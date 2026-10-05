'use strict';

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('child_process').spawn(require('electron'), [__filename], {
    env, stdio: 'inherit', windowsHide: true
  });
  const timeout = setTimeout(() => { console.error('Score navigation checks timed out'); child.kill(); }, 45000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('exit', code => { clearTimeout(timeout); process.exitCode = code == null ? 1 : code; });
  return;
}

// Real production preload; only synthetic history and a temporary profile.
// No production main process, foreground tracker, startup writes, or network.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { createStore, todayKey } = require('../src/store');
const { createFocusProfiles } = require('../src/focus-profiles');
const { validateIpcPayload } = require('../src/ipc-validate');
const version = require('../package.json').version;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-score-navigation-'));
const userData = path.join(temporary, 'user-data');
fs.mkdirSync(userData);
app.setPath('appData', temporary);
app.setPath('userData', userData);
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const store = createStore(userData);
  store.updateSettings({ onboardingComplete: true, trackingPaused: true, launchAtStartup: false,
    updateChecksEnabled: false, focusShareIncludeOther: false, focusShareGoalPct: 80 });
  store.addSeconds('Synthetic app', 'productive', 300);
  const profiles = createFocusProfiles({ dataDir: userData, rules: { productive: [], unproductive: [], other: [] }, ignore: [] });
  const today = store.snapshot().date;
  const noon = new Date(today + 'T12:00:00');
  const dateAt = offset => todayKey(new Date(noon.getFullYear(), noon.getMonth(), noon.getDate() - offset, 12).getTime());
  function fixture(offset, byCategory, precision = 'segments') {
    const date = dateAt(offset);
    const byHour = Array.from({ length: 24 }, () => ({ productive: 0, unproductive: 0, other: 0 }));
    if (precision !== 'daily') byHour[9] = { ...byCategory };
    let at = new Date(date + 'T09:00:00').getTime();
    const timeline = precision === 'segments' ? Object.entries(byCategory).filter(([, seconds]) => seconds > 0).map(([kind, seconds]) => {
      const start = at; at += seconds * 1000;
      return { start, end: at, kind, profileId: 'default' };
    }) : [];
    return { date, byCategory, byHour, timeline, apps: [], topApps: [] };
  }
  const days = Array.from({ length: 30 }, (_, index) => fixture(29 - index,
    { productive: 3600, unproductive: 1200, other: 600 }));
  const scored = fixture(1, { productive: 3600, unproductive: 1200, other: 600 });
  const empty = fixture(2, { productive: 0, unproductive: 0, other: 0 }, 'daily');
  const limited = fixture(3, { productive: 60, unproductive: 0, other: 3540 }, 'hourly');
  const coarse = fixture(4, { productive: 1200, unproductive: 600, other: 0 }, 'daily');
  for (const day of [scored, empty, limited, coarse]) days[days.findIndex(item => item.date === day.date)] = day;
  days[days.length - 1] = { ...fixture(0, store.snapshot().byCategory), ...store.snapshot(), apps: [] };
  const dayByDate = new Map(days.map(day => [day.date, day]));
  const timelineCalls = [];
  const ipcCalls = [];
  const heldDays = new Map();
  const handlers = {
    'state:get': () => ({ stats: store.snapshot(), now: null, lastFocused: null, session: null, platform: process.platform }),
    'profiles:get': () => profiles.snapshot(),
    'rules:get': () => ({ ...profiles.active(), profileId: profiles.snapshot().activeId }),
    'ignore:get': () => ({ ignore: profiles.active().ignore, profileId: profiles.snapshot().activeId }),
    'keywords:get': () => ({ productive: [], unproductive: [] }),
    'updates:get': () => ({ currentVersion: version, available: false, phase: 'idle' }),
    'session:getActive': () => null,
    'session:getForDay': (_event, date) => ({ date: date || today, sessions: [], recentDays: [], historyEnabled: true }),
    'history:summary': (_event, count) => days.slice(-(count || 90)),
    'history:timelineDay': (_event, value) => {
      const date = validateIpcPayload('history:timelineDay', value);
      timelineCalls.push(date);
      const held = heldDays.get(date);
      if (held) { held.requested = true; return held.promise; }
      return dayByDate.get(date) || null;
    }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, (event, ...args) => {
    ipcCalls.push(channel);
    return handler(event, ...args);
  });
  const win = new BrowserWindow({ show: false, width: 1040, height: 760,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const rendererErrors = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2 && !message.includes('Electron Security Warning')) rendererErrors.push(message);
  });
  const render = expression => win.webContents.executeJavaScript(expression);
  const tileSelector = (date, period) => `[data-score-date="${date}"][data-score-period="${period}"]`;
  async function waitFor(expression, message) {
    await render(`(async () => {
      for (let attempt = 0; attempt < 150; attempt++) {
        if (${expression}) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error(${JSON.stringify(message)});
    })()`);
  }
  async function period(periodName) {
    await render(`document.querySelector('.nav-btn[data-tab="analytics"]').click(); setAnalyticsSegment(${JSON.stringify(periodName)});`);
    await waitFor(`document.querySelector(${JSON.stringify(tileSelector(scored.date, periodName))})`, 'Score grid did not load: ' + periodName);
  }
  async function snapshot() {
    return render(`(() => ({ segment: analyticsSegment,
      date: document.getElementById('timeline-date').value,
      dataDate: timelineDayData?.date,
      total: document.getElementById('day-total').textContent,
      share: document.getElementById('day-focus-share').textContent,
      subtitle: document.getElementById('analytics-subtitle').textContent,
      precision: document.getElementById('timeline-precision').textContent,
      backVisible: !document.getElementById('focus-score-back').classList.contains('hidden') && !document.getElementById('focus-score-back').hidden
    }))()`);
  }
  async function nativeKey(key) {
    // Chromium's trusted input exercises native button default activation.
    // Electron sendInputEvent requires a focused native BrowserWindow, which
    // would expose this intentionally hidden diagnostic to the user.
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const inputs = {
      Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' },
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' },
      Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }
    };
    const input = inputs[key];
    assert(input, 'Supported native diagnostic key');
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...input });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp', key: input.key, code: input.code, windowsVirtualKeyCode: input.windowsVirtualKeyCode
    });
  }
  async function open(date, source, activation = 'click') {
    const selector = tileSelector(date, source);
    await render(`(() => {
      const tile = document.querySelector(${JSON.stringify(selector)});
      if (!tile || tile.tagName !== 'BUTTON' || tile.type !== 'button' || tile.disabled) throw new Error('Expected enabled native score button');
      tile.focus({ preventScroll: true });
    })()`);
    if (activation === 'click') await render(`document.querySelector(${JSON.stringify(selector)}).click()`);
    else await nativeKey(activation);
    await waitFor(`analyticsSegment === 'day' && document.getElementById('timeline-date').value === ${JSON.stringify(date)} &&
      timelineDayData?.date === ${JSON.stringify(date)} && !document.getElementById('timeline-precision').textContent.includes('Loading')`, 'Historical Day did not load after ' + activation);
    assert(timelineCalls.includes(date), 'Selected historical date requested through real preload');
    const state = await snapshot();
    assert.equal(state.date, date); assert.equal(state.dataDate, date); assert.equal(state.segment, 'day');
    assert(state.subtitle.includes(date), 'Day heading identifies selected historical date');
    assert.equal(state.backVisible, true, 'Drill-down exposes a return control');
    return state;
  }
  async function returned(date, source) {
    await waitFor(`analyticsSegment === ${JSON.stringify(source)} &&
      document.activeElement?.matches(${JSON.stringify(tileSelector(date, source))}) &&
      document.activeElement.dataset.selected === 'true'`, 'Back did not restore period, selected tile and keyboard focus');
    assert.equal((await snapshot()).backVisible, false, 'Return control hides outside drill-down');
  }
  async function back(date, source) {
    await render(`document.getElementById('focus-score-back').click()`);
    await returned(date, source);
  }
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await render(`(async () => { await window.sydtrackProfilesUI.reload(); await loadRulesAndIgnore(); })()`);
    await waitFor(`liveDayDate === ${JSON.stringify(today)}`, 'Isolated renderer did not finish booting');
    assert.equal(await render('typeof openFocusScoreDay'), 'function', 'Historical score navigation hook exists');

    await period('week');
    const first = await open(scored.date, 'week');
    assert.equal(first.total, '1 hour 30 minutes'); assert.equal(first.share, '75%');
    win.webContents.send('tracker:update', { stats: { ...store.snapshot(), byCategory: { productive: 7200, unproductive: 0, other: 0 },
      settings: { ...store.getSettings(), thresholdSec: 777 } }, now: null, lastFocused: null });
    await waitFor(`latestGoalSettings?.thresholdSec === 777`, 'Synthetic live update did not settle');
    await render('new Promise(resolve => setTimeout(resolve, 80))');
    const afterTick = await snapshot();
    assert.equal(afterTick.date, scored.date, 'Live update preserves historical selected date');
    assert.equal(afterTick.total, first.total, 'Live totals do not overwrite historical Day metrics');
    assert.equal(afterTick.share, first.share, 'Live focus share does not overwrite historical Day');
    await back(scored.date, 'week');

    await open(scored.date, 'week', 'Enter'); await back(scored.date, 'week');
    await period('month');
    await open(scored.date, 'month', 'Space'); await back(scored.date, 'month');
    await open(scored.date, 'month');
    await render(`document.querySelector('[data-segment="day"]').focus({ preventScroll: true })`);
    assert.equal(await render(`document.activeElement?.dataset.segment`), 'day', 'Escape begins on focused Day segment');
    await nativeKey('Escape'); await returned(scored.date, 'month');
    console.log('Score navigation: real preload requests, exact Day metrics, native Enter/Space, live-update isolation and Back passed.');

    const emptyTile = await render(`document.querySelector(${JSON.stringify(tileSelector(empty.date, 'month'))}).textContent`);
    assert(emptyTile.includes('—'), 'Empty day remains an unscored tile');
    const emptyState = await open(empty.date, 'month');
    assert.equal(emptyState.total, '0 min'); assert.equal(emptyState.share, '—');
    assert(emptyState.precision.includes('No activity'), 'Empty Day explains missing activity');
    await back(empty.date, 'month');
    const limitedTile = await render(`document.querySelector(${JSON.stringify(tileSelector(limited.date, 'month'))}).textContent`);
    assert(limitedTile.includes('—'), 'Other-heavy day is not falsely scored');
    const limitedState = await open(limited.date, 'month');
    assert.equal(limitedState.total, '1 hour');
    assert(limitedState.precision.includes('hourly totals'), 'Hourly-only Day uses existing coarse-history explanation');
    await back(limited.date, 'month');
    const coarseState = await open(coarse.date, 'month');
    assert.equal(coarseState.total, '30 min'); assert.equal(coarseState.share, '67%');
    assert(coarseState.precision.includes('Only daily totals'), 'Daily-only history does not invent precise segments');
    await back(coarse.date, 'month');

    const beforeInvalid = timelineCalls.length;
    const future = dateAt(-1);
    for (const [date, source] of [['not-a-date', 'week'], ['2026-02-30', 'month'], [future, 'week'], [scored.date, 'apps']]) {
      assert.equal(await render(`openFocusScoreDay(${JSON.stringify(date)}, ${JSON.stringify(source)})`), false, 'Invalid date/source rejected: ' + date + '/' + source);
      assert.equal((await snapshot()).segment, 'month', 'Rejected navigation leaves prior grid visible');
    }
    assert.equal(timelineCalls.length, beforeInvalid, 'Rejected dates do not invoke historical IPC');

    // Keep one genuine historical preload request pending, return to its grid,
    // then open a second day. Resolving the first must not revive stale metrics.
    let resolveHeld;
    const held = { requested: false, promise: new Promise(resolve => { resolveHeld = resolve; }) };
    heldDays.set(scored.date, held);
    await render(`document.querySelector(${JSON.stringify(tileSelector(scored.date, 'month'))}).click()`);
    for (let attempt = 0; !held.requested && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(held.requested, true, 'Delayed historical IPC reached the main harness');
    await back(scored.date, 'month');
    await open(empty.date, 'month');
    resolveHeld(scored); heldDays.delete(scored.date);
    await render('new Promise(resolve => setTimeout(resolve, 80))');
    const settled = await snapshot();
    assert.equal(settled.date, empty.date); assert.equal(settled.dataDate, empty.date); assert.equal(settled.total, '0 min');
    await back(empty.date, 'month');
    console.log('Score navigation: empty/Other-heavy/coarse days, invalid dates and late responses passed.');

    const layouts = [];
    for (const width of [800, 1040, 1600]) {
      win.setSize(width, 760);
      for (const theme of ['midnight', 'linen']) {
        await render(`applyTheme(${JSON.stringify(theme)})`);
        await period('month');
        await render(`document.querySelector(${JSON.stringify(tileSelector(scored.date, 'month'))}).scrollIntoView({ block: 'center' });`);
        await render('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const originScroll = await render('document.querySelector(".main").scrollTop');
        const grid = await render(`(() => {
          const card = document.getElementById('month-focus-scores');
          const rect = card.getBoundingClientRect();
          const tiles = [...card.querySelectorAll('[data-score-date]')];
          return { count: tiles.length, contained: tiles.every(tile => {
            const r = tile.getBoundingClientRect();
            return r.left >= rect.left && r.right <= rect.right + 1 && r.height >= 44;
          }), overflow: card.scrollWidth > card.clientWidth + 1 };
        })()`);
        assert.equal(grid.count, 30); assert.equal(grid.contained, true); assert.equal(grid.overflow, false);
        await open(scored.date, 'month');
        const dayContained = await render(`(() => {
          const panel = document.getElementById('panel-day');
          const back = document.getElementById('focus-score-back').getBoundingClientRect();
          return panel.scrollWidth <= panel.clientWidth + 1 && back.left >= 0 && back.right <= innerWidth;
        })()`);
        assert.equal(dayContained, true, 'Historical Day and Back fit the viewport');
        if (width === 1040 && theme === 'midnight') {
          await render(`document.querySelector('.main').scrollTop = 0`);
          await render('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          fs.writeFileSync(path.join(temporary, 'selected-day.png'), (await win.webContents.capturePage()).toPNG());
        }
        await back(scored.date, 'month');
        const restoredScroll = await render('document.querySelector(".main").scrollTop');
        assert(Math.abs(restoredScroll - originScroll) <= 2, 'Back preserves prior grid scroll after async rerender');
        if (width === 1040 && theme === 'midnight') {
          await render('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          fs.writeFileSync(path.join(temporary, 'selected-month.png'), (await win.webContents.capturePage()).toPNG());
        }
        layouts.push({ width, theme, gridContained: true, backContained: true, restoredScroll: true });
      }
    }
    console.log('Score navigation layouts:', JSON.stringify(layouts));
    await period('month');
    assert.equal(await render(`document.querySelector(${JSON.stringify(tileSelector(today, 'month'))}).querySelector('strong').textContent`), '100%', 'Month begins with current-day score');
    await open(today, 'month');
    const sameDay = fixture(0, { productive: 300, unproductive: 300, other: 0 }, 'hourly');
    dayByDate.set(today, sameDay);
    win.webContents.send('tracker:update', { stats: { ...store.snapshot(), byCategory: sameDay.byCategory,
      byHour: sameDay.byHour, settings: { ...store.getSettings(), thresholdSec: 778 } }, now: null, lastFocused: null });
    await waitFor('latestGoalSettings?.thresholdSec === 778', 'Same-day totals update did not arrive');
    await back(today, 'month');
    assert.equal(await render(`document.querySelector(${JSON.stringify(tileSelector(today, 'month'))}).querySelector('strong').textContent`), '50%', 'Back overlays current totals on cached Month grid');
    await period('week');
    assert.equal(await render(`document.querySelector(${JSON.stringify(tileSelector(today, 'week'))}).querySelector('strong').textContent`), '50%', 'Cached Week grid also reflects current totals');
    await period('month');
    const currentDay = await open(today, 'month');
    assert.equal(await render('timelineFollowsToday'), false, 'Tile-selected current day remains pinned');
    const nextDay = dateAt(-1);
    const nextFixture = fixture(-1, { productive: 900, unproductive: 900, other: 0 }, 'hourly');
    days[days.findIndex(day => day.date === today)] = sameDay;
    days.push(nextFixture); dayByDate.set(nextDay, nextFixture);
    const beforeRolloverHistory = ipcCalls.filter(channel => channel === 'history:summary').length;
    win.webContents.send('tracker:update', { stats: { ...store.snapshot(), date: nextDay,
      byCategory: nextFixture.byCategory, byHour: nextFixture.byHour }, now: null, lastFocused: null });
    await waitFor(`liveDayDate === ${JSON.stringify(nextDay)}`, 'Synthetic midnight update did not arrive');
    const afterMidnight = await snapshot();
    assert.equal(afterMidnight.date, today, 'Midnight does not move tile-selected current day');
    assert.equal(afterMidnight.dataDate, today, 'Original current-day metadata remains selected after midnight');
    assert.equal(afterMidnight.total, currentDay.total, 'Next-day live stats do not overwrite selected Day');
    await back(today, 'month');
    await waitFor(`document.querySelector(${JSON.stringify(tileSelector(nextDay, 'month'))})`, 'Back did not refresh Month grid to include new date');
    assert(ipcCalls.filter(channel => channel === 'history:summary').length > beforeRolloverHistory, 'Date rollover fetches fresh history through existing IPC');
    console.log('Score navigation: Escape, current totals on cached grids, pinned dates and rollover history refresh passed.');
    assert.equal(rendererErrors.length, 0, 'No renderer errors: ' + rendererErrors.join('\n'));
    assert(ipcCalls.every(channel => Object.hasOwn(handlers, channel)), 'Navigation uses existing read-only IPC channels');
    assert.equal(store.getSettings().trackingPaused, true);
    assert.equal(store.snapshot().byCategory.productive, 300, 'UI navigation does not mutate tracked history');
    console.log('Score navigation screenshots:', JSON.stringify({ month: path.join(temporary, 'selected-month.png'), day: path.join(temporary, 'selected-day.png') }));
    console.log('Score navigation checks passed. All activity/profile data stayed in:', temporary);
    app.quit();
  } finally {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
    if (!win.isDestroyed()) {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
      win.destroy();
    }
  }
}).catch(error => { console.error(error); app.exit(1); });

setTimeout(() => { console.error('Score navigation checks timed out'); app.exit(1); }, 40000).unref();
