'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, Notification, dialog, powerMonitor, protocol, net, nativeTheme } = require('electron');
const { bindTrackingLifecycle } = require('./tracking-lifecycle');
const { createErrorLog, installErrorLogging } = require('./error-log');
let errorLog;
const { createFocusProfiles } = require('./focus-profiles');
let focusProfiles;
let appliedProfile = '';
const { createAppTray } = require('./tray');
const { validateSiteTags } = require('./browser-rules');
const {
  loadBrowserKeywords,
  saveBrowserKeywords,
  defaultBrowserKeywords
} = require('./browser-keywords');

const {
  loadRulesFrom,
  saveRules,
  loadIgnoreFrom,
  saveIgnore,
  loadAppIdentitiesFrom,
  saveAppIdentities,
  DEFAULT_RULES_PATH,
  DEFAULT_IGNORE_PATH,
  DEFAULT_APP_IDENTITIES_PATH
} = require('./classifier');
const { createStore } = require('./store');
const { createTracker } = require('./tracker');
const { createSessionManager } = require('./sessions');
const { updateAppSettings } = require('./settings-service');
const {
  buildExport,
  importBackup,
  writeBackupFile,
  readBackupFile
} = require('./backup');
const { buildCsvExport, importCsv } = require('./data-export');
const { deleteAllMyData, backupUserConfig } = require('./data-ownership');
const { migrateLegacyUserData } = require('./legacy-data-dir');
const { APP_ID } = require('./app-identity');
const { HIDDEN_ARG, syncLoginItem, shouldStartHidden } = require('./startup');
const {
  buildProfilePack,
  writeProfilePackFile,
  readProfilePackFile
} = require('./profile-pack');
const { validateIpcPayload } = require('./ipc-validate');
const {
  APP_PAGE_URL,
  applyContentSecurityPolicy,
  assertIpcSender,
  buildBrowserWindowOptions,
  denyPermissionRequests,
  installNavigationGuards,
  windowBackgroundColor,
  registerAppScheme,
  resolveAppFile
} = require('./window-security');

registerAppScheme(protocol);

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// Required on Windows so Electron toasts show under a real app identity (dev + packaged).
if (process.platform === 'win32') {
  app.setName('sydtrack');
  app.setAppUserModelId(APP_ID);
}

let mainWindow = null;
let tracker = null;
let store = null;
let sessionManager = null;
/** Mutable holders so tracker picks up hot-reloaded rules/ignore. */
const rulesHolder = { rules: null };
const ignoreHolder = { ignore: [] };
const identitiesHolder = { identities: null };
const browserKeywordsHolder = { keywords: null };
let rulesFilePath = null;
let rulesIsCustom = false;
let ignoreFilePath = null;
let ignoreIsCustom = false;
/** Last tracker tick — so state:get can return `now` + lastFocused. */
let lastPayload = { now: null, stats: null, lastFocused: null };
let servicesStarted = false;
let appTray = null;
let isQuitting = false;
const startHidden = shouldStartHidden({ argv: process.argv, platform: process.platform, appApi: app });

function dataDir() {
  let dir;
  try {
    if (app.isPackaged) dir = app.getPath('userData');
  } catch (_) {}
  if (!dir) {
    dir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
  }
  try {
    const result = migrateLegacyUserData(dir, { appData: app.getPath('appData') });
    if (result.migrated) console.log('[sydtrack] Copied existing focusflow data into', dir);
  } catch (err) {
    console.error('[main] legacy data directory migration failed', err.message);
  }
  return dir;
}

function userRulesPath() {
  return path.join(dataDir(), 'rules.json');
}

function userIgnorePath() {
  return path.join(dataDir(), 'ignore.json');
}

function userAppIdentitiesPath() {
  return path.join(dataDir(), 'app-identities.json');
}

function userBrowserKeywordsPath() {
  return path.join(dataDir(), 'browser-keywords.json');
}

