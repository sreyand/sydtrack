'use strict';

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
  child.on('error', (err) => { console.error(err); process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code == null ? 1 : code; });
  return;
}

// Isolated renderer verification: no preload, tracking service, or user data access.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { THEME_IDS } = require('../src/theme');
const THEME_PICKER_ORDER = ['midnight', 'tide', 'plum', 'forest', 'dusk', 'linen', 'graphite', 'coral', 'starlight'];
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
      // Chromium returns color-mix() as color(srgb ...) with channels in 0–1.
      const scale = String(value).startsWith('color(srgb ') ? 255 : 1;
      return [Number(parts[0] || 0) * scale, Number(parts[1] || 0) * scale, Number(parts[2] || 0) * scale, parts[3] == null ? 1 : Number(parts[3])];
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
    const categoryProbe = document.createElement('div');
    categoryProbe.className = 'last-focused';
    categoryProbe.innerHTML = ['prod', 'unprod', 'other', 'ignore'].map(kind => '<button class="btn-mini selected ' + kind + '">P</button>').join('');
    document.querySelector('.card').append(categoryProbe);
    const checks = [];
    for (const theme of ${JSON.stringify(THEME_IDS)}) {
      applyTheme(theme);
      const samples = [
        ['body', document.body, document.body],
        ['phrase title', document.getElementById('quick-rule-title'), document.getElementById('last-focused')],
        ['phrase input', document.getElementById('quick-rule-keyword'), document.getElementById('quick-rule-keyword')],
        ['phrase save', document.getElementById('quick-rule-save'), document.getElementById('quick-rule-save')],
        ['Undo message', document.getElementById('correction-undo-message'), document.getElementById('correction-undo')],
        ['Undo action', document.getElementById('correction-undo-action'), document.getElementById('correction-undo-action')],
        ['Undo dismiss', document.getElementById('correction-undo-dismiss'), document.getElementById('correction-undo-dismiss')],
        ['update status', document.getElementById('updates-status'), document.getElementById('settings-updates-card')],
        ['update action', document.getElementById('updates-open'), document.getElementById('updates-open')],
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
      if (['tide', 'linen', 'plum', 'forest'].includes(theme)) {
        const selected = document.querySelector('[data-theme-id="' + theme + '"]');
        samples.push(
          ['selected theme', selected, selected],
          ['primary button', document.getElementById('rules-save'), document.getElementById('rules-save')],
          ['danger button', document.getElementById('data-clear-all'), document.getElementById('data-clear-all')],
          ['privacy warning', document.querySelector('.privacy-warning strong'), document.querySelector('.privacy-warning')],
          ['privacy explanation', document.querySelector('.privacy-warning p'), document.querySelector('.privacy-warning')]
        );
        for (const kind of ['prod', 'unprod', 'other', 'ignore']) {
          const button = categoryProbe.querySelector('.' + kind);
          samples.push(['selected ' + kind, button, button]);
        }
      }
      for (const [name, foreground, background] of samples) {
        const fg = getComputedStyle(foreground).color;
        const bg = effectiveBackground(background);
        checks.push({ theme, name, ratio: Number(ratio(fg, bg).toFixed(2)), fg, bg });
      }
    }
    applyTheme('midnight');
    categoryProbe.remove();
    tip.classList.add('hidden');
    profileMenu.innerHTML = '';
    return checks;
  })()`);
  console.log('Theme contrast checks:', JSON.stringify(THEME_IDS.map(theme => ({ theme,
    samples: contrastChecks.filter(check => check.theme === theme).length,
    minRatio: Math.min(...contrastChecks.filter(check => check.theme === theme).map(check => check.ratio)) }))));
  if (contrastChecks.some(check => check.ratio < 4.5)) {
    console.error('Low-contrast samples:', JSON.stringify(contrastChecks.filter(check => check.ratio < 4.5)));
  }
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
        const footer = ['#notif-btn', '#pause-btn', '#source-pill'].map(rect);
        const footerRhythm = mobile || !${collapsed} || (footer.every(r => r.width === 44 && r.height === 44) &&
          footer.slice(1).every((r, i) => Math.abs(r.top - footer[i].bottom - 8) <= 1));
        const footerInside = footer.every(r => r.top >= rail.top && r.bottom <= rail.bottom && r.left >= rail.left && r.right <= rail.right);
        const mobileRail = !mobile || (rail.width >= rect('.shell').width - 1 && rect('#nav-toggle').width === 0);
        const customAligned = Math.abs(center('#session-custom-min') - center('#session-start-btn')) <= 1;
        const card = rect('#session-timer-card');
        const controlsInside = ['#session-custom-min', '#session-start-btn', '.session-mode-control'].every(s => { const r = rect(s); return r.left >= card.left && r.right <= card.right; });
        return { width: innerWidth, collapsed: ${collapsed}, sidebarAligned, footerRhythm, footerInside, mobileRail, customAligned, controlsInside };
      })()`));
      if (width === 1040 && collapsed) {
        await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-sessions-layout.png'), (await win.webContents.capturePage()).toPNG());
      }
    }
  }
  console.log('Layout checks:', JSON.stringify(layoutChecks));
  if (layoutChecks.some(check => !check.footerRhythm || !check.footerInside)) throw new Error('Sidebar footer spacing or containment failed');
  const footerStateChecks = [];
  for (const height of [600, 760]) {
    win.setSize(1040, height);
    footerStateChecks.push(await win.webContents.executeJavaScript(`(async () => {
      document.body.classList.add('nav-collapsed');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = el => el.getBoundingClientRect();
      const rail = rect(document.querySelector('.rail'));
      const before = rect(document.querySelector('.rail-foot'));
      const checks = [];
      for (const source of ['real', 'demo', 'paused', 'idle', 'fallback-demo']) {
        updateSourcePill({ source });
        syncNotifUi({ notificationsEnabled: source !== 'paused' });
        syncPauseUi({ trackingPaused: source === 'paused' });
        const pill = document.getElementById('source-pill');
        const footer = rect(document.querySelector('.rail-foot'));
        const controls = ['notif-btn', 'pause-btn', 'source-pill'].map(id => rect(document.getElementById(id)));
        const dot = getComputedStyle(pill, '::before');
        checks.push({ source, height: innerHeight,
          stable: footer.top === before.top && footer.height === before.height,
          contained: controls.every(r => r.top >= rail.top && r.bottom <= rail.bottom),
          dot: dot.width === '8px' && dot.height === '8px' && getComputedStyle(pill).backgroundColor === 'rgba(0, 0, 0, 0)',
          labeled: pill.title === pill.textContent && !!pill.title });
      }
      syncNotifUi({ notificationsEnabled: true }); syncPauseUi({ trackingPaused: false }); updateSourcePill({ source: 'real' });
      return checks;
    })()`));
  }
  console.log('Footer state checks:', JSON.stringify(footerStateChecks.flat()));
  if (footerStateChecks.flat().some(check => !check.stable || !check.contained || !check.dot || !check.labeled)) throw new Error('Sidebar footer state layout failed');
  const themePickerChecks = [];
  win.setSize(1040, 760);
  for (const theme of ['tide', 'linen', 'plum', 'forest']) {
    themePickerChecks.push(await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('[data-tab="home"]').click();
      document.body.classList.add('nav-collapsed');
      document.querySelector('[data-theme-id="${theme}"]').click();
      if ('${theme}' === 'forest') {
        const stats = { date: localDateKey(), byCategory: { productive: 10800, unproductive: 2400, other: 1200 },
          topApps: [{ name: 'Code', seconds: 10800, category: 'productive' }, { name: 'Chrome', seconds: 2400, category: 'unproductive' }] };
        renderPie(stats);
        renderMood({ ...stats, mood: { id: 'focused', ratio: 0.82 } });
        renderLastFocused({ app: 'Code', title: 'Synthetic project', category: 'productive', source: 'real' });
        document.querySelector('.main').scrollTop = 0;
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const selected = [...document.querySelectorAll('[data-theme-id][aria-pressed="true"]')];
      return { theme: '${theme}', applied: document.documentElement.dataset.theme === '${theme}',
        selected: selected.length === 1 && selected[0].dataset.themeId === '${theme}',
        forestCanvas: '${theme}' !== 'forest' || getComputedStyle(document.body).backgroundColor === 'rgb(17, 27, 22)' };
    })()`));
    const filename = theme === 'forest' ? 'sydtrack-ui-forest-home.png' : 'sydtrack-theme-' + theme + '.png';
    // Hidden-window capture can otherwise return the preceding compositor frame.
    if (theme === 'forest') await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 200))');
    fs.writeFileSync(path.join(os.tmpdir(), filename), (await win.webContents.capturePage()).toPNG());
  }
  console.log('Theme picker checks:', JSON.stringify(themePickerChecks));
  if (themePickerChecks.some(check => !check.applied || !check.selected || !check.forestCanvas)) throw new Error('Theme picker failed');
  const themePickerLayouts = [];
  for (const width of [800, 1040, 1600]) {
    win.setSize(width, 760);
    const contentWidth = win.getContentSize()[0];
    await win.webContents.executeJavaScript(`(async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (Math.abs(innerWidth - ${contentWidth}) <= 1) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Theme chooser did not receive the requested window width');
    })()`);
    themePickerLayouts.push(await win.webContents.executeJavaScript(`(async () => {
      document.body.classList.remove('nav-collapsed');
      document.querySelector('[data-tab="settings"]').click();
      document.querySelector('[data-settings-tab="tracking"]').click();
      applyTheme('forest');
      const card = document.getElementById('settings-appearance-card');
      card.scrollIntoView({ block: 'center' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const picker = card.querySelector('.theme-swatches');
      const bounds = picker.getBoundingClientRect();
      const buttons = [...picker.querySelectorAll('[data-theme-id]')];
      const rects = buttons.map(button => button.getBoundingClientRect());
      const rows = new Set(rects.map(rect => Math.round(rect.top))).size;
      // These compact choices can all fit naturally even at 800px. Prove the
      // wrap behavior under a narrower chooser without changing app styling.
      const originalMaxWidth = picker.style.maxWidth;
      picker.style.maxWidth = '360px';
      const wrappedBounds = picker.getBoundingClientRect();
      const wrappedRects = buttons.map(button => button.getBoundingClientRect());
      const wrappedRows = new Set(wrappedRects.map(rect => Math.round(rect.top))).size;
      const wraps = getComputedStyle(picker).flexWrap === 'wrap' && wrappedRows > 1 &&
        wrappedRects.every(rect => rect.left >= wrappedBounds.left - 1 && rect.right <= wrappedBounds.right + 1);
      picker.style.maxWidth = originalMaxWidth;
      return { width: innerWidth, rows, constrainedRows: wrappedRows,
        order: buttons.map(button => button.dataset.themeId).join(',') === ${JSON.stringify(THEME_PICKER_ORDER.join(','))},
        wraps,
        contained: rects.every(rect => rect.width > 0 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1),
        noOverlap: rects.every((rect, index) => rects.slice(index + 1).every(other =>
          rect.right <= other.left + 1 || other.right <= rect.left + 1 || rect.bottom <= other.top + 1 || other.bottom <= rect.top + 1)),
        textFits: buttons.every(button => button.scrollWidth <= button.clientWidth + 1),
        noPageOverflow: document.querySelector('.main').scrollWidth <= document.querySelector('.main').clientWidth + 1,
        forestSelected: buttons.filter(button => button.getAttribute('aria-pressed') === 'true').length === 1 &&
          picker.querySelector('[data-theme-id="forest"]').getAttribute('aria-pressed') === 'true' };
    })()`));
    if (width === 1040) fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-forest-settings.png'), (await win.webContents.capturePage()).toPNG());
  }
  console.log('Dark-to-light theme picker layouts:', JSON.stringify(themePickerLayouts));
  if (themePickerLayouts.some(check => !check.order || !check.wraps || !check.contained || !check.noOverlap || !check.textFits || !check.noPageOverflow || !check.forestSelected))
    throw new Error('Theme chooser ordering or wrapping failed');
  await win.webContents.executeJavaScript("applyTheme('midnight')");
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
  const explanationChecks = [];
  for (const width of [800, 1040, 1600]) {
    win.setSize(width, 760);
    await new Promise(resolve => setTimeout(resolve, 80));
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const result = await win.webContents.executeJavaScript(`(async () => {
      const check = (value, message) => { if (!value) throw new Error(message); };
      document.querySelectorAll('.view').forEach(view => view.classList.toggle('hidden', view.id !== 'view-home'));
      ['pie-tip', 'day-tip', 'week-tip', 'name-tip'].forEach(id => document.getElementById(id).classList.add('hidden'));
      const chip = document.getElementById('lf-cat'), tip = document.getElementById('lf-explanation');
      chip.blur(); window.sydtrackCategoryUI.hide();
      const entry = { app: 'chrome', title: 'Admissions - r/jhu', category: 'unproductive', source: 'real',
        explanation: { category: 'unproductive', kind: 'rule', rule: 'r/', origin: 'profile', profileId: 'default', profileName: 'Default' } };
      renderLastFocused(entry);
      check(tip.classList.contains('hidden') && !chip.disabled && chip.tagName === 'BUTTON', 'Explanation is available without a permanent subtitle: ' + JSON.stringify({ hidden: tip.classList.contains('hidden'), disabled: chip.disabled, tag: chip.tagName, cache: lastFocusedCache, module: !!window.sydtrackCategoryUI }));
      chip.dispatchEvent(new MouseEvent('mouseenter'));
      check(!tip.classList.contains('hidden') && tip.textContent.includes('Matched “r/” in the default profile.'), 'Hover identifies the real winning rule rather than the subreddit group');
      renderLastFocused(entry);
      check(!tip.classList.contains('hidden'), 'An unchanged tracking tick preserves an open explanation');
      chip.focus();
      check(chip.getAttribute('aria-describedby') === 'lf-explanation-text' && chip.getAttribute('aria-expanded') === 'true', 'Keyboard focus exposes the explanation accessibly');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      check(tip.classList.contains('hidden') && !chip.hasAttribute('aria-describedby') && document.activeElement === chip, 'Escape dismisses without moving keyboard focus');
      chip.click();
      check(!tip.classList.contains('hidden'), 'Click can pin the explanation');
      chip.click();
      check(tip.classList.contains('hidden'), 'A second click dismisses the explanation');
      renderLastFocused({ ...entry, category: 'other', explanation: { category: 'other', kind: 'today' } });
      chip.dispatchEvent(new MouseEvent('mouseenter'));
      check(tip.textContent.includes('today only') && tip.textContent.includes('Future profile rules are unchanged'), 'Today corrections are distinct from future profile rules');
      renderLastFocused({ ...entry, title: 'New unknown page', category: 'other', explanation: { category: 'other', kind: 'none' } });
      check(tip.classList.contains('hidden'), 'Changing pages clears stale explanation copy');
      chip.click();
      check(tip.textContent.includes('No matching rule'), 'Other explains uncertainty without a productivity judgment');
      renderLastFocused({ ...entry, explanation: { ...entry.explanation, rule: '<img src=x onerror=alert(1)>', profileName: 'A very long profile name '.repeat(4) } });
      chip.click();
      check(!tip.querySelector('img') && tip.textContent.includes('<img src=x'), 'Rule and profile text is rendered literally, never as HTML');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = tip.getBoundingClientRect();
      const contained = rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && tip.scrollWidth <= tip.clientWidth + 1;
      check(contained, 'Long explanation remains inside the viewport');
      for (const theme of ${JSON.stringify(THEME_IDS)}) {
        applyTheme(theme);
        const body = getComputedStyle(tip), heading = getComputedStyle(tip.querySelector('.lf-explanation-heading'));
        const parse = value => (value.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
        const lum = value => parse(value).map(n => { n /= 255; return n <= 0.04045 ? n / 12.92 : Math.pow((n + .055) / 1.055, 2.4); }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
        const contrast = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
        check(contrast(body.color, body.backgroundColor) >= 4.5 && contrast(heading.color, body.backgroundColor) >= 4.5, 'Explanation is readable in ' + theme);
      }
      applyTheme('midnight');
      renderLastFocused(entry); chip.blur(); chip.click();
      document.querySelector('.nav-btn[data-tab="analytics"]').click();
      check(tip.classList.contains('hidden'), 'Leaving Home closes the explanation');
      document.querySelector('.nav-btn[data-tab="home"]').click();
      renderLastFocused({ ...entry, source: 'demo' }); chip.click();
      check(tip.textContent.includes('Demo activity'), 'Demo explanation is explicitly labeled');
      renderLastFocused(null, null);
      check(chip.disabled && tip.classList.contains('hidden'), 'Waiting state has no invented explanation');
      renderLastFocused(entry); chip.blur(); chip.click();
      return { width: innerWidth, contained, hoverAndKeyboard: true, scopes: true, safeText: true };
    })()`);
    explanationChecks.push(result);
    if (width === 1040) {
      await win.webContents.executeJavaScript(`(() => {
        renderPie({ byCategory: { productive: 5400, unproductive: 1800, other: 1200 } });
        renderLastFocused({ app: 'chrome', title: 'Admissions - r/jhu', category: 'unproductive', source: 'real',
          explanation: { category: 'unproductive', kind: 'rule', rule: 'r/', origin: 'profile', profileId: 'default', profileName: 'Default' } });
        document.getElementById('lf-cat').dispatchEvent(new MouseEvent('mouseenter'));
        if (document.getElementById('lf-explanation').classList.contains('hidden')) throw new Error('Explanation preview is not visible');
      })()`);
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-category-explanation.png'), (await win.webContents.capturePage()).toPNG());
    }
  }
  console.log('Category explanation UI checks:', JSON.stringify(explanationChecks));
  await win.webContents.executeJavaScript('window.sydtrackCategoryUI.hide()');
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
    const noGuess = keywordForQuickClassify({ app: 'chrome', title: 'How to do it - Google Chrome' }) === null;
    fillRulesEditors({ productive: ['jhu', 'r/learnpython'], unproductive: ['r/'], productiveApps: ['code'] });
    const subreddit = { app: 'chrome', title: 'Discussion - r/jhu - Google Chrome', category: 'unproductive' };
    const preciseKey = keywordForQuickClassify(subreddit) === 'r/jhu';
    const sourceWins = defaultCategoryFromRules(subreddit) === 'unproductive';
    const preciseException = defaultCategoryFromRules({ app: 'chrome', title: 'Question - r/learnpython' }) === 'productive';
    const nativeIdentity = defaultCategoryFromRules({ app: 'Code', title: 'Project r/jhu notes' }) === 'productive';
    const ignoreBoundary = defaultCategoryFromRules({ app: 'discord-helper', title: '' }, {}, ['cord']) === 'other';
    renderLastFocused({ app: 'chrome', title: 'Google - Google Chrome', category: 'other' });
    const unknownSafe = ['lf-prod', 'lf-unprod', 'lf-other'].every(id => !document.getElementById(id).disabled && document.getElementById(id).title.includes('Choose a title phrase')) &&
      !document.getElementById('lf-ignore').disabled && document.getElementById('lf-cat').textContent === 'other';
    renderLastFocused(subreddit);
    const recognizedEnabled = !document.getElementById('lf-prod').disabled && document.getElementById('lf-prod').title.includes('r/jhu');
    fillRulesEditors({ productive: ['google chrome'], unproductive: [] });
    const ruleNotice = !document.getElementById('tags-rule-notice').classList.contains('hidden');
    fillRulesEditors({ productive: ['github'], unproductive: ['youtube'] });
    const quietWhenSafe = document.getElementById('tags-rule-notice').classList.contains('hidden');
    if (![noGuess, preciseKey, sourceWins, preciseException, nativeIdentity, ignoreBoundary, unknownSafe, recognizedEnabled, ruleNotice, quietWhenSafe].every(Boolean))
      throw new Error('Safe quick rules, source exceptions, native identities, or browser-name notice failed');
    return { loaded, removed, siteKey, siteCategory, genericBrowsers, nativeEditor, noGuess, preciseKey, sourceWins, preciseException, unknownSafe, recognizedEnabled, ruleNotice };
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
      !list.querySelector('.app-activity[data-row-id="d"] .app-activity-reason')?.textContent.includes('Unrecognized pages') ||
      !list.querySelector('.app-group-duration.productive') || !list.querySelector('.app-group-duration.unproductive') ||
      list.querySelector('.app-group-head > span'))
      throw new Error('Category groups, colored durations, or compact Day summary failed');
    const current = id => list.querySelector('.app-activity[data-row-id="' + id + '"] .app-activity-category:disabled[aria-pressed="true"]');
    if (list.querySelectorAll('.app-activity-category').length !== 16 ||
      current('a')?.dataset.category !== 'unproductive' || current('b')?.dataset.category !== 'productive' ||
      current('c')?.dataset.category !== 'ignored' || current('d')?.dataset.category !== 'other' ||
      list.querySelector('.app-activity-change'))
      throw new Error('P/U/O/I buttons do not reflect each activity’s current category');
    if ([...list.querySelectorAll('.app-activity[data-row-id="d"] button')].some(button => !button.disabled))
      throw new Error('Unrecognized browser pages must not be reclassified as one rule');
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
  const coverageChecks = await win.webContents.executeJavaScript(`(() => {
    const stats = { date: '2026-09-25', byCategory: { productive: 3600, unproductive: 0, other: 25200 },
      settings: { focusShareIncludeOther: false }, mood: { id: 'thriving', ratio: 1 }, topApps: [] };
    renderRoundup(stats);
    renderMood(stats);
    const partial = document.getElementById('roundup-headline').textContent === 'Partial picture' &&
      document.getElementById('roundup-goal-card').dataset.hit === 'na' &&
      document.getElementById('roundup-goal-value').textContent === '100%' &&
      document.getElementById('roundup-goal-basis').textContent === 'Based on 1h of 8h tracked' &&
      document.getElementById('mood-label').textContent.includes('Partial picture') &&
      document.getElementById('mood-block').dataset.mood === 'meh' &&
      getComputedStyle(document.getElementById('roundup-goal-fill')).backgroundColor ===
        getComputedStyle(document.querySelector('.month-dot.other')).backgroundColor;
    stats.byCategory = { productive: 3600, unproductive: 900, other: 900 };
    renderRoundup(stats);
    const scored = document.getElementById('roundup-goal-card').dataset.hit === 'yes' &&
      document.getElementById('roundup-headline').textContent === 'Goal reached';
    stats.byCategory = { productive: 3600, unproductive: 0, other: 25200 };
    stats.settings.focusShareIncludeOther = true;
    renderRoundup(stats);
    const included = document.getElementById('roundup-goal-card').dataset.hit === 'no' &&
      document.getElementById('roundup-goal-value').textContent === '13%' &&
      document.getElementById('roundup-goal-basis').textContent === 'Of all 8h tracked';
    if (!partial || !scored || !included) throw new Error('Focus share coverage or goal verdict failed');
    stats.settings.focusShareIncludeOther = false;
    renderRoundup(stats);
    return { partial, scored, included };
  })()`);
  console.log('Focus coverage checks:', JSON.stringify(coverageChecks));
  await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-tab="roundup"]').click();
    applyTheme('midnight'); document.querySelector('.main').scrollTop = 0;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (document.getElementById('view-roundup').classList.contains('hidden')) throw new Error('Coverage preview did not reach Roundup');
  })()`);
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-focus-coverage.png'), (await win.webContents.capturePage()).toPNG());
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
      document.querySelector('#profile-shortcut-settings .settings-field-label').textContent === 'Focus profile hotswap' &&
      document.getElementById('profile-shortcut-status').classList.contains('hidden') &&
      getComputedStyle(document.querySelector('.profile-shortcut-row')).borderBottomWidth === '0px' &&
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
  const breakReminderChecks = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-settings-tab="wellbeing"]').click();
    const saved = { theme: 'midnight', breakReminderEnabled: true, breakReminderMinutes: 45 };
    const changes = [];
    const realPushSettings = pushSettings;
    const minutes = document.getElementById('break-reminder-minutes');
    const toggle = document.getElementById('break-reminder-toggle');
    minutes.blur();
    applySettingsInputs(saved);
    // Exercise the existing handlers with an in-memory saved preference, never
    // a production preload, tracker, profile, or settings file.
    pushSettings = async partial => {
      changes.push({ ...partial });
      Object.assign(saved, partial);
      applySettingsInputs({ ...saved });
      return { ...saved };
    };
    try {
      minutes.value = '65';
      minutes.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      const edited = saved.breakReminderMinutes === 65 && !minutes.disabled;
      toggle.click();
      await Promise.resolve();
      const disabledPreserves = saved.breakReminderEnabled === false && saved.breakReminderMinutes === 65 &&
        minutes.disabled && minutes.value === '65' && minutes.getClientRects().length > 0;
      toggle.click();
      await Promise.resolve();
      const reenabledPreserves = saved.breakReminderEnabled === true && saved.breakReminderMinutes === 65 &&
        !minutes.disabled && minutes.value === '65';
      const exactChanges = JSON.stringify(changes) === JSON.stringify([
        { breakReminderMinutes: 65 }, { breakReminderEnabled: false }, { breakReminderEnabled: true }
      ]);
      return { edited, disabledPreserves, reenabledPreserves, exactChanges };
    } finally { pushSettings = realPushSettings; }
  })()`);
  console.log('Inline Breaks preference checks:', JSON.stringify(breakReminderChecks));
  if (!Object.values(breakReminderChecks).every(Boolean)) throw new Error('Inline Breaks changed saved-minute or enable/disable behavior');
  const settingsGeometryChecks = [];
  for (const width of [800, 1040, 1600]) {
    win.setSize(width, 760);
    const contentWidth = win.getContentSize()[0];
    await win.webContents.executeJavaScript(`(async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (Math.abs(innerWidth - ${contentWidth}) <= 1) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Settings geometry did not receive the requested window width');
    })()`);
    settingsGeometryChecks.push(...await win.webContents.executeJavaScript(`(() => {
      document.body.classList.remove('nav-collapsed');
      document.querySelector('[data-tab="settings"]').click();
      const results = [];
      const shown = node => !node.hidden && node.getClientRects().length > 0 && node.getBoundingClientRect().width > 0;
      for (const theme of ['midnight', 'linen', 'forest']) {
        for (const screenEnabled of [false, true]) {
          for (const breakEnabled of [false, true]) {
            applySettingsInputs({ theme, screenTimeLimitEnabled: screenEnabled, screenTimeLimitSec: 28800,
              breakReminderEnabled: breakEnabled, breakReminderMinutes: 45, notificationsEnabled: breakEnabled,
              focusBoostScheduleEnabled: breakEnabled, focusBoostScheduleStart: '09:00', focusBoostScheduleEnd: '17:00' });
            for (const tab of ['wellbeing', 'notifications']) {
              document.querySelector('[data-settings-tab="' + tab + '"]').click();
              const panel = document.getElementById('settings-panel-' + tab);
              const controls = [...panel.querySelectorAll('input, select, textarea, .schedule-time-trigger')].filter(shown);
              const rects = controls.map(control => control.getBoundingClientRect());
              const gaps = [...panel.querySelectorAll('.field')].filter(field => shown(field) &&
                getComputedStyle(field).flexDirection === 'column').map(field => {
                  const control = [...field.children].find(node => node.matches('input, select, textarea') && shown(node)) ||
                    field.querySelector('.schedule-time-trigger');
                  const label = [...field.children].find(node => node !== control);
                  return control.getBoundingClientRect().top - label.getBoundingClientRect().bottom;
                });
              const titles = [...panel.querySelectorAll('.settings-block-title')];
              const breaks = document.getElementById('settings-breaks');
              const lastBreakField = breaks.querySelector('.break-reminder-row');
              const breakCopy = document.getElementById('break-reminder-field');
              const breakMinutes = document.getElementById('break-reminder-minutes');
              const breakToggle = document.getElementById('break-reminder-toggle');
              const sentenceParts = ['break-reminder-label', 'break-reminder-minutes', 'break-reminder-unit']
                .map(id => document.getElementById(id).getBoundingClientRect());
              const breakInlineGaps = tab === 'wellbeing' ? sentenceParts.slice(1).flatMap((rect, index) => {
                const previous = sentenceParts[index];
                return Math.abs(rect.top + rect.height / 2 - previous.top - previous.height / 2) <= 2
                  ? [rect.left - previous.right] : [];
              }) : [];
              const wellbeingSections = tab === 'wellbeing' ? [document.getElementById('goals-settings'), breaks] : [];
              const wellbeingHeadingGaps = wellbeingSections.map(section => {
                const title = section.querySelector(':scope > .settings-block-title');
                const firstRow = [...section.children].find(node => node.matches('.field, .switch-row') && shown(node));
                return firstRow.getBoundingClientRect().top - title.getBoundingClientRect().bottom;
              });
              const wellbeingHelperGaps = tab === 'wellbeing' ? [...panel.querySelectorAll('.switch-row .hint')].filter(shown).map(hint => {
                const title = hint.parentElement.querySelector('.switch-title');
                return hint.getBoundingClientRect().top - title.getBoundingClientRect().bottom;
              }) : [];
              const wellbeingFinalRows = wellbeingSections.map(section =>
                [...section.children].filter(node => node.matches('.field, .switch-row') && shown(node)).at(-1));
              let threeDigitBreakFits = true;
              if (tab === 'wellbeing') {
                const previousMinutes = breakMinutes.value;
                breakMinutes.value = '240';
                const style = getComputedStyle(breakMinutes);
                const context = document.createElement('canvas').getContext('2d');
                context.font = style.font;
                const contentWidth = breakMinutes.getBoundingClientRect().width -
                  ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((total, name) => total + parseFloat(style[name]), 0);
                // Leave room for native number steppers, in addition to the text.
                threeDigitBreakFits = breakMinutes.value === '240' && breakMinutes.scrollWidth <= breakMinutes.clientWidth + 1 &&
                  context.measureText('240').width + 18 <= contentWidth;
                breakMinutes.value = previousMinutes;
              }
              results.push({ width: innerWidth, theme, tab, screenEnabled, breakEnabled,
                minGap: gaps.length ? Math.min(...gaps) : null, maxGap: gaps.length ? Math.max(...gaps) : null,
                tightGaps: gaps.every(gap => gap >= 6 && gap <= 10) && (tab !== 'notifications' || gaps.length === 6),
                contained: controls.every((control, index) => {
                  const card = control.closest('.card').getBoundingClientRect();
                  return rects[index].left >= card.left && rects[index].right <= card.right && rects[index].width > 0;
                }),
                noOverlap: rects.every((rect, index) => rects.slice(index + 1).every(other =>
                  rect.right <= other.left + 1 || other.right <= rect.left + 1 || rect.bottom <= other.top + 1 || other.bottom <= rect.top + 1)),
                noPageOverflow: panel.scrollWidth <= panel.clientWidth + 1 &&
                  document.querySelector('.main').scrollWidth <= document.querySelector('.main').clientWidth + 1,
                headings: titles.map(title => title.textContent.trim()).join(',') === (tab === 'wellbeing' ? 'Daily goals,Breaks' : '') &&
                  titles.every(title => getComputedStyle(title).textTransform === 'none'),
                visibility: tab !== 'wellbeing' || shown(document.getElementById('screen-limit-field')) === screenEnabled &&
                  shown(document.getElementById('break-reminder-field')) &&
                  document.getElementById('break-reminder-minutes').disabled === !breakEnabled &&
                  document.getElementById('break-reminder-minutes').value === '45',
                inlineBreak: tab !== 'wellbeing' || lastBreakField.textContent.replace(/\\s+/g, ' ').trim() === 'Remind me to take a break after minutes' &&
                  [...breakCopy.children].map(node => node.id).join(',') === 'break-reminder-label,break-reminder-minutes,break-reminder-unit' &&
                  breakCopy.tagName === 'LABEL' && breakCopy.htmlFor === breakMinutes.id &&
                  breakMinutes.getAttribute('aria-labelledby') === 'break-reminder-label break-reminder-unit' &&
                  !lastBreakField.querySelector('label label') && !breakToggle.closest('label') &&
                  breakToggle.getAttribute('aria-label') === 'Enable break reminders',
                breakSentenceFits: tab !== 'wellbeing' || sentenceParts.every(rect => rect.left >= breakCopy.getBoundingClientRect().left - 1 &&
                  rect.right <= breakCopy.getBoundingClientRect().right + 1) &&
                  breakCopy.getBoundingClientRect().right <= breakToggle.getBoundingClientRect().left + 1 &&
                  Math.abs(breakToggle.getBoundingClientRect().right - lastBreakField.getBoundingClientRect().right) <= 1 &&
                  (innerWidth <= 900 || sentenceParts.every(rect => Math.abs(rect.top + rect.height / 2 -
                    sentenceParts[0].top - sentenceParts[0].height / 2) <= 2)),
                threeDigitBreakFits,
                regularBreakText: tab !== 'wellbeing' || getComputedStyle(breakCopy).fontWeight === '400',
                breakWeight: tab === 'wellbeing' ? getComputedStyle(breakCopy).fontWeight : null,
                spacedBreakBox: tab !== 'wellbeing' || getComputedStyle(breakCopy).columnGap === '12px' &&
                  getComputedStyle(breakCopy).rowGap === '12px' && breakInlineGaps.every(gap => gap >= 11 && gap <= 13),
                minBreakGap: breakInlineGaps.length ? Math.min(...breakInlineGaps) : null,
                maxBreakGap: breakInlineGaps.length ? Math.max(...breakInlineGaps) : null,
                wellbeingRhythm: tab !== 'wellbeing' || wellbeingHeadingGaps.every(gap => gap >= 7 && gap <= 9) &&
                  wellbeingHelperGaps.every(gap => gap >= 3 && gap <= 5) &&
                  wellbeingFinalRows.every(row => getComputedStyle(row).paddingBottom === '0px'),
                minHeadingGap: wellbeingHeadingGaps.length ? Math.min(...wellbeingHeadingGaps) : null,
                maxHeadingGap: wellbeingHeadingGaps.length ? Math.max(...wellbeingHeadingGaps) : null,
                minHelperGap: wellbeingHelperGaps.length ? Math.min(...wellbeingHelperGaps) : null,
                maxHelperGap: wellbeingHelperGaps.length ? Math.max(...wellbeingHelperGaps) : null,
                cleanBottom: tab !== 'wellbeing' || getComputedStyle(lastBreakField).borderBottomWidth === '0px',
                scheduleState: tab !== 'notifications' || document.getElementById('fb-schedule-start').disabled === !breakEnabled &&
                  document.getElementById('fb-schedule-end').disabled === !breakEnabled &&
                  document.getElementById('fb-schedule-start-trigger').disabled === !breakEnabled &&
                  document.getElementById('fb-schedule-end-trigger').disabled === !breakEnabled });
            }
          }
        }
      }
      return results;
    })()`));
  }
  const settingsGeometryFailures = settingsGeometryChecks.filter(check => !check.tightGaps || !check.contained || !check.noOverlap ||
    !check.noPageOverflow || !check.headings || !check.visibility || !check.inlineBreak || !check.breakSentenceFits ||
    !check.threeDigitBreakFits || !check.regularBreakText || !check.spacedBreakBox || !check.wellbeingRhythm || !check.cleanBottom || !check.scheduleState);
  const measuredGaps = settingsGeometryChecks.filter(check => check.minGap != null);
  const measuredBreakGaps = settingsGeometryChecks.filter(check => check.minBreakGap != null);
  const measuredWellbeingGaps = settingsGeometryChecks.filter(check => check.minHeadingGap != null);
  console.log('Settings compact field geometry:', JSON.stringify({ cases: settingsGeometryChecks.length,
    widths: [...new Set(settingsGeometryChecks.map(check => check.width))],
    themes: [...new Set(settingsGeometryChecks.map(check => check.theme))],
    minGap: Math.min(...measuredGaps.map(check => check.minGap)), maxGap: Math.max(...measuredGaps.map(check => check.maxGap)),
    minBreakGap: Math.min(...measuredBreakGaps.map(check => check.minBreakGap)), maxBreakGap: Math.max(...measuredBreakGaps.map(check => check.maxBreakGap)),
    breakFontWeights: [...new Set(measuredWellbeingGaps.map(check => check.breakWeight))],
    minHeadingGap: Math.min(...measuredWellbeingGaps.map(check => check.minHeadingGap)), maxHeadingGap: Math.max(...measuredWellbeingGaps.map(check => check.maxHeadingGap)),
    minHelperGap: Math.min(...measuredWellbeingGaps.map(check => check.minHelperGap)), maxHelperGap: Math.max(...measuredWellbeingGaps.map(check => check.maxHelperGap)),
    failures: settingsGeometryFailures.slice(0, 8), failureCount: settingsGeometryFailures.length }));
  if (settingsGeometryFailures.length) throw new Error('Compact Settings geometry failed');
  win.setSize(1040, 900);
  for (const tab of ['wellbeing', 'notifications']) {
    await win.webContents.executeJavaScript(`(async () => {
      applySettingsInputs({ theme: 'midnight', screenTimeLimitEnabled: true, screenTimeLimitSec: 28800,
        breakReminderEnabled: true, breakReminderMinutes: 45, notificationsEnabled: true, focusBoostScheduleEnabled: true });
      document.querySelector('[data-settings-tab="${tab}"]').click();
      document.querySelector('.main').scrollTop = 0;
      await new Promise(resolve => setTimeout(resolve, 200));
    })()`);
    fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-settings-' + tab + '-clean.png'), (await win.webContents.capturePage()).toPNG());
    if (tab === 'wellbeing') {
      await win.webContents.executeJavaScript(`(async () => {
        applySettingsInputs({ ...latestGoalSettings, breakReminderEnabled: false });
        await new Promise(resolve => setTimeout(resolve, 200));
      })()`);
      fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-ui-settings-wellbeing-disabled-clean.png'), (await win.webContents.capturePage()).toPNG());
    }
  }
  win.setSize(1040, 760);
  await win.webContents.executeJavaScript(`document.querySelector('[data-settings-tab="tracking"]').click()`);
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

setTimeout(() => { console.error('UI checks timed out'); app.exit(1); }, 45000).unref();
