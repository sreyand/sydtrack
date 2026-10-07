'use strict';

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('child_process').spawn(require('electron'), [__filename], {
    env, stdio: 'inherit', windowsHide: true
  });
  const timeout = setTimeout(() => { console.error('Schedule time checks timed out'); child.kill(); }, 80000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('exit', code => { clearTimeout(timeout); process.exitCode = code == null ? 1 : code; });
  return;
}

// Production sandboxed preload and renderer, synthetic IPC/settings, hidden window.
// No production main process, foreground tracker, personal profile, or network.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { THEME_IDS } = require('../src/theme');
const version = require('../package.json').version;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-schedule-time-'));
const userData = path.join(temporary, 'user-data');
fs.mkdirSync(userData);
app.setPath('appData', temporary);
app.setPath('userData', userData);
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const now = new Date();
  const date = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  let settings = { onboardingComplete: true, trackingPaused: false, trackingPauseUntil: 0,
    launchAtStartup: false, updateChecksEnabled: false, notificationsEnabled: true, demoMode: false,
    theme: 'midnight', pollMs: 3000, thresholdSec: 600, focusBoost: false,
    focusBoostScheduleEnabled: true, focusBoostScheduleStart: '09:07', focusBoostScheduleEnd: '23:59',
    focusShareGoalPct: 80, focusShareIncludeOther: false };
  const profile = { id: 'default', name: 'Synthetic profile', productive: [], unproductive: [], other: [], ignore: [] };
  const stats = () => ({ date, byCategory: { productive: 0, unproductive: 0, other: 0 },
    byHour: Array.from({ length: 24 }, () => ({ productive: 0, unproductive: 0, other: 0 })),
    topApps: [], appBreakdown: [], activityRows: [], settings: { ...settings } });
  const writes = [];
  let failScheduleWrite = false, heldWrite = null, win;
  const timingKeys = ['focusBoostScheduleStart', 'focusBoostScheduleEnd', 'focusBoostScheduleEnabled'];
  const scheduleWrites = () => writes.filter(write => timingKeys.some(key => Object.hasOwn(write.partial, key)));
  function publish() {
    win.webContents.send('tracker:update', { stats: stats(), now: { source: 'real' }, lastFocused: null, session: null });
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
    'settings:update': async (_event, partial) => {
      assert(partial && typeof partial === 'object', 'Settings writes retain the production preload object contract');
      writes.push({ channel: 'settings:update', partial });
      const scheduleWrite = timingKeys.some(key => Object.hasOwn(partial, key));
      if (scheduleWrite && failScheduleWrite) { failScheduleWrite = false; throw new Error('Synthetic schedule write failed'); }
      if (scheduleWrite && heldWrite) await heldWrite;
      settings = { ...settings, ...partial };
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
  async function key(name, shift = false) {
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const inputs = {
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' },
      Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' },
      Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
      ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
      ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
      ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
      ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
      Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
      End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
      Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }
    };
    const input = inputs[name];
    assert(input, 'Supported native test key');
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...input, modifiers: shift ? 8 : 0 });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp', key: input.key, code: input.code, windowsVirtualKeyCode: input.windowsVirtualKeyCode, modifiers: shift ? 8 : 0
    });
  }
  async function setWidth(width) {
    win.setSize(width, 760);
    const [contentWidth, contentHeight] = win.getContentSize();
    await waitFor(`Math.abs(innerWidth - ${contentWidth}) <= 2 && Math.abs(innerHeight - ${contentHeight}) <= 2`, 'Hidden renderer did not reach requested dimensions');
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  const id = which => 'fb-schedule-' + which;
  const visible = which => `!document.getElementById('${id(which)}-popover').hidden && !document.getElementById('${id(which)}-popover').classList.contains('hidden')`;
  async function state(which) {
    return render(`(() => {
      const input = document.getElementById('${id(which)}');
      const trigger = document.getElementById('${id(which)}-trigger');
      const wrapper = trigger.closest('.schedule-time-control');
      const popover = document.getElementById('${id(which)}-popover');
      return { value: input.value, nativeDisabled: input.disabled, triggerDisabled: trigger.disabled,
        time: trigger.dataset.time, display: trigger.querySelector('.schedule-time-value')?.textContent.trim(),
        expanded: trigger.getAttribute('aria-expanded'), visible: ${visible(which)},
        focusedId: document.activeElement?.id, focusedUnit: document.activeElement?.dataset.timeUnit,
        focusedAction: document.activeElement?.dataset.timeAction,
        status: wrapper.querySelector('[role="status"]')?.textContent.trim() || '',
        groups: [...popover.querySelectorAll('[role="listbox"]')].map(group => ({
          unit: group.dataset.timeUnit, tabindex: group.tabIndex, activeId: group.getAttribute('aria-activedescendant'),
          activeValue: document.getElementById(group.getAttribute('aria-activedescendant'))?.dataset.timeOption,
          options: [...group.querySelectorAll('[role="option"]')].map(option => ({
            id: option.id, value: Number(option.dataset.timeOption), native: option.tagName === 'BUTTON' && option.type === 'button',
            selected: option.getAttribute('aria-selected') === 'true', tabIndex: option.tabIndex
          }))
        })) };
    })()`);
  }
  async function showNotifications() {
    await render(`document.querySelector('.nav-btn[data-tab="settings"]').click(); document.querySelector('[data-settings-tab="notifications"]').click();
      document.getElementById('fb-schedule-times').scrollIntoView({ block: 'center' });`);
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  async function open(which, native = false) {
    await render(`document.getElementById('${id(which)}-trigger').focus({ preventScroll: true })`);
    if (native) await key('Enter');
    else await render(`document.getElementById('${id(which)}-trigger').click()`);
    await waitFor(visible(which), 'Schedule ' + which + ' picker did not open');
    const ui = await state(which);
    assert.equal(ui.expanded, 'true', 'Open picker reports expanded state');
    return ui;
  }
  async function draft(which, time) {
    const [hour, minute] = time.split(':').map(Number);
    await render(`(() => {
      const popover = document.getElementById('${id(which)}-popover');
      const period = popover.querySelector('[role="listbox"][data-time-unit="period"]');
      const values = { hour: period ? (${hour} % 12 || 12) : ${hour}, minute: ${minute}, period: ${hour >= 12 ? 1 : 0} };
      for (const [unit, value] of Object.entries(values)) {
        const group = popover.querySelector('[role="listbox"][data-time-unit="' + unit + '"]');
        if (!group) continue;
        const option = group.querySelector('[data-time-option="' + value + '"]');
        if (!option) throw new Error('Missing exact ' + unit + ' option ' + value);
        option.click();
      }
    })()`);
  }
  async function save(which, time) {
    const before = scheduleWrites().length;
    const previous = (await state(which)).value;
    await open(which);
    await draft(which, time);
    assert.equal(scheduleWrites().length, before, 'Draft selection does not write settings');
    assert.equal((await state(which)).value, previous, 'Draft selection leaves the hidden native value unchanged');
    await render(`document.querySelector('#${id(which)}-popover [data-time-action="save"]').click()`);
    await waitFor(`document.getElementById('${id(which)}-trigger').dataset.time === ${JSON.stringify(time)} && !document.getElementById('${id(which)}-trigger').disabled && !(${visible(which)})`, 'Schedule exact-minute save did not settle');
    assert.equal(scheduleWrites().length, before + 1, 'One time commit uses one schedule settings write');
    assert.deepEqual(scheduleWrites()[before].partial, { [which === 'start' ? 'focusBoostScheduleStart' : 'focusBoostScheduleEnd']: time });
    assert.equal(settings[which === 'start' ? 'focusBoostScheduleStart' : 'focusBoostScheduleEnd'], time);
    assert.equal((await state(which)).value, time);
  }
  async function assertDisplay(which, time) {
    const normalized = value => String(value).replace(/\s+/g, ' ').trim().replace(/^0(?=\d:)/, '');
    const expected = await render(`(() => {
      const date = new Date(); date.setHours(${Number(time.slice(0, 2))}, ${Number(time.slice(3))}, 0, 0);
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
    })()`);
    assert.equal(normalized((await state(which)).display), normalized(expected), 'Trigger shows localized exact-minute time');
  }
  async function pickerGeometry(which) {
    return render(`(() => {
      const popover = document.getElementById('${id(which)}-popover');
      const r = popover.getBoundingClientRect();
      const trigger = document.getElementById('${id(which)}-trigger').getBoundingClientRect();
      const inside = rect => rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
      const lists = [...popover.querySelectorAll('[role="listbox"]')];
      return { contained: inside(r) && inside(trigger), overflow: popover.scrollWidth > popover.clientWidth + 1,
        listsVisible: lists.every(group => {
          const rect = group.getBoundingClientRect();
          const selected = group.querySelector('[aria-selected="true"]').getBoundingClientRect();
          return rect.left >= r.left && rect.right <= r.right + 1 && rect.top >= r.top && rect.bottom <= r.bottom + 1 &&
            selected.top >= rect.top - 1 && selected.bottom <= rect.bottom + 1;
        }), footerVisible: [...popover.querySelectorAll('[data-time-action]')].every(button => {
          const rect = button.getBoundingClientRect(); return inside(rect) && rect.top >= r.top && rect.bottom <= r.bottom + 1;
        }) };
    })()`);
  }
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await render(`(async () => { await window.sydtrackProfilesUI.reload(); await loadRulesAndIgnore(); })()`);
    await waitFor(`liveDayDate === ${JSON.stringify(date)} && typeof window.sydtrackScheduleTimeUI?.sync === 'function'`, 'Isolated schedule renderer did not boot');
    await showNotifications();
    await render(`(() => { window.__scheduleTestConfirmations = 0; window.confirm = () => { window.__scheduleTestConfirmations++; throw new Error('Schedule time must not request confirmation'); }; })()`);
    for (const [which, time] of [['start', '09:07'], ['end', '23:59']]) {
      const structure = await render(`(() => {
        const input = document.getElementById('${id(which)}');
        const trigger = document.getElementById('${id(which)}-trigger');
        const popover = document.getElementById('${id(which)}-popover');
        return { native: input.type === 'time', hidden: input.getBoundingClientRect().width === 0,
          control: trigger.tagName === 'BUTTON' && trigger.type === 'button' && trigger.getAttribute('aria-haspopup') === 'dialog' &&
            trigger.getAttribute('aria-controls') === popover.id && trigger.closest('.schedule-time-control').dataset.scheduleInput === input.id,
          role: popover.getAttribute('role'), label: popover.getAttribute('aria-label') };
      })()`);
      assert.equal(structure.native, true, 'Native exact-minute fallback input is preserved');
      assert.equal(structure.hidden, true, 'Initialized custom picker hides the native platform input');
      assert.equal(structure.control, true, 'Picker has a native accessible trigger linked to its preserved input/dialog');
      assert.equal(structure.role, 'dialog'); assert.equal(structure.label, 'Schedule ' + which + ' time');
      const ui = await state(which);
      assert.equal(ui.value, time); assert.equal(ui.time, time); assert.equal(ui.expanded, 'false');
      await assertDisplay(which, time);
    }
    const beforeDraft = scheduleWrites().length;
    const opened = await open('start', true);
    assert.equal(opened.focusedUnit, 'hour', 'Native Enter focuses the first time list');
    const minutes = opened.groups.find(group => group.unit === 'minute');
    assert.deepEqual(minutes.options.map(option => option.value), Array.from({ length: 60 }, (_, index) => index), 'Every exact minute is selectable');
    assert.equal(await render(`(() => {
      const group = document.querySelector('#${id('start')}-popover [data-time-unit="minute"][role="listbox"]');
      for (let minute = 0; minute < 60; minute++) {
        group.querySelector('[data-time-option="' + minute + '"]').click();
        const selected = group.querySelector('[aria-selected="true"]');
        if (!selected || Number(selected.dataset.timeOption) !== minute) return false;
      }
      return document.getElementById('${id('start')}').value === '09:07';
    })()`), true, 'All 60 minute choices update the draft without rounding or changing persisted time');
    assert.equal(scheduleWrites().length, beforeDraft, 'Selecting every minute still makes no IPC writes before Save');
    for (const group of opened.groups) {
      assert.equal(group.tabindex, 0, 'Each time group is keyboard focusable');
      assert(group.options.every(option => option.native && option.id && option.tabIndex === -1), 'Native options use managed group focus');
      assert.equal(new Set(group.options.map(option => option.id)).size, group.options.length, 'Options have unique active-descendant IDs');
      assert.equal(group.options.filter(option => option.selected).length, 1, 'Each time list has one draft selection');
      assert(group.options.some(option => option.id === group.activeId), 'Active descendant names an option in the same list');
    }
    assert.equal(opened.groups.find(group => group.unit === 'hour').options.length, opened.groups.some(group => group.unit === 'period') ? 12 : 24);
    await draft('start', '22:37');
    assert.equal(scheduleWrites().length, beforeDraft);
    await key('Escape');
    await waitFor(`!(${visible('start')})`, 'Escape did not dismiss draft');
    assert.equal((await state('start')).focusedId, id('start') + '-trigger', 'Escape returns focus to the time trigger');
    assert.equal((await state('start')).time, '09:07');
    await open('end'); await draft('end', '05:04');
    await render(`document.querySelector('#${id('end')}-popover [data-time-action="cancel"]').click()`);
    assert.equal((await state('end')).visible, false); assert.equal((await state('end')).time, '23:59');
    assert.equal((await state('end')).focusedId, id('end') + '-trigger', 'Cancel restores focus');
    assert.equal(scheduleWrites().length, beforeDraft, 'Escape/Cancel do not write drafts');
    await save('start', '22:37'); await save('end', '05:04');
    await assertDisplay('start', '22:37'); await assertDisplay('end', '05:04');
    assert.equal(settings.focusBoostScheduleEnabled, true, 'Overnight exact-minute edits retain schedule enablement');
    console.log('Schedule time: arbitrary initial values, all 60 minutes, draft cancellation and exact overnight saves passed.');

    await open('start'); await draft('start', '12:31');
    const beforeUnrelated = scheduleWrites().length;
    settings = { ...settings, notificationsEnabled: false }; publish();
    await new Promise(resolve => setTimeout(resolve, 60));
    const preserved = await state('start');
    assert.equal(preserved.visible, true, 'Unrelated authoritative settings updates keep the open draft');
    assert.equal(preserved.time, '22:37'); assert.equal(preserved.value, '22:37');
    assert.equal(preserved.groups.find(group => group.unit === 'minute').options.find(option => option.selected).value, 31, 'Unrelated updates do not reset unsaved minutes');
    assert.equal(preserved.groups.find(group => group.unit === 'hour').options.find(option => option.selected).value, 12);
    if (preserved.groups.some(group => group.unit === 'period')) assert.equal(preserved.groups.find(group => group.unit === 'period').options.find(option => option.selected).value, 1);
    assert.equal(scheduleWrites().length, beforeUnrelated, 'Unrelated update does not save an open draft');
    settings = { ...settings, focusBoostScheduleStart: '22:38' }; publish();
    await waitFor(`!(${visible('start')}) && document.getElementById('${id('start')}-trigger').dataset.time === '22:38'`, 'External schedule change did not close and replace the old draft');
    assert.equal((await state('start')).value, '22:38');
    await save('start', '22:37');
    console.log('Schedule time: unrelated-update draft preservation and external-value replacement passed.');

    const beforeDismissals = scheduleWrites().length;
    await open('start');
    await draft('start', '11:26');
    await render(`window.dispatchEvent(new Event('resize'))`);
    assert.equal((await state('start')).visible, true, 'A stale resize notification at the placed viewport keeps the draft open');
    await render(`document.querySelector('#${id('end')}-popover [role="listbox"]').dispatchEvent(new Event('scroll'));
      document.querySelector('.select-menu-listbox')?.dispatchEvent(new Event('scroll'));`);
    const retained = await state('start');
    assert.equal(retained.visible, true, 'Closed-picker scroll notifications do not dismiss the current draft');
    assert.equal(retained.groups.find(group => group.unit === 'minute').activeValue, '26');
    assert.equal(retained.time, '22:37', 'Ignored stale events do not commit a draft');
    await render(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.body.click()`);
    await waitFor(`!(${visible('start')})`, 'Outside pointer did not dismiss picker');
    await open('start');
    await render(`document.querySelector('[data-settings-tab="wellbeing"]').focus({ preventScroll: true })`);
    await waitFor(`!(${visible('start')})`, 'Outside focus did not dismiss picker');
    await open('start');
    await render(`document.querySelector('[data-settings-tab="wellbeing"]').click()`);
    await waitFor(`!(${visible('start')})`, 'Settings navigation did not dismiss picker');
    await showNotifications(); await open('end');
    await render(`document.querySelector('.nav-btn[data-tab="home"]').click()`);
    await waitFor(`!(${visible('end')})`, 'View navigation did not dismiss picker');
    await showNotifications(); await open('start');
    await render(`document.querySelector('.main').dispatchEvent(new Event('scroll'))`);
    await waitFor(`!(${visible('start')})`, 'Main scroll did not dismiss picker');
    await open('start');
    await render(`document.body.dispatchEvent(new Event('scroll'))`);
    await waitFor(`!(${visible('start')})`, 'Body scroll did not dismiss picker');
    await open('end'); await setWidth(1050);
    await waitFor(`!(${visible('end')})`, 'Resize did not dismiss picker');
    await setWidth(1040); await showNotifications();
    assert.equal(scheduleWrites().length, beforeDismissals, 'Dismissal/navigation does not write times');

    await open('start', true);
    await key('ArrowRight');
    assert.equal((await state('start')).focusedUnit, 'minute', 'Right arrow moves to minutes');
    const listScroll = await render(`(() => {
      const group = document.querySelector('#${id('start')}-popover [role="listbox"][data-time-unit="minute"]');
      const before = group.scrollTop; group.scrollTop += 32;
      return { before, after: group.scrollTop };
    })()`);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.notEqual(listScroll.after, listScroll.before, 'Minute column actually scrolls');
    assert.equal((await state('start')).visible, true, 'Scrolling a picker column keeps its draft open');
    await waitFor(`document.querySelector('#${id('start')}-popover [role="listbox"][data-time-unit="minute"]').classList.contains('scroll-active')`, 'Actual minute scrolling did not reveal its scrollbar');
    const scrollbarRevealed = await render(`document.querySelector('#${id('start')}-popover [role="listbox"][data-time-unit="minute"]').classList.contains('scroll-active')`);
    for (const [press, expected] of [['Home', 0], ['ArrowDown', 1], ['End', 59], ['ArrowUp', 58]]) {
      await key(press);
      const ui = await state('start');
      const group = ui.groups.find(candidate => candidate.unit === 'minute');
      assert.equal(Number(group.activeValue), expected, 'Minute active descendant after ' + press);
      assert.equal(group.options.find(option => option.selected).value, expected, 'Minute draft selection after ' + press);
    }
    await key('Enter'); await key('Space');
    assert.equal(scheduleWrites().length, beforeDismissals, 'Native Enter/Space on a list only chooses a draft');
    await key('ArrowLeft');
    assert.equal((await state('start')).focusedUnit, 'hour', 'Left arrow returns to hours');
    // List options stay out of the sequential Tab order; Tab reaches footer actions.
    for (let attempt = 0; !(await state('start')).focusedAction && attempt < 5; attempt++) await key('Tab');
    assert(['save', 'cancel'].includes((await state('start')).focusedAction), 'Tab reaches picker footer without traversing every option');
    if ((await state('start')).focusedAction === 'cancel') await key('Tab');
    assert.equal((await state('start')).focusedAction, 'save', 'Set time is reachable by native Tab');
    const beforeKeyboardSave = scheduleWrites().length;
    await key('Enter');
    await waitFor(`document.getElementById('${id('start')}-trigger').dataset.time === '22:58' && !document.getElementById('${id('start')}-trigger').disabled && !(${visible('start')})`, 'Native Enter did not save the exact-minute draft');
    assert.equal(scheduleWrites().length, beforeKeyboardSave + 1);
    assert.deepEqual(scheduleWrites()[beforeKeyboardSave].partial, { focusBoostScheduleStart: '22:58' });
    assert.equal((await state('start')).focusedId, id('start') + '-trigger', 'Native Save restores trigger focus');
    await key('Space');
    await waitFor(visible('start'), 'Native Space did not reopen the focused time trigger');
    await key('Escape');
    assert.equal((await state('start')).focusedId, id('start') + '-trigger');
    await save('start', '22:37');
    console.log('Schedule time: native keyboard lists/footer/focus, outside focus/pointer and navigation/scroll/resize dismissal passed.');

    failScheduleWrite = true;
    const beforeFailure = scheduleWrites().length;
    await open('start'); await draft('start', '10:13');
    await render(`document.querySelector('#${id('start')}-popover [data-time-action="save"]').click()`);
    await waitFor(`!document.getElementById('${id('start')}-trigger').disabled && document.querySelector('[data-schedule-input="${id('start')}"] [role="status"]')?.textContent.trim()`, 'Failed save did not return a usable control with status');
    const failed = await state('start');
    assert.equal(scheduleWrites().length, beforeFailure + 1); assert.equal(settings.focusBoostScheduleStart, '22:37');
    assert.equal(failed.value, '22:37'); assert.equal(failed.time, '22:37', 'Failed commit rolls both native and custom time back');
    assert(/could not|couldn't|try again/i.test(failed.status), 'Failed commit explains retry');
    assert.equal(failed.focusedId, id('start') + '-trigger', 'Failed save restores trigger focus');
    const retry = await open('start');
    assert.equal(retry.time, '22:37'); assert.equal(retry.value, '22:37');
    assert.equal(retry.groups.find(group => group.unit === 'minute').options.find(option => option.selected).value, 13, 'Retry reopens the attempted minute draft');
    assert.equal(retry.groups.find(group => group.unit === 'hour').options.find(option => option.selected).value, 10, 'Retry reopens the attempted hour draft');
    await render(`document.querySelector('#${id('start')}-popover [data-time-action="save"]').click()`);
    await waitFor(`document.getElementById('${id('start')}-trigger').dataset.time === '10:13' && !document.getElementById('${id('start')}-trigger').disabled && !(${visible('start')})`, 'Reopened attempted draft did not save on retry');
    assert.equal(scheduleWrites().length, beforeFailure + 2, 'Retry commits the preserved attempted draft exactly once without reselection');
    assert.equal(settings.focusBoostScheduleStart, '10:13');

    let releaseHeld;
    heldWrite = new Promise(resolve => { releaseHeld = resolve; });
    const beforeBusy = scheduleWrites().length;
    await open('end'); await draft('end', '12:29');
    await render(`document.querySelector('#${id('end')}-popover [data-time-action="save"]').click()`);
    for (let attempt = 0; scheduleWrites().length === beforeBusy && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(scheduleWrites().length, beforeBusy + 1, 'Committed time reaches held synthetic backend');
    assert.equal((await state('end')).triggerDisabled, true, 'Pending time disables its trigger');
    assert.equal((await state('start')).triggerDisabled, true, 'Pending time disables the other trigger too');
    await render(`document.querySelector('#${id('end')}-popover [data-time-action="save"]').click();
      document.getElementById('${id('end')}-trigger').click(); document.getElementById('${id('start')}-trigger').click();`);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(scheduleWrites().length, beforeBusy + 1, 'Repeated Save/trigger clicks cannot duplicate pending time writes');
    assert.equal(settings.focusBoostScheduleEnd, '05:04', 'Pending backend retains persisted time until success');
    heldWrite = null; releaseHeld();
    await waitFor(`document.getElementById('${id('end')}-trigger').dataset.time === '12:29' && !document.getElementById('${id('end')}-trigger').disabled`, 'Held schedule save did not settle');
    assert.equal((await state('end')).focusedId, id('end') + '-trigger', 'Successful pending save restores focus');
    console.log('Schedule time: failed-write rollback/retry and pending-write duplicate guard passed.');

    settings = { ...settings, focusBoostScheduleStart: '00:01', focusBoostScheduleEnd: '21:56' };
    publish();
    await waitFor(`document.getElementById('${id('start')}-trigger').dataset.time === '00:01' && document.getElementById('${id('end')}-trigger').dataset.time === '21:56'`, 'Synthetic reloaded settings did not synchronize custom times');
    await assertDisplay('start', '00:01'); await assertDisplay('end', '21:56');
    await open('end'); await draft('end', '02:11');
    settings = { ...settings, focusBoostScheduleEnabled: false }; publish();
    await waitFor(`document.getElementById('${id('start')}-trigger').disabled && document.getElementById('${id('end')}-trigger').disabled`, 'Disabled schedule did not disable both custom controls');
    assert.equal((await state('end')).visible, false, 'External schedule disable closes the open unsaved draft');
    const beforeDisabled = scheduleWrites().length;
    for (const which of ['start', 'end']) {
      assert.equal((await state(which)).nativeDisabled, true, 'Native fallback shares disabled schedule state');
      await render(`document.getElementById('${id(which)}-trigger').click(); document.querySelector('#${id(which)}-popover [data-time-action="save"]').click()`);
      assert.equal((await state(which)).visible, false, 'Disabled schedule never opens a picker');
    }
    assert.equal(scheduleWrites().length, beforeDisabled, 'Disabled schedule cannot write through closed controls');
    settings = { ...settings, focusBoostScheduleEnabled: true }; publish();
    await waitFor(`!document.getElementById('${id('start')}-trigger').disabled`, 'Re-enabled schedule did not restore picker');
    console.log('Schedule time: synthetic reload sync and schedule-off input/picker/write guards passed.');

    // Simulate the progressive-enhancement module being unavailable in its own
    // hidden in-memory session. No production files are renamed or overwritten.
    const fallback = new BrowserWindow({ show: false, width: 1040, height: 760,
      webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
        partition: 'schedule-time-fallback-' + Date.now() } });
    let blockedModule = 0;
    fallback.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const blocked = details.url.replace(/\\/g, '/').endsWith('/schedule-time-ui.js');
      if (blocked) blockedModule++;
      callback({ cancel: blocked });
    });
    try {
      const beforeFallback = scheduleWrites().length;
      await fallback.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
      const fallbackResult = await fallback.webContents.executeJavaScript(`(async () => {
        for (let attempt = 0; !liveDayDate && attempt < 150; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
        if (!liveDayDate) throw new Error('Fallback renderer did not boot');
        document.querySelector('.nav-btn[data-tab="settings"]').click();
        document.querySelector('[data-settings-tab="notifications"]').click();
        return { moduleAbsent: typeof window.sydtrackScheduleTimeUI === 'undefined',
          nativeUsable: ['start', 'end'].every(which => {
            const input = document.getElementById('fb-schedule-' + which);
            const trigger = document.getElementById(input.id + '-trigger');
            return input.type === 'time' && !input.hidden && !input.disabled && input.getBoundingClientRect().width > 0 && trigger.hidden;
          }), values: ['start', 'end'].map(which => document.getElementById('fb-schedule-' + which).value) };
      })()`);
      assert.equal(blockedModule, 1, 'Fallback actually blocks only the new picker module');
      assert.deepEqual(fallbackResult, { moduleAbsent: true, nativeUsable: true, values: ['00:01', '21:56'] }, 'Missing custom module preserves usable exact-minute native inputs');
      assert.equal(scheduleWrites().length, beforeFallback, 'Fallback renderer boot does not rewrite schedule values');
      console.log('Schedule time: missing-module native input fallback passed.');
    } finally {
      fallback.webContents.session.webRequest.onBeforeRequest(null);
      fallback.destroy();
    }

    const layouts = [];
    for (const width of [900, 1040, 1600]) {
      await setWidth(width);
      for (const theme of THEME_IDS) {
        await render(`applyTheme(${JSON.stringify(theme)}); document.getElementById('fb-schedule-times').scrollIntoView({ block: 'center' })`);
        await new Promise(resolve => setTimeout(resolve, 60));
        await open('end');
        const geometry = await pickerGeometry('end');
        assert.deepEqual(geometry, { contained: true, overflow: false, listsVisible: true, footerVisible: true }, 'Exact-minute picker stays visible and scrolls its selections into view: ' + width + '/' + theme);
        await key('Escape');
        layouts.push({ width, theme });
      }
      console.log('Schedule time layouts passed at width:', width);
    }
    win.setSize(900, 600);
    const [shortWidth, shortHeight] = win.getContentSize();
    await waitFor(`Math.abs(innerWidth - ${shortWidth}) <= 2 && Math.abs(innerHeight - ${shortHeight}) <= 2`, 'Hidden renderer did not reach short-window dimensions');
    for (const theme of ['midnight', 'graphite']) {
      await render(`applyTheme(${JSON.stringify(theme)}); document.getElementById('fb-schedule-times').scrollIntoView({ block: 'center' })`);
      await new Promise(resolve => setTimeout(resolve, 60));
      await open('end');
      assert.deepEqual(await pickerGeometry('end'), { contained: true, overflow: false, listsVisible: true, footerVisible: true }, 'Short-height picker containment: 900x600/' + theme);
      await key('Escape');
    }
    console.log('Schedule time: short-height dark/light picker containment passed.');
    await setWidth(1040);
    await render(`applyTheme('midnight'); document.getElementById('fb-schedule-times').scrollIntoView({ block: 'center' });
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await open('end');
    await render('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal((await state('end')).visible, true, 'Picker screenshot is open');
    fs.writeFileSync(path.join(temporary, 'schedule-time-picker.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await key('Escape');
    await render(`document.getElementById('${id('end')}-trigger').blur(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    assert.equal((await state('end')).visible, false, 'Closed screenshot has no picker');
    fs.writeFileSync(path.join(temporary, 'schedule-time-controls.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    assert.equal(await render('window.__scheduleTestConfirmations'), 0, 'Time edits never ask for confirmation');

    // Reload the actual renderer with Chromium's locale override so production
    // Intl formatting and hour-list construction are exercised in 24-hour mode.
    await win.webContents.debugger.sendCommand('Emulation.setLocaleOverride', { locale: 'en-GB' });
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
    await waitFor(`liveDayDate === ${JSON.stringify(date)} && typeof window.sydtrackScheduleTimeUI?.sync === 'function'`, '24-hour locale renderer did not boot');
    await showNotifications();
    const twentyFour = await open('start', true);
    assert.equal(twentyFour.groups.some(group => group.unit === 'period'), false, '24-hour locale omits AM/PM list');
    assert.deepEqual(twentyFour.groups.find(group => group.unit === 'hour').options.map(option => option.value), Array.from({ length: 24 }, (_, index) => index), '24-hour locale offers every hour 00–23');
    await key('End');
    assert.equal(Number((await state('start')).groups.find(group => group.unit === 'hour').activeValue), 23, 'Native keyboard reaches 23 in 24-hour locale');
    await key('Escape');
    await save('start', '18:42'); await save('end', '02:09');
    await assertDisplay('start', '18:42'); await assertDisplay('end', '02:09');
    console.log('Schedule time: real renderer 24-hour locale lists, native keyboard and exact-minute saves passed.');

    assert.equal(scrollbarRevealed, true, 'Scrolling briefly reveals the minute list scrollbar');
    const unexpectedErrors = rendererErrors.filter(message => !message.includes('Synthetic schedule write failed'));
    assert.equal(unexpectedErrors.length, 0, 'No unexpected renderer errors: ' + unexpectedErrors.join('\n'));
    console.log('Schedule time layouts:', JSON.stringify(layouts));
    console.log('Schedule time picker screenshot:', path.join(temporary, 'schedule-time-picker.png'));
    console.log('Schedule time controls screenshot:', path.join(temporary, 'schedule-time-controls.png'));
    console.log('Schedule time checks passed. All diagnostic state stayed in:', temporary);
    app.quit();
  } finally {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
    if (!win.isDestroyed()) {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
      win.destroy();
    }
  }
}).catch(error => { console.error(error); app.exit(1); });

setTimeout(() => { console.error('Schedule time checks timed out'); app.exit(1); }, 75000).unref();
