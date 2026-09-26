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
        ['profile input', profileInput, profileInput]
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
        tip.classList.remove('hidden');
        tip.style.left = '0px'; tip.style.top = '0px';
        tip.innerHTML = '<div class="pt-cat">Productive · top apps</div><ul><li><span class="pt-name app-trunc">Intel Connectivity Performance Suite with a very long application name</span><span class="pt-secs">123:59:59</span></li></ul>';
        const box = tip.getBoundingClientRect();
        const time = tip.querySelector('.pt-secs').getBoundingClientRect();
        results.push({ id, width: innerWidth, overflow: tip.scrollWidth > tip.clientWidth + 1, timeInside: time.right <= box.right - 10 });
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
    return results;
  })()`);
  console.log('Stationary hover checks:', JSON.stringify(hoverChecks));
  await win.webContents.executeJavaScript(`(() => {
    renderAppList({ activityRows: [
      { id: 'a', name: 'Chrome', reason: 'youtube', category: 'unproductive', seconds: 20 },
      { id: 'b', name: 'Chrome', reason: 'github', category: 'productive', seconds: 10 },
      { id: 'c', name: 'Chrome', reason: '<legacy>', category: 'ignored', seconds: 5 }
    ] });
    const list = document.getElementById('app-list');
    if (list.children.length !== 3 || list.querySelectorAll('button.selected').length !== 3 || !list.textContent.includes('youtube') || list.querySelector('legacy')) throw new Error('Activity rows/reasons/highlights failed');
  })()`);
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
    renderOtherInbox(stats);
    const story = document.getElementById('roundup-story');
    const other = document.getElementById('tags-other-card');
    other.querySelector('button').click();
    return { productive: story.textContent.includes('github'), unproductive: story.textContent.includes('youtube'),
      otherVisible: !other.hidden, previewApp: document.getElementById('tags-preview-app').value };
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
    return { initial, wellbeing, notifications, overflow: document.getElementById('view-settings').scrollWidth > document.getElementById('view-settings').clientWidth + 1 };
  })()`);
  console.log('Settings tabs checks:', JSON.stringify(settingsChecks));
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
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-results.json'), JSON.stringify(results.flat(), null, 2));
  const failed = contrastChecks.some(check => check.ratio < 4.5) || !boostSyncChecks.trayEnabled || !boostSyncChecks.trayDisabled || !timedPauseUi.active || !timedPauseUi.cleared || results.flat().some((r) => r.overflow || !r.timeInside) || !tagChecks.loaded || !tagChecks.removed || !titleOnlyCheck || hoverChecks.some(r => !r.stayedVisible || !r.leftHidden) || !segmentChecks.analyticsPreserved || !segmentChecks.sessionPreserved;
  app.exit(failed || historyChecks.share !== '75%' || !historyChecks.visible || historyChecks.overflow || historyChecks.scoreCells !== 30 || historyChecks.scoreHeight > 520 || !lifetimeChecks.visible || lifetimeChecks.total !== '10h tracked' || lifetimeChecks.days !== '4' || lifetimeChecks.bars !== 3 || lifetimeChecks.overflow || !roundupEvidence.productive || !roundupEvidence.unproductive || !roundupEvidence.otherVisible || roundupEvidence.previewApp !== 'Unmatched App' || !settingsChecks.initial || !settingsChecks.wellbeing || !settingsChecks.notifications || settingsChecks.overflow || layoutChecks.some(r => !r.sidebarAligned || !r.mobileRail || !r.customAligned || !r.controlsInside) ? 1 : 0);
}).catch((error) => { console.error(error); app.exit(1); });

setTimeout(() => { console.error('UI checks timed out'); app.exit(1); }, 20000).unref();
