'use strict';

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('child_process').spawn(require('electron'), [__filename], {
    env, stdio: 'inherit', windowsHide: true
  });
  const timeout = setTimeout(() => { console.error('Pause menu checks timed out'); child.kill(); }, 45000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('exit', code => { clearTimeout(timeout); process.exitCode = code == null ? 1 : code; });
  return;
}

// Production sandboxed preload, synthetic IPC/state, and a hidden test window.
// No production main process, foreground tracker, personal profile, or network.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { THEME_IDS } = require('../src/theme');
const version = require('../package.json').version;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-pause-menu-'));
const userData = path.join(temporary, 'user-data');
fs.mkdirSync(userData);
app.setPath('appData', temporary);
app.setPath('userData', userData);
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const at = new Date();
  const date = at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0');
  let settings = { onboardingComplete: true, trackingPaused: false, trackingPauseUntil: 0,
    launchAtStartup: false, updateChecksEnabled: false, notificationsEnabled: true, demoMode: false,
    theme: 'midnight', pollMs: 3000, thresholdSec: 600, focusBoost: false,
    focusBoostScheduleEnabled: false, focusShareGoalPct: 80, focusShareIncludeOther: false };
  const profile = { id: 'default', name: 'Synthetic profile', productive: [], unproductive: [], other: [], ignore: [] };
  const stats = () => ({ date, byCategory: { productive: 0, unproductive: 0, other: 0 },
    byHour: Array.from({ length: 24 }, () => ({ productive: 0, unproductive: 0, other: 0 })),
    topApps: [], appBreakdown: [], activityRows: [], settings: { ...settings } });
  let win;
  const writes = [];
  let failedTimed = false, failedSettings = false, heldWrite = null;
  function publish() {
    win.webContents.send('tracker:update', { stats: stats(), now: { source: settings.trackingPaused ? 'paused' : 'real' }, lastFocused: null, session: null });
  }
  const handlers = {
    'state:get': () => ({ stats: stats(), now: { source: 'real' }, lastFocused: null, session: null, platform: process.platform }),
    'profiles:get': () => ({ schemaVersion: 1, activeId: 'default', profiles: [profile] }),
    'rules:get': () => ({ ...profile, profileId: 'default' }),
    'ignore:get': () => ({ ignore: [], profileId: 'default' }),
    'keywords:get': () => ({ productive: [], unproductive: [] }),
    'updates:get': () => ({ currentVersion: version, available: false, phase: 'idle' }),
    'session:getActive': () => null,
    'session:getForDay': (_event, key) => ({ date: key || date, sessions: [], recentDays: [], historyEnabled: true }),
    'history:summary': () => [],
    'history:timelineDay': () => ({ ...stats(), timeline: [] }),
    'tracking:pauseFor': async (_event, minutes) => {
      assert([15, 30, 60].includes(minutes), 'Timed pause uses supported numeric minutes through production preload');
      writes.push({ channel: 'tracking:pauseFor', minutes });
      if (failedTimed) { failedTimed = false; throw new Error('Synthetic pause write failed'); }
      if (heldWrite) await heldWrite;
      settings = { ...settings, trackingPaused: true, trackingPauseUntil: Date.now() + minutes * 60000 };
      publish(); return { ...settings };
    },
    'settings:update': async (_event, partial) => {
      writes.push({ channel: 'settings:update', partial });
      if (failedSettings) { failedSettings = false; throw new Error('Synthetic settings write failed'); }
      if (heldWrite) await heldWrite;
      settings = { ...settings, ...partial,
        ...(Object.hasOwn(partial, 'trackingPaused') ? { trackingPauseUntil: 0 } : {}) };
      publish(); return { ...settings };
    }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  win = new BrowserWindow({ show: false, width: 1040, height: 760,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      // Keep frame-based layout settling deterministic while this diagnostic stays hidden.
      backgroundThrottling: false } });
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
  async function key(name) {
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const inputs = {
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' },
      Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' },
      Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
      ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
      ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
      Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
      End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
      Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }
    };
    const input = inputs[name];
    assert(input, 'Supported test key');
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...input });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp', key: input.key, code: input.code, windowsVirtualKeyCode: input.windowsVirtualKeyCode
    });
  }
  async function setWidth(width) {
    win.setSize(width, 760);
    const [contentWidth, contentHeight] = win.getContentSize();
    await waitFor(`Math.abs(innerWidth - ${contentWidth}) <= 2 && Math.abs(innerHeight - ${contentHeight}) <= 2`, 'Hidden renderer did not reach requested window dimensions');
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  const menuVisible = `!document.getElementById('pause-settings-menu').classList.contains('hidden') && !document.getElementById('pause-settings-menu').hidden`;
  async function state() {
    return render(`(() => ({
      label: document.getElementById('pause-settings-label').textContent.trim(),
      settingsPaused: document.getElementById('pause-settings-btn').getAttribute('data-paused'),
      sidebarPaused: document.getElementById('pause-btn').getAttribute('data-paused'),
      menuVisible: ${menuVisible}, expanded: document.getElementById('pause-settings-btn').getAttribute('aria-expanded'),
      popup: document.getElementById('pause-settings-btn').getAttribute('aria-haspopup'),
      disabled: document.getElementById('pause-settings-btn').disabled,
      status: document.getElementById('pause-until-status').textContent,
      statusVisible: !document.getElementById('pause-until-status').classList.contains('hidden'),
      source: document.getElementById('source-pill').textContent,
      focusedMinutes: document.activeElement?.dataset.pauseMinutes,
      focusedId: document.activeElement?.id
    }))()`);
  }
  async function trackerGeometry() {
    return render(`(() => {
      const definitions = [
        ['launch-startup-row', '#launch-startup-toggle'],
        ['pause', '#pause-settings-btn'],
        ['session-history-row', '#session-history-toggle']
      ];
      const center = rect => (rect.top + rect.bottom) / 2;
      const rows = definitions.map(([id, selector]) => {
        const row = id === 'pause' ? document.querySelector('.pause-settings-row') : document.getElementById(id);
        const rect = row.getBoundingClientRect();
        const title = row.querySelector('.switch-title').getBoundingClientRect();
        const control = row.querySelector(selector).getBoundingClientRect();
        return { id, height: rect.height, top: rect.top, bottom: rect.bottom,
          titleCenter: center(title), controlCenter: center(control),
          borderBottom: parseFloat(getComputedStyle(row).borderBottomWidth) || 0 };
      });
      const polling = document.getElementById('polling-settings');
      const pollingRect = polling.getBoundingClientRect();
      const upperDivider = rows[1].bottom - rows[1].borderBottom / 2;
      const lowerDivider = pollingRect.top + (parseFloat(getComputedStyle(polling).borderTopWidth) || 0) / 2;
      return { rows, statusHidden: document.getElementById('pause-until-status').classList.contains('hidden'),
        historyAbove: rows[2].controlCenter - upperDivider,
        historyBelow: lowerDivider - rows[2].controlCenter };
    })()`);
  }
  function assertTrackerGeometry(geometry, label) {
    assert.equal(geometry.statusHidden, true, 'Uniform spacing is checked only with the live pause hint hidden: ' + label);
    const heights = geometry.rows.map(row => row.height);
    assert(Math.max(...heights) - Math.min(...heights) <= 1.01,
      'Live Tracker rows have uniform heights: ' + label + ' ' + JSON.stringify(geometry));
    assert(geometry.rows.every(row => Math.abs(row.titleCenter - row.controlCenter) <= 1.01),
      'Tracker titles center with their controls: ' + label + ' ' + JSON.stringify(geometry));
    assert(geometry.historyAbove > 0 && geometry.historyBelow > 0 && Math.abs(geometry.historyAbove - geometry.historyBelow) <= 1.01,
      'History control is centered between its upper divider and Polling divider: ' + label + ' ' + JSON.stringify(geometry));
  }
  async function openMenu() {
    await render(`document.getElementById('pause-settings-btn').click()`);
    await waitFor(menuVisible, 'Pause duration menu did not open');
    const ui = await state();
    assert.equal(ui.label, 'Pause for…'); assert.equal(ui.expanded, 'true');
  }
  async function choose(minutes) {
    await openMenu();
    await render(`document.querySelector('#pause-settings-menu [data-pause-minutes="${minutes}"]').click()`);
    await waitFor(`document.getElementById('pause-settings-btn').getAttribute('data-paused') === 'on' && !document.getElementById('pause-settings-btn').disabled`, 'Pause choice did not settle');
    const ui = await state();
    assert.equal(ui.label, 'Resume tracking'); assert.equal(ui.sidebarPaused, 'on');
    assert.equal(ui.menuVisible, false, 'Choosing duration closes the menu immediately');
    assert(ui.expanded === 'false' || ui.expanded == null, 'Paused control does not advertise an expanded menu');
    assert.equal(ui.popup, null, 'Paused control acts as Resume without a menu');
    return ui;
  }
  async function resume(button = 'pause-settings-btn') {
    const before = writes.length;
    await render(`document.getElementById(${JSON.stringify(button)}).click()`);
    await waitFor(`document.getElementById('pause-settings-btn').getAttribute('data-paused') === 'off' && !document.getElementById('pause-settings-btn').disabled`, 'Resume did not settle');
    assert.equal(writes.length, before + 1, 'Resume performs one write');
    assert.equal(writes[before].channel, 'settings:update');
    assert.equal(writes[before].partial.trackingPaused, false);
    assert.equal(settings.trackingPauseUntil, 0, 'Resume clears timed deadline');
    const ui = await state();
    assert.equal(ui.label, 'Pause for…'); assert.equal(ui.sidebarPaused, 'off'); assert.equal(ui.menuVisible, false);
    assert.equal(ui.statusVisible, false, 'Resume clears the timed status');
  }
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await render(`(async () => { await window.sydtrackProfilesUI.reload(); await loadRulesAndIgnore(); })()`);
    await waitFor(`liveDayDate === ${JSON.stringify(date)}`, 'Isolated renderer did not boot');
    await render(`document.querySelector('.nav-btn[data-tab="settings"]').click(); document.querySelector('[data-settings-tab="tracking"]').click();`);
    await render(`document.querySelector('.pause-settings-row').scrollIntoView({ block: 'center' });
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await render(`(() => {
      window.__pauseTestConfirmations = 0;
      window.confirm = () => { window.__pauseTestConfirmations++; throw new Error('Pause must not request confirmation'); };
    })()`);
    const structure = await render(`(() => {
      const button = document.getElementById('pause-settings-btn');
      const menu = document.getElementById('pause-settings-menu');
      return { singleControl: button.classList.contains('btn') && !button.classList.contains('pause-power') &&
          !button.querySelector('svg') && !document.getElementById('pause-15-btn'),
        accessible: button.tagName === 'BUTTON' && button.type === 'button' &&
          button.getAttribute('aria-haspopup') === 'menu' && button.getAttribute('aria-controls') === 'pause-settings-menu' && menu.getAttribute('role') === 'menu',
        choices: [...menu.querySelectorAll('[data-pause-minutes]')].map(item => ({
          minutes: Number(item.dataset.pauseMinutes), native: item.tagName === 'BUTTON' && item.type === 'button', role: item.getAttribute('role')
        })) };
    })()`);
    assert.equal(structure.singleControl, true, 'Settings has one labeled pause control without redundant old controls');
    assert.equal(structure.accessible, true);
    assert.deepEqual(structure.choices.map(item => item.minutes), [15, 30, 60, 0]);
    assert(structure.choices.every(item => item.native && item.role === 'menuitem'));
    assert.equal(await render('typeof window.sydtrack.pauseForMinutes'), 'function', 'New timed-pause bridge exists');

    for (const minutes of [15, 30, 60]) {
      const before = writes.length, started = Date.now();
      const ui = await choose(minutes);
      assert.equal(writes.length, before + 1, 'One timed pause makes one IPC write');
      assert.deepEqual(writes[before], { channel: 'tracking:pauseFor', minutes });
      assert.equal(settings.trackingPaused, true);
      assert(Math.abs(settings.trackingPauseUntil - started - minutes * 60000) < 2000, 'Timed deadline matches selected duration');
      assert.equal(ui.statusVisible, true); assert(ui.status.startsWith('Resumes at '));
      assert.equal(await render(`(() => {
        const row = document.querySelector('.pause-settings-row').getBoundingClientRect();
        const hint = document.getElementById('pause-until-status').getBoundingClientRect();
        const control = document.getElementById('pause-settings-btn').getBoundingClientRect();
        return hint.height > 0 && hint.top >= row.top && hint.bottom <= row.bottom + 1 &&
          control.top >= row.top && control.bottom <= row.bottom + 1;
      })()`), true, 'Timed pause status remains visible and its row can expand without clipping');
      assert(/^Paused/i.test(ui.source) && /\d/.test(ui.source), 'Sidebar shows timed countdown');
      await resume();
    }
    const beforeIndefinite = writes.length;
    const indefinite = await choose(0);
    assert.equal(writes.length, beforeIndefinite + 1); assert.equal(writes[beforeIndefinite].channel, 'settings:update');
    assert.equal(writes[beforeIndefinite].partial.trackingPaused, true);
    assert.equal(settings.trackingPauseUntil, 0); assert.equal(indefinite.statusVisible, false);
    await resume('pause-btn');
    const beforeSidebar = writes.length;
    await render(`document.getElementById('pause-btn').click()`);
    await waitFor(`document.getElementById('pause-settings-label').textContent.trim() === 'Resume tracking'`, 'Sidebar pause did not synchronize Settings');
    assert.equal(writes.length, beforeSidebar + 1); assert.equal(settings.trackingPauseUntil, 0);
    assert.equal((await state()).menuVisible, false, 'Sidebar pause remains one-click indefinite');
    await resume();
    console.log('Pause menu: timed choices, indefinite/resume, single writes and cross-sidebar synchronization passed.');

    const beforeDismissal = writes.length;
    await openMenu();
    await key('Escape');
    await waitFor(`!(${menuVisible})`, 'Escape did not dismiss menu');
    assert.equal((await state()).focusedId, 'pause-settings-btn', 'Escape restores trigger focus');
    await openMenu();
    await render(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.body.click();`);
    await waitFor(`!(${menuVisible})`, 'Outside click did not dismiss menu');
    await openMenu(); await key('Tab');
    await waitFor(`!(${menuVisible})`, 'Tab did not dismiss menu');
    await openMenu();
    await render(`document.querySelector('[data-settings-tab="wellbeing"]').click()`);
    await waitFor(`!(${menuVisible})`, 'Changing Settings section did not dismiss menu');
    await render(`document.querySelector('[data-settings-tab="tracking"]').click()`);
    await openMenu();
    await render(`document.querySelector('.nav-btn[data-tab="home"]').click()`);
    await waitFor(`!(${menuVisible})`, 'Leaving Settings did not dismiss menu');
    await render(`document.querySelector('.nav-btn[data-tab="settings"]').click();
      document.querySelector('.pause-settings-row').scrollIntoView({ block: 'center' });
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    assert.equal(writes.length, beforeDismissal, 'Menu dismissal makes no tracking changes');
    await openMenu();
    await render(`document.querySelector('#pause-settings-menu [data-pause-minutes="15"]').focus({ preventScroll: true })`);
    for (const [press, expected] of [['ArrowDown', '30'], ['ArrowUp', '15'], ['End', '0'], ['Home', '15'], ['ArrowUp', '0'], ['ArrowDown', '15']]) {
      await key(press);
      assert.equal((await state()).focusedMinutes, expected, 'Menu keyboard focus after ' + press);
    }
    await key('Enter');
    await waitFor(`document.getElementById('pause-settings-label').textContent.trim() === 'Resume tracking' && !document.getElementById('pause-settings-btn').disabled`, 'Native Enter did not choose duration');
    assert.equal((await state()).focusedId, 'pause-settings-btn', 'Keyboard pause restores focus after the pending action settles');
    const beforeKeyboardResume = writes.length;
    await key('Space');
    await waitFor(`document.getElementById('pause-settings-label').textContent.trim() === 'Pause for…' && !document.getElementById('pause-settings-btn').disabled`, 'Native Space did not resume');
    assert.equal(writes.length, beforeKeyboardResume + 1);
    assert.equal(writes[beforeKeyboardResume].partial.trackingPaused, false);
    assert.equal((await state()).focusedId, 'pause-settings-btn', 'Keyboard resume keeps focus on its control');

    failedTimed = true;
    const beforeFailed = writes.length;
    await openMenu();
    await render(`document.querySelector('#pause-settings-menu [data-pause-minutes="30"]').click()`);
    await waitFor(`!document.getElementById('pause-settings-btn').disabled && !(${menuVisible})`, 'Failed timed pause did not restore usable control');
    assert.equal(writes.length, beforeFailed + 1); assert.equal(settings.trackingPaused, false);
    assert.equal((await state()).label, 'Pause for…', 'Failed pause keeps previous live state');
    assert((await state()).status.includes('Could not pause'), 'Failed pause explains retry');
    await choose(30);
    failedSettings = true;
    const beforeResumeFailure = writes.length;
    await render(`document.getElementById('pause-settings-btn').click()`);
    await waitFor(`!document.getElementById('pause-settings-btn').disabled`, 'Failed resume did not restore usable control');
    assert.equal(writes.length, beforeResumeFailure + 1); assert.equal(settings.trackingPaused, true);
    assert.equal((await state()).label, 'Resume tracking', 'Failed resume preserves paused state');
    assert((await state()).status.includes('Could not resume'), 'Failed resume explains retry');
    await resume();

    let releaseHeld;
    heldWrite = new Promise(resolve => { releaseHeld = resolve; });
    const beforeBusy = writes.length;
    await openMenu();
    await render(`document.querySelector('#pause-settings-menu [data-pause-minutes="60"]').click()`);
    for (let attempt = 0; writes.length === beforeBusy && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(writes.length, beforeBusy + 1, 'Selected pause reaches the held backend write');
    await render(`document.querySelector('#pause-settings-menu [data-pause-minutes="15"]').click();
      document.getElementById('pause-settings-btn').click(); document.getElementById('pause-btn').click();`);
    await render('new Promise(resolve => setTimeout(resolve, 50))');
    assert.equal(writes.length, beforeBusy + 1, 'Rapid choices/sidebar clicks do not duplicate pending write');
    assert.equal(settings.trackingPaused, false, 'Pending backend write does not pretend to have succeeded');
    heldWrite = null; releaseHeld();
    await waitFor(`document.getElementById('pause-settings-label').textContent.trim() === 'Resume tracking' && !document.getElementById('pause-settings-btn').disabled`, 'Held write did not settle');
    await resume();
    assert.equal(await render('window.__pauseTestConfirmations'), 0);
    console.log('Pause menu: keyboard/dismissal, failed-write retries, no confirmation and pending-action guard passed.');

    failedSettings = true;
    const beforeSidebarFailure = writes.length;
    await render(`document.getElementById('pause-btn').focus({ preventScroll: true })`);
    await key('Enter');
    await waitFor(`!document.getElementById('pause-btn').disabled && document.getElementById('pause-until-status').textContent.includes('Could not pause')`, 'Failed sidebar pause did not settle');
    assert.equal(writes.length, beforeSidebarFailure + 1);
    assert.equal(settings.trackingPaused, false, 'Sidebar failure keeps the previous live state');
    assert.equal((await state()).focusedId, 'pause-btn', 'Sidebar failure restores keyboard focus');
    heldWrite = new Promise(resolve => { releaseHeld = resolve; });
    const beforeSidebarBusy = writes.length;
    await key('Space');
    for (let attempt = 0; writes.length === beforeSidebarBusy && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(writes.length, beforeSidebarBusy + 1, 'Sidebar retry reaches the held backend write');
    const sidebarBusy = await render(`document.getElementById('pause-btn').disabled && document.getElementById('pause-settings-btn').disabled`);
    assert.equal(sidebarBusy, true, 'Sidebar-first action disables both pause controls');
    await render(`document.getElementById('pause-btn').click(); document.getElementById('pause-settings-btn').click();
      document.querySelector('#pause-settings-menu [data-pause-minutes="30"]').click();`);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(writes.length, beforeSidebarBusy + 1, 'Sidebar-first pending action prevents duplicate writes from every pause entry point');
    assert.equal(settings.trackingPaused, false);
    heldWrite = null; releaseHeld();
    await waitFor(`document.getElementById('pause-btn').getAttribute('data-paused') === 'on' && !document.getElementById('pause-btn').disabled`, 'Sidebar retry did not settle');
    assert.equal((await state()).focusedId, 'pause-btn', 'Sidebar keyboard action restores focus after settling');
    failedSettings = true;
    const beforeSidebarResumeFailure = writes.length;
    await key('Space');
    await waitFor(`!document.getElementById('pause-btn').disabled && document.getElementById('pause-until-status').textContent.includes('Could not resume')`, 'Failed sidebar resume did not settle');
    assert.equal(writes.length, beforeSidebarResumeFailure + 1); assert.equal(settings.trackingPaused, true);
    assert.equal((await state()).focusedId, 'pause-btn');
    await resume('pause-btn');
    console.log('Pause menu: sidebar-first pending guard, failure/retry and settled keyboard focus passed.');

    const layouts = [];
    for (const width of [800, 1040, 1600]) {
      await setWidth(width);
      for (const theme of THEME_IDS) {
        await render(`applyTheme(${JSON.stringify(theme)}); document.querySelector('.pause-settings-row').scrollIntoView({ block: 'center' });`);
        // Hidden windows can throttle requestAnimationFrame despite timer preferences.
        // Allow native resize/scroll events to dispatch, then synchronous geometry flushes layout.
        await new Promise(resolve => setTimeout(resolve, 60));
        assertTrackerGeometry(await trackerGeometry(), width + '/' + theme);
        await openMenu();
        const contained = await render(`(() => {
          const menu = document.getElementById('pause-settings-menu');
          const r = menu.getBoundingClientRect();
          const trigger = document.getElementById('pause-settings-btn').getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 &&
            trigger.left >= 0 && trigger.right <= innerWidth && menu.scrollWidth <= menu.clientWidth + 1 &&
            [...menu.querySelectorAll('[role="menuitem"]')].every(item => {
              const rect = item.getBoundingClientRect();
              return rect.left >= r.left && rect.right <= r.right + 1 && rect.top >= r.top && rect.bottom <= r.bottom + 1;
            });
        })()`);
        assert.equal(contained, true, 'Pause menu stays inside viewport: ' + width + '/' + theme);
        if (width === 800 && theme === 'midnight') {
          const beforeScroll = writes.length;
          // At the narrow layout the document, not only .main, owns scrolling.
          const previousTop = await render('document.scrollingElement.scrollTop');
          await render(`window.scrollBy(0, ${previousTop > 4 ? '-4' : '4'})`);
          await waitFor(`!(${menuVisible})`, 'Document scrolling at 800px did not dismiss menu');
          assert.notEqual(await render('document.scrollingElement.scrollTop'), previousTop, 'The narrow document actually scrolled');
          assert.equal(writes.length, beforeScroll, 'Scroll dismissal makes no tracking changes');
        }
        await key('Escape');
        layouts.push({ width, theme, contained: true, trackerSpacing: true });
      }
      console.log('Pause menu layouts passed at width:', width);
    }
    console.log('Pause menu layouts:', JSON.stringify(layouts));
    // A dedicated painted frame avoids a stale screenshot when hidden theme/layout
    // checks run faster than the compositor; this never shows the native window.
    await setWidth(1040);
    await render(`window.__pauseScreenshotEvents = [];
      ['scroll', 'resize', 'focusin'].forEach(type => window.addEventListener(type, event => {
        if (!document.getElementById('pause-settings-menu').classList.contains('hidden')) {
          window.__pauseScreenshotEvents.push({ type, target: event.target?.id || event.target?.className || event.target?.nodeName,
            width: innerWidth, top: document.scrollingElement.scrollTop, mainTop: document.querySelector('.main').scrollTop });
        }
      }, true))`);
    await render(`applyTheme('midnight'); document.querySelector('.pause-settings-row').scrollIntoView({ block: 'center' });
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await openMenu();
    await render('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal((await state()).menuVisible, true, 'Saved screenshot represents the open menu: ' + JSON.stringify(await render('window.__pauseScreenshotEvents')));
    fs.writeFileSync(path.join(temporary, 'pause-menu.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await key('Escape');
    await render('document.getElementById("pause-settings-btn").blur(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal((await state()).menuVisible, false, 'Clean Tracker screenshot has its duration menu closed');
    assertTrackerGeometry(await trackerGeometry(), 'closed Tracker screenshot');
    fs.writeFileSync(path.join(temporary, 'tracker-spacing.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    assert.equal(settings.trackingPaused, false);
    assert.equal(await render('window.__pauseTestConfirmations'), 0);
    const unexpectedErrors = rendererErrors.filter(message => !message.includes('Synthetic pause write failed') && !message.includes('Synthetic settings write failed'));
    assert.equal(unexpectedErrors.length, 0, 'No unexpected renderer errors: ' + unexpectedErrors.join('\n'));
    console.log('Pause menu screenshot:', path.join(temporary, 'pause-menu.png'));
    console.log('Tracker spacing screenshot:', path.join(temporary, 'tracker-spacing.png'));
    console.log('Pause menu checks passed. All diagnostic state stayed in:', temporary);
    app.quit();
  } finally {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
    if (!win.isDestroyed()) {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
      win.destroy();
    }
  }
}).catch(error => { console.error(error); app.exit(1); });

setTimeout(() => { console.error('Pause menu checks timed out'); app.exit(1); }, 40000).unref();
