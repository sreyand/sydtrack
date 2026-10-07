'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, defaultSettings } = require('../src/store');
const { WINDOW_SHORTCUTS } = require('../src/window-shortcut');
const { THEME_IDS } = require('../src/theme');
const { initializeThemeRotation, resolveDailyTheme } = require('../src/theme-rotation');
const { validateIpcPayload } = require('../src/ipc-validate');
const { buildExport, importBackup } = require('../src/backup');
const { buildCsvExport, importCsv } = require('../src/data-export');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-desktop-preferences-'));
function directory(name) {
  const target = path.join(temporaryRoot, name);
  fs.mkdirSync(target, { recursive: true });
  return target;
}
function preferences(settings) {
  return Object.fromEntries(['theme', 'windowShortcut', 'themeRotationEnabled', 'themeRotationMode',
    'themeRotationAnchorDate', 'themeRotationAnchorTheme'].map(key => [key, settings[key]]));
}
function copy(value) { return JSON.parse(JSON.stringify(value)); }

try {
  const defaults = {
    theme: 'midnight', windowShortcut: '', themeRotationEnabled: false, themeRotationMode: 'dark',
    themeRotationAnchorDate: '', themeRotationAnchorTheme: ''
  };
  assert.deepEqual(preferences(defaultSettings()), defaults, 'new desktop features are opt-in and keep Midnight');
  const firstRun = createStore(directory('first-run'), { onboardingForNewInstall: true });
  assert.deepEqual(preferences(firstRun.getSettings()), defaults);
  assert.equal(firstRun.getSettings().onboardingComplete, false);
  assert.equal(firstRun.getSettings().trackingPaused, true, 'new preferences do not bypass first-run consent');

  for (const theme of THEME_IDS) {
    const target = directory('legacy-' + theme);
    fs.writeFileSync(path.join(target, 'settings.json'), JSON.stringify({ ...defaultSettings(), theme }));
    assert.deepEqual(preferences(createStore(target).getSettings()), { ...defaults, theme },
      'existing appearance remains selected and does not opt into rotation');
  }
  for (const [value, expected] of [[true, 'midnight'], [false, 'graphite'], ['unknown', 'midnight']]) {
    const store = createStore(directory('legacy-theme-' + String(value)));
    store.updateSettings({ theme: value });
    assert.equal(store.getSettings().theme, expected, 'legacy theme normalization is preserved');
  }

  const invalidDirectory = directory('invalid-preferences');
  fs.writeFileSync(path.join(invalidDirectory, 'settings.json'), JSON.stringify({
    ...defaultSettings(), theme: 'unknown', windowShortcut: 'CommandOrControl+Alt+X',
    themeRotationEnabled: 'true', themeRotationMode: 'Dark',
    themeRotationAnchorDate: '2026-02-29', themeRotationAnchorTheme: 'unknown'
  }));
  const invalidStore = createStore(invalidDirectory);
  assert.deepEqual(preferences(invalidStore.getSettings()), defaults, 'malformed saved desktop preferences are sanitized');
  invalidStore.updateSettings({ notificationsEnabled: false });
  assert.deepEqual(preferences(createStore(invalidDirectory).getSettings()), defaults,
    'sanitized values persist on the next settings save');
  const malformed = [undefined, null, 1, 'true', [], {}];
  for (const value of malformed) {
    const sanitized = invalidStore.updateSettings({ windowShortcut: value, themeRotationEnabled: value,
      themeRotationMode: value, themeRotationAnchorDate: value, themeRotationAnchorTheme: value });
    assert.deepEqual(preferences(sanitized), defaults, 'malformed field types never enable a shortcut or rotation');
  }

  const persistedDirectory = directory('persisted-preferences');
  const persistedStore = createStore(persistedDirectory);
  for (const shortcut of WINDOW_SHORTCUTS) {
    persistedStore.updateSettings(validateIpcPayload('settings:update', { windowShortcut: shortcut }));
    assert.equal(createStore(persistedDirectory).getSettings().windowShortcut, shortcut,
      'supported show/hide shortcut survives restart: ' + shortcut);
  }
  for (const [mode, theme] of [['dark', 'forest'], ['light', 'coral'], ['any', 'tide']]) {
    const current = { ...persistedStore.getSettings(), theme, themeRotationEnabled: true, themeRotationMode: mode };
    persistedStore.updateSettings({ ...current, ...initializeThemeRotation(current, '2026-10-07') });
    assert.deepEqual(preferences(createStore(persistedDirectory).getSettings()), preferences(persistedStore.getSettings()),
      mode + ' cycle and stable local-date anchor survive restart');
  }
  const desired = {
    theme: 'forest', windowShortcut: 'CommandOrControl+Alt+S', themeRotationEnabled: true,
    themeRotationMode: 'dark', themeRotationAnchorDate: '2026-10-07', themeRotationAnchorTheme: 'forest'
  };
  persistedStore.updateSettings(desired);
  persistedStore.updateSettings({ notificationsEnabled: false });
  assert.deepEqual(preferences(createStore(persistedDirectory).getSettings()), desired,
    'unrelated settings edits preserve opted-in desktop preferences');
  persistedStore.addSeconds('Code', 'productive', 120);
  const seededSeconds = persistedStore.snapshot().byCategory.productive;

  const backup = copy(buildExport(persistedStore, { includeSettings: true }));
  assert.deepEqual(preferences(backup.settings), desired, 'JSON backup includes the cycle anchor and shortcut');
  const jsonDirectory = directory('json-roundtrip');
  const jsonStore = createStore(jsonDirectory);
  let importedSettings = null;
  const jsonResult = importBackup(jsonStore, backup, { onSettings: settings => { importedSettings = settings; } });
  assert.equal(jsonResult.ok, true);
  assert.equal(jsonResult.appliedSettings, true);
  assert.deepEqual(preferences(importedSettings), desired);
  assert.deepEqual(preferences(createStore(jsonDirectory).getSettings()), desired, 'JSON preferences survive import and restart');
  assert.equal(jsonStore.snapshot().byCategory.productive, seededSeconds, 'JSON preference restore preserves exported activity');
  assert.deepEqual(resolveDailyTheme(jsonStore.getSettings(), '2026-10-08'), { theme: 'dusk' },
    'JSON restore retains the original anchor rather than starting a new cycle');
  assert.equal(buildExport(persistedStore, { includeSettings: false }).settings, undefined,
    'excluding settings from a backup excludes desktop preferences too');

  const csv = buildCsvExport(persistedStore, { includeSettings: true });
  const csvDirectory = directory('csv-roundtrip');
  const csvStore = createStore(csvDirectory);
  const csvResult = importCsv(csvStore, csv);
  assert.equal(csvResult.ok, true);
  assert.deepEqual(preferences(createStore(csvDirectory).getSettings()), desired, 'CSV preferences survive import and restart');
  assert.equal(csvStore.snapshot().byCategory.productive, seededSeconds, 'CSV preference restore preserves exported activity');
  assert.deepEqual(resolveDailyTheme(csvStore.getSettings(), '2026-10-08'), { theme: 'dusk' },
    'CSV restore retains its stable local-date anchor');
  const csvWithoutSettings = buildCsvExport(persistedStore, { includeSettings: false });
  assert(!csvWithoutSettings.includes('themeRotation') && !csvWithoutSettings.includes('windowShortcut'),
    'excluding settings from CSV excludes the new preferences');
  const malformedBackup = copy(backup);
  malformedBackup.settings = { ...malformedBackup.settings, themeRotationEnabled: 1, themeRotationMode: 'invalid',
    windowShortcut: 'unsupported', themeRotationAnchorDate: '2026-04-31', themeRotationAnchorTheme: 'unsupported' };
  const sanitizedImport = createStore(directory('sanitized-json-import'));
  assert.equal(importBackup(sanitizedImport, malformedBackup).ok, true);
  assert.deepEqual(preferences(sanitizedImport.getSettings()), { ...defaults, theme: 'forest' },
    'JSON restoration sanitizes malformed new preference fields without discarding the chosen appearance');

  const failureDirectory = directory('failed-write');
  const failureStore = createStore(failureDirectory);
  failureStore.updateSettings(desired);
  const settingsPath = path.resolve(failureDirectory, 'settings.json');
  const priorSettings = copy(failureStore.getSettings());
  const priorFile = fs.readFileSync(settingsPath, 'utf8');
  const candidate = { ...priorSettings, theme: 'coral', themeRotationEnabled: false,
    themeRotationMode: 'light', windowShortcut: 'Alt+S', themeRotationAnchorDate: '2026-10-08',
    themeRotationAnchorTheme: 'coral' };
  for (const operation of ['updateSettings', 'applyImportedSettings']) {
    const originalRename = fs.renameSync;
    try {
      fs.renameSync = function renameWithSettingsFailure(from, to) {
        if (path.resolve(to) === settingsPath) throw new Error('Synthetic settings rename failure');
        return originalRename.apply(this, arguments);
      };
      assert.throws(() => failureStore[operation](candidate), /Synthetic settings rename failure/);
    } finally {
      fs.renameSync = originalRename;
    }
    assert.deepEqual(failureStore.getSettings(), priorSettings, operation + ' rolls back its in-memory settings after a failed write');
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), priorFile, operation + ' preserves the durable settings file');
    assert.deepEqual(createStore(failureDirectory).getSettings(), priorSettings, operation + ' remains unchanged on restart');
    assert(!fs.readdirSync(failureDirectory).some(name => /^settings\.json\..*\.tmp$/.test(name)), 'failed atomic write cleans its temporary file');
  }
  failureStore.updateSettings(candidate);
  assert.deepEqual(preferences(createStore(failureDirectory).getSettings()), preferences(candidate),
    'a later successful save still works after failure');

  for (const shortcut of WINDOW_SHORTCUTS) {
    assert.equal(validateIpcPayload('settings:update', { windowShortcut: shortcut }).windowShortcut, shortcut);
  }
  for (const mode of ['dark', 'light', 'any']) {
    assert.deepEqual(validateIpcPayload('settings:update', { themeRotationEnabled: true, themeRotationMode: mode }),
      { themeRotationEnabled: true, themeRotationMode: mode });
  }
  assert.equal(validateIpcPayload('settings:update', { themeRotationEnabled: false }).themeRotationEnabled, false);
  for (const shortcut of [null, true, 1, [], {}, 'Ctrl+Alt+S', 'unsupported']) {
    assert.throws(() => validateIpcPayload('settings:update', { windowShortcut: shortcut }));
  }
  for (const value of [undefined, null, 0, 1, 'true', 'false', [], {}]) {
    assert.throws(() => validateIpcPayload('settings:update', { themeRotationEnabled: value }));
  }
  for (const mode of [undefined, null, true, 1, [], {}, 'Dark', 'all', '']) {
    assert.throws(() => validateIpcPayload('settings:update', { themeRotationMode: mode }));
  }
  for (const [key, value] of [['themeRotationAnchorDate', '2026-10-07'], ['themeRotationAnchorTheme', 'forest']]) {
    assert.throws(() => validateIpcPayload('settings:update', { [key]: value }), 'renderer cannot set private cycle anchors');
    assert.throws(() => validateIpcPayload('settings:update', { themeRotationEnabled: true, [key]: value }),
      'mixed public/private settings payload is rejected atomically');
  }
  console.log('desktop preference checks passed');
} finally {
  const resolvedRoot = path.resolve(temporaryRoot);
  assert.equal(path.dirname(resolvedRoot), path.resolve(os.tmpdir()));
  assert(path.basename(resolvedRoot).startsWith('sydtrack-desktop-preferences-'));
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}
