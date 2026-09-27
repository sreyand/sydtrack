'use strict';

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('error', (err) => { console.error(err); process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code == null ? 1 : code; });
  return;
}

// Isolated renderer verification: no preload, tracking service, or user data access.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-ui-')));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1040, height: 760,
    webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  const results = [];
  const layoutChecks = [];
  await win.webContents.executeJavaScript(`(() => {
    const style = document.createElement('style');
    style.textContent = '* { transition: none !important; animation: none !important; }';
    document.head.append(style);
  })()`);
  const contrastChecks = await win.webContents.executeJavaScript(`(() => {
    const parse = value => {
      const parts = String(value).match(/[\\d.]+/g) || [];
      return [Number(parts[0] || 0), Number(parts[1] || 0), Number(parts[2] || 0), parts[3] == null ? 1 : Number(parts[3])];
    };
    const composite = (fg, bg) => {
      const alpha = fg[3] + bg[3] * (1 - fg[3]);
      return [0, 1, 2].map(i => (fg[i] * fg[3] + bg[i] * bg[3] * (1 - fg[3])) / (alpha || 1)).concat(alpha);
    };
    const luminance = rgba => {
      const channel = value => {
        const n = value / 255;
        return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(rgba[0]) + 0.7152 * channel(rgba[1]) + 0.0722 * channel(rgba[2]);
    };
    const ratio = (fgValue, bgValue) => {
      const bg = parse(bgValue);
      const fg = composite(parse(fgValue), bg);
      const a = luminance(fg);
      const b = luminance(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const effectiveBackground = element => {
      const layers = [];
      for (let node = element; node; node = node.parentElement) {
        layers.push(parse(getComputedStyle(node).backgroundColor));
      }
      let result = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i--) result = composite(layers[i], result);
      return 'rgba(' + result.join(',') + ')';
    };
    const tip = document.getElementById('pie-tip');
    tip.classList.remove('hidden');
    tip.innerHTML = '<div class="pt-cat unproductive">Unproductive · top apps</div><ul><li><span class="pt-name">chrome</span><span class="pt-secs">42:47</span></li></ul>';
    const profileMenu = document.getElementById('focus-profile-menu');
    profileMenu.innerHTML = '<button class="profile-choice" aria-pressed="true">Coding</button>';
    const profileInput = document.getElementById('profile-name');
    const checks = [];
    for (const theme of ['midnight', 'graphite', 'coral', 'starlight', 'dusk']) {
      applyTheme(theme);
      const samples = [
        ['body', document.body, document.body],
        ['tooltip name', tip.querySelector('.pt-name'), tip],
        ['tooltip time', tip.querySelector('.pt-secs'), tip],
        ['tooltip category', tip.querySelector('.pt-cat'), tip],
        ['focusboost label', document.querySelector('.fb-focus'), document.querySelector('.focusboost-btn')],
        ['profile choice', profileMenu.querySelector('.profile-choice'), profileMenu.querySelector('.profile-choice')],
        ['profile input', profileInput, profileInput],
        ['timeline heading', document.getElementById('timeline-heading'), document.querySelector('.timeline-card')],
        ['timeline note', document.getElementById('timeline-precision'), document.querySelector('.timeline-card')],
        ['timeline date', document.getElementById('timeline-date'), document.getElementById('timeline-date')],
        ['longest block', document.getElementById('timeline-longest'), document.querySelector('.timeline-card')],
        ['data disclosure', document.querySelector('.storage-details summary'), document.querySelector('.storage-details summary')],
        ['data explanation', document.querySelector('.storage-details-body p'), document.querySelector('.storage-details-body')]
      ];
      for (const [name, foreground, background] of samples) {
        const fg = getComputedStyle(foreground).color;
        const bg = effectiveBackground(background);
        checks.push({ theme, name, ratio: Number(ratio(fg, bg).toFixed(2)), fg, bg });
      }
    }
    applyTheme('midnight');
    tip.classList.add('hidden');
    profileMenu.innerHTML = '';
    return checks;
  })()`);
  console.log('Theme contrast checks:', JSON.stringify(contrastChecks));
  const timelineChecks = await win.webContents.executeJavaScript(`(() => {
    const date = document.getElementById('timeline-date').value;
    const [y, m, d] = date.split('-').map(Number);
    const at = hour => new Date(y, m - 1, d, hour).getTime();
    timelineDayData = { date, timeline: [
      { start: at(9), end: at(11), kind: 'productive', profileId: 'coding' },
      { start: at(11), end: at(12), kind: 'idle', profileId: null },
      { start: at(12), end: at(13), kind: 'unproductive', profileId: 'default' }
    ], byHour: [{ productive: 7200, unproductive: 3600, other: 0 }] };
    renderTimeline();
    const blocks = document.querySelectorAll('#timeline-visual .timeline-block').length;
    const text = document.getElementById('timeline-text').textContent;
    const longest = document.getElementById('timeline-longest').textContent;
    const defaultSpan = timelineViewport.end - timelineViewport.start;
    const exactHourlyHidden = document.getElementById('day-hourly-card').classList.contains('hidden');
    const visual = document.getElementById('timeline-visual');
    const pinch = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, clientX: 400, cancelable: true });
    visual.dispatchEvent(pinch);
    const pinchZoomed = pinch.defaultPrevented && timelineViewport.end - timelineViewport.start < defaultSpan;
    const recenter = document.getElementById('timeline-recenter');
    const recenterBox = recenter.getBoundingClientRect();
    const cardBox = recenter.closest('.timeline-card').getBoundingClientRect();
    const recenterBottomRight = !recenter.classList.contains('hidden') &&
      cardBox.right - recenterBox.right < 50 && cardBox.bottom - recenterBox.bottom < 50;
    recenter.click();
    const buttonReset = recenter.classList.contains('hidden') && timelineViewport.end - timelineViewport.start === defaultSpan;
    visual.dispatchEvent(pinch);
    const reset = new KeyboardEvent('keydown', { key: '0', bubbles: true, cancelable: true });
    visual.dispatchEvent(reset);
    const keyboardReset = reset.defaultPrevented && timelineViewport.end - timelineViewport.start === defaultSpan;
    const axis = document.querySelectorAll('#timeline-visual .timeline-axis span').length;
    const overviewLabel = document.getElementById('timeline-precision').textContent.includes('overview');
    const noControls = !document.getElementById('timeline-category') && !document.getElementById('timeline-profile') &&
      !document.querySelector('.timeline-details') && document.getElementById('timeline-visual').getAttribute('aria-describedby') === 'timeline-text';
    timelineDayData = { date, timeline: Array.from({ length: 180 }, (_, i) => ({
      start: at(19) + i * 60000, end: at(19) + (i + 1) * 60000,
      kind: i % 2 ? 'unproductive' : 'productive', profileId: 'default'
    })), byHour: [] };
    renderTimeline();
    const denseBlocks = document.querySelectorAll('#timeline-visual .timeline-block').length;
    const denseOverview = document.getElementById('timeline-precision').textContent.includes('overview');
    const denseMixed = !document.getElementById('timeline-mixed-key').classList.contains('hidden');
    timelineDayData = { date, timeline: [], byHour: [{ productive: 7200 }] };
    renderTimeline();
    const older = document.getElementById('timeline-precision').textContent;
    const oldHidden = document.getElementById('timeline-visual').classList.contains('hidden');
    const oldLongestHidden = document.getElementById('timeline-longest').classList.contains('hidden');
    const olderHourlyShown = !document.getElementById('day-hourly-card').classList.contains('hidden');
    return { blocks, text, longest, noControls, older, oldHidden, oldLongestHidden,
      axis, defaultSpan, exactHourlyHidden, pinchZoomed, keyboardReset, buttonReset, recenterBottomRight,
      overviewLabel, denseBlocks, denseOverview, denseMixed, olderHourlyShown };
  })()`);
  console.log('Timeline checks:', JSON.stringify(timelineChecks));
  await win.webContents.executeJavaScript(`(() => {
    const date = document.getElementById('timeline-date').value;
    const [y, m, d] = date.split('-').map(Number);
    const at = (h, min = 0) => new Date(y, m - 1, d, h, min).getTime();
    timelineDayData = { date, timeline: [
      { start: at(8), end: at(10, 30), kind: 'productive', profileId: 'coding' },
      { start: at(10, 30), end: at(11), kind: 'idle', profileId: null },
      { start: at(11), end: at(12, 30), kind: 'unproductive', profileId: 'default' },
      { start: at(13), end: at(15), kind: 'productive', profileId: 'coding' }
    ], byHour: Array.from({ length: 24 }, (_, hour) => ({ productive: hour >= 8 && hour <= 14 ? 2400 : 0, unproductive: hour === 11 ? 3600 : 0, other: 0 })) };
    renderTimeline();
    renderDay(timelineDayData);
    document.getElementById('view-home').classList.add('hidden');
    document.getElementById('view-analytics').classList.remove('hidden');
    document.querySelector('.main').scrollTop = 0;
    applyTheme('coral');
  })()`);
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-timeline-coral.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(() => { applyTheme('midnight'); document.getElementById('view-analytics').classList.add('hidden'); document.getElementById('view-home').classList.remove('hidden'); })()`);
  const boostSyncChecks = await win.webContents.executeJavaScript(`(() => {
    const button = document.getElementById('focusboost-btn');
    const base = { thresholdSec: 600, focusBoostSec: 180, focusBoostScheduleEnabled: false };
    applySettingsInputs({ ...base, focusBoost: false });
    applySettingsInputs({ ...base, focusBoost: true, thresholdSec: 180 });
    const trayEnabled = button.dataset.boost === 'on' && button.classList.contains('armed');
    applySettingsInputs({ ...base, focusBoost: false });
    const trayDisabled = button.dataset.boost === 'off' && !button.classList.contains('armed');
    return { trayEnabled, trayDisabled };
  })()`);
  console.log('External focusboost sync:', JSON.stringify(boostSyncChecks));
  const timedPauseUi = await win.webContents.executeJavaScript(`(() => {
    const deadline = Date.now() + 15 * 60 * 1000;
    syncPauseUi({ trackingPaused: true, trackingPauseUntil: deadline });
    const active = document.getElementById('pause-btn').getAttribute('aria-pressed') === 'true' &&
      document.getElementById('pause-until-status').textContent.startsWith('Resumes at ');
    syncPauseUi({ trackingPaused: false, trackingPauseUntil: 0 });
    const cleared = document.getElementById('pause-btn').getAttribute('aria-pressed') === 'false' &&
      document.getElementById('pause-until-status').classList.contains('hidden');
    return { active, cleared };
  })()`);
  console.log('Timed pause UI:', JSON.stringify(timedPauseUi));
  for (const width of [800, 1040, 1600]) {
    win.setSize(width, 760);
    for (const collapsed of [false, true]) {
      layoutChecks.push(await win.webContents.executeJavaScript(`(async () => {
        document.body.classList.toggle('nav-collapsed', ${collapsed});
        document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-sessions'));
        document.querySelector('[data-session-mode="custom"]').click();
        await new Promise(resolve => requestAnimationFrame(resolve));
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const center = selector => { const r = rect(selector); return r.x + r.width / 2; };
        const mobile = innerWidth <= 900;
        const rail = rect('.rail');
        const sidebarAligned = mobile || !${collapsed} || ['.logo-mark', '#nav-toggle', '.nav-btn', '#notif-btn', '#pause-btn', '#source-pill'].every(s => Math.abs(center(s) - center('.rail')) <= 1);
        const mobileRail = !mobile || (rail.width >= rect('.shell').width - 1 && rect('#nav-toggle').width === 0);
        const customAligned = Math.abs(center('#session-custom-min') - center('#session-start-btn')) <= 1;
        const card = rect('#session-timer-card');
        const controlsInside = ['#session-custom-min', '#session-start-btn', '.session-mode-control'].every(s => { const r = rect(s); return r.left >= card.left && r.right <= card.right; });
        return { width: innerWidth, collapsed: ${collapsed}, sidebarAligned, mobileRail, customAligned, controlsInside };
      })()`));
      if (width === 1040 && collapsed) {
        await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-sessions-layout.png'), (await win.webContents.capturePage()).toPNG());
      }
    }
  }
  console.log('Layout checks:', JSON.stringify(layoutChecks));
  await win.webContents.executeJavaScript("document.body.classList.remove('nav-collapsed')");
  for (const width of [800, 1040, 1600]) {
    win.setSize(width, 760);
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    results.push(await win.webContents.executeJavaScript(`(() => {
      const results = [];
      for (const id of ['pie-tip', 'day-tip', 'week-tip']) {
        const tip = document.getElementById(id);
        tip.closest('.view').classList.remove('hidden');
        const panel = tip.closest('.analytics-panel');
        if (panel) panel.classList.remove('hidden');
        const hourlyCard = tip.closest('#day-hourly-card');
        const hourlyWasHidden = hourlyCard && hourlyCard.classList.contains('hidden');
        if (hourlyCard) hourlyCard.classList.remove('hidden');
        tip.classList.remove('hidden');
        tip.style.left = '0px'; tip.style.top = '0px';
        tip.innerHTML = '<div class="pt-cat">Productive · top apps</div><ul><li><span class="pt-name app-trunc">Intel Connectivity Performance Suite with a very long application name</span><span class="pt-secs">123:59:59</span></li></ul>';
        const box = tip.getBoundingClientRect();
        const time = tip.querySelector('.pt-secs').getBoundingClientRect();
        results.push({ id, width: innerWidth, overflow: tip.scrollWidth > tip.clientWidth + 1, timeInside: time.right <= box.right - 10 });
        if (hourlyWasHidden) hourlyCard.classList.add('hidden');
      }
      return results;
    })()`));
  }
  console.log(JSON.stringify(results.flat()));
  const tagChecks = await win.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('tags-quick-input');
    input.value = 'youtube';
    fillRulesEditors({ productive: [], unproductive: ['youtube'] });
    const loaded = document.getElementById('tags-quick-status').textContent.includes('Unproductive');
    document.getElementById('rules-unprod-edit').value = '';
    document.getElementById('rules-unprod-edit').dispatchEvent(new Event('input'));
    const removed = document.getElementById('tags-quick-status').textContent.includes('not in any list');
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('hidden', view.id !== 'view-home'));
    const siteKey = keywordForQuickClassify({ app: 'chrome', title: 'Unhelpful title', url: 'https://example.com' }) === 'site:example.com';
    const siteCategory = defaultCategoryFromRules({ app: 'chrome', url: 'https://learn.youtube.com', title: 'youtube' }, { productive: ['site:learn.youtube.com'], unproductive: ['youtube'] }, []) === 'productive';
    if (!siteKey || !siteCategory) throw new Error('Website quick tagging or classification failed');
    fillRulesEditors({ productive: ['github'], unproductive: ['youtube'], browserApps: ['researchtool'] });
    const genericBrowsers = ['Browser.exe', 'Research Browser', 'Firefox', 'LibreWolf', 'researchtool'].every(app =>
      isBrowserApp(app) && defaultCategoryFromRules({ app, title: 'YouTube video' }, cachedRules, []) === 'unproductive');
    const nativeEditor = !isBrowserApp('chrome-helper.exe') && !isBrowserApp('Code');
    if (!genericBrowsers || !nativeEditor) throw new Error('Browser identity/classification mismatch in renderer');
    return { loaded, removed, siteKey, siteCategory, genericBrowsers, nativeEditor };
  })()`);
  console.log('Tag input checks:', JSON.stringify(tagChecks));
  const titleOnlyCheck = await win.webContents.executeJavaScript(`(async () => {
    currentPlatform = 'win32';
    document.getElementById('tags-quick-input').value = 'site:example.com';
    await tagsQuickAdd('productive');
    const blocked = document.getElementById('tags-quick-status').textContent.includes('title word');
    currentPlatform = null;
    return blocked;
  })()`);
  const segmentChecks = await win.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-segment="week"]').click();
    document.querySelector('[data-session-mode="custom"]').click();
    const analyticsPreserved = document.querySelector('[data-segment="week"]').classList.contains('active');
    document.querySelector('[data-segment="apps"]').click();
    const sessionPreserved = document.querySelector('[data-session-mode="custom"]').classList.contains('active');
    return { analyticsPreserved, sessionPreserved };
  })()`);
  console.log('Independent segment checks:', JSON.stringify(segmentChecks));
  const hoverChecks = await win.webContents.executeJavaScript(`(async () => {
    const results = [];
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('hidden', view.id !== 'view-analytics'));
    document.querySelector('.main').scrollTop = 0;
    document.getElementById('day-hourly-card').classList.remove('hidden');
    for (const mode of ['day', 'week']) {
      setAnalyticsSegment(mode);
      const stats = { date: '2026-09-09', byHour: Array.from({length: 24}, () => ({productive: 0, unproductive: 0, other: 0, byApp: {}})), week: [] };
      const update = (i) => {
        stats.byHour[12] = { productive: 60 + i, unproductive: 0, other: 0, byApp: { ['Refresh ' + i]: {seconds: 60 + i, category: 'productive'} } };
        stats.week = [{date: '2026-09-09', byCategory: {productive: 60 + i}, topApps: [{name: 'Refresh ' + i, seconds: 60 + i, category: 'productive'}]}];
        (mode === 'day' ? renderDay : renderWeek)(stats);
      };
      update(0);
      const chart = document.getElementById(mode + '-chart');
      chart.scrollIntoView({block: 'center'});
      const col = chart.querySelector('.day-col:not(.empty)');
      const rect = col.getBoundingClientRect();
      col.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2}));
      const tip = document.getElementById(mode + '-tip');
      let stayedVisible = !tip.classList.contains('hidden');
      for (let i = 1; i <= 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 750));
        update(i);
        stayedVisible = stayedVisible && !tip.classList.contains('hidden') && tip.textContent.includes('Refresh ' + i);
      }
      chart.dispatchEvent(new MouseEvent('mouseleave'));
      update(4);
      const leftHidden = tip.classList.contains('hidden');
      results.push({mode, stayedVisible, leftHidden});
    }
    renderTimeline();
    return results;
  })()`);
  console.log('Stationary hover checks:', JSON.stringify(hoverChecks));
  const homePieNavigation = await win.webContents.executeJavaScript(`(() => {
    document.querySelector('.nav-btn[data-tab="home"]').click();
    renderPie({ byCategory: { productive: 60, unproductive: 30, other: 10 }, topApps: [] });
    appsRange = 'week';
    const pie = document.getElementById('pie-chart');
    const rect = pie.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height * 0.08;
    pie.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y }));
    const reachedDayApps = !document.getElementById('view-analytics').classList.contains('hidden') &&
      !document.getElementById('panel-apps').classList.contains('hidden') && appsRange === 'day' &&
      document.querySelector('[data-apps-range="day"]').getAttribute('aria-pressed') === 'true';
    document.querySelector('.nav-btn[data-tab="home"]').click();
    pie.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    const keyboardWorks = !document.getElementById('panel-apps').classList.contains('hidden') &&
      !document.getElementById('view-analytics').classList.contains('hidden');
    document.querySelector('.nav-btn[data-tab="home"]').click();
    renderPie({ byCategory: { productive: 0, unproductive: 0, other: 0 }, topApps: [] });
    pie.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y }));
    const emptyStaysHome = !document.getElementById('view-home').classList.contains('hidden');
    return { reachedDayApps, keyboardWorks, emptyStaysHome };
  })()`);
  console.log('Home pie navigation:', JSON.stringify(homePieNavigation));
  await win.webContents.executeJavaScript(`(() => {
    renderAppList({ date: '2026-09-25', appBreakdown: [
      { name: 'Chrome', category: 'unproductive', seconds: 20 },
      { name: 'Chrome', category: 'productive', seconds: 10 }
    ], activityRows: [
      { id: 'a', name: 'Chrome', reason: 'youtube', category: 'unproductive', seconds: 20 },
      { id: 'b', name: 'Chrome', reason: 'github', category: 'productive', seconds: 10 },
      { id: 'c', name: 'Chrome', reason: '<legacy>', category: 'ignored', seconds: 5 },
      { id: 'd', name: 'Chrome', reason: 'No matching rule', category: 'other', seconds: 0 }
    ] });
    const list = document.getElementById('app-list');
    if (list.children.length !== 1 || list.querySelectorAll('.app-activity').length !== 4 ||
      list.querySelector('.app-group-details').open || !list.textContent.includes('U 20s') ||
      !list.textContent.includes('youtube') || list.querySelector('legacy') ||
      !document.getElementById('apps-donut').getAttribute('aria-label').includes('Chrome, 30s'))
      throw new Error('Compact mixed-app summary or collapsed activity failed');
    list.querySelector('.app-group-details summary').click();
    if (!list.querySelector('.app-group-details').open)
      throw new Error('App activity disclosure failed');
    const groups = [...list.querySelectorAll('.app-activity-type')].map(node => node.getAttribute('aria-label'));
    if (groups.join(',') !== 'productive activity,unproductive activity,other activity,ignored activity' ||
      /productive|unproductive/i.test(list.querySelector('.app-group-mix').textContent) ||
      !list.querySelector('.app-activity[data-row-id="d"] .app-activity-reason')?.textContent.includes('Default ruleset') ||
      !list.querySelector('.app-group-duration.productive') || !list.querySelector('.app-group-duration.unproductive') ||
      list.querySelector('.app-group-head > span'))
      throw new Error('Category groups, colored durations, or compact Day summary failed');
    const current = id => list.querySelector('.app-activity[data-row-id="' + id + '"] .app-activity-category:disabled');
    if (list.querySelectorAll('.app-activity-category').length !== 16 ||
      current('a')?.dataset.category !== 'unproductive' || current('b')?.dataset.category !== 'productive' ||
      current('c')?.dataset.category !== 'ignored' || current('d')?.dataset.category !== 'other' ||
      list.querySelector('.app-activity-change'))
      throw new Error('P/U/O/I buttons do not reflect each activity’s current category');
    const active = current('b');
    const available = list.querySelector('.app-activity[data-row-id="a"] .app-activity-category[data-category="productive"]');
    if (getComputedStyle(active).color === getComputedStyle(available).color ||
      getComputedStyle(active).borderColor === getComputedStyle(available).borderColor)
      throw new Error('Current category should be colored and outlined; available buttons should stay neutral');
    const rowTops = [...list.querySelectorAll('.app-activity-row')].map(row => row.getBoundingClientRect().top);
    const rowGaps = rowTops.slice(1).map((top, index) => top - rowTops[index]);
    if (Math.max(...rowGaps) - Math.min(...rowGaps) > 1)
      throw new Error('Activity rows have uneven gaps between categories');
    list.querySelector('.app-group-details').open = false;
  })()`);
  win.setSize(1100, 850);
  const appsChecks = await win.webContents.executeJavaScript(`(async () => {
    renderAppList({ date: '2026-09-25', appBreakdown: [
      { name: 'Chrome', category: 'productive', seconds: 5400 },
      { name: 'Chrome', category: 'unproductive', seconds: 1800 },
      { name: 'Code', category: 'productive', seconds: 4200 },
      { name: 'Discord', category: 'unproductive', seconds: 1800 },
      { name: 'Notion', category: 'productive', seconds: 900 }
    ], activityRows: [
      { id: 'a', name: 'Chrome', reason: 'github', category: 'productive', seconds: 5400 },
      { id: 'b', name: 'Chrome', reason: 'youtube', category: 'unproductive', seconds: 1800 },
      { id: 'c', name: 'Code', reason: 'App identity', category: 'productive', seconds: 4200 },
      { id: 'd', name: 'Discord', reason: 'discord', category: 'unproductive', seconds: 1800 },
      { id: 'e', name: 'Notion', reason: 'notion', category: 'productive', seconds: 900 }
    ] });
    document.querySelector('[data-tab="analytics"]').click();
    setAnalyticsSegment('apps');
    document.querySelector('.main').scrollTop = 0;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const panel = document.getElementById('panel-apps');
    const tab = document.querySelector('.analytics-apps-tab').getBoundingClientRect();
    const leftTabs = document.querySelector('.analytics-toolbar .segment-control').getBoundingClientRect();
    const overview = panel.querySelector('.apps-overview').getBoundingClientRect();
    const details = panel.querySelector('.apps-detail-card').getBoundingClientRect();
    const total = document.getElementById('apps-total');
    const normal = total.textContent;
    total.textContent = '23h 59m';
    const number = total.getBoundingClientRect();
    const center = document.querySelector('.apps-donut-center').getBoundingClientRect();
    const centerPadding = Math.min(number.left - center.left, center.right - number.right);
    total.textContent = normal;
    appsRange = 'week'; appsHistoryRange = 'week';
    appsHistoryDays = [{ date: '2026-09-24', apps: [{ name: 'Chrome', category: 'unproductive', seconds: 3600 }] },
      { date: '2026-09-25', apps: [] }];
    renderAppList(lastAppsStats);
    const weekly = document.getElementById('apps-period-label').textContent.includes('Last 7 days') &&
      document.querySelectorAll('#app-list .app-activity-category').length === 0 &&
      document.getElementById('apps-total').textContent === '4h 55m';
    appsRange = 'day'; appsHistoryRange = null; renderAppList(lastAppsStats);
    return { overflow: panel.scrollWidth > panel.clientWidth + 1,
      cardGap: details.top - overview.bottom, centerPadding, weekly,
      appsOnRight: tab.left > leftTabs.right + 20,
      slices: document.querySelectorAll('#apps-legend li').length,
      mixed: document.querySelector('.app-group-mix').textContent.includes('P 1h 30m') && document.querySelector('.app-group-mix').textContent.includes('U 30m'),
      collapsed: !document.querySelector('.app-group-details').open,
      rows: document.querySelectorAll('.app-activity').length };
  })()`);
  console.log('Apps analytics checks:', JSON.stringify(appsChecks));
  await win.webContents.executeJavaScript("applyTheme('coral')");
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-apps-light.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.querySelector('.app-group-details summary').click(); document.querySelector('.apps-detail-card').scrollIntoView({block:'start'})");
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-apps-detail.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.querySelector('.main').scrollTop = 0");
  await win.webContents.executeJavaScript("applyTheme('midnight')");
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-apps-dark.png'), (await win.webContents.capturePage()).toPNG());
  const historyChecks = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-tab="analytics"]').click();
    setAnalyticsSegment('month');
    await loadAnalyticsHistory(async count => Array.from({length: count}, (_, i) => ({
      date: '2026-08-' + String(i + 1).padStart(2, '0'),
      byCategory: {productive: 3600, unproductive: 1200, other: 600}
    })));
    const panel = document.getElementById('month-history');
    const scoreCard = document.getElementById('month-focus-scores');
    return { share: document.getElementById('month-focus-share').textContent, visible: !document.getElementById('panel-month').classList.contains('hidden'),
      overflow: panel.scrollWidth > panel.clientWidth + 1, scoreCells: document.querySelectorAll('.month-score-day').length,
      scoreHeight: scoreCard.getBoundingClientRect().height };
  })()`);
  console.log('History checks:', JSON.stringify(historyChecks));
  const lifetimeChecks = await win.webContents.executeJavaScript(`(() => {
    setAnalyticsSegment('lifetime');
    renderLifetime({ totalSeconds: 36000, byCategory: { productive: 21600, unproductive: 10800, other: 3600 },
      activeDays: 4, firstDay: '2026-01-01', averageSeconds: 9000,
      longestDay: { date: '2026-01-03', seconds: 14400 } });
    const panel = document.getElementById('panel-lifetime');
    return { visible: !panel.classList.contains('hidden'), total: document.getElementById('lifetime-total').textContent,
      days: document.getElementById('lifetime-days').textContent, bars: panel.querySelectorAll('.lifetime-track > span').length,
      overflow: panel.scrollWidth > panel.clientWidth + 1 };
  })()`);
  console.log('Lifetime checks:', JSON.stringify(lifetimeChecks));
  const roundupEvidence = await win.webContents.executeJavaScript(`(() => {
    const stats = { date: '2026-09-25', byCategory: { productive: 120, unproductive: 90, other: 60 },
      topApps: [
        { name: 'chrome', category: 'productive', seconds: 120, topMatch: { reason: 'github', seconds: 120 } },
        { name: 'chrome', category: 'unproductive', seconds: 90, topMatch: { reason: 'youtube', seconds: 90 } }
      ], otherApps: [{ name: 'Unmatched App', category: 'other', seconds: 60 }] };
    renderRoundup(stats);
    const story = document.getElementById('roundup-story');
    return { productive: story.textContent.includes('github'), unproductive: story.textContent.includes('youtube'),
      redundantCardRemoved: !document.getElementById('tags-other-card') };
  })()`);
  console.log('Roundup evidence checks:', JSON.stringify(roundupEvidence));
  const settingsChecks = await win.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-tab="settings"]').click();
    const visible = name => !document.getElementById('settings-panel-' + name).classList.contains('hidden');
    const initial = visible('tracking') && !visible('wellbeing') && !visible('notifications');
    document.querySelector('[data-settings-tab="wellbeing"]').click();
    applySettingsInputs({ breakReminderEnabled: true, breakReminderMinutes: 45, notificationsEnabled: true });
    const wellbeing = visible('wellbeing') && !document.getElementById('break-reminder-field').classList.contains('hidden') &&
      document.getElementById('break-reminder-minutes').value === '45' && document.getElementById('goals-settings').closest('#settings-panel-wellbeing') != null;
    document.querySelector('[data-settings-tab="notifications"]').click();
    const notifications = visible('notifications') && document.getElementById('settings-reminder-timing').closest('#settings-panel-notifications') != null &&
      document.getElementById('fb-schedule-toggle').closest('#settings-panel-notifications') != null;
    document.querySelector('[data-settings-tab="tracking"]').click();
    applySettingsInputs({ profileShortcut: 'Alt+B' });
    const shortcut = document.getElementById('profile-shortcut').value === 'Alt+B' &&
      document.getElementById('profile-shortcut').closest('#settings-panel-tracking') != null &&
      document.getElementById('profile-shortcut').options.length === 4 &&
      document.querySelector('#profile-shortcut-settings .settings-block-title').textContent === 'Focus profile hotswap' &&
      document.getElementById('profile-shortcut-status').classList.contains('hidden') &&
      !document.getElementById('profile-shortcut-settings').textContent.includes('Cycles through');
    const storage = document.getElementById('settings-storage-details');
    storage.open = true;
    const storageText = storage.textContent;
    const dataPrivacy = storage.closest('#settings-data-card') != null && storageText.includes("app you're using") &&
      storageText.includes('does not read browser addresses') && storageText.includes('90 days') &&
      storageText.includes('lifetime stats') && storageText.includes('No screenshots') &&
      document.getElementById('data-path').closest('#settings-data-card') != null;
    return { initial, wellbeing, notifications, dataPrivacy, shortcut,
      overflow: document.getElementById('view-settings').scrollWidth > document.getElementById('view-settings').clientWidth + 1 };
  })()`);
  console.log('Settings tabs checks:', JSON.stringify(settingsChecks));
  await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('settings-storage-details').scrollIntoView({block: 'center'});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-data.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-tab="settings"]').click();
    document.querySelector('[data-settings-tab="wellbeing"]').click();
    document.querySelector('.main').scrollTop = 0;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-wellbeing.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-history.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const screenshot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-home.png'), screenshot.toPNG());
  await win.webContents.executeJavaScript("document.querySelector('.nav-btn[data-tab=\"sessions\"]').click(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-sessions.png'), (await win.webContents.capturePage()).toPNG());
  const sessionDayChecks = await win.webContents.executeJavaScript(`(() => {
    const today = localDateKey();
    fillSessionDaySelect({ date: '2026-09-24', recentDays: [] });
    const select = document.getElementById('session-day-select');
    return { todayPresent: [...select.options].some(option => option.value === today && option.textContent.includes('today')),
      historicalSelected: select.value === '2026-09-24', minutesRightAligned: getComputedStyle(document.getElementById('session-custom-min')).textAlign === 'right' };
  })()`);
  console.log('Session control checks:', JSON.stringify(sessionDayChecks));
  win.setSize(1040, 760);
  const onboardingChecks = await win.webContents.executeJavaScript(`(() => {
    document.getElementById('onboarding-screen').classList.remove('hidden');
    document.querySelector('.shell').inert = true;
    applyTheme('midnight');
    const screen = document.getElementById('onboarding-screen');
    const card = screen.querySelector('.onboarding-card');
    const rect = card.getBoundingClientRect();
    return { visible: !screen.classList.contains('hidden'),
      generalSelected: document.querySelector('input[name="onboarding-profile"]:checked').value === 'default',
      startupSelected: document.getElementById('onboarding-startup').checked,
      currentCopy: card.textContent.includes('See the pattern, not every move.') && card.textContent.includes('Private by default.') &&
        card.textContent.includes('No screenshots') && card.textContent.includes('Choose a starting profile'),
      fits: rect.left >= 0 && rect.top >= 32 && rect.right <= innerWidth && rect.bottom <= innerHeight };
  })()`);
  console.log('Onboarding checks:', JSON.stringify(onboardingChecks));
  await win.webContents.executeJavaScript(`(async () => {
    document.querySelectorAll('.scroll-active').forEach(area => area.classList.remove('scroll-active'));
    await new Promise(resolve => setTimeout(resolve, 250));
  })()`);
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-onboarding-midnight.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("applyTheme('graphite')");
  await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 250))');
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-onboarding-graphite.png'), (await win.webContents.capturePage()).toPNG());
  const scrollbarChecks = await win.webContents.executeJavaScript(`(async () => {
    const area = document.querySelector('.main');
    area.classList.remove('scroll-active');
    area.dispatchEvent(new PointerEvent('pointermove'));
    const appeared = area.classList.contains('scroll-active');
    await new Promise(resolve => setTimeout(resolve, 1200));
    return { appeared, faded: !area.classList.contains('scroll-active') };
  })()`);
  console.log('Scrollbar checks:', JSON.stringify(scrollbarChecks));
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-results.json'), JSON.stringify(results.flat(), null, 2));
  const failed = contrastChecks.some(check => check.ratio < 4.5) || timelineChecks.blocks < 1 || timelineChecks.blocks > 24 || !timelineChecks.text.includes('Idle') || timelineChecks.text.includes('Untracked') || timelineChecks.axis < 2 || timelineChecks.defaultSpan >= 86400000 || !timelineChecks.exactHourlyHidden || !timelineChecks.pinchZoomed || !timelineChecks.keyboardReset || !timelineChecks.buttonReset || !timelineChecks.recenterBottomRight || !timelineChecks.overviewLabel || !timelineChecks.denseOverview || !timelineChecks.denseMixed || timelineChecks.denseBlocks > 24 || !timelineChecks.olderHourlyShown || !timelineChecks.longest.includes('Longest productive block: 2h') || !timelineChecks.noControls || !timelineChecks.older.includes('hourly totals') || !timelineChecks.oldHidden || !timelineChecks.oldLongestHidden || !boostSyncChecks.trayEnabled || !boostSyncChecks.trayDisabled || !timedPauseUi.active || !timedPauseUi.cleared || results.flat().some((r) => r.overflow || !r.timeInside) || !tagChecks.loaded || !tagChecks.removed || !titleOnlyCheck || hoverChecks.some(r => !r.stayedVisible || !r.leftHidden) || !segmentChecks.analyticsPreserved || !segmentChecks.sessionPreserved;
  app.exit(failed || !homePieNavigation.reachedDayApps || !homePieNavigation.keyboardWorks || !homePieNavigation.emptyStaysHome || appsChecks.overflow || appsChecks.cardGap > 20 || appsChecks.centerPadding < 10 || !appsChecks.weekly || !appsChecks.appsOnRight || appsChecks.slices !== 4 || !appsChecks.mixed || !appsChecks.collapsed || appsChecks.rows !== 5 || historyChecks.share !== '75%' || !historyChecks.visible || historyChecks.overflow || historyChecks.scoreCells !== 30 || historyChecks.scoreHeight > 520 || !lifetimeChecks.visible || lifetimeChecks.total !== '10h tracked' || lifetimeChecks.days !== '4' || lifetimeChecks.bars !== 3 || lifetimeChecks.overflow || !roundupEvidence.productive || !roundupEvidence.unproductive || !roundupEvidence.redundantCardRemoved || !settingsChecks.initial || !settingsChecks.wellbeing || !settingsChecks.notifications || !settingsChecks.dataPrivacy || !settingsChecks.shortcut || settingsChecks.overflow || !sessionDayChecks.todayPresent || !sessionDayChecks.historicalSelected || !sessionDayChecks.minutesRightAligned || !onboardingChecks.visible || !onboardingChecks.generalSelected || !onboardingChecks.startupSelected || !onboardingChecks.currentCopy || !onboardingChecks.fits || !scrollbarChecks.appeared || !scrollbarChecks.faded || layoutChecks.some(r => !r.sidebarAligned || !r.mobileRail || !r.customAligned || !r.controlsInside) ? 1 : 0);
}).catch((error) => { console.error(error); app.exit(1); });

setTimeout(() => { console.error('UI checks timed out'); app.exit(1); }, 30000).unref();