function loadAppIdentities() {
  const custom = userAppIdentitiesPath();
  if (!fs.existsSync(custom)) saveAppIdentities(custom, loadAppIdentitiesFrom(DEFAULT_APP_IDENTITIES_PATH));
  try {
    identitiesHolder.identities = loadAppIdentitiesFrom(custom);
  } catch (err) {
    console.warn('[main] invalid app identities; using defaults, preserving file:', err.message);
    identitiesHolder.identities = loadAppIdentitiesFrom(DEFAULT_APP_IDENTITIES_PATH);
  }
}

function attachAppIdentities(rules) {
  rules.identities = identitiesHolder.identities || loadAppIdentitiesFrom(DEFAULT_APP_IDENTITIES_PATH);
  rules.browserKeywords = browserKeywordsHolder.keywords || defaultBrowserKeywords();
  return rules;
}

function loadBrowserKeywordFile() {
  browserKeywordsHolder.keywords = loadBrowserKeywords(userBrowserKeywordsPath());
  if (rulesHolder.rules) rulesHolder.rules.browserKeywords = browserKeywordsHolder.keywords;
  return browserKeywordsHolder.keywords;
}

function loadAppRules() {
  const custom = userRulesPath();
  if (fs.existsSync(custom)) {
    rulesHolder.rules = attachAppIdentities(loadRulesFrom(custom));
    rulesFilePath = custom;
    rulesIsCustom = true;
  } else {
    rulesHolder.rules = attachAppIdentities(loadRulesFrom(DEFAULT_RULES_PATH));
    rulesFilePath = DEFAULT_RULES_PATH;
    rulesIsCustom = false;
  }
  return rulesPayload();
}

function loadAppIgnore() {
  const custom = userIgnorePath();
  if (fs.existsSync(custom)) {
    ignoreHolder.ignore = loadIgnoreFrom(custom);
    ignoreFilePath = custom;
    ignoreIsCustom = true;
  } else {
    ignoreHolder.ignore = loadIgnoreFrom(DEFAULT_IGNORE_PATH);
    ignoreFilePath = DEFAULT_IGNORE_PATH;
    ignoreIsCustom = false;
  }
  return ignorePayload();
}

function rulesPayload() {
  return {
    profileId: focusProfiles && focusProfiles.snapshot().activeId,
    browserApps: (identitiesHolder.identities && identitiesHolder.identities.browserApps) || [],
    productive: (rulesHolder.rules && rulesHolder.rules.productive) || [],
    unproductive: (rulesHolder.rules && rulesHolder.rules.unproductive) || [],
    path: rulesFilePath,
    isCustom: rulesIsCustom
  };
}

function ignorePayload() {
  return {
    profileId: focusProfiles && focusProfiles.snapshot().activeId,
    ignore: ignoreHolder.ignore || [],
    path: ignoreFilePath,
    isCustom: ignoreIsCustom
  };
}

function installAppProtocol() {
  const root = path.join(__dirname, '..');
  protocol.handle('sydtrack', (request) => {
    const filePath = resolveAppFile(request.url, root);
    if (!filePath) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filePath).href);
  });
}

function guardIpc(event, channel, payload) {
  const contents = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  assertIpcSender(event, contents);
  return validateIpcPayload(channel, payload);
}

