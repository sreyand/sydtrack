'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { channels } = require('../src/ipc-validate');
const { APP_PAGE_URL, windowBackgroundColor } = require('../src/window-security');

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
const handlers = new Map();
const switches = [];
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
  send() {},
  loadURL() { return Promise.resolve(); }
};

let windowOpts = null;
const fakeWindow = {
  webContents,
  isDestroyed: () => false,
  show() {},
  hide() {},
  focus() {},
  restore() {},
  isMinimized: () => false,
  isFocused: () => true,
  on() {},
  once() {},
  loadURL() { return Promise.resolve(); },
  setAppDetails() {},
  flashFrame() {},
  removeListener() {}
};

function Notification() {}
Notification.isSupported = () => false;

const electron = {
  app: {
    commandLine: { appendSwitch: (name) => switches.push(name) },
    requestSingleInstanceLock: () => true,
    whenReady: () => ready,
    on(event, fn) { appListeners[event] = fn; },
    quit() {},
    isPackaged: true,
    getPath: () => userData,
    getAppPath: () => path.join(__dirname, '..'),
    setName() {},
    setAppUserModelId() {}
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
  assert(handlers.size === channels.length, 'every known IPC channel is registered');

  readyResolve();
  await ready;
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert(!!windowOpts, 'createWindow constructed a BrowserWindow');
  assert(windowOpts.webPreferences.sandbox === true, 'BrowserWindow sandbox stays on');
  assert(windowOpts.webPreferences.contextIsolation === true, 'BrowserWindow contextIsolation stays on');
  assert(windowOpts.webPreferences.nodeIntegration === false, 'BrowserWindow nodeIntegration stays off');
  assert(windowOpts.backgroundColor === windowBackgroundColor('midnight'), 'BrowserWindow uses the active theme canvas');
  assert(typeof webContents.openHandler === 'function', 'installNavigationGuards ran on window creation');
  assert(session.webRequest.called === true, 'applyContentSecurityPolicy ran on window creation');
  assert(session.permissionDenied === true, 'denyPermissionRequests ran on window creation');

  const goodEvent = { sender: webContents, senderFrame: { url: APP_PAGE_URL } };
  const badEvent = { sender: { id: 'other' }, senderFrame: { url: APP_PAGE_URL } };

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

  const builder = require('../build/electron-builder.config.js');
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
