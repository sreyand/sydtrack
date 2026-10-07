'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { channels } = require('../src/ipc-validate');
const { APP_PAGE_URL, windowBackgroundColor } = require('../src/window-security');
const { APP_ID } = require('../src/app-identity');
const { createUpdateChecker } = require('../src/updates');
const { titleBarOverlayForTheme } = require('../src/theme');
const { poolForMode, resolveDailyTheme } = require('../src/theme-rotation');
let updateRequests = 0;
const releasePagesOpened = [];
let trackerCreates = 0, trackerStarts = 0, pauseBoundaries = 0;
let expireTimedPause = null;

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok  ', msg);
  }
}

async function throws(fn, msg) {
  try {
    await fn();
    assert(false, msg);
  } catch (_) {
    assert(true, msg);
  }
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-main-sec-'));
if (!process.resourcesPath) process.resourcesPath = path.join(__dirname, '..');
const handlers = new Map();
const switches = [];
const registeredShortcuts = new Map();
let blockedShortcut = null;
let throwingShortcut = null;
let failSettingsWrite = false;
let mainStore = null, appearanceToday = null;
let recordAppearanceTimers = false;
const appearanceTimerDelay = 23_456_789;
const sentMessages = [];
let appliedAppId = null;
let loginItemSettings = null;
let windowShowCount = 0;
const windowActions = [];
const windowState = { visible: true, minimized: false, focused: true, destroyed: false };
const windowListeners = new Map();
const powerListeners = new Map();
const nativeBackgrounds = [], nativeOverlays = [];
const appListeners = {};
let readyResolve;
const ready = new Promise((resolve) => { readyResolve = resolve; });

const session = {
  webRequest: { onHeadersReceived: null },
  setPermissionRequestHandler: null
};
session.webRequest.onHeadersReceived = function onHeadersReceived() {
  session.webRequest.called = true;
};
session.setPermissionRequestHandler = function setPermissionRequestHandler() {
  session.permissionDenied = true;
};

const webContents = {
  session,
  mainFrame: { url: APP_PAGE_URL },
  listeners: {},
  on(event, fn) { this.listeners[event] = fn; },
  once() {},
  setWindowOpenHandler(fn) { this.openHandler = fn; },
  send(channel, payload) { sentMessages.push({ channel, payload }); },
  loadURL() { return Promise.resolve(); }
};

let windowOpts = null;
const fakeWindow = {
  webContents,
  isDestroyed: () => windowState.destroyed,
  show() { windowShowCount += 1; windowActions.push('show'); windowState.visible = true; },
  hide() { windowActions.push('hide'); windowState.visible = false; windowState.focused = false; },
  focus() { windowActions.push('focus'); windowState.focused = true; },
  restore() { windowActions.push('restore'); windowState.minimized = false; },
  isVisible: () => windowState.visible,
  isMinimized: () => windowState.minimized,
  isFocused: () => windowState.focused,
  on(event, fn) { windowListeners.set(event, fn); },
  once() {},
  loadURL() { return Promise.resolve(); },
  setAppDetails() {},
  setBackgroundColor(value) { nativeBackgrounds.push(value); },
  setTitleBarOverlay(value) { nativeOverlays.push(value); },
  flashFrame() {},
  removeListener() {}
};

function Notification() {}
Notification.isSupported = () => false;

const electron = {
  shell: { openExternal: async url => releasePagesOpened.push(url) },
  globalShortcut: {
    register(key, callback) {
      if (key === throwingShortcut) throw new Error('Synthetic shortcut registration failure');
      if (key === blockedShortcut) return false;
      registeredShortcuts.set(key, callback);
      return true;
    },
    unregister(key) { registeredShortcuts.delete(key); }
  },
  app: {
    commandLine: { appendSwitch: (name) => switches.push(name) },
    requestSingleInstanceLock: () => true,
    whenReady: () => ready,
    on(event, fn) { appListeners[event] = fn; },
    quit() {},
    isPackaged: true,
    getLoginItemSettings: () => ({ wasOpenedAsHidden: false }),
    setLoginItemSettings(value) { loginItemSettings = value; },
    getPath: () => userData,
    getAppPath: () => path.join(__dirname, '..'),
    resourcesPath: path.join(__dirname, '..', 'renderer', 'assets'),
    setName() {},
    setAppUserModelId(value) { appliedAppId = value; }
  },
  BrowserWindow: Object.assign(function BrowserWindow(opts) {
    windowOpts = opts;
    return fakeWindow;
  }, { getAllWindows: () => (windowOpts ? [fakeWindow] : []) }),
  ipcMain: {
    handle(channel, fn) { handlers.set(channel, fn); }
  },
  Notification,
  dialog: {
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 0 }),
    showErrorBox() {}
  },
  powerMonitor: {
    getSystemIdleState: () => 'active',
    on(event, fn) {
      if (!powerListeners.has(event)) powerListeners.set(event, new Set());
      powerListeners.get(event).add(fn);
    },
    removeListener(event, fn) { powerListeners.get(event)?.delete(fn); }
  },
  protocol: {
    registerSchemesAsPrivileged() {},
    handle() {}
  },
  net: { fetch: async () => new Response('') },
  nativeTheme: { shouldUseDarkColors: true },
  Tray: function Tray() {
    return { setToolTip() {}, setContextMenu() {}, on() {}, setImage() {}, destroy() {} };
  },
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true, resize: () => ({ isEmpty: () => true }) }),
    createEmpty: () => ({ isEmpty: () => true, resize: () => ({ isEmpty: () => true }) })
  }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'electron') return electron;
  if (request === './store' && parent.filename === path.join(__dirname, '..', 'src', 'main.js')) {
    const storeModule = originalLoad.call(this, request, parent, isMain);
    return { ...storeModule,
      createStore(...args) { mainStore = storeModule.createStore(...args); return mainStore; },
      todayKey(at) { return appearanceToday && at === undefined ? appearanceToday : storeModule.todayKey(at); }
    };
  }
  if (request === './settings-service' && parent.filename === path.join(__dirname, '..', 'src', 'main.js')) {
    const settingsModule = originalLoad.call(this, request, parent, isMain);
    return { ...settingsModule, updateAppSettings(...args) {
      if (failSettingsWrite) { failSettingsWrite = false; throw new Error('Synthetic settings-save failure'); }
      return settingsModule.updateAppSettings(...args);
    } };
  }
  if (request === './theme-rotation' && parent.filename === path.join(__dirname, '..', 'src', 'main.js')) {
    const rotationModule = originalLoad.call(this, request, parent, isMain);
    return { ...rotationModule, millisecondsUntilNextDay(now) {
      return recordAppearanceTimers ? appearanceTimerDelay : rotationModule.millisecondsUntilNextDay(now);
    } };
  }
  if (request === './tracker' && parent.filename === path.join(__dirname, '..', 'src', 'main.js')) {
    return { createTracker: () => {
      trackerCreates++;
      return { start() { trackerStarts++; }, stop() {}, setSystemPresence() {}, getLastFocused: () => null,
        invalidateClassification() {}, refreshCadence() {}, markPauseBoundary() { pauseBoundaries++; } };
    } };
  }
  if (request === './timed-pause' && parent.filename === path.join(__dirname, '..', 'src', 'main.js')) {
    const timedPause = originalLoad.call(this, request, parent, isMain);
    return { ...timedPause, createTimedPause: options => {
      expireTimedPause = options.onExpire;
      return timedPause.createTimedPause(options);
    } };
  }
  if (request === './updates' && parent.filename === path.join(__dirname, '..', 'src', 'main.js')) {
    return { createUpdateChecker: options => createUpdateChecker({ ...options, fetch: async () => {
      updateRequests++;
      return [{ tag_name: 'v99.0.0', prerelease: false, draft: false, html_url: 'https://evil.example' }];
    } }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

process.env.SYDTRACK_DEMO = '0';
process.env.SYDTRACK_FORCE_REAL = '1';

require('../src/main.js');

async function run() {
  assert(!switches.includes('no-sandbox'), 'main does not append no-sandbox');
  if (process.platform === 'win32') {
    assert(appliedAppId === APP_ID, 'Windows uses the stable packaged application identity');
  } else {
    assert(appliedAppId === null, 'non-Windows platforms skip the Windows application identity API');
  }
  assert(handlers.size === channels.length, 'every known IPC channel is registered');

  readyResolve();
  await ready;
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  if (process.platform === 'win32') {
    assert(loginItemSettings && loginItemSettings.openAtLogin === false, 'fresh Windows install waits for onboarding before enabling startup');
    assert(loginItemSettings.args.includes('--hidden'), 'Windows startup registration launches hidden');
  } else if (process.platform === 'darwin') {
    assert(loginItemSettings && loginItemSettings.openAtLogin === false, 'fresh macOS install waits for onboarding before enabling startup');
  } else {
    assert(loginItemSettings === null, 'unsupported platforms do not register a login item');
  }
  assert(!!windowOpts, 'createWindow constructed a BrowserWindow');
  assert(windowOpts.webPreferences.sandbox === true, 'BrowserWindow sandbox stays on');
  assert(windowOpts.webPreferences.contextIsolation === true, 'BrowserWindow contextIsolation stays on');
  assert(windowOpts.webPreferences.nodeIntegration === false, 'BrowserWindow nodeIntegration stays off');
  assert(windowOpts.backgroundColor === windowBackgroundColor('midnight'), 'BrowserWindow uses the active theme canvas');
  assert(typeof webContents.openHandler === 'function', 'installNavigationGuards ran on window creation');
  assert(session.webRequest.called === true, 'applyContentSecurityPolicy ran on window creation');
  assert(session.permissionDenied === true, 'denyPermissionRequests ran on window creation');

  const showsAfterReady = windowShowCount;
  appListeners['second-instance']({}, ['sydtrack.exe', '--hidden']);
  assert(windowShowCount === showsAfterReady, 'duplicate hidden startup does not surface the existing window');
  appListeners['second-instance']({}, ['sydtrack.exe']);
  assert(windowShowCount === showsAfterReady + 1, 'ordinary second launch surfaces the existing window');

  const goodEvent = { sender: webContents, senderFrame: webContents.mainFrame };
  const badEvent = { sender: { id: 'other' }, senderFrame: { url: APP_PAGE_URL } };

  const desktopDefaults = (await handlers.get('state:get')(goodEvent)).stats.settings;
  assert(desktopDefaults.windowShortcut === '' && registeredShortcuts.size === 0, 'show/hide shortcut defaults to Off without registering a binding');
  assert(desktopDefaults.themeRotationEnabled === false && desktopDefaults.themeRotationMode === 'dark' &&
    desktopDefaults.themeRotationAnchorDate === '' && desktopDefaults.themeRotationAnchorTheme === '',
  'daily appearance defaults to disabled with no private anchor');
  await handlers.get('settings:update')(goodEvent, { windowShortcut: 'CommandOrControl+Alt+S' });
  const onboardingShortcut = await handlers.get('state:get')(goodEvent);
  assert(onboardingShortcut.stats.settings.windowShortcut === 'CommandOrControl+Alt+S' &&
    !registeredShortcuts.has('CommandOrControl+Alt+S') && onboardingShortcut.windowShortcutRegistered === false,
  'incomplete onboarding can retain a shortcut preference without activating a global binding');
  await handlers.get('settings:update')(goodEvent, { windowShortcut: '' });

  await handlers.get('settings:update')(goodEvent, { profileShortcut: 'Alt+B' });
  assert(registeredShortcuts.has('Alt+B'), 'enabling the profile shortcut registers it');
  registeredShortcuts.get('Alt+B')();
  assert(sentMessages.some(message => message.channel === 'profiles:cycle-requested'), 'shortcut requests a renderer-guarded profile change');
  blockedShortcut = 'CommandOrControl+Alt+B';
  await throws(() => handlers.get('settings:update')(goodEvent, { profileShortcut: blockedShortcut }), 'colliding shortcut is rejected');
  assert(registeredShortcuts.has('Alt+B') &&
    (await handlers.get('state:get')(goodEvent)).stats.settings.profileShortcut === 'Alt+B',
  'collision preserves both the registered shortcut and saved preference');
  blockedShortcut = null;
  const beforeCycle = await handlers.get('profiles:get')(goodEvent);
  const afterCycle = await handlers.get('profiles:cycle')(goodEvent);
  await handlers.get('rules:set')(goodEvent, { profileId: afterCycle.activeId, productive: ['r/learnpython'], unproductive: ['r/'], other: [], ignore: [] });
  const profileSaved = (await handlers.get('profiles:get')(goodEvent)).profiles.find(profile => profile.id === afterCycle.activeId);
  assert(profileSaved.productive.includes('r/learnpython') && profileSaved.ignore.length === 0, 'rule changes can atomically restore an ignored app in the active profile');
  await throws(() => handlers.get('rules:set')(goodEvent, { profileId: beforeCycle.activeId, productive: [], unproductive: [], ignore: [] }), 'atomic rule changes reject a stale profile guard');
  assert(beforeCycle.profiles.length < 2 || afterCycle.activeId !== beforeCycle.activeId, 'profile cycle advances to an available profile');
  const quick = await handlers.get('rules:quickSet')(goodEvent, { profileId: afterCycle.activeId, app: 'chrome',
    title: 'A guide to linear algebra - Google Chrome', keyword: 'linear algebra', category: 'productive', toggle: false });
  assert(quick.rules.productive.includes('linear algebra') && !!quick.undoToken, 'quick IPC returns the saved rule and an opaque Undo token');
  const undone = await handlers.get('corrections:undo')(goodEvent, quick.undoToken);
  assert(!undone.rules.productive.includes('linear algebra'), 'Undo IPC restores the previous keyword state');
  await throws(() => handlers.get('corrections:undo')(goodEvent, quick.undoToken), 'Undo token is one-use');
  const updateState = await handlers.get('updates:get')(goodEvent);
  assert(updateState.currentVersion === require('../package.json').version && updateRequests === 0, 'automatic checks are off and startup makes no GitHub request');
  await throws(() => handlers.get('updates:openRelease')(goodEvent), 'release cannot be opened before an update is known');
  const foundUpdate = await handlers.get('updates:check')(goodEvent);
  assert(foundUpdate.available && updateRequests === 1, 'manual IPC performs one scoped update check');
  await handlers.get('updates:openRelease')(goodEvent);
  assert(releasePagesOpened[0] === 'https://github.com/sreyand/sydtrack/releases/tag/v99.0.0', 'release opener constructs a trusted repository URL, ignoring remote html_url');
  await handlers.get('settings:update')(goodEvent, { profileShortcut: '' });
  assert(!registeredShortcuts.has('Alt+B'), 'turning the shortcut off unregisters it');

  const timedPause = await handlers.get('tracking:pause15')(goodEvent);
  assert(timedPause.trackingPaused === true && timedPause.trackingPauseUntil > Date.now(),
    'timed pause IPC persists an active deadline');
  const manuallyResumed = await handlers.get('settings:update')(goodEvent, { trackingPaused: false });
  assert(manuallyResumed.trackingPaused === false && manuallyResumed.trackingPauseUntil === 0,
    'manual resume cancels the timed deadline');

  for (const minutes of [15, 30, 60]) {
    const before = Date.now();
    const paused = await handlers.get('tracking:pauseFor')(goodEvent, minutes);
    assert(paused.trackingPaused && paused.trackingPauseUntil >= before + minutes * 60_000 &&
      paused.trackingPauseUntil <= Date.now() + minutes * 60_000, 'flexible pause IPC persists the exact ' + minutes + '-minute duration');
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    assert(saved.trackingPauseUntil === paused.trackingPauseUntil, 'flexible pause deadline reaches durable settings');
    assert(paused.onboardingComplete === false && trackerCreates === 0 && trackerStarts === 0,
      'timed pause does not complete onboarding or start tracking');
  }
  expireTimedPause();
  const expired = (await handlers.get('state:get')(goodEvent)).stats.settings;
  assert(!expired.trackingPaused && expired.trackingPauseUntil === 0 && expired.onboardingComplete === false && trackerCreates === 0,
    'automatic resume cannot bypass incomplete onboarding');

  const unchangedSettings = fs.readFileSync(path.join(userData, 'settings.json'), 'utf8');
  for (const invalid of [undefined, null, false, '15', 0, -15, 15.5, 16, 45, 90, NaN, Infinity, [], [30], { minutes: 30 }]) {
    await throws(() => handlers.get('tracking:pauseFor')(goodEvent, invalid), 'flexible pause rejects invalid duration ' + String(invalid));
    assert(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8') === unchangedSettings, 'rejected pause cannot write settings');
  }
  await throws(() => handlers.get('tracking:pauseFor')({ sender: webContents, senderFrame: { url: APP_PAGE_URL } }, 30),
    'flexible pause rejects a child frame even with the app URL');
  await throws(() => handlers.get('tracking:pauseFor')(badEvent, 30), 'valid pause duration cannot bypass sender checks');
  assert(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8') === unchangedSettings, 'rejected sender cannot write a pause deadline');

  await handlers.get('settings:update')(goodEvent, { onboardingComplete: true, trackingPaused: false });
  assert(trackerCreates === 1 && trackerStarts === 1, 'completed onboarding starts one tracking service');
  const boundaries = pauseBoundaries;
  await handlers.get('tracking:pauseFor')(goodEvent, 30);
  assert(pauseBoundaries === boundaries + 1, 'flexible pause uses the existing tracker pause boundary');
  await handlers.get('tracking:pauseFor')(goodEvent, 60);
  assert(pauseBoundaries === boundaries + 1, 'changing duration while paused reschedules without restarting tracking');
  const indefinite = await handlers.get('settings:update')(goodEvent, { trackingPaused: true });
  assert(indefinite.trackingPaused && indefinite.trackingPauseUntil === 0, 'manual indefinite pause clears an earlier timed deadline');
  await handlers.get('tracking:pauseFor')(goodEvent, 15);
  const resumed = await handlers.get('settings:update')(goodEvent, { trackingPaused: false });
  assert(!resumed.trackingPaused && resumed.trackingPauseUntil === 0 && pauseBoundaries === boundaries + 2,
    'manual resume clears the deadline and uses the existing tracker resume boundary');
  await handlers.get('tracking:pauseFor')(goodEvent, 60);
  expireTimedPause();
  assert(pauseBoundaries === boundaries + 4 && trackerCreates === 1 && trackerStarts === 1,
    'automatic expiry resumes the same tracker and marks both transition boundaries');

  await handlers.get('settings:update')(goodEvent, { windowShortcut: 'CommandOrControl+Alt+S' });
  assert(registeredShortcuts.has('CommandOrControl+Alt+S') &&
    (await handlers.get('state:get')(goodEvent)).windowShortcutRegistered === true,
  'explicitly enabling show/hide registers the shortcut and reports its active binding');
  blockedShortcut = 'Alt+S';
  await throws(() => handlers.get('settings:update')(goodEvent, { windowShortcut: blockedShortcut }), 'colliding show/hide shortcut is rejected');
  assert(registeredShortcuts.has('CommandOrControl+Alt+S') &&
    (await handlers.get('state:get')(goodEvent)).stats.settings.windowShortcut === 'CommandOrControl+Alt+S',
  'show/hide collision preserves its working binding and saved preference');
  blockedShortcut = null;
  throwingShortcut = 'CommandOrControl+Shift+S';
  await throws(() => handlers.get('settings:update')(goodEvent, { windowShortcut: throwingShortcut }), 'thrown show/hide registration is rejected');
  throwingShortcut = null;
  const shortcutSettingsBeforeFailure = fs.readFileSync(path.join(userData, 'settings.json'), 'utf8');
  failSettingsWrite = true;
  await throws(() => handlers.get('settings:update')(goodEvent, { windowShortcut: 'Alt+S' }), 'failed settings save rolls back a newly registered shortcut');
  assert(registeredShortcuts.has('CommandOrControl+Alt+S') && !registeredShortcuts.has('Alt+S') &&
    fs.readFileSync(path.join(userData, 'settings.json'), 'utf8') === shortcutSettingsBeforeFailure,
  'failed save restores the prior show/hide binding without changing durable settings');
  const toggle = registeredShortcuts.get('CommandOrControl+Alt+S');
  for (const state of [
    { visible: true, minimized: false, focused: true, expected: ['hide'] },
    { visible: false, minimized: false, focused: false, expected: ['show', 'focus'] },
    { visible: true, minimized: false, focused: false, expected: ['show', 'focus'] },
    { visible: true, minimized: true, focused: true, expected: ['restore', 'show', 'focus'] }
  ]) {
    Object.assign(windowState, state); windowActions.length = 0;
    toggle();
    assert(JSON.stringify(windowActions) === JSON.stringify(state.expected), 'global shortcut chooses safe window action ' + state.expected.join('/'));
  }
  windowState.destroyed = true; windowActions.length = 0; toggle();
  assert(windowActions.length === 0, 'show/hide shortcut ignores destroyed windows');
  windowState.destroyed = false;
  assert(trackerCreates === 1 && trackerStarts === 1, 'show/hide actions neither start nor duplicate tracking services');
  await handlers.get('settings:update')(goodEvent, { windowShortcut: '' });
  assert(!registeredShortcuts.has('CommandOrControl+Alt+S'), 'show/hide Off unregisters its active binding');

  const privateSettingsBefore = fs.readFileSync(path.join(userData, 'settings.json'), 'utf8');
  for (const payload of [{ themeRotationAnchorDate: '2026-10-07' }, { themeRotationAnchorTheme: 'forest' }]) {
    await throws(() => handlers.get('settings:update')(goodEvent, payload), 'renderer IPC cannot write private rotation anchor ' + Object.keys(payload)[0]);
  }
  assert(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8') === privateSettingsBefore, 'rejected private anchors cannot write settings');
  appearanceToday = '2026-10-07';
  await handlers.get('settings:update')(goodEvent, { theme: 'forest' });
  const rotating = await handlers.get('settings:update')(goodEvent, { themeRotationEnabled: true, themeRotationMode: 'dark' });
  assert(rotating.themeRotationEnabled && rotating.theme === 'forest' && rotating.themeRotationMode === 'dark' &&
    rotating.themeRotationAnchorDate === appearanceToday && rotating.themeRotationAnchorTheme === 'forest',
  'enabling daily appearance initializes one private local-date anchor while retaining an eligible theme');
  const anchorSettings = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
  assert(anchorSettings.themeRotationAnchorDate === appearanceToday && anchorSettings.themeRotationAnchorTheme === 'forest',
    'private rotation anchors reach durable settings');
  await handlers.get('settings:update')(goodEvent, { notificationsEnabled: false });
  assert(mainStore.getSettings().themeRotationAnchorDate === rotating.themeRotationAnchorDate &&
    mainStore.getSettings().themeRotationAnchorTheme === rotating.themeRotationAnchorTheme && mainStore.getSettings().theme === 'forest',
  'unrelated settings edits do not reset the daily appearance anchor');
  appearanceToday = '2026-10-08';
  const nextTheme = resolveDailyTheme(mainStore.getSettings(), appearanceToday).theme;
  const sentBeforeAppearance = sentMessages.length;
  for (const listener of [...(powerListeners.get('resume') || [])]) listener();
  assert(mainStore.getSettings().themeRotationEnabled === true && mainStore.getSettings().theme === nextTheme &&
    mainStore.getSettings().themeRotationAnchorDate === '2026-10-07' && mainStore.getSettings().themeRotationAnchorTheme === 'forest',
  'resume rotates for the new local date without disabling rotation or advancing its anchor');
  assert(nativeBackgrounds.at(-1) === windowBackgroundColor(nextTheme), 'automatic appearance synchronizes the native window background');
  if (process.platform === 'win32') assert(JSON.stringify(nativeOverlays.at(-1)) === JSON.stringify(titleBarOverlayForTheme(nextTheme)),
    'automatic appearance synchronizes native Windows titlebar colors');
  assert(sentMessages.slice(sentBeforeAppearance).some(message => message.channel === 'tracker:update' && message.payload.stats.settings.theme === nextTheme),
    'automatic appearance publishes updated theme settings to the renderer');
  const nativeCount = nativeBackgrounds.length;
  for (const listener of [...(powerListeners.get('unlock-screen') || [])]) listener();
  windowListeners.get('focus')?.();
  assert(nativeBackgrounds.length === nativeCount && mainStore.getSettings().theme === nextTheme,
    'same-date unlock/focus does not rotate again or rewrite native colors');
  const lightRotation = await handlers.get('settings:update')(goodEvent, { themeRotationMode: 'light' });
  assert(lightRotation.themeRotationEnabled && lightRotation.theme === poolForMode('light')[0] &&
    lightRotation.themeRotationAnchorDate === appearanceToday && lightRotation.themeRotationAnchorTheme === lightRotation.theme,
  'changing an enabled rotation mode atomically initializes an eligible theme and anchor');
  const anyRotation = await handlers.get('settings:update')(goodEvent, { themeRotationMode: 'any' });
  assert(anyRotation.themeRotationEnabled && anyRotation.theme === lightRotation.theme && anyRotation.themeRotationMode === 'any',
    'Any mode retains the current eligible theme');
  const manualTheme = await handlers.get('settings:update')(goodEvent, { theme: 'plum' });
  assert(manualTheme.theme === 'plum' && manualTheme.themeRotationEnabled === false && nativeBackgrounds.at(-1) === windowBackgroundColor('plum'),
    'manual theme choice disables rotation and synchronizes native appearance');
  appearanceToday = '2026-10-09';
  for (const listener of [...(powerListeners.get('resume') || [])]) listener();
  assert(mainStore.getSettings().theme === 'plum' && mainStore.getSettings().themeRotationEnabled === false,
    'disabled rotation does not change a manually selected theme on resume');
  await handlers.get('settings:update')(goodEvent, { themeRotationMode: 'dark' });
  assert(mainStore.getSettings().theme === 'plum' && mainStore.getSettings().themeRotationAnchorDate === manualTheme.themeRotationAnchorDate,
    'changing mode while disabled does not rotate or reset the anchor');

  const originalSetTimeout = global.setTimeout, originalClearTimeout = global.clearTimeout;
  const activeAppearanceTimers = new Set(), syntheticAppearanceTimers = new Set();
  let scheduledAppearanceTimers = 0;
  recordAppearanceTimers = true;
  global.setTimeout = (callback, delay, ...args) => {
    if (delay !== appearanceTimerDelay) return originalSetTimeout(callback, delay, ...args);
    const timer = { callback, unref() { this.unreffed = true; return this; } };
    activeAppearanceTimers.add(timer); syntheticAppearanceTimers.add(timer); scheduledAppearanceTimers++;
    return timer;
  };
  global.clearTimeout = timer => {
    if (syntheticAppearanceTimers.has(timer)) activeAppearanceTimers.delete(timer);
    else originalClearTimeout(timer);
  };
  try {
    // Only the synthetic temporary store is changed. An overdue timed pause
    // expires inside automatic appearance's applySettings, causing a nested
    // normal settings update that must not schedule a second midnight timer.
    mainStore.updateSettings({ theme: 'forest', themeRotationEnabled: true, themeRotationMode: 'dark',
      themeRotationAnchorDate: '2026-10-07', themeRotationAnchorTheme: 'forest',
      trackingPaused: true, trackingPauseUntil: Date.now() - 1000 });
    appearanceToday = '2026-10-08';
    for (const listener of [...(powerListeners.get('resume') || [])]) listener();
    assert(mainStore.getSettings().trackingPaused === false && mainStore.getSettings().trackingPauseUntil === 0,
      'rotation can expire an overdue timed pause through the normal resume path');
    assert(activeAppearanceTimers.size === 1 && scheduledAppearanceTimers === 1 && [...activeAppearanceTimers][0].unreffed === true,
      'nested overdue-pause resume schedules exactly one unreferenced midnight appearance timer');

    appearanceToday = '2026-10-09';
    const expectedAfterMidnight = resolveDailyTheme(mainStore.getSettings(), appearanceToday).theme;
    const postMidnight = await handlers.get('settings:update')(goodEvent, { notificationsEnabled: true });
    assert(postMidnight.theme === expectedAfterMidnight && postMidnight.theme === mainStore.getSettings().theme && postMidnight.themeRotationEnabled === true,
      'unrelated settings response after midnight returns the newly rotated authoritative theme');
    assert(activeAppearanceTimers.size === 1 && scheduledAppearanceTimers === 2,
      'ordinary post-midnight sync replaces the prior timer rather than retaining a duplicate');
    await handlers.get('settings:update')(goodEvent, { themeRotationEnabled: false });
    assert(activeAppearanceTimers.size === 0, 'disabling rotation clears its single pending midnight timer');
  } finally {
    recordAppearanceTimers = false;
    global.setTimeout = originalSetTimeout; global.clearTimeout = originalClearTimeout;
  }
  appearanceToday = null;

  for (const channel of channels) {
    const handler = handlers.get(channel);
    assert(typeof handler === 'function', channel + ' is registered');
    await throws(() => handler(badEvent), channel + ' rejects a bad sender');
    await throws(() => handler(goodEvent, { __unexpected: true }), channel + ' rejects a bad payload');
  }

  const preloadPath = path.join(__dirname, '..', 'src', 'preload.js');
  const exposed = {};
  const ipcRenderer = { invoke() {}, on() { return this; }, removeListener() {} };
  Module._load = function loadPreload(request, parent, isMain) {
    if (request === 'electron') {
      return {
        contextBridge: { exposeInMainWorld(name, api) { exposed[name] = api; } },
        ipcRenderer
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[preloadPath];
  require(preloadPath);
  assert(exposed.sydtrack && typeof exposed.sydtrack.getState === 'function', 'preload exposes window.sydtrack');
  assert(!Object.prototype.hasOwnProperty.call(exposed.sydtrack, 'ipcRenderer'), 'preload does not expose ipcRenderer');
  assert(!Object.values(exposed.sydtrack).includes(ipcRenderer), 'preload does not leak the raw ipcRenderer object');
  const requests = [];
  ipcRenderer.invoke = async (channel, payload) => {
    requests.push({ channel, payload });
    return channel === 'profiles:activate' ? { activeId: payload } : {};
  };
  await exposed.sydtrack.activateProfile('new-profile');
  await exposed.sydtrack.setRules({ productive: [], unproductive: [], other: [] }, 'default');
  await exposed.sydtrack.setIgnore([], 'default');
  assert(requests.slice(-2).every(request => request.payload.profileId === 'default'), 'an in-flight rule/Ignore save retains its original profile guard');
  await exposed.sydtrack.setRules({ productive: [], unproductive: [] });
  assert(requests.at(-1).payload.profileId === 'new-profile', 'ordinary rule saves still use the current profile');
  await exposed.sydtrack.pauseForMinutes(30);
  assert(requests.at(-1).channel === 'tracking:pauseFor' && requests.at(-1).payload === 30,
    'preload passes only numeric minutes to the flexible pause channel');
  await exposed.sydtrack.pauseFor15Minutes();
  assert(requests.at(-1).channel === 'tracking:pause15' && requests.at(-1).payload === undefined,
    'legacy preload keeps the original no-payload pause channel');

  const builder = require('../build/electron-builder.config.js');
  assert(builder.appId === APP_ID, 'builder and runtime application identities match');
  assert(builder.publish === null, 'builder config has publish: null');
  assert(!builder.publish || builder.publish.provider !== 'github', 'builder config does not publish to GitHub');

  await handlers.get('settings:update')(goodEvent, { windowShortcut: 'Alt+S', profileShortcut: 'Alt+B' });
  const quittingToggle = registeredShortcuts.get('Alt+S');
  appListeners['before-quit']();
  assert(registeredShortcuts.size === 0, 'quitting disposes show/hide and profile shortcut bindings');
  windowActions.length = 0; quittingToggle();
  assert(windowActions.length === 0, 'a late show/hide callback cannot surface the quitting window');
  const appearanceListener = windowListeners.get('focus');
  assert(!powerListeners.get('resume')?.has(appearanceListener) && !powerListeners.get('unlock-screen')?.has(appearanceListener),
    'quitting removes daily appearance resume/unlock listeners');
}

run().then(() => {
  Module._load = originalLoad;
  if (failed) {
    console.error(failed + ' main-security check(s) failed');
    process.exitCode = 1;
  } else {
    console.log('main-security checks passed');
  }
}).catch((err) => {
  Module._load = originalLoad;
  console.error(err);
  process.exitCode = 1;
});