function createWindow() {
  const winOpts = buildBrowserWindowOptions({
    preloadPath: path.join(__dirname, 'preload.js'),
    iconPath: path.join(__dirname, '..', 'renderer', 'assets', 'sydtrack.ico'),
    platform: process.platform,
    backgroundColor: windowBackgroundColor(store && store.getSettings ? store.getSettings().theme : 'midnight')
  });
  mainWindow = new BrowserWindow(winOpts);
  installNavigationGuards(mainWindow.webContents);
  applyContentSecurityPolicy(mainWindow.webContents.session);
  denyPermissionRequests(mainWindow.webContents.session);
  if (process.platform === 'win32') {
    // Windows uses these shell properties for the taskbar menu, independently
    // of the document title. Portable builds must relaunch their outer EXE.
    const executable = app.isPackaged
      ? process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
      : process.execPath;
    const relaunchCommand = app.isPackaged
      ? `"${executable}"`
      : `"${executable}" "${app.getAppPath()}" --disable-gpu`;
    mainWindow.setAppDetails({
      appId: APP_ID,
      appIconPath: app.isPackaged
        ? path.join(process.resourcesPath, 'sydtrack.ico')
        : path.join(__dirname, '..', 'renderer', 'assets', 'sydtrack.ico'),
      appIconIndex: 0,
      relaunchDisplayName: 'sydtrack',
      relaunchCommand
    });
  }
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (errorLog) errorLog.write('renderer-exit', `${details.reason} (${details.exitCode})`);
  });
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (errorLog && level >= 2) errorLog.write('renderer', message);
  });

  mainWindow.loadURL(APP_PAGE_URL).catch((err) => {
    console.error('[main] renderer failed to load:', err && err.message ? err.message : err);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[main] renderer did-fail-load:', errorCode, errorDescription, validatedURL);
  });
  if (!startHidden) mainWindow.show();
  mainWindow.once('ready-to-show', () => {
    // Start tracker after window is visible
    ensureTrackerStarted();
  });
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    if (appTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function formatReminderBody(template, payload) {
  const app = payload && payload.app ? String(payload.app) : 'an app';
  const streakSec = Math.round(Number(payload && payload.streak) || 0);
  const minutes = Math.max(1, Math.round(streakSec / 60));
  const streak =
    streakSec > 0 && streakSec < 60 ? streakSec + 's' : minutes + ' min';
  const timeSpent = streak;
  return String(template || '')
    .replace(/\{app\}/gi, app)
    .replace(/\{time_spent\}/gi, timeSpent)
    // legacy alias
    .replace(/\{streak\}/gi, timeSpent)
    .trim();
}

function fireReminder(payload) {
  const settings = (store && store.getSettings && store.getSettings()) || {};
  // DND / notifications toggle — skip OS toast + in-app banner
  if (settings.notificationsEnabled === false) {
    return;
  }
  const boostOn = !!settings.focusBoost;
  const boostTemplate =
    settings.focusBoostReminderMessage ||
    "Hey! focusboost is enabled. Maybe it's time to refocus?";
  const standardTemplate =
    settings.reminderMessage ||
    "You've been on {app} for a while... maybe it's time to get back?";
  const template = boostOn ? boostTemplate : standardTemplate;
  let body = formatReminderBody(template, payload);
  if (!body) {
    body = formatReminderBody(standardTemplate, payload);
  }

  const iconPath = path.join(__dirname, '..', 'renderer', 'assets', 'logo-mark.png');

  // OS toast — the real light nudge (works even when SydTrack is in the background).
  if (Notification.isSupported()) {
    try {
      const n = new Notification({
        title: 'Time to refocus',
        body,
        icon: iconPath,
        silent: false,
        timeoutType: 'default',
        urgency: 'normal'
      });
      n.on('click', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      });
      n.show();
    } catch (err) {
      console.error('[reminder] native notification failed', err && err.message);
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    // Soft taskbar flash if the window is not focused
    if (!mainWindow.isFocused()) {
      try {
        mainWindow.flashFrame(true);
        const stopFlash = () => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(false);
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.removeListener('focus', stopFlash);
        };
        mainWindow.once('focus', stopFlash);
      } catch (_) {
        /* ignore */
      }
    }
    mainWindow.webContents.send('reminder:fired', { ...payload, body });
  }
}

function reportRecovery({ filePath, recoveryPath }) {
  const settingsReset = path.basename(filePath) === 'settings.json';
  const profilesReset = path.basename(filePath) === 'focus-profiles.json';
  if (profilesReset && store) store.updateSettings({ trackingPaused: true });
  dialog.showMessageBox({
    type: 'warning',
    title: 'SydTrack data recovery',
    message: `SydTrack could not read ${path.basename(filePath)}.`,
    detail: `${settingsReset ? 'Settings were reset and tracking is paused. Review Settings before resuming.' : profilesReset ? 'Focus profiles were recovered from legacy tags into Default. Tracking is paused; review the profiles in Settings before resuming.' : 'This session file was set aside. Its contents have not been restored.'}\n\nThe original contents are preserved at:\n${recoveryPath}`,
    buttons: ['OK']
  }).catch((err) => console.error('[recovery] notice failed', err.message));
}

