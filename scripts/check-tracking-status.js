'use strict';

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
  const timeout = setTimeout(() => { console.error('Tracking status checks timed out'); child.kill(); }, 90000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('exit', code => { clearTimeout(timeout); process.exitCode = code == null ? 1 : code; });
  return;
}

// The shipped renderer and sandboxed preload use synthetic IPC, an isolated
// profile and a hidden window. No foreground probes, startup changes or network.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-tracking-status-'));
const userData = path.join(temporary, 'user-data');
fs.mkdirSync(userData);
app.setPath('appData', temporary);
app.setPath('userData', userData);
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const { todayKey } = require('../src/store');
  const date = todayKey();
  let settings = { onboardingComplete: true, trackingPaused: false, trackingPauseUntil: 0,
    resumeTrackingNextDay: false, trackingPauseDate: '', launchAtStartup: false,
    updateChecksEnabled: false, notificationsEnabled: false, demoMode: false, theme: 'midnight',
    uiMotionEnabled: false, uiGlistenEnabled: false, pollMs: 3000, thresholdSec: 600,
    focusBoost: false, focusBoostScheduleEnabled: false, focusShareGoalPct: 80, focusShareIncludeOther: false };
  const profile = { id: 'default', name: 'Synthetic profile', productive: [], unproductive: [], other: [], ignore: [] };
  const live = () => ({ source: 'real', app: 'Synthetic editor', title: 'PRIVATE WINDOW TITLE', category: 'productive',
    idle: false, idleReason: 'active', ignored: false, trackingError: null, lastSuccessfulSampleAt: Date.now() - 120000 });
  let now = live(), win, failNextSave = false;
  const writes = [];
  const stats = () => ({ date, byCategory: { productive: 3600, unproductive: 600, other: 0 },
    byHour: Array.from({ length: 24 }, () => ({ productive: 0, unproductive: 0, other: 0 })),
    topApps: [], appBreakdown: [], activityRows: [], settings: { ...settings } });
  const payload = () => ({ stats: stats(), now: { ...now }, lastFocused: null, session: null });
  const publish = () => win.webContents.send('tracker:update', payload());
  const handlers = {
    'state:get': () => ({ ...payload(), platform: process.platform }),
    'profiles:get': () => ({ schemaVersion: 1, activeId: 'default', profiles: [profile] }),
    'rules:get': () => ({ ...profile, profileId: 'default' }),
    'ignore:get': () => ({ ignore: [], profileId: 'default' }),
    'keywords:get': () => ({ productive: [], unproductive: [] }),
    'updates:get': () => ({ currentVersion: require('../package.json').version, available: false, phase: 'idle' }),
    'session:getActive': () => null,
    'session:getForDay': (_event, key) => ({ date: key || date, sessions: [], recentDays: [], historyEnabled: true }),
    'history:summary': () => [],
    'history:timelineDay': () => ({ ...stats(), timeline: [] }),
    'settings:update': (_event, partial) => {
      writes.push({ ...partial });
      if (failNextSave) { failNextSave = false; throw new Error('Synthetic tracking status write failure'); }
      settings = { ...settings, ...partial,
        ...(Object.hasOwn(partial, 'trackingPaused') ? { trackingPauseUntil: 0, trackingPauseDate: '' } : {}) };
      now = settings.trackingPaused ? { ...now, source: 'paused' } : live();
      publish();
      return { ...settings };
    }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  win = new BrowserWindow({ show: false, width: 1040, height: 760,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  const rendererErrors = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2 && !message.includes('Electron Security Warning')) rendererErrors.push(message);
  });
  const render = expression => win.webContents.executeJavaScript(expression);
  async function waitFor(expression, message) {
    await render(`(async () => {
      for (let attempt = 0; attempt < 150; attempt++) {
        if (${expression}) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error(${JSON.stringify(message)});
    })()`);
  }
  const visible = `!document.getElementById('tracking-status-popover').classList.contains('hidden')`;
  const heading = `document.getElementById('tracking-status-heading').textContent`;
  const source = `document.getElementById('source-pill')`;
  const action = `document.getElementById('tracking-status-action')`;
  const close = `document.getElementById('tracking-status-close')`;
  async function key(name, shiftKey = false) {
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const keys = {
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' },
      Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
      Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }
    };
    const input = keys[name];
    assert(input, 'Supported test key');
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...input, modifiers: shiftKey ? 8 : 0 });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp', key: input.key, code: input.code, windowsVirtualKeyCode: input.windowsVirtualKeyCode, modifiers: shiftKey ? 8 : 0
    });
  }
  async function open() {
    if (!await render(visible)) await render(`${source}.click()`);
    await waitFor(visible, 'Tracking details did not open');
    assert.equal(await render(`${source}.getAttribute('aria-expanded')`), 'true');
  }
  async function update(next, partial = {}) {
    now = next;
    settings = { ...settings, ...partial };
    publish();
    const expected = require('../renderer/lib/tracking-status').describe(now, settings).label;
    await waitFor(`${heading} === ${JSON.stringify(expected)}`, 'Published tracking state did not reach details');
  }
  async function setWidth(width) {
    win.setSize(width, 760);
    const [contentWidth, contentHeight] = win.getContentSize();
    await waitFor(`Math.abs(innerWidth - ${contentWidth}) <= 2 && Math.abs(innerHeight - ${contentHeight}) <= 2`, 'Viewport did not settle');
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  async function geometry() {
    return render(`(() => {
      const panel = document.getElementById('tracking-status-popover'), p = panel.getBoundingClientRect();
      const trigger = document.getElementById('source-pill'), t = trigger.getBoundingClientRect();
      const inside = r => r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
      return { inside: inside(p) && inside(t), panel: { left: p.left, top: p.top, right: p.right, bottom: p.bottom },
        width: innerWidth, height: innerHeight, overflow: panel.scrollWidth > panel.clientWidth + 1,
        controlsInside: [...panel.querySelectorAll('button:not(.hidden)')].every(button => {
          const r = button.getBoundingClientRect();
          return r.left >= p.left && r.right <= p.right + 1 && r.top >= p.top && r.bottom <= p.bottom + 1;
        }) };
    })()`);
  }
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await waitFor(`liveDayDate === ${JSON.stringify(date)} && ${source}.textContent === 'Live tracking'`, 'Isolated tracking status renderer did not boot');
    const structure = await render(`({ tag: ${source}.tagName, type: ${source}.type,
      controls: ${source}.getAttribute('aria-controls'), popup: ${source}.getAttribute('aria-haspopup'),
      role: document.getElementById('tracking-status-popover').getAttribute('role') })`);
    assert.deepEqual(structure, { tag: 'BUTTON', type: 'button', controls: 'tracking-status-popover', popup: 'dialog', role: 'dialog' });
    const beforeRead = writes.length;
    await open();
    assert.equal(await render(heading), 'Live tracking');
    assert.equal(await render(`${action}.classList.contains('hidden')`), true);
    assert.equal(writes.length, beforeRead, 'Opening details does not change tracking');
    await render(`${close}.click()`);
    assert.equal(await render(visible), false);
    assert.equal(await render('document.activeElement.id'), 'source-pill');

    await render(`${source}.focus({ preventScroll: true })`);
    await key('Enter'); await waitFor(visible, 'Enter did not open tracking details');
    await key('Tab');
    assert.equal(await render('document.activeElement.id'), 'tracking-status-close', 'Tab enters the popover controls');
    await key('Tab');
    assert.equal(await render(visible), false, 'Tab exits the last popover control');
    assert.equal(await render('document.activeElement.id'), 'source-pill');
    await key('Enter'); await waitFor(visible, 'Keyboard reopen failed');
    await key('Escape');
    assert.equal(await render(visible), false);
    assert.equal(await render('document.activeElement.id'), 'source-pill');
    await open();
    await render(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
    assert.equal(await render(visible), false, 'Outside pointer dismisses details');
    assert.equal(writes.length, beforeRead, 'Reading and dismissing details never writes settings');

    await update({ ...live(), source: 'paused' }, { trackingPaused: true });
    await open();
    assert.equal(await render(`${action}.textContent`), 'Resume tracking');
    await render(`${source}.focus({ preventScroll: true })`); await key('Tab'); await key('Tab');
    assert.equal(await render('document.activeElement.id'), 'tracking-status-action', 'Paused details expose Resume to keyboard navigation');
    failNextSave = true;
    const beforeFailure = writes.length;
    await key('Enter');
    await waitFor(`!${action}.disabled && !document.getElementById('tracking-status-error').classList.contains('hidden')`, 'Resume failure did not expose an inline retry');
    assert.equal(settings.trackingPaused, true);
    assert.equal(await render(visible), true, 'Failed Resume preserves details');
    assert.equal(await render(heading), 'Paused');
    assert.match(await render(`document.getElementById('tracking-status-error').textContent`), /Could not resume tracking/);
    assert.deepEqual(writes.slice(beforeFailure), [{ trackingPaused: false }]);
    await render(`${action}.click()`);
    await waitFor(`${heading} === 'Live tracking' && ${action}.classList.contains('hidden')`, 'Retry did not resume tracking');
    assert.equal(settings.trackingPaused, false);
    assert.equal(await render(`document.getElementById('tracking-status-error').classList.contains('hidden')`), true);
    assert.equal(writes.length, beforeFailure + 2, 'Each Resume attempt performs one settings write');

    const until = Date.now() + 15 * 60_000;
    await update({ ...live(), source: 'paused' }, { trackingPaused: true, trackingPauseUntil: until });
    assert.match(await render(`${source}.textContent`), /^Paused · \d+:\d{2}/);
    assert.ok((await render(`document.getElementById('tracking-status-description').textContent`)).includes(
      new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
    await update({ ...live(), source: 'paused' }, { trackingPauseUntil: 0, resumeTrackingNextDay: true, trackingPauseDate: date });
    assert.match(await render(`document.getElementById('tracking-status-description').textContent`), /start of/);

    const lastSuccessful = Date.now() - 120_000;
    await update({ source: 'idle', app: 'Tracking unavailable', title: 'PRIVATE ERROR TITLE', trackingError: 'PRIVATE BACKEND ERROR',
      idle: true, idleReason: 'no-window', lastSuccessfulSampleAt: lastSuccessful },
    { trackingPaused: false, trackingPauseUntil: 0, resumeTrackingNextDay: false, trackingPauseDate: '' });
    await open();
    assert.equal(await render(heading), 'Tracking unavailable');
    const unavailable = await render(`document.getElementById('tracking-status-popover').textContent`);
    assert.match(unavailable, /Last successful reading:/);
    assert.match(unavailable, /retries automatically/);
    assert(!unavailable.includes('PRIVATE'), 'Details do not expose raw titles or backend errors');
    assert.equal(await render(`${action}.textContent`), 'Tracking settings');
    const beforeRecovery = writes.length;
    await update(live());
    assert.equal(await render(visible), true, 'Fresh readings update an open popover');
    assert.equal(await render(heading), 'Live tracking');
    assert.equal(await render(`document.getElementById('tracking-status-last-reading').classList.contains('hidden')`), true);
    assert.equal(await render(`${action}.classList.contains('hidden')`), true);
    assert.equal(writes.length, beforeRecovery, 'Recovery display makes no settings changes');

    for (const [next, partial, label] of [
      [{ ...live(), ignored: true, category: 'ignored' }, {}, 'Ignored app'],
      [{ ...live(), source: 'idle', idle: true, idleReason: 'idle' }, {}, 'Idle'],
      [{ ...live(), source: 'demo' }, { demoMode: true }, 'Demo mode']
    ]) {
      await update(next, partial);
      assert.equal(await render(`${source}.textContent`), label);
      assert.equal(await render(heading), label);
    }
    assert.match(await render(`document.getElementById('tracking-status-description').textContent`), /simulated/);
    await update({ source: 'idle', app: 'Tracking unavailable', trackingError: 'fixture unavailable' }, { demoMode: false });
    await open();
    await render(`${action}.click()`);
    await waitFor(`!document.getElementById('view-settings').classList.contains('hidden') && document.querySelector('[data-settings-tab="tracking"]').getAttribute('aria-selected') === 'true'`, 'Settings action did not route to Tracking');
    assert.equal(await render(visible), false);
    assert.equal(await render('document.activeElement.dataset.settingsTab'), 'tracking');
    assert.equal(writes.length, beforeRecovery, 'Opening Tracking settings does not mutate settings');
    console.log('Tracking details: read-only open, keyboard, pause retry, deadline, safe health details, recovery and settings routing passed.');

    await render(`document.querySelector('.nav-btn[data-tab="home"]').click()`);
    const layouts = [];
    for (const width of [800, 1040, 1600]) {
      await setWidth(width);
      for (const theme of ['midnight', 'graphite']) {
        settings.theme = theme;
        await update({ source: 'idle', app: 'Tracking unavailable', trackingError: 'fixture unavailable', lastSuccessfulSampleAt: lastSuccessful });
        for (const collapsed of width > 900 ? [false, true] : [false]) {
          await render(`if (document.body.classList.contains('nav-collapsed') !== ${collapsed}) document.getElementById('nav-toggle').click()`);
          await new Promise(resolve => setTimeout(resolve, 60));
          await open();
          const measured = await geometry();
          assert(measured.inside && !measured.overflow && measured.controlsInside,
            'Details stay within viewport: ' + JSON.stringify({ width, theme, collapsed, ...measured }));
          await key('Escape');
          layouts.push({ width, theme, collapsed });
        }
      }
    }
    console.log('Tracking details layouts passed:', JSON.stringify(layouts));

    await setWidth(1040);
    await render(`if (!document.body.classList.contains('nav-collapsed')) document.getElementById('nav-toggle').click()`);
    assert.equal(await render(`localStorage.getItem('sydtrack.sidebarCollapsed')`), 'true');
    await win.reload();
    await waitFor(`liveDayDate === ${JSON.stringify(date)} && document.body.classList.contains('nav-collapsed') && document.getElementById('nav-toggle').getAttribute('aria-expanded') === 'false'`, 'Collapsed sidebar did not survive reload with matching accessibility state');
    await render(`document.getElementById('nav-toggle').click()`);
    assert.equal(await render(`document.getElementById('nav-toggle').getAttribute('aria-expanded')`), 'true');
    await win.reload();
    await waitFor(`liveDayDate === ${JSON.stringify(date)} && !document.body.classList.contains('nav-collapsed') && document.getElementById('nav-toggle').getAttribute('aria-expanded') === 'true'`, 'Expanded sidebar did not survive reload');

    const screenshots = [];
    for (const theme of ['midnight', 'graphite']) {
      settings.theme = theme;
      await update({ source: 'idle', app: 'Tracking unavailable', trackingError: 'fixture unavailable', lastSuccessfulSampleAt: lastSuccessful });
      await render('document.getElementById("source-pill").blur(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await open();
      await render('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      assert.equal(await render(visible), true, 'Screenshot captures open details');
      const screenshot = path.join(temporary, 'tracking-status-' + theme + '.png');
      fs.writeFileSync(screenshot, (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
      screenshots.push(screenshot);
      await key('Escape');
    }
    assert.equal(rendererErrors.filter(message => !message.includes('Synthetic tracking status write failure')).length, 0,
      'No unexpected renderer errors: ' + rendererErrors.join('\n'));
    console.log('Sidebar memory: collapsed and expanded reload persistence with matching accessibility state passed.');
    console.log('Tracking detail screenshots:', JSON.stringify(screenshots));
    console.log('Tracking status UI checks passed. All diagnostic state stayed in:', temporary);
    app.quit();
  } finally {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
    if (!win.isDestroyed()) {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
      win.destroy();
    }
  }
}).catch(error => { console.error(error); app.exit(1); });

setTimeout(() => { console.error('Tracking status checks timed out'); app.exit(1); }, 85000).unref();
