'use strict';

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
  const timeout = setTimeout(() => { console.error('Select menu checks timed out'); child.kill(); }, 60000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('exit', code => { clearTimeout(timeout); process.exitCode = code == null ? 1 : code; });
  return;
}

// Real sandboxed preload, hidden renderer, and synthetic settings IPC only.
// No production main process, tracker, startup changes, personal data, or network.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { THEME_IDS } = require('../src/theme');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-select-menu-'));
const userData = path.join(temporary, 'user-data');
fs.mkdirSync(userData);
app.setPath('appData', temporary); app.setPath('userData', userData); app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const date = require('../src/store').todayKey();
  let settings = { onboardingComplete: true, trackingPaused: true, trackingPauseUntil: 0,
    launchAtStartup: false, updateChecksEnabled: false, notificationsEnabled: false, theme: 'midnight',
    pollMs: 3000, profileShortcut: '', windowShortcut: '', themeRotationEnabled: false, themeRotationMode: 'dark',
    themeRotationAnchorDate: '', themeRotationAnchorTheme: '', thresholdSec: 600, focusBoost: false, focusBoostScheduleEnabled: false,
    focusBoostScheduleStart: '09:07', focusBoostScheduleEnd: '23:59', focusShareGoalPct: 80, focusShareIncludeOther: false };
  const stats = () => ({ date, settings: { ...settings }, byCategory: { productive: 0, unproductive: 0, other: 0 },
    byHour: Array.from({ length: 24 }, () => ({ productive: 0, unproductive: 0, other: 0 })), topApps: [], appBreakdown: [], activityRows: [] });
  const profile = { id: 'default', name: 'Synthetic profile', productive: [], unproductive: [], other: [], ignore: [] };
  const writes = [];
  let win, failNext = false, heldWrite = null;
  const selectKeys = ['pollMs', 'profileShortcut', 'windowShortcut', 'themeRotationMode'];
  const appearanceKeys = ['theme', 'themeRotationEnabled', 'themeRotationMode'];
  const selectWrites = () => writes.filter(partial => selectKeys.some(key => Object.hasOwn(partial, key)));
  const appearanceWrites = () => writes.filter(partial => appearanceKeys.some(key => Object.hasOwn(partial, key)));
  const publish = () => win.webContents.send('tracker:update', { stats: stats(), now: null, lastFocused: null, session: null });
  const handlers = {
    'state:get': () => ({ stats: stats(), now: null, lastFocused: null, session: null, platform: process.platform }),
    'profiles:get': () => ({ schemaVersion: 1, activeId: 'default', profiles: [profile] }),
    'rules:get': () => ({ ...profile, profileId: 'default' }), 'ignore:get': () => ({ ignore: [], profileId: 'default' }),
    'keywords:get': () => ({ productive: [], unproductive: [] }),
    'updates:get': () => ({ currentVersion: require('../package.json').version, available: false, phase: 'idle' }),
    'session:getActive': () => null, 'session:getForDay': (_event, day) => ({ date: day || date, sessions: [], recentDays: [], historyEnabled: true }),
    'history:summary': () => [], 'history:timelineDay': () => ({ ...stats(), timeline: [] }),
    'settings:update': async (_event, partial) => {
      assert(partial && typeof partial === 'object'); writes.push(partial);
      const relevant = [...selectKeys, ...appearanceKeys].some(key => Object.hasOwn(partial, key));
      if (relevant && failNext) { failNext = false; throw new Error('Synthetic select save failed'); }
      if (relevant && heldWrite) await heldWrite;
      // Model main's atomic appearance patch with the real pure helper; never
      // start the production services, midnight timer, or OS shortcut registry.
      let changes = { ...partial };
      if (Object.hasOwn(changes, 'theme')) changes.themeRotationEnabled = false;
      const merged = { ...settings, ...changes };
      if (merged.themeRotationEnabled === true && (settings.themeRotationEnabled !== true || merged.themeRotationMode !== settings.themeRotationMode)) {
        changes = { ...changes, ...require('../src/theme-rotation').initializeThemeRotation(merged, date) };
      }
      settings = { ...settings, ...changes }; publish(); return { ...settings };
    }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  win = new BrowserWindow({ show: false, width: 1040, height: 760,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2 && !message.includes('Electron Security Warning') && !message.includes('ERR_BLOCKED_BY_CLIENT')) errors.push(message);
  });
  const render = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, message) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await render(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(message);
  };
  const trigger = id => id + '-select-trigger', listbox = id => id + '-select-listbox';
  async function state(id = 'poll-mode') {
    return render(`(() => {
      const input = document.getElementById(${JSON.stringify(id)}), trigger = document.getElementById(${JSON.stringify(trigger(id))});
      const list = document.getElementById(${JSON.stringify(listbox(id))});
      return { value: input.value, confirmed: trigger.dataset.selectValue, hidden: input.hidden,
        disabled: trigger.disabled, expanded: trigger.getAttribute('aria-expanded'), visible: !list.hidden,
        active: document.getElementById(list.getAttribute('aria-activedescendant'))?.dataset.selectValue,
        focus: document.activeElement.id, text: trigger.querySelector('.select-menu-value').textContent,
        status: trigger.closest('.select-menu-control').querySelector('[role="status"]').textContent,
        options: [...list.querySelectorAll('[role="option"]')].map(button => ({ value: button.dataset.selectValue,
          selected: button.getAttribute('aria-selected') === 'true', disabled: button.disabled })) };
    })()`);
  }
  async function key(name, shift = false) {
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const code = { Enter: 13, Space: 32, Escape: 27, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, Tab: 9 }[name];
    assert(code, 'Supported trusted test key');
    const input = { key: name === 'Space' ? ' ' : name, code: name, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 };
    if (name === 'Enter' || name === 'Space') input.text = input.unmodifiedText = name === 'Space' ? ' ' : '\r';
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...input });
    delete input.text; delete input.unmodifiedText;
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...input });
  }
  async function show() {
    await render(`document.querySelector('.nav-btn[data-tab="settings"]').click(); document.querySelector('[data-settings-tab="tracking"]').click();
      document.getElementById('poll-mode-select-trigger').scrollIntoView({ block: 'center' })`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  async function open(id = 'poll-mode', native) {
    await render(`document.getElementById(${JSON.stringify(trigger(id))}).focus({ preventScroll: true })`);
    if (native) await key(native);
    else await render(`document.getElementById(${JSON.stringify(trigger(id))}).click()`);
    await wait(`!document.getElementById(${JSON.stringify(listbox(id))}).hidden`, 'Select list did not open: ' + id);
  }
  async function choose(id, value) {
    await open(id);
    await render(`(() => {
      const option = [...document.querySelectorAll('#${listbox(id)} [data-select-value]')].find(option => option.dataset.selectValue === ${JSON.stringify(value)});
      if (!option) throw Error('Exact string option missing'); option.click();
    })()`);
  }
  async function settled(id, value) {
    await wait(`document.getElementById(${JSON.stringify(trigger(id))}).dataset.selectValue === ${JSON.stringify(value)} &&
      !document.getElementById(${JSON.stringify(trigger(id))}).disabled`, 'Select save did not settle');
  }
  async function toggleRotationWithSpace() {
    await render(`document.getElementById('theme-rotation-toggle').scrollIntoView({block:'center'});
      document.getElementById('theme-rotation-toggle').focus({preventScroll:true})`);
    await key('Space');
  }
  async function dimensions(width, height) {
    win.setSize(width, height);
    const [w, h] = win.getContentSize();
    await wait(`Math.abs(innerWidth - ${w}) <= 2 && Math.abs(innerHeight - ${h}) <= 2`, 'Hidden viewport did not resize');
    await new Promise(resolve => setTimeout(resolve, 45));
  }
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await wait(`typeof window.sydtrackSelectMenuUI?.create === 'function' && document.getElementById('poll-mode-select-trigger')`, 'Select bridge did not initialize');
    await show();
    assert.equal(await render(`(() => {
      return [...document.querySelectorAll('#view-settings select')].every(input => {
        const trigger = document.getElementById(input.id + '-select-trigger'), list = document.getElementById(input.id + '-select-listbox');
        return input.hidden && input.getClientRects().length === 0 && trigger.tagName === 'BUTTON' && trigger.type === 'button' &&
          trigger.getAttribute('aria-haspopup') === 'listbox' && trigger.getAttribute('aria-controls') === list.id &&
          trigger.getAttribute('aria-label').length > 5 && list.getAttribute('role') === 'listbox' &&
          [...list.children].every(option => option.tagName === 'BUTTON' && option.type === 'button' && option.tabIndex === -1);
      });
    })()`), true, 'Native backing, accessible names and listbox/option semantics');
    const beforeKeyboard = selectWrites().length;
    await open('poll-mode', 'Enter');
    assert.equal((await state()).active, '3000');
    await key('End'); assert.equal((await state()).active, '1000');
    await key('Home'); assert.equal((await state()).active, '5000');
    await key('ArrowUp'); assert.equal((await state()).active, '1000');
    await key('ArrowDown'); assert.equal((await state()).active, '5000');
    assert.equal(selectWrites().length, beforeKeyboard, 'Keyboard navigation does not save a draft');
    await key('Escape'); assert.equal((await state()).focus, trigger('poll-mode')); assert.equal((await state()).visible, false);
    await open('poll-mode', 'Space'); await key('Home'); await key('Space'); await settled('poll-mode', '5000');
    assert.deepEqual(selectWrites()[beforeKeyboard], { pollMs: 5000 });
    assert.equal(selectWrites().length, beforeKeyboard + 1, 'One trusted commit makes one existing IPC write');
    await choose('profile-shortcut', 'Alt+B'); await settled('profile-shortcut', 'Alt+B');
    assert.equal(settings.profileShortcut, 'Alt+B', 'Shortcut value remains an exact string');
    await choose('window-shortcut', 'CommandOrControl+Shift+S'); await settled('window-shortcut', 'CommandOrControl+Shift+S');
    assert.equal(settings.windowShortcut, 'CommandOrControl+Shift+S', 'Show/hide shortcut roundtrips without rewriting its accelerator');

    const beforeFailure = selectWrites().length;
    failNext = true; await choose('poll-mode', '3000');
    await wait(`document.getElementById('poll-mode-select-status').textContent.includes('Could not save') && !document.getElementById('poll-mode-select-trigger').disabled`, 'Failed write did not report/settle');
    const failed = await state(); assert.equal(failed.value, '5000'); assert.equal(failed.confirmed, '5000'); assert.equal(settings.pollMs, 5000);
    await open(); assert.equal((await state()).active, '3000', 'Retry reopens the attempted option without reselecting');
    await key('Enter'); await settled('poll-mode', '3000');
    assert.equal(selectWrites().length, beforeFailure + 2, 'Failure and one retry make exactly two writes');
    assert.equal((await state()).status, '');

    let releaseHeld;
    heldWrite = new Promise(resolve => { releaseHeld = resolve; });
    const beforeHeld = selectWrites().length;
    await choose('poll-mode', '1000');
    await wait(`document.getElementById('poll-mode-select-trigger').disabled && document.getElementById('profile-shortcut-select-trigger').disabled`, 'Shared pending guard did not disable both controls');
    assert.equal(await render(`(() => {
      const root = document.createElement('div'), input = document.createElement('select');
      for (const value of ['one', 'two']) { const option = document.createElement('option'); option.value = value; option.textContent = value; input.append(option); }
      input.id = 'second-instance-select'; root.append(input); document.body.append(root);
      const instance = window.sydtrackSelectMenuUI.create({root, onCommit: async () => { throw Error('Pending cross-instance write must never run'); }});
      const guarded = root.querySelector('.select-menu-trigger').disabled; instance.dispose(); root.remove(); return guarded;
    })()`), true, 'Pending guard is shared across separate reusable instances');
    await render(`document.getElementById('profile-shortcut-select-trigger').click();
      document.querySelector('#poll-mode-select-listbox [data-select-value="1000"]').click();
      document.querySelector('#profile-shortcut-select-listbox [data-select-value="CommandOrControl+Alt+B"]').click()`);
    assert.equal(selectWrites().length, beforeHeld + 1, 'Rapid and cross-control clicks cannot race the pending save');
    heldWrite = null; releaseHeld(); await settled('poll-mode', '1000');
    assert.equal((await state()).focus, trigger('poll-mode'), 'Settled save restores keyboard focus');

    await open(); await key('Home');
    settings = { ...settings, thresholdSec: 777 }; publish();
    await wait('latestGoalSettings.thresholdSec === 777', 'Unrelated settings sync did not arrive');
    assert.equal((await state()).visible, true); assert.equal((await state()).active, '5000', 'Unrelated sync preserves the open draft');
    settings = { ...settings, pollMs: 3000 }; publish();
    await settled('poll-mode', '3000'); assert.equal((await state()).visible, false, 'Actual external value change closes/reset the list');
    await open();
    await render(`document.getElementById('poll-mode').value = '5000'; document.getElementById('poll-mode').disabled = true;
      window.sydtrackSelectMenuUI.create({root: document.getElementById('view-settings')}).refresh()`);
    assert.equal((await state()).visible, false); assert.equal((await state()).disabled, true);
    assert.equal((await state()).confirmed, '3000', 'Busy refresh never confirms an optimistic backing value');
    await render(`document.getElementById('poll-mode').value = '3000'; document.getElementById('poll-mode').disabled = false;
      window.sydtrackSelectMenuUI.create({root: document.getElementById('view-settings')}).sync()`);
    await open(); await key('Tab'); assert.equal((await state()).visible, false); assert.notEqual((await state()).focus, listbox('poll-mode'));
    await open(); await render(`document.querySelector('[data-settings-tab="wellbeing"]').click()`); assert.equal((await state()).visible, false);
    await show(); await open(); await render(`document.querySelector('.nav-btn[data-tab="home"]').click()`); assert.equal((await state()).visible, false);
    await show(); await open(); await render(`document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))`); assert.equal((await state()).visible, false);
    await open();
    await render(`document.getElementById('profile-shortcut-select-listbox').dispatchEvent(new Event('scroll'));
      document.getElementById('fb-schedule-end-popover').dispatchEvent(new Event('scroll'))`);
    assert.equal((await state()).visible, true, 'Queued scroll from another closed select/schedule list cannot dismiss the current menu');
    await render(`window.dispatchEvent(new Event('resize'))`);
    assert.equal((await state()).visible, true, 'Delayed same-size resize notification cannot dismiss an already positioned menu');
    await render(`document.querySelector('.main').dispatchEvent(new Event('scroll'))`); assert.equal((await state()).visible, false);
    await open(); await dimensions(800, 600); assert.equal((await state()).visible, false, 'A real viewport change still dismisses the menu');
    await show(); await open(); await render(`window.dispatchEvent(new Event('scroll'))`); assert.equal((await state()).visible, false);

    assert.equal(settings.themeRotationEnabled, false, 'Daily rotation defaults off');
    assert.equal(await render(`(() => {
      const toggle = document.getElementById('theme-rotation-toggle'), label = toggle.closest('.appearance-rotation-switch');
      return toggle.tagName === 'INPUT' && toggle.type === 'checkbox' && toggle.getAttribute('role') === 'switch' &&
        !toggle.checked && !toggle.hasAttribute('aria-pressed') && label?.tagName === 'LABEL' && label.textContent.trim() === 'Rotate daily' &&
        document.getElementById('theme-rotation-options').classList.contains('hidden') &&
        [...document.getElementById('theme-rotation-mode').options].map(option => option.textContent).join('|') === 'Dark themes|Light themes|Any theme';
    })()`), true, 'Compact labelled native switch and clear theme pool choices');
    const beforeSwitchKeyboard = appearanceWrites().length;
    failNext = true; await toggleRotationWithSpace();
    await wait(`!appearanceSaving && document.getElementById('appearance-status').textContent.includes('Could not save')`, 'Failed rotation toggle did not report/settle');
    assert.equal(settings.themeRotationEnabled, false);
    assert.equal(await render(`document.getElementById('theme-rotation-options').classList.contains('hidden') && !document.getElementById('theme-rotation-toggle').checked && !document.getElementById('theme-rotation-toggle').disabled`), true, 'Failed Space enabling restores unchecked switch and hidden preferences');
    assert.equal(appearanceWrites().length, beforeSwitchKeyboard + 1, 'Native Space makes one attempted write');
    await toggleRotationWithSpace();
    await wait(`!appearanceSaving && latestGoalSettings.themeRotationEnabled === true && !document.getElementById('theme-rotation-options').classList.contains('hidden')`, 'Daily rotation did not enable/reveal preferences');
    assert.equal(await render(`document.getElementById('theme-rotation-toggle').checked`), true, 'Trusted Space retry checks the native switch');
    assert.equal(appearanceWrites().length, beforeSwitchKeyboard + 2, 'One Space retry makes one existing settings write');
    assert.equal((await state('theme-rotation-mode')).confirmed, 'dark'); assert.equal(settings.themeRotationMode, 'dark');
    failNext = true; await toggleRotationWithSpace();
    await wait(`!appearanceSaving && document.getElementById('appearance-status').textContent.includes('Could not save')`, 'Failed Space disabling did not report/settle');
    assert.equal(settings.themeRotationEnabled, true);
    assert.equal(await render(`document.getElementById('theme-rotation-toggle').checked && !document.getElementById('theme-rotation-options').classList.contains('hidden')`), true, 'Failed disabling restores checked switch and enabled preferences');
    await choose('theme-rotation-mode', 'light'); await settled('theme-rotation-mode', 'light');
    assert.equal(settings.themeRotationEnabled, true); assert.equal(settings.themeRotationMode, 'light');
    assert(require('../src/theme-rotation').poolForMode('light').includes(settings.theme), 'Light pool initializes an appropriate confirmed theme');
    await choose('theme-rotation-mode', 'any'); await settled('theme-rotation-mode', 'any');
    assert.equal(settings.themeRotationMode, 'any');
    let beforeAppearanceHeld = appearanceWrites().length;
    heldWrite = new Promise(resolve => { releaseHeld = resolve; });
    await render(`document.querySelector('[data-theme-id="forest"]').click()`);
    await wait(`appearanceSaving && document.getElementById('theme-rotation-mode-select-trigger').disabled`, 'Manual chip pending save did not disable the rotation trigger');
    await render(`document.getElementById('theme-rotation-mode-select-trigger').click(); document.getElementById('theme-rotation-toggle').click()`);
    assert.equal((await state('theme-rotation-mode')).visible, false);
    assert.equal(appearanceWrites().length, beforeAppearanceHeld + 1, 'Held manual theme change cannot start a rotation save');
    heldWrite = null; releaseHeld();
    await wait(`!appearanceSaving && latestGoalSettings.theme === 'forest' && latestGoalSettings.themeRotationEnabled === false`, 'Manual theme choice did not disable rotation');
    assert.equal(await render(`document.documentElement.dataset.theme === 'forest' && document.getElementById('theme-rotation-options').classList.contains('hidden')`), true);
    failNext = true; await render(`document.querySelector('[data-theme-id="graphite"]').click()`);
    await wait(`!appearanceSaving && document.getElementById('appearance-status').textContent.includes('Could not save')`, 'Failed appearance save did not report/settle');
    assert.equal(settings.theme, 'forest'); assert.equal(settings.themeRotationEnabled, false);
    assert.equal(await render(`document.documentElement.dataset.theme === 'forest' && !document.getElementById('theme-rotation-toggle').checked`), true, 'Failed theme save restores confirmed theme and unchecked rotation switch');
    await render(`document.getElementById('theme-rotation-toggle').click()`);
    await wait('!appearanceSaving && latestGoalSettings.themeRotationEnabled === true', 'Rotation retry did not enable');
    beforeAppearanceHeld = appearanceWrites().length;
    heldWrite = new Promise(resolve => { releaseHeld = resolve; });
    await render(`document.getElementById('theme-rotation-toggle').click()`);
    await wait(`appearanceSaving && document.getElementById('theme-rotation-mode-select-trigger').disabled`, 'Disabling toggle pending save did not disable the rotation trigger');
    await render(`document.getElementById('theme-rotation-mode-select-trigger').click(); document.querySelector('[data-theme-id="graphite"]').click()`);
    assert.equal((await state('theme-rotation-mode')).visible, false);
    assert.equal(appearanceWrites().length, beforeAppearanceHeld + 1, 'Held rotation toggle cannot start another mode or manual-theme save');
    heldWrite = null; releaseHeld();
    await wait('!appearanceSaving && latestGoalSettings.themeRotationEnabled === false', 'Held rotation disabling did not settle');
    await render(`document.getElementById('theme-rotation-toggle').click()`);
    await wait('!appearanceSaving && latestGoalSettings.themeRotationEnabled === true', 'Rotation did not reenable after held toggle');
    await choose('theme-rotation-mode', 'dark'); await settled('theme-rotation-mode', 'dark');
    failNext = true; await choose('theme-rotation-mode', 'light');
    await wait(`!appearanceSaving && document.getElementById('theme-rotation-mode-select-status').textContent.includes('Could not save') && !document.getElementById('theme-rotation-mode-select-trigger').disabled`, 'Failed rotation option did not rollback/settle');
    assert.equal(settings.theme, 'forest'); assert.equal(settings.themeRotationMode, 'dark');
    assert.equal((await state('theme-rotation-mode')).value, 'dark');
    await open('theme-rotation-mode'); assert.equal((await state('theme-rotation-mode')).active, 'light'); await key('Escape');
    const beforeRotationHeld = appearanceWrites().length;
    heldWrite = new Promise(resolve => { releaseHeld = resolve; });
    await choose('theme-rotation-mode', 'any');
    await wait(`appearanceSaving && document.getElementById('theme-rotation-toggle').disabled && [...document.querySelectorAll('.select-menu-trigger')].every(button => button.disabled)`, 'Held rotation save did not guard all custom selects/toggle');
    await render(`document.getElementById('theme-rotation-toggle').click(); document.querySelector('[data-theme-id="graphite"]').click();
      document.querySelector('#theme-rotation-mode-select-listbox [data-select-value="light"]').click()`);
    assert.equal(appearanceWrites().length, beforeRotationHeld + 1, 'Rapid rotation/options/manual-theme clicks make no duplicate writes');
    heldWrite = null; releaseHeld(); await settled('theme-rotation-mode', 'any');
    assert.equal(settings.themeRotationEnabled, true); assert.equal(settings.theme, 'forest');
    assert.equal(await render(`(() => {
      const credit = document.querySelector('#settings-panel-tracking > .font-credit');
      return !document.getElementById('settings-appearance-card').querySelector('.font-credit') &&
        credit?.textContent.includes('Satoshi') && credit.previousElementSibling?.id === 'settings-data-card';
    })()`), true, 'Typeface attribution is preserved after Data without Appearance clutter');

    assert.equal(await render(`(async () => {
      const root = document.createElement('div'); document.getElementById('view-settings').append(root);
      const input = document.createElement('select'); input.id = 'synthetic-select'; input.setAttribute('aria-label', 'Synthetic safe strings');
      for (const value of ['', '<img src=x onerror=alert(1)>', 'disabled']) {
        const option = document.createElement('option'); option.value = value; option.textContent = value || 'Off'; option.disabled = value === 'disabled'; input.append(option);
      }
      root.append(input);
      const instance = window.sydtrackSelectMenuUI.create({ root, onCommit: async () => {} });
      const duplicate = window.sydtrackSelectMenuUI.create({ root });
      const list = root.querySelector('.select-menu-listbox');
      const safe = instance === duplicate && !root.querySelector('img') && list.children[1].dataset.selectValue === '<img src=x onerror=alert(1)>' && list.children[1].textContent === '<img src=x onerror=alert(1)>' && list.children[2].disabled;
      instance.dispose(); const restored = !input.hidden && !root.querySelector('.select-menu-trigger'); root.remove();
      return safe && restored;
    })()`), true, 'Reusable/idempotent instance preserves strings safely and dispose restores native fallback');

    let layouts = 0;
    for (const width of [800, 1040, 1600]) for (const height of [600, 760]) {
      await dimensions(width, height); await show();
      for (const theme of THEME_IDS) {
        await render(`applySettingsInputs({...latestGoalSettings, theme: ${JSON.stringify(theme)}, themeRotationEnabled:true, themeRotationMode:'any'})`);
        for (const id of ['poll-mode', 'profile-shortcut', 'window-shortcut', 'theme-rotation-mode']) {
          await render(`document.getElementById(${JSON.stringify(trigger(id))}).scrollIntoView({block:'center'})`);
          await new Promise(resolve => setTimeout(resolve, 20)); await open(id);
          const geometry = await render(`(() => {
            const trigger = document.getElementById(${JSON.stringify(trigger(id))}), list = document.getElementById(${JSON.stringify(listbox(id))});
            const rect = list.getBoundingClientRect(), inside = rect => rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
            const sample = document.createElement('span'); document.body.append(sample);
            const color = token => { sample.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue(token); return getComputedStyle(sample).backgroundColor; };
            const themed = getComputedStyle(trigger).backgroundColor === color('--color-surface-sunken') && getComputedStyle(list).backgroundColor === color('--color-surface'); sample.remove();
            const t = trigger.getBoundingClientRect();
            return { contained: inside(rect) && inside(t), themed, overflow: list.scrollWidth > list.clientWidth + 1,
              details: { hidden: list.hidden, viewport: [innerWidth,innerHeight], list: [rect.left,rect.top,rect.width,rect.height], trigger: [t.left,t.top,t.width,t.height] } };
          })()`);
          assert.equal(geometry.contained, true, `${width}×${height}/${theme}/${id}: dropdown contained ${JSON.stringify(geometry.details)}`);
          assert.equal(geometry.themed, true); assert.equal(geometry.overflow, false); await key('Escape');
        }
        const rotationGeometry = await render(`(() => {
          const card = document.getElementById('settings-appearance-card'), header = card.querySelector('.appearance-head');
          const chips = card.querySelector('.theme-swatches'), footer = card.querySelector('.appearance-rotation');
          const toggle = document.getElementById('theme-rotation-toggle'), label = card.querySelector('.appearance-rotation-switch');
          const preferences = document.getElementById('theme-rotation-options');
          const head = header.getBoundingClientRect(), row = footer.getBoundingClientRect(), swatches = chips.getBoundingClientRect();
          const a = label.getBoundingClientRect(), b = preferences.getBoundingClientRect(), control = toggle.getBoundingClientRect();
          const gap = b.left - a.right, centerDifference = Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2);
          const overlap = Math.min(a.right,b.right) > Math.max(a.left,b.left) + 1 && Math.min(a.bottom,b.bottom) > Math.max(a.top,b.top) + 1;
          return { cohesive: header.children.length === 1 && header.firstElementChild.tagName === 'H3' && !header.contains(toggle) &&
            footer.contains(label) && label.contains(toggle) && footer.contains(preferences) && !preferences.classList.contains('hidden') && head.width > 0 &&
            swatches.top >= head.bottom + 12 && row.top >= swatches.bottom + 12 &&
            Math.abs(a.left - row.left) <= 1 && gap >= 6 && gap <= 20 && centerDifference <= 2 &&
            a.height <= 44 && row.height <= 44 && control.width > 0 && control.width <= 48 && control.height <= 28 &&
            b.right - a.left <= 360 && a.top >= row.top - 1 && b.right <= row.right + 1 && b.bottom <= row.bottom + 1 &&
            !overlap && card.scrollWidth <= card.clientWidth + 1,
            details: { gap, centerDifference, groupWidth: b.right - a.left, rowHeight: row.height, switch: [control.width,control.height] } };
        })()`);
        assert.equal(rotationGeometry.cohesive, true, `${width}×${height}/${theme}: compact adjacent rotation controls ${JSON.stringify(rotationGeometry.details)}`);
        await render(`applySettingsInputs({...latestGoalSettings, themeRotationEnabled:false})`);
        assert.equal(await render(`(() => {
          const toggle = document.getElementById('theme-rotation-toggle'), preferences = document.getElementById('theme-rotation-options');
          const row = document.querySelector('.appearance-rotation');
          return !toggle.checked && preferences.classList.contains('hidden') && preferences.getClientRects().length === 0 &&
            row.getBoundingClientRect().height <= 44 && row.scrollWidth <= row.clientWidth + 1;
        })()`), true, `${width}×${height}/${theme}: rotation off keeps a compact switch with no detached preference control`);
        layouts++;
      }
    }
    await dimensions(1040, 760); await show();
    await render(`applySettingsInputs({...latestGoalSettings, theme:'forest'}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await open('profile-shortcut');
    await render('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal((await state('profile-shortcut')).visible, true, 'Open menu screenshot is actually open after layout settles');
    const screenshot = path.join(temporary, 'select-menu.png'); fs.writeFileSync(screenshot, (await win.webContents.capturePage(undefined, {stayHidden:true, stayAwake:true})).toPNG());
    console.log('Select menu screenshot:', screenshot);
    await key('Escape');
    for (const theme of ['forest', 'graphite']) for (const enabled of [false, true]) {
      await render(`applySettingsInputs({...latestGoalSettings, theme:${JSON.stringify(theme)}, themeRotationEnabled:${enabled}, themeRotationMode:'any'});
        document.getElementById('settings-appearance-card').scrollIntoView({block:'start'});
        document.activeElement?.blur();
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      // Existing buttons/switches animate their token colors across a theme
      // change; let only this diagnostic capture settle before taking a frame.
      await new Promise(resolve => setTimeout(resolve, 350));
      await render('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      assert.equal(await render(`[...document.querySelectorAll('.select-menu-listbox')].every(list => list.hidden)`), true, 'Appearance screenshot has no popup');
      assert.equal(await render(`document.documentElement.dataset.theme === ${JSON.stringify(theme)} &&
        document.getElementById('theme-rotation-toggle').checked === ${enabled} &&
        document.getElementById('theme-rotation-options').classList.contains('hidden') === ${!enabled}`), true, 'Appearance screenshot shows its actual theme and on/off state');
      const file = path.join(temporary, 'appearance-' + theme + '-' + (enabled ? 'on' : 'off') + '.png');
      fs.writeFileSync(file, (await win.webContents.capturePage(undefined, {stayHidden:true, stayAwake:true})).toPNG());
      console.log('Appearance screenshot:', file);
    }
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
    await wait(`document.readyState === 'complete' && document.getElementById('poll-mode-select-trigger')?.dataset.selectValue === '3000' &&
      document.getElementById('profile-shortcut-select-trigger')?.dataset.selectValue === 'Alt+B' &&
      document.getElementById('window-shortcut-select-trigger')?.dataset.selectValue === 'CommandOrControl+Shift+S' &&
      document.getElementById('theme-rotation-mode-select-trigger')?.dataset.selectValue === 'any' && latestGoalSettings.themeRotationEnabled === true && latestGoalSettings.theme === 'forest'`, 'Confirmed select/appearance values did not survive renderer reload');
    await show();
    const moduleUrl = require('url').pathToFileURL(path.join(__dirname, '..', 'renderer', 'select-menu-ui.js')).href;
    win.webContents.session.webRequest.onBeforeRequest({ urls: [moduleUrl] }, (_details, callback) => callback({ cancel: true }));
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
    await wait(`document.readyState === 'complete' && !window.sydtrackSelectMenuUI && !document.getElementById('poll-mode').hidden`, 'Missing module did not preserve native fallback');
    await render(`document.querySelector('.nav-btn[data-tab="settings"]').click(); document.querySelector('[data-settings-tab="tracking"]').click()`);
    assert.equal(await render(`['poll-mode','profile-shortcut','window-shortcut','theme-rotation-mode'].every(id => document.getElementById(id).getClientRects().length > 0) && !document.querySelector('.select-menu-trigger')`), true);
    const beforeFallback = selectWrites().length;
    await render(`document.getElementById('poll-mode').value='5000'; document.getElementById('poll-mode').dispatchEvent(new Event('change',{bubbles:true}))`);
    await wait('latestGoalSettings.pollMs === 5000', 'Native fallback did not save through existing change handler');
    assert.equal(selectWrites().length, beforeFallback + 1);
    await render(`document.getElementById('theme-rotation-mode').value='light'; document.getElementById('theme-rotation-mode').dispatchEvent(new Event('change',{bubbles:true}))`);
    await wait(`!appearanceSaving && latestGoalSettings.themeRotationMode === 'light'`, 'Native rotation fallback did not save');
    assert.equal(settings.themeRotationMode, 'light'); assert.equal(settings.themeRotationEnabled, true);
    assert.deepEqual(errors, [], 'No unexpected renderer errors');
    console.log(`Select menu checks passed: native keyboard, exact shortcut/settings saves, rotation/manual-theme/failure/reload, shared pending guard, sync/dismissal/fallback, and ${layouts} four-control theme/viewport cases`);
    win.destroy(); app.quit();
  } catch (error) {
    console.error(error); win.destroy(); app.exit(1);
  }
}).catch(error => { console.error(error); app.exit(1); });