/** Idempotent: load rules/ignore/store once. Tracker starts separately after show. */
function startServices() {
  if (servicesStarted) return;
  servicesStarted = true;
  loadAppIdentities();
  loadBrowserKeywordFile();
  loadAppRules();
  loadAppIgnore();
  store = createStore(dataDir(), { onRecovery: reportRecovery });
  sessionManager = createSessionManager({
    dataDir: dataDir(),
    getSettings: () => store.getSettings(),
    onRecovery: reportRecovery
  });

  focusProfiles = createFocusProfiles({ dataDir: dataDir(), rules: rulesHolder.rules, ignore: ignoreHolder.ignore,
    defaults: require('./default-focus-profiles.json'),
    onChange: applyFocusProfile, onRecovery: reportRecovery });
  applyFocusProfile(focusProfiles.active());

  // Force real tracking on Windows/macOS unless user opted into demo
  if ((process.platform === 'win32' || process.platform === 'darwin') && process.env.SYDTRACK_DEMO == null) {
    const s = store.getSettings();
    if (s.demoMode) {
      store.updateSettings({ demoMode: false });
    }
  }
}

function syncStartupPreference(settings) {
  try {
    return syncLoginItem(app, settings && settings.launchAtStartup !== false, {
      platform: process.platform,
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      env: process.env
    });
  } catch (err) {
    console.warn('[startup] could not update login item:', err && err.message ? err.message : err);
    return { supported: false, enabled: false };
  }
}

function applyFocusProfile(profile) {
  const signature = JSON.stringify(profile);
  if (signature === appliedProfile) return;
  appliedProfile = signature;
  rulesHolder.rules = attachAppIdentities({ productive: profile.productive, unproductive: profile.unproductive });
  ignoreHolder.ignore = profile.ignore;
  rulesFilePath = ignoreFilePath = focusProfiles.filePath;
  rulesIsCustom = ignoreIsCustom = true;
  if (tracker) tracker.invalidateClassification();
  if (sessionManager) sessionManager.resetClassification();
}

function ensureTrackerStarted() {
  if (tracker) {
    tracker.start(); // idempotent inside tracker
    return;
  }
  if (!store) startServices();
  tracker = createTracker({
    store,
    rulesHolder,
    ignoreHolder,
    sessionManager,
    onTick: (payload) => {
      lastPayload = payload;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tracker:update', payload);
      }
      if (appTray && typeof appTray.refresh === 'function') {
        appTray.refresh();
      }
    },
    onReminder: fireReminder,
    readIdleTime: () => {
      try { return powerMonitor.getSystemIdleTime(); }
      catch (_) { return null; }
    }
  });
  bindTrackingLifecycle(powerMonitor, tracker);
  tracker.start();
}

function sendTrackerUpdateToRenderer(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tracker:update', payload);
  }
}

function createTray() {
  if (appTray) return appTray;
  appTray = createAppTray({
    getMainWindow: () => mainWindow,
    getStore: () => store,
    getSessionManager: () => sessionManager,
    getLastPayload: () => lastPayload,
    sendTrackerUpdate: (payload) => {
      lastPayload = Object.assign({}, lastPayload, payload || {});
      sendTrackerUpdateToRenderer(lastPayload);
    },
    onQuit: () => {
      isQuitting = true;
      if (tracker) {
        try { tracker.stop(); } catch (_) {}
      }
      app.quit();
    }
  });
  return appTray;
}

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) {
  console.log('[sydtrack] Another copy is already running. Quit it from the tray before starting this build.');
  app.quit();
}
app.on('second-instance', (_event, argv) => {
  if (Array.isArray(argv) && argv.includes(HIDDEN_ARG)) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!ownsInstance) return;
  errorLog = createErrorLog(dataDir());
  installErrorLogging(errorLog);
  installAppProtocol();
  startServices();
  syncStartupPreference(store.getSettings());
  createWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}).catch((err) => {
  console.error('[startup] failed', err);
  dialog.showErrorBox('SydTrack could not start', `Local data could not be loaded safely. Check file access and available disk space before restarting.\n\n${err.message}`);
  app.quit();
});

