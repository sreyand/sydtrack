'use strict';

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('child_process').spawn(require('electron'), [__filename], {
    env, stdio: 'inherit', windowsHide: true
  });
  const timeout = setTimeout(() => { console.error('Tab transition checks timed out'); child.kill(); }, 90000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('exit', code => { clearTimeout(timeout); process.exitCode = code == null ? 1 : code; });
  return;
}

// The shipped renderer and sandboxed preload run with synthetic IPC and an
// isolated userData directory. No tracker, startup registration, personal data,
// native shortcut, installer, or network request is started by this harness.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-tab-transitions-'));
const userData = path.join(temporary, 'user-data');
fs.mkdirSync(userData);
app.setPath('appData', temporary);
app.setPath('userData', userData);
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const { todayKey } = require('../src/store');
  const today = todayKey();
  const noon = new Date(today + 'T12:00:00');
  const dateAt = offset => todayKey(new Date(noon.getFullYear(), noon.getMonth(), noon.getDate() - offset, 12).getTime());
  const historyApps = [{ name: 'History editor', category: 'productive', seconds: 2400 },
    { name: 'History browser', category: 'unproductive', seconds: 600 }];
  const liveApps = [{ name: 'Live editor', category: 'productive', seconds: 3600 },
    { name: 'Live browser', category: 'unproductive', seconds: 600 }];
  const byCategory = { productive: 3600, unproductive: 600, other: 300 };
  const byHour = Array.from({ length: 24 }, (_, hour) => hour === 9 ? { ...byCategory }
    : { productive: 0, unproductive: 0, other: 0 });
  const days = Array.from({ length: 30 }, (_, index) => ({ date: dateAt(29 - index),
    byCategory: { ...byCategory }, byHour, apps: historyApps, topApps: historyApps }));
  const settings = {
    onboardingComplete: true, trackingPaused: true, trackingPauseUntil: 0, launchAtStartup: false,
    updateChecksEnabled: false, notificationsEnabled: false, theme: 'midnight', pollMs: 3000,
    profileShortcut: '', windowShortcut: '', themeRotationEnabled: false, themeRotationMode: 'dark',
    themeRotationAnchorDate: '', themeRotationAnchorTheme: '', uiMotionEnabled: false,
    thresholdSec: 600, focusBoost: false, focusBoostScheduleEnabled: false,
    focusBoostScheduleStart: '09:00', focusBoostScheduleEnd: '17:00', focusShareGoalPct: 80,
    focusShareIncludeOther: false
  };
  const stats = () => ({ date: today, settings: { ...settings }, byCategory: { ...byCategory }, byHour,
    week: days.slice(-7), topApps: liveApps, appBreakdown: liveApps,
    activityRows: liveApps.map((entry, index) => ({ ...entry, id: 'synthetic-' + index, reason: 'App identity' })) });
  const profile = { id: 'default', name: 'Synthetic profile', productive: [], unproductive: [], other: [], ignore: [] };
  const historyCalls = [], timelineCalls = [];
  let heldHistory = null, heldTimeline = null, failNextHistory = false, failNextTimeline = false;
  const handlers = {
    'state:get': () => ({ stats: stats(), now: null, lastFocused: null, session: null, platform: process.platform }),
    'profiles:get': () => ({ schemaVersion: 1, activeId: 'default', profiles: [profile] }),
    'rules:get': () => ({ ...profile, profileId: 'default' }),
    'ignore:get': () => ({ ignore: [], profileId: 'default' }),
    'keywords:get': () => ({ productive: [], unproductive: [] }),
    'updates:get': () => ({ currentVersion: require('../package.json').version, available: false, phase: 'idle' }),
    'session:getActive': () => null,
    'session:getForDay': (_event, day) => ({ date: day || today, sessions: [], recentDays: [], historyEnabled: true }),
    'history:summary': async (_event, count) => {
      historyCalls.push(count);
      if (failNextHistory) { failNextHistory = false; throw new Error('Synthetic history refresh failure'); }
      const held = heldHistory;
      if (held) await held;
      return days.slice(-(count || 90));
    },
    'history:lifetime': () => ({ activeDays: 30, totalSeconds: 135000, averageSeconds: 4500,
      firstDay: days[0].date, byCategory: { productive: 108000, unproductive: 18000, other: 9000 },
      longestDay: { date: today, seconds: 4500 } }),
    'history:timelineDay': async (_event, date) => {
      timelineCalls.push(date);
      if (failNextTimeline) { failNextTimeline = false; throw new Error('Synthetic timeline refresh failure'); }
      if (heldTimeline) await heldTimeline;
      let at = new Date(date + 'T09:00:00').getTime();
      const timeline = Object.entries(byCategory).map(([kind, seconds]) => {
        const start = at; at += seconds * 1000;
        return { start, end: at, kind, profileId: 'default' };
      });
      return { ...stats(), date, timeline };
    },
    'settings:update': (_event, partial) => Object.assign(settings, partial)
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  const win = new BrowserWindow({ show: false, width: 1200, height: 840,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  const errors = [], failures = [], checked = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2 && !message.includes('Electron Security Warning') && !message.includes('ERR_BLOCKED_BY_CLIENT')) errors.push(message);
  });
  const render = expression => win.webContents.executeJavaScript(expression);
  const frame = () => render('new Promise(resolve => setTimeout(resolve, 0))');
  const wait = async (expression, message) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await render(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    throw new Error(message);
  };
  const check = (condition, message, detail) => {
    checked.push(message);
    if (!condition) {
      const failure = message + (detail == null ? '' : ': ' + JSON.stringify(detail));
      failures.push(failure); console.error('FAIL:', failure);
    }
  };
  async function finishAnimations() {
    await frame();
    await render(`for (const animation of document.getAnimations()) {
      if (animation.id === 'sydtrack-ui-motion') animation.finish();
    }`);
    await frame();
  }
  async function screenshot(name) {
    try {
      await finishAnimations();
      const file = path.join(temporary, name + '.png');
      let capture;
      for (let attempt = 0; attempt < 5; attempt++) {
        try { capture = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); break; }
        catch (error) {
          if (!error.message.includes('Current display surface not available') || attempt === 4) throw error;
          // Wake a hidden compositor without showing a native test window.
          await render('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        }
      }
      // The first capture may contain the last painted hidden frame. Wait for
      // this tab's layout and selected highlight to reach the compositor.
      await render('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await new Promise(resolve => setTimeout(resolve, 80));
      capture = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      fs.writeFileSync(file, capture.toPNG());
      console.log('Tab transition screenshot:', file);
    } catch (error) {
      console.warn('Optional tab transition screenshot unavailable:', error.message);
    }
  }
  async function media(value) {
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value }]
    });
    await wait(`matchMedia('(prefers-reduced-motion: reduce)').matches === ${value === 'reduce'}`, 'Media emulation did not apply');
    await frame();
  }
  async function reload(mode) {
    heldHistory = null;
    settings.uiMotionEnabled = mode !== 'off';
    await media(mode === 'reduced' ? 'reduce' : 'no-preference');
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
    await wait(`typeof latestGoalSettings === 'object' && latestGoalSettings && typeof uiMotion === 'object' &&
      document.getElementById('timeline-date').value && document.getElementById('ui-motion-toggle')`, 'Renderer did not initialize');
    await render('document.fonts.ready');
    await wait(`document.documentElement.dataset.uiMotion === ${JSON.stringify(mode === 'on' ? 'on' : 'off')}`, 'Motion mode did not initialize');
    await render(`(() => {
      window.__transitionAnimationRecords = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        window.__transitionAnimationRecords.push({ target: this, animation });
        return animation;
      };
    })()`);
  }
  async function segment(name) {
    await render(`document.querySelector('[data-segment=${JSON.stringify(name)}]').click()`);
    await frame();
  }
  function freezeHistory() {
    let release;
    heldHistory = new Promise(resolve => { release = resolve; });
    return () => { heldHistory = null; release(); };
  }
  async function rects(selector) {
    return render(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}), button => {
      const rect = button.getBoundingClientRect();
      return { key: button.dataset.segment || button.dataset.settingsTab || button.dataset.appsRange,
        left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    })`);
  }
  function stable(before, after) {
    return before.length === after.length && before.every((rect, index) => rect.key === after[index].key &&
      ['left', 'top', 'width', 'height'].every(key => Math.abs(rect[key] - after[index][key]) <= 0.5));
  }
  async function rememberCharts() {
    await render(`window.__weekBar = document.querySelector('#week-chart [data-day]');
      window.__monthPie = document.querySelector('#month-history .pie-chart');
      window.__removedCharts = [];
      window.__chartObserver?.disconnect();
      window.__chartObserver = new MutationObserver(records => {
        for (const record of records) for (const node of record.removedNodes) {
          if (node === window.__weekBar || node.contains?.(window.__weekBar)) window.__removedCharts.push('week');
          if (node === window.__monthPie || node.contains?.(window.__monthPie)) window.__removedCharts.push('month');
        }
      });
      window.__chartObserver.observe(document.getElementById('view-analytics'), { subtree: true, childList: true })`);
  }
  const chartState = () => render(`({
    week: window.__weekBar === document.querySelector('#week-chart [data-day]') && window.__weekBar?.isConnected,
    month: window.__monthPie === document.querySelector('#month-history .pie-chart') && window.__monthPie?.isConnected,
    loading: ['week-chart', 'month-history'].some(id => document.getElementById(id).textContent.includes('Loading')),
    removed: window.__removedCharts.slice(), segment: analyticsSegment
  })`);
  async function cachedChecks(mode) {
    await render(`document.querySelector('.nav-btn[data-tab="analytics"]').click();
      document.querySelector('[data-segment="month"]').click()`);
    await wait(`document.querySelector('#month-history .pie-chart') && fullHistoryCache`, 'Month history did not render');
    await segment('week');
    await wait(`document.querySelector('#week-chart [data-day]')`, 'Week history did not render');
    await finishAnimations();
    await rememberCharts();
    for (const name of ['week', 'month', 'month', 'week', 'day', 'week', 'month']) {
      const synchronous = await render(`(() => {
        document.querySelector('[data-segment=${JSON.stringify(name)}]').click();
        return { week: window.__weekBar.isConnected, month: window.__monthPie.isConnected,
          loading: ['week-chart', 'month-history'].some(id => document.getElementById(id).textContent.includes('Loading')) };
      })()`);
      check(synchronous.week && synchronous.month && !synchronous.loading,
        `${mode}: ${name} click retains cached charts synchronously`, synchronous);
      await frame();
      const after = await chartState();
      check(after.week && after.month && !after.loading && after.removed.length === 0,
        `${mode}: ${name} click does not replace cached charts in the next frame`, after);
    }
    await render(`document.querySelector('.nav-btn[data-tab="home"]').click();
      document.querySelector('.nav-btn[data-tab="analytics"]').click()`);
    await frame();
    const revisit = await chartState();
    check(revisit.week && revisit.month && !revisit.loading && revisit.removed.length === 0,
      `${mode}: sidebar revisit retains cached chart content`, revisit);
    await render('window.__chartObserver.disconnect()');
  }
  async function geometryChecks(mode) {
    await segment('day'); await finishAnimations();
    const selector = '.analytics-toolbar .segment-control:first-child > .segment-btn';
    const before = await rects(selector);
    for (const name of ['week', 'month', 'lifetime', 'day']) {
      await render(`document.querySelector('[data-segment=${JSON.stringify(name)}]').click()`);
      const synchronous = await rects(selector);
      check(stable(before, synchronous), `${mode}: Analytics ${name} active style does not move tab geometry`, { before, after: synchronous });
      await frame();
      const after = await rects(selector);
      check(stable(before, after), `${mode}: Analytics ${name} geometry stays stable after observer work`, { before, after });
    }
    await segment('apps');
    const rangeSelector = '#apps-range > .segment-btn';
    await render('void setAppsRange("day")'); await finishAnimations();
    const rangeBefore = await rects(rangeSelector);
    for (const name of ['week', 'month', 'day']) {
      await render(`document.querySelector('[data-apps-range=${JSON.stringify(name)}]').click()`);
      const synchronous = await rects(rangeSelector);
      check(stable(rangeBefore, synchronous), `${mode}: Apps ${name} range geometry does not change with selection`, { before: rangeBefore, after: synchronous });
      await frame();
    }
    await render(`document.querySelector('.nav-btn[data-tab="settings"]').click();
      document.querySelector('[data-settings-tab="tracking"]').click()`);
    await finishAnimations();
    const settingsSelector = '.settings-toolbar > .segment-btn';
    const settingsBefore = await rects(settingsSelector);
    for (const name of ['wellbeing', 'notifications', 'tracking']) {
      await render(`document.querySelector('[data-settings-tab=${JSON.stringify(name)}]').click()`);
      const synchronous = await rects(settingsSelector);
      check(stable(settingsBefore, synchronous), `${mode}: Settings ${name} active style keeps fixed tab geometry`, { before: settingsBefore, after: synchronous });
      await frame();
      const after = await rects(settingsSelector);
      check(stable(settingsBefore, after), `${mode}: Settings ${name} geometry stays stable after observer work`, { before: settingsBefore, after });
    }
    await render('document.querySelector(".nav-btn[data-tab=analytics]").click()');
  }
  async function timelineChecks(mode) {
    await segment('day');
    await wait('timelineLoadedDate === document.getElementById("timeline-date").value && document.querySelector("#timeline-visual .timeline-block")', 'Day timeline did not render');
    await finishAnimations();
    const count = timelineCalls.length;
    const same = await render(`(() => {
      window.__timelineBlock = document.querySelector('#timeline-visual .timeline-block');
      document.querySelector('[data-segment="day"]').click();
      return { retained: window.__timelineBlock.isConnected,
        text: document.getElementById('timeline-precision').textContent };
    })()`);
    await frame();
    check(same.retained && !same.text.includes('Loading') && timelineCalls.length === count,
      `${mode}: fresh same-Day click keeps timeline identity and avoids redundant loading`, same);
    let release;
    heldTimeline = new Promise(resolve => { release = resolve; });
    try {
      const pending = await render(`(() => {
        void loadTimelineDay(true);
        return { retained: window.__timelineBlock.isConnected,
          text: document.getElementById('timeline-precision').textContent,
          busy: document.getElementById('timeline-visual').getAttribute('aria-busy') };
      })()`);
      check(pending.retained && !pending.text.includes('Loading') && pending.busy === 'true',
        `${mode}: same-date timeline refresh keeps confirmed data while held`, pending);
      await segment('week'); await segment('day');
      heldTimeline = null; release();
      await wait('document.getElementById("timeline-visual").getAttribute("aria-busy") !== "true"', 'Held timeline did not settle');
      await frame();
      check(await render('window.__timelineBlock === document.querySelector("#timeline-visual .timeline-block") && window.__timelineBlock.isConnected'),
        `${mode}: unchanged timeline response patches without replacing its segments`);
    } finally { heldTimeline = null; release(); }
  }
  async function heldHistoryChecks(mode) {
    await segment('week'); await finishAnimations(); await rememberCharts();
    const callCount = historyCalls.length, release = freezeHistory();
    try {
      const synchronous = await render(`(() => {
        invalidateHistoryViews(); void loadAnalyticsHistory();
        return { week: window.__weekBar.isConnected, month: window.__monthPie.isConnected,
          loading: document.getElementById('week-chart').textContent.includes('Loading') };
      })()`);
      check(synchronous.week && synchronous.month && !synchronous.loading,
        `${mode}: background history refresh keeps rendered chart while request is held`, synchronous);
      for (let attempt = 0; attempt < 100 && historyCalls.length === callCount; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      assert(historyCalls.length > callCount, 'Synthetic held history was not requested');
      await segment('month');
      const pending = await chartState();
      check(pending.week && pending.month && !pending.loading && pending.removed.length === 0,
        `${mode}: pending Week→Month switches retain both prior charts`, pending);
      await segment('day');
      release();
      await wait('fullHistoryCache !== null', 'Held full history did not settle');
      await frame();
      const active = await render(`({ segment: analyticsSegment,
        selected: document.querySelector('[data-segment="day"]').getAttribute('aria-selected'),
        visible: Array.from(document.querySelectorAll('.analytics-panel:not(.hidden)'), panel => panel.dataset.panel || panel.id.replace('panel-', '')) })`);
      check(active.segment === 'day' && active.selected === 'true' && active.visible.length === 1 && active.visible[0] === 'day',
        `${mode}: held Week/Month results cannot paint or select a stale active tab`, active);
    } finally { release(); await render('window.__chartObserver.disconnect()'); }
  }
  async function appsChecks(mode) {
    await segment('apps');
    await render('void setAppsRange("week")');
    await wait('appsHistoryRange === "week" && document.querySelector("#app-list .app-group")', 'Apps week did not load');
    await finishAnimations();
    const synchronous = await render(`(() => {
      window.__appsFirst = document.querySelector('#app-list .app-group');
      document.querySelector('[data-apps-range="week"]').click();
      return { retained: window.__appsFirst.isConnected,
        donut: getComputedStyle(document.getElementById('apps-donut')).backgroundImage,
        loading: document.getElementById('app-list').textContent.includes('Loading') };
    })()`);
    check(synchronous.retained && synchronous.donut.includes('conic-gradient') && !synchronous.loading,
      `${mode}: same Apps range click preserves already rendered app content`, synchronous);
    await render('invalidateHistoryViews()');
    const release = freezeHistory(), callCount = historyCalls.length;
    try {
      const pending = await render(`(() => {
        void setAppsRange('month');
        return { donut: getComputedStyle(document.getElementById('apps-donut')).backgroundImage,
          content: document.getElementById('app-list').textContent, range: appsRange,
          period: document.getElementById('apps-period-label').textContent,
          status: document.getElementById('apps-range-status').textContent };
      })()`);
      check(pending.donut.includes('conic-gradient') && pending.content.includes('History editor') &&
        !pending.content.includes('Loading') && pending.period.startsWith('Last 7 days') && pending.status.includes('Loading last 30 days'),
        `${mode}: held Apps range change does not blank its prior chart and app list`, pending);
      for (let attempt = 0; attempt < 100 && historyCalls.length === callCount; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      assert(historyCalls.length > callCount, 'Synthetic held Apps history was not requested');
      await render('void setAppsRange("day")');
      release(); await frame();
      await new Promise(resolve => setTimeout(resolve, 50));
      const final = await render(`({ range: appsRange,
        selected: document.querySelector('[data-apps-range="day"]').getAttribute('aria-pressed'),
        title: document.getElementById('apps-period-label').textContent,
        content: document.getElementById('app-list').textContent,
        donut: getComputedStyle(document.getElementById('apps-donut')).backgroundImage })`);
      check(final.range === 'day' && final.selected === 'true' && final.title.startsWith('Today') &&
        final.content.includes('Live editor') && !final.content.includes('History editor') && final.donut.includes('conic-gradient'),
      `${mode}: late held Apps range results cannot overwrite the active daily range`, final);
    } finally { release(); }
  }
  async function failureChecks(mode) {
    await segment('month');
    await wait('fullHistoryCache !== null && document.querySelector("#month-history .pie-chart")', 'Month cache did not settle before failure checks');
    await segment('week'); await finishAnimations(); await rememberCharts();
    failNextHistory = true;
    await render('invalidateHistoryViews(); void loadAnalyticsHistory()');
    await wait('document.getElementById("analytics-loading").textContent.includes("Could not load")', 'History failure did not report');
    await frame();
    const history = await chartState();
    check(history.week && history.month && !history.loading && history.removed.length === 0,
      `${mode}: failed history refresh keeps confirmed Week/Month charts`, history);
    await render('window.__chartObserver.disconnect()');

    await segment('apps'); await render('void setAppsRange("week")');
    await wait('appsHistoryRange === "week"', 'Apps week did not settle before failure checks');
    await render(`window.__failureApp = document.querySelector('#app-list .app-group'); invalidateHistoryViews()`);
    failNextHistory = true;
    await render('void setAppsRange("month")');
    await wait('document.getElementById("apps-range-status").textContent.includes("Could not load")', 'Apps failure did not report');
    const apps = await render(`({ retained: window.__failureApp.isConnected,
      period: document.getElementById('apps-period-label').textContent,
      donut: getComputedStyle(document.getElementById('apps-donut')).backgroundImage,
      busy: document.getElementById('panel-apps').getAttribute('aria-busy') })`);
    check(apps.retained && apps.period.startsWith('Last 7 days') && apps.donut.includes('conic-gradient') && apps.busy !== 'true',
      `${mode}: failed Apps range load preserves chart, list, and confirmed period label`, apps);

    await segment('day');
    await wait('timelineLoadedDate === document.getElementById("timeline-date").value && document.querySelector("#timeline-visual .timeline-block")', 'Timeline did not settle before failure checks');
    await render(`window.__failureTimeline = document.querySelector('#timeline-visual .timeline-block');
      window.__failureInsight = document.getElementById('timeline-longest').textContent`);
    failNextTimeline = true;
    await render('void loadTimelineDay(true)');
    await wait('document.getElementById("timeline-precision").textContent.includes("Could not load")', 'Timeline failure did not report');
    const timeline = await render(`({ retained: window.__failureTimeline.isConnected,
      insight: document.getElementById('timeline-longest').textContent,
      previousInsight: window.__failureInsight,
      hidden: document.getElementById('timeline-longest').classList.contains('hidden'),
      busy: document.getElementById('timeline-visual').getAttribute('aria-busy') })`);
    check(timeline.retained && timeline.insight.length > 0 && timeline.insight === timeline.previousInsight && !timeline.hidden && timeline.busy !== 'true',
      `${mode}: failed same-date refresh preserves timeline segments and longest-block insight`, timeline);
  }
  async function activityReorderCheck(mode) {
    await segment('apps'); await render('void setAppsRange("day")');
    const activity = [
      { id: 'transition-a', name: 'Focus editor', category: 'productive', seconds: 600, reason: 'Activity A' },
      { id: 'transition-b', name: 'Focus editor', category: 'productive', seconds: 300, reason: 'Activity B' }
    ];
    const update = rows => win.webContents.send('tracker:update', {
      stats: { ...stats(), activityRows: rows,
        appBreakdown: [{ name: 'Focus editor', category: 'productive', seconds: rows.reduce((sum, row) => sum + row.seconds, 0) }] },
      now: null, lastFocused: null, session: null
    });
    try {
      update(activity);
      await wait('document.querySelector(".app-activity[data-row-id=transition-a]") && document.querySelector(".app-activity[data-row-id=transition-b]")', 'Synthetic activities did not render');
      const initial = await render(`(() => {
        window.__activityRowA = document.querySelector('.app-activity[data-row-id="transition-a"]');
        window.__activityActionsA = window.__activityRowA.querySelector('.app-activity-actions');
        window.__activityActionA = window.__activityActionsA.querySelector('[data-category="unproductive"]');
        window.__activityRowA.closest('details').open = true;
        window.__activityActionA.focus({ preventScroll: true });
        return { first: window.__activityRowA.parentElement.querySelector('.app-activity').dataset.rowId,
          focused: document.activeElement === window.__activityActionA, disabled: window.__activityActionA.disabled };
      })()`);
      assert(initial.first === 'transition-a' && initial.focused && !initial.disabled,
        'Activity A must start first with a focused actionable category button');
      update(activity.map(row => row.id === 'transition-b' ? { ...row, seconds: 1200 } : row));
      await wait('lastAppsStats.activityRows.find(row => row.id === "transition-b").seconds === 1200', 'Synthetic activity duration update did not arrive');
      await frame();
      const reordered = await render(`(() => {
        const row = document.querySelector('.app-activity[data-row-id="transition-a"]');
        return { row: row === window.__activityRowA,
          actions: row.querySelector('.app-activity-actions') === window.__activityActionsA,
          action: row.querySelector('[data-category="unproductive"]') === window.__activityActionA,
          focused: document.activeElement === window.__activityActionA,
          focusedRow: document.activeElement.closest('.app-activity')?.dataset.rowId,
          first: row.parentElement.querySelector('.app-activity').dataset.rowId,
          reason: row.querySelector('.app-activity-reason').textContent,
          open: row.closest('details').open };
      })()`);
      check(reordered.row && reordered.actions && reordered.action && reordered.focused && reordered.focusedRow === 'transition-a' &&
        reordered.first === 'transition-b' && reordered.reason.includes('Activity A') && reordered.open,
      `${mode}: live same-app activity reordering preserves A's identity, action, and focus without becoming B`, reordered);
    } finally {
      win.webContents.send('tracker:update', { stats: stats(), now: null, lastFocused: null, session: null });
      await wait('lastAppsStats.activityRows[0].id === "synthetic-0"', 'Default synthetic activities did not restore');
      await render('document.querySelector(".main").scrollTop = 0');
    }
  }
  async function pillCheck() {
    await segment('week'); await finishAnimations();
    const remembered = await render(`(() => {
      const group = document.querySelector('.analytics-toolbar .segment-control');
      window.__rememberedPill = group.querySelector('.ui-motion-indicator');
      const rect = window.__rememberedPill?.getBoundingClientRect();
      window.__rememberedPillRect = rect && { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      return !!rect;
    })()`);
    assert(remembered, 'Analytics moving highlight was not created');
    await segment('apps'); await finishAnimations();
    await render('window.__transitionAnimationRecords.length = 0; document.querySelector("[data-segment=day]").click()');
    await frame();
    const result = await render(`(() => {
      const pill = window.__rememberedPill;
      const animation = pill.getAnimations().find(animation => animation.id === 'sydtrack-ui-motion');
      if (!animation) return { continuous: false, retained: pill.isConnected, frames: null };
      animation.pause(); animation.currentTime = 0;
      const rect = pill.getBoundingClientRect(), previous = window.__rememberedPillRect;
      return { continuous: ['left', 'top', 'width', 'height'].every(key => Math.abs(rect[key] - previous[key]) <= 1),
        retained: pill === document.querySelector('.analytics-toolbar .segment-control .ui-motion-indicator'),
        frames: animation.effect.getKeyframes() };
    })()`);
    check(result.retained && result.continuous,
      'on: Apps→Day highlight resumes continuously from its last visible Analytics position', result);
    await finishAnimations();

    await segment('day'); await finishAnimations();
    await segment('week');
    const interrupted = await render(`(() => {
      const pill = document.querySelector('.analytics-toolbar .segment-control .ui-motion-indicator');
      const animation = pill.getAnimations().find(animation => animation.id === 'sydtrack-ui-motion');
      if (!animation) return false;
      animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
      const rect = pill.getBoundingClientRect();
      window.__interruptedWeekPill = pill;
      window.__interruptedWeekRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      return true;
    })()`);
    assert(interrupted, 'Day→Week highlight must be sampled midway through its real animation');
    await segment('apps');
    await segment('week');
    const resumed = await render(`(() => {
      const pill = window.__interruptedWeekPill;
      const animation = pill.getAnimations().find(animation => animation.id === 'sydtrack-ui-motion');
      if (!animation) return { retained: pill.isConnected, continuous: false, animated: false };
      animation.pause(); animation.currentTime = 0;
      const rect = pill.getBoundingClientRect(), previous = window.__interruptedWeekRect;
      return { retained: pill === document.querySelector('.analytics-toolbar .segment-control .ui-motion-indicator'),
        continuous: ['left', 'top', 'width', 'height'].every(key => Math.abs(rect[key] - previous[key]) <= 1),
        animated: true, previous, current: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
    })()`);
    check(resumed.retained && resumed.continuous && resumed.animated,
      'on: interrupted Day→Week→Apps→Week resumes from actual parked geometry even when target is unchanged', resumed);
    await finishAnimations();
  }
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    for (const mode of ['off', 'on', 'reduced']) {
      await reload(mode);
      await cachedChecks(mode);
      await geometryChecks(mode);
      await timelineChecks(mode);
      await heldHistoryChecks(mode);
      await appsChecks(mode);
      await failureChecks(mode);
      await activityReorderCheck(mode);
      if (mode === 'on') await pillCheck();
      if (mode !== 'on') check((await render('document.getAnimations().filter(animation => animation.id === "sydtrack-ui-motion").length')) === 0,
        `${mode}: tab switching does not start motion animations`);
      await segment('week');
      await wait('document.querySelector("#week-chart [data-day]") && fullHistoryCache', 'Week did not settle for capture');
      await screenshot('analytics-week-' + mode);
      await segment('month'); await screenshot('analytics-month-' + mode);
    }
    check(errors.length === 0, 'Renderer reports no unexpected errors', errors);
    assert.deepEqual(failures, [], 'Tab transition regressions failed');
    console.log(`Tab transition checks passed (${checked.length} assertions): cached Week/Month identity, same-tab/sidebar revisits, held/failed history and timeline without blanking, stable Analytics/Settings/range geometry, stale request protection, stable Apps content and period labels, focused activity identity across reorder, interrupted parked-highlight continuity, and motion off/on/reduced. Temporary data: ${temporary}`);
    win.destroy(); app.quit();
  } catch (error) {
    console.error(error); win.destroy(); app.exit(1);
  }
}).catch(error => { console.error(error); app.exit(1); });
