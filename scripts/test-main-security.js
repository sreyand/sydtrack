'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { channels } = require('../src/ipc-validate');
const { APP_PAGE_URL, windowBackgroundColor } = require('../src/window-security');
const { APP_ID } = require('../src/app-identity');

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
const sentMessages = [];
let appliedAppId = null;
let loginItemSettings = null;
let windowShowCount = 0;
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
  isDestroyed: () => false,
  show() { windowShowCount += 1; },
  hide() {},
  focus() {},
  restore() {},
  isMinimized: () => false,
  isFocused: () => true,
  on() {},
  once() {},
  loadURL() { return Promise.resolve(); },
  setAppDetails() {},
  setTitleBarOverlay() {},
  flashFrame() {},
  removeListener() {}
};

function Notification() {}
Notification.isSupported = () => false;

const electron = {
  globalShortcut: {
    register(key, callback) {
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
    on() {},
    removeListener() {}
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
  await handlers.get('settings:update')(goodEvent, { profileShortcut: '' });
  assert(!registeredShortcuts.has('Alt+B'), 'turning the shortcut off unregisters it');

  const timedPause = await handlers.get('tracking:pause15')(goodEvent);
  assert(timedPause.trackingPaused === true && timedPause.trackingPauseUntil > Date.now(),
    'timed pause IPC persists an active deadline');
  const manuallyResumed = await handlers.get('settings:update')(goodEvent, { trackingPaused: false });
  assert(manuallyResumed.trackingPaused === false && manuallyResumed.trackingPauseUntil === 0,
    'manual resume cancels the timed deadline');

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

  const builder = require('../build/electron-builder.config.js');
  assert(builder.appId === APP_ID, 'builder and runtime application identities match');
  assert(builder.publish === null, 'builder config has publish: null');
  assert(!builder.publish || builder.publish.provider !== 'github', 'builder config does not publish to GitHub');
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