app.on('window-all-closed', () => {
  // Keep running in tray; only stop tracker / quit when explicitly quitting.
  if (isQuitting || !appTray) {
    if (tracker) tracker.stop();
    if (process.platform !== 'darwin') app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

ipcMain.handle('state:get', async (event, payload) => {
  guardIpc(event, 'state:get', payload);
  return {
    now: lastPayload.now || null,
    lastFocused: lastPayload.lastFocused || (tracker && tracker.getLastFocused && tracker.getLastFocused()) || null,
    stats: store ? store.snapshot([], { includeWeek: false }) : lastPayload.stats,
    session: sessionManager ? sessionManager.getActiveSession() : lastPayload.session || null,
    platform: process.platform
  };
});

ipcMain.handle('apps:correctActivityToday', async (event, payload) => {
  const { id, category } = guardIpc(event, 'apps:correctActivityToday', payload);
  const stats = store.correctActivityToday(id, category);
  if (tracker) tracker.invalidateClassification();
  if (sessionManager) sessionManager.resetClassification();
  return stats;
});

ipcMain.handle('apps:correctToday', async (event, payload) => {
  const { name, category } = guardIpc(event, 'apps:correctToday', payload);
  const stats = store.correctAppToday(name, category);
  if (tracker) tracker.invalidateClassification();
  if (sessionManager) sessionManager.resetClassification();
  return stats;
});

ipcMain.handle('history:summary', async (event, payload) => {
  const days = guardIpc(event, 'history:summary', payload);
  return store ? store.historySummary(days) : [];
});

ipcMain.handle('rules:get', async (event, payload) => {
  guardIpc(event, 'rules:get', payload);
  return rulesPayload();
});

ipcMain.handle('rules:set', async (event, payload) => {
  const next = guardIpc(event, 'rules:set', payload);
  assertActiveProfile(next.profileId);
  validateSiteTags(next);
  focusProfiles.save(focusProfiles.snapshot().activeId, { productive: next.productive, unproductive: next.unproductive });
  return rulesPayload();
});

ipcMain.handle('rules:reset', async (event, payload) => {
  const profileId = guardIpc(event, 'rules:reset', payload);
  assertActiveProfile(profileId);
  const defaults = loadRulesFrom(DEFAULT_RULES_PATH);
  focusProfiles.save(focusProfiles.snapshot().activeId, { productive: defaults.productive, unproductive: defaults.unproductive });
  return rulesPayload();
});

ipcMain.handle('ignore:get', async (event, payload) => {
  guardIpc(event, 'ignore:get', payload);
  return ignorePayload();
});

ipcMain.handle('ignore:set', async (event, payload) => {
  const next = guardIpc(event, 'ignore:set', payload);
  assertActiveProfile(next.profileId);
  focusProfiles.save(focusProfiles.snapshot().activeId, { ignore: next.ignore });
  return ignorePayload();
});

ipcMain.handle('ignore:reset', async (event, payload) => {
  const profileId = guardIpc(event, 'ignore:reset', payload);
  assertActiveProfile(profileId);
  focusProfiles.save(focusProfiles.snapshot().activeId, { ignore: loadIgnoreFrom(DEFAULT_IGNORE_PATH) });
  return ignorePayload();
});

ipcMain.handle('keywords:get', async (event, payload) => {
  guardIpc(event, 'keywords:get', payload);
  return browserKeywordsHolder.keywords || defaultBrowserKeywords();
});

ipcMain.handle('keywords:set', async (event, payload) => {
  const next = guardIpc(event, 'keywords:set', payload);
  browserKeywordsHolder.keywords = saveBrowserKeywords(userBrowserKeywordsPath(), next);
  if (rulesHolder.rules) rulesHolder.rules.browserKeywords = browserKeywordsHolder.keywords;
  if (tracker) tracker.invalidateClassification();
  return browserKeywordsHolder.keywords;
});

ipcMain.handle('keywords:reset', async (event, payload) => {
  guardIpc(event, 'keywords:reset', payload);
  browserKeywordsHolder.keywords = saveBrowserKeywords(userBrowserKeywordsPath(), defaultBrowserKeywords());
  if (rulesHolder.rules) rulesHolder.rules.browserKeywords = browserKeywordsHolder.keywords;
  if (tracker) tracker.invalidateClassification();
  return browserKeywordsHolder.keywords;
});

function assertActiveProfile(id) {
  if (id != null && id !== focusProfiles.snapshot().activeId) throw new Error('Focus profile changed. Reload tags before saving.');
}

ipcMain.handle('profiles:get', async (event, payload) => {
  guardIpc(event, 'profiles:get', payload);
  return focusProfiles.snapshot();
});
ipcMain.handle('profiles:save', async (event, payload) => {
  const { id, fields } = guardIpc(event, 'profiles:save', payload);
  return focusProfiles.save(id, fields);
});
ipcMain.handle('profiles:activate', async (event, payload) => {
  const id = guardIpc(event, 'profiles:activate', payload);
  return focusProfiles.activate(id);
});
ipcMain.handle('profiles:delete', async (event, payload) => {
  const id = guardIpc(event, 'profiles:delete', payload);
  return focusProfiles.remove(id);
});

ipcMain.handle('settings:update', async (event, payload) => {
  const partial = guardIpc(event, 'settings:update', payload);
  if (!store) return {};
  return applySettings(partial);
});

function applySettings(partial) {
  const next = updateAppSettings(store, sessionManager, partial, () => {
    if (appTray && typeof appTray.refresh === 'function') appTray.refresh();
    if (partial && partial.theme && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(windowBackgroundColor(partial.theme));
    }
  });
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'launchAtStartup')) {
    syncStartupPreference(next);
  }
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'pollMs') && tracker && typeof tracker.refreshCadence === 'function') {
    tracker.refreshCadence();
  }
  return next;
}

ipcMain.handle('data:export', async (event, payload) => {
  const options = guardIpc(event, 'data:export', payload);
  if (!store || !mainWindow) return { ok: false, error: 'not ready' };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export SydTrack backup',
    defaultPath: `sydtrack-backup-${new Date().toISOString().slice(0, 10)}.sydtrack`,
    filters: [
      { name: 'SydTrack backup', extensions: ['sydtrack', 'json'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  const exportData = buildExport(store, {
    includeSettings: options.includeSettings !== false,
    includeRules: options.includeRules !== false,
    includeIgnore: options.includeIgnore !== false,
    rules: rulesHolder.rules,
    ignore: ignoreHolder.ignore,
    sessionManager,
    identities: identitiesHolder.identities,
    focusProfiles,
    browserKeywords: browserKeywordsHolder.keywords
  });
  writeBackupFile(result.filePath, exportData);
  return { ok: true, path: result.filePath };
});

ipcMain.handle('data:exportCsv', async (event, payload) => {
  guardIpc(event, 'data:exportCsv', payload);
  if (!store || !mainWindow) return { ok: false, error: 'not ready' };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export SydTrack CSV',
    defaultPath: `sydtrack-export-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [
      { name: 'CSV', extensions: ['csv'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const csv = buildCsvExport(store, {
    includeSettings: true,
    rules: rulesHolder.rules,
    ignore: ignoreHolder.ignore,
    sessionManager,
    focusProfiles
  });
  fs.mkdirSync(path.dirname(result.filePath), { recursive: true });
  fs.writeFileSync(result.filePath, csv, 'utf8');
  return { ok: true, path: result.filePath };
});

ipcMain.handle('data:import', async (event, payload) => {
  const options = guardIpc(event, 'data:import', payload);
  if (!store || !mainWindow) return { ok: false, error: 'not ready' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import SydTrack backup',
    properties: ['openFile'],
    filters: [
      { name: 'SydTrack backup', extensions: ['sydtrack', 'json'] },
      { name: 'CSV', extensions: ['csv'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) {
    return { ok: false, canceled: true };
  }

  const chosen = result.filePaths[0];
  try { backupUserConfig(dataDir()); } catch (err) {
    return { ok: false, error: 'Could not back up settings before import: ' + err.message };
  }
  if (chosen.toLowerCase().endsWith('.csv')) {
    try {
      const imported = importCsv(store, fs.readFileSync(chosen, 'utf8'), {
        sessionManager,
        focusProfiles,
        onSettings: applySettings,
        onRules: (rules) => {
          focusProfiles.save('default', { productive: rules.productive, unproductive: rules.unproductive });
        },
        onIgnore: (list) => {
          focusProfiles.save('default', { ignore: list });
        }
      });
      return { ...imported, path: chosen };
    } catch (err) {
      return { ok: false, error: err.message || 'Failed to import CSV' };
    }
  }

  let obj;
  try {
    obj = readBackupFile(chosen);
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to read backup' };
  }

  if (obj.profiles) {
    const confirmation = await dialog.showMessageBox(mainWindow, { type: 'question', buttons: ['Cancel', 'Import backup'], defaultId: 0, cancelId: 0,
      message: 'Replace your Focus profiles with this backup?', detail: 'This restores the saved profile collection and active selection. Activity totals will still be merged.' });
    if (confirmation.response !== 1) return { ok: false, canceled: true };
  }
  const imported = importBackup(store, obj, {
    sessionManager,
    focusProfiles,
    onIdentities: (identities) => {
      identitiesHolder.identities = saveAppIdentities(userAppIdentitiesPath(), identities);
      attachAppIdentities(rulesHolder.rules);
    },
    onBrowserKeywords: (keywords) => {
      browserKeywordsHolder.keywords = saveBrowserKeywords(userBrowserKeywordsPath(), keywords);
      if (rulesHolder.rules) rulesHolder.rules.browserKeywords = browserKeywordsHolder.keywords;
    },
    mode: options.mode === 'replace' ? 'replace' : 'merge',
    onSettings: (next) => {
      if (sessionManager && next) sessionManager.applyHistorySetting(next.sessionHistoryEnabled !== false);
      if (appTray && typeof appTray.refresh === 'function') appTray.refresh();
    },
    onRules: (rules) => {
      if (!obj.profiles) focusProfiles.save('default', { productive: rules.productive, unproductive: rules.unproductive });
    },
    onIgnore: (list) => {
      if (!obj.profiles) focusProfiles.save('default', { ignore: list });
    }
  });
  return { ...imported, path: result.filePaths[0] };
});


ipcMain.handle('profile:export', async (event, payload) => {
  const options = guardIpc(event, 'profile:export', payload);
  if (!mainWindow) return { ok: false, error: 'not ready' };
  const selected = focusProfiles.snapshot().profiles.find(profile => profile.id === options.id) || focusProfiles.active();
  options.name = selected.name;
  const baseName = (typeof options.name === 'string' && options.name.trim())
    ? options.name.trim().replace(/[^\w\-]+/g, '-').replace(/^-|-$/g, '') || 'focus'
    : 'focus';
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Focus profile pack',
    defaultPath: `${baseName}-profile.sydtrack-profile`,
    filters: [
      { name: 'SydTrack profile', extensions: ['sydtrack-profile', 'json'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  const pack = buildProfilePack({
    name: typeof options.name === 'string' ? options.name : undefined,
    productive: selected.productive,
    unproductive: selected.unproductive,
    ignore: selected.ignore
  });
  writeProfilePackFile(result.filePath, pack);
  return { ok: true, path: result.filePath, name: pack.name || null };
});

ipcMain.handle('profile:import', async (event, payload) => {
  guardIpc(event, 'profile:import', payload);
  if (!mainWindow) return { ok: false, error: 'not ready' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Focus profile pack',
    properties: ['openFile'],
    filters: [
      { name: 'SydTrack profile', extensions: ['sydtrack-profile', 'json'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) {
    return { ok: false, canceled: true };
  }

  let pack;
  try {
    pack = readProfilePackFile(result.filePaths[0]);
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to read profile pack' };
  }

  const confirmation = await dialog.showMessageBox(mainWindow, { type: 'question', buttons: ['Cancel', 'Replace tags'], defaultId: 0, cancelId: 0,
    message: `Replace tags in ${focusProfiles.active().name}?`, detail: 'Historical totals will not change.' });
  if (confirmation.response !== 1) return { ok: false, canceled: true };
  focusProfiles.save(focusProfiles.snapshot().activeId, { productive: pack.productive, unproductive: pack.unproductive, ignore: pack.ignore });

  return {
    ok: true,
    path: result.filePaths[0],
    name: pack.name || null,
    productive: pack.productive.length,
    unproductive: pack.unproductive.length,
    ignore: pack.ignore.length,
    rules: rulesPayload(),
    ignoreList: ignorePayload()
  };
});

ipcMain.handle('profiles:import', async (event, payload) => {
  guardIpc(event, 'profiles:import', payload);
  if (focusProfiles.snapshot().profiles.length >= 5) throw new Error('All five slots are used. Delete a profile before importing another.');
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Add Focus profile', properties: ['openFile'], filters: [{ name: 'Focus profile', extensions: ['sydtrack-profile', 'json'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  const pack = readProfilePackFile(result.filePaths[0]);
  return focusProfiles.save(null, { name: pack.name || path.basename(result.filePaths[0], path.extname(result.filePaths[0])).slice(0, 40),
    productive: pack.productive, unproductive: pack.unproductive, ignore: pack.ignore });
});

ipcMain.handle('data:clearToday', async (event, payload) => {
  guardIpc(event, 'data:clearToday', payload);
  if (!store) return { ok: false };
  store.clearToday();
  return { ok: true, stats: store.snapshot() };
});

ipcMain.handle('data:clearAll', async (event, payload) => {
  guardIpc(event, 'data:clearAll', payload);
  if (!store) return { ok: false };
  store.clearAllHistory();
  return { ok: true, stats: store.snapshot() };
});

ipcMain.handle('data:deleteAll', async (event, payload) => {
  guardIpc(event, 'data:deleteAll', payload);
  if (!store) return { ok: false, error: 'not ready' };
  const {
    loadAppIdentitiesFrom,
    saveAppIdentities,
    DEFAULT_APP_IDENTITIES_PATH
  } = require('./classifier');
  const deleted = deleteAllMyData({
    dataDir: dataDir(),
    store,
    sessionManager,
    focusProfiles,
    profileDefaults: require('./default-focus-profiles.json'),
    identitiesPath: userAppIdentitiesPath(),
    defaultIdentities: loadAppIdentitiesFrom(DEFAULT_APP_IDENTITIES_PATH),
    saveIdentities: saveAppIdentities,
    appData: app.getPath('appData')
  });
  loadAppIdentities();
  loadBrowserKeywordFile();
  if (tracker) tracker.invalidateClassification();
  return {
    ...deleted,
    stats: store.snapshot(),
    error: deleted.ok ? undefined : (deleted.failed || []).map((item) => item.path).join(', ') || 'Delete failed'
  };
});

ipcMain.handle('session:start', async (event, payload) => {
  const options = guardIpc(event, 'session:start', payload);
  if (!sessionManager || !store) return null;
  if (options.mode === 'custom' && options.customMin != null) {
    const mins = Number(options.customMin);
    if (Number.isFinite(mins) && mins > 0) {
      store.updateSettings({ sessionCustomMin: Math.min(24 * 60, Math.max(1, Math.round(mins))) });
    }
  }
  return sessionManager.startSession(options);
});

ipcMain.handle('session:stop', async (event, payload) => {
  guardIpc(event, 'session:stop', payload);
  if (!sessionManager) return { ok: false };
  return sessionManager.stopSession();
});

ipcMain.handle('session:getActive', async (event, payload) => {
  guardIpc(event, 'session:getActive', payload);
  if (!sessionManager) return null;
  return sessionManager.getActiveSession();
});

ipcMain.handle('session:getForDay', async (event, payload) => {
  const dateKey = guardIpc(event, 'session:getForDay', payload) || undefined;
  if (!sessionManager) return { date: dateKey, sessions: [], historyEnabled: true };
  const settings = store ? store.getSettings() : {};
  const key = dateKey || undefined;
  return {
    date: key || require('./store').todayKey(),
    sessions: sessionManager.getSessionsForDay(key),
    historyEnabled: settings.sessionHistoryEnabled !== false,
    recentDays: sessionManager.getRecentSessionDays(14),
    mostRecent: sessionManager.getMostRecentSession()
  };
});

ipcMain.handle('session:delete', async (event, payload) => {
  const opts = guardIpc(event, 'session:delete', payload);
  if (!sessionManager) return { ok: false, reason: 'no-manager' };
  return sessionManager.deleteSession(opts.id, opts.dateKey);
});
