'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, defaultSettings } = require('../src/store');
const { validateIpcPayload } = require('../src/ipc-validate');
const { buildExport, importBackup } = require('../src/backup');
const { buildCsvExport, importCsv } = require('../src/data-export');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-ui-motion-settings-'));
function directory(name) {
  const target = path.join(temporaryRoot, name);
  fs.mkdirSync(target, { recursive: true });
  return target;
}
function copy(value) { return JSON.parse(JSON.stringify(value)); }

try {
  assert.equal(defaultSettings().uiMotionEnabled, false, 'UI motion is opt-in');
  const firstRun = createStore(directory('first-run'), { onboardingForNewInstall: true });
  assert.equal(firstRun.getSettings().uiMotionEnabled, false);
  assert.equal(firstRun.getSettings().onboardingComplete, false);
  assert.equal(firstRun.getSettings().trackingPaused, true, 'the appearance preference does not bypass consent');

  const legacyDirectory = directory('legacy');
  const legacySettings = { ...defaultSettings(), theme: 'forest' };
  delete legacySettings.uiMotionEnabled;
  fs.writeFileSync(path.join(legacyDirectory, 'settings.json'), JSON.stringify(legacySettings));
  const legacyStore = createStore(legacyDirectory);
  assert.equal(legacyStore.getSettings().uiMotionEnabled, false, 'older installations keep instant interactions');
  assert.equal(legacyStore.getSettings().theme, 'forest', 'adding UI motion does not change the chosen appearance');

  const malformed = [undefined, null, 0, 1, 'true', 'false', [], {}];
  for (const [index, value] of malformed.entries()) {
    const target = directory('malformed-' + index);
    fs.writeFileSync(path.join(target, 'settings.json'), JSON.stringify({ ...legacySettings, uiMotionEnabled: value }));
    const store = createStore(target);
    assert.equal(store.getSettings().uiMotionEnabled, false, 'only a literal saved true enables UI motion');
    store.updateSettings({ uiMotionEnabled: true });
    assert.equal(store.updateSettings({ uiMotionEnabled: value }).uiMotionEnabled, false,
      'direct updates also normalize malformed values to off');
    assert.equal(createStore(target).getSettings().uiMotionEnabled, false, 'normalized values persist');
  }

  const persistedDirectory = directory('persisted');
  const store = createStore(persistedDirectory);
  for (const enabled of [true, false, true]) {
    assert.deepEqual(validateIpcPayload('settings:update', { uiMotionEnabled: enabled }), { uiMotionEnabled: enabled });
    store.updateSettings(validateIpcPayload('settings:update', { uiMotionEnabled: enabled }));
    assert.equal(createStore(persistedDirectory).getSettings().uiMotionEnabled, enabled,
      'both enabled and disabled states survive a restart');
  }
  store.updateSettings({ theme: 'graphite', notificationsEnabled: false });
  assert.equal(createStore(persistedDirectory).getSettings().uiMotionEnabled, true,
    'theme changes and unrelated preferences preserve the saved motion choice');
  for (const value of malformed) {
    assert.throws(() => validateIpcPayload('settings:update', { uiMotionEnabled: value }),
      'renderer IPC refuses non-boolean motion values');
    assert.throws(() => validateIpcPayload('settings:update', { uiMotionEnabled: value, notificationsEnabled: true }),
      'a mixed payload with an invalid motion value is rejected atomically');
  }

  store.addSeconds('Code', 'productive', 120);
  const seededSeconds = store.snapshot().byCategory.productive;
  for (const enabled of [true, false]) {
    store.updateSettings({ uiMotionEnabled: enabled });
    const json = copy(buildExport(store, { includeSettings: true }));
    assert.equal(json.settings.uiMotionEnabled, enabled, 'JSON backups retain the motion choice');
    const jsonDirectory = directory('json-' + enabled);
    const jsonStore = createStore(jsonDirectory);
    jsonStore.updateSettings({ uiMotionEnabled: !enabled });
    const jsonResult = importBackup(jsonStore, json);
    assert.equal(jsonResult.ok, true);
    assert.equal(jsonResult.appliedSettings, true);
    assert.equal(createStore(jsonDirectory).getSettings().uiMotionEnabled, enabled,
      'JSON restores both enabled and disabled motion through the normal settings path');
    assert.equal(jsonStore.snapshot().byCategory.productive, seededSeconds, 'JSON restores preserve activity');

    const csv = buildCsvExport(store, { includeSettings: true });
    const csvDirectory = directory('csv-' + enabled);
    const csvStore = createStore(csvDirectory);
    csvStore.updateSettings({ uiMotionEnabled: !enabled });
    assert.equal(importCsv(csvStore, csv).ok, true);
    assert.equal(createStore(csvDirectory).getSettings().uiMotionEnabled, enabled,
      'CSV restores both enabled and disabled motion through the normal settings path');
    assert.equal(csvStore.snapshot().byCategory.productive, seededSeconds, 'CSV restores preserve activity');
  }
  assert.equal(buildExport(store, { includeSettings: false }).settings, undefined,
    'activity-only JSON exports exclude appearance settings');
  assert(!buildCsvExport(store, { includeSettings: false }).includes('uiMotionEnabled'),
    'activity-only CSV exports exclude appearance settings');

  const malformedBackup = copy(buildExport(store, { includeSettings: true }));
  malformedBackup.settings.uiMotionEnabled = 'true';
  const imported = createStore(directory('malformed-import'));
  imported.updateSettings({ uiMotionEnabled: true });
  assert.equal(importBackup(imported, malformedBackup).ok, true);
  assert.equal(imported.getSettings().uiMotionEnabled, false, 'malformed imported motion never opts the user in');

  const rollbackDirectory = directory('write-failure');
  const rollbackStore = createStore(rollbackDirectory);
  rollbackStore.updateSettings({ uiMotionEnabled: true });
  const settingsPath = path.resolve(rollbackDirectory, 'settings.json');
  const previous = copy(rollbackStore.getSettings());
  const previousFile = fs.readFileSync(settingsPath, 'utf8');
  for (const operation of ['updateSettings', 'applyImportedSettings']) {
    const originalRename = fs.renameSync;
    try {
      fs.renameSync = function renameWithSyntheticFailure(from, to) {
        if (path.resolve(to) === settingsPath) throw new Error('Synthetic UI motion settings failure');
        return originalRename.apply(this, arguments);
      };
      assert.throws(() => rollbackStore[operation]({ uiMotionEnabled: false }), /Synthetic UI motion settings failure/);
    } finally {
      fs.renameSync = originalRename;
    }
    assert.deepEqual(rollbackStore.getSettings(), previous, operation + ' preserves confirmed motion on failed save');
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), previousFile, operation + ' preserves the durable settings file');
    assert.equal(createStore(rollbackDirectory).getSettings().uiMotionEnabled, true,
      operation + ' does not change the preference after a restart');
  }
  rollbackStore.updateSettings({ uiMotionEnabled: false });
  assert.equal(createStore(rollbackDirectory).getSettings().uiMotionEnabled, false, 'saving still works after a failure');
  rollbackStore.updateSettings({ uiMotionEnabled: true });
  rollbackStore.eraseActivityAndSettings();
  assert.equal(rollbackStore.getSettings().uiMotionEnabled, false, 'a full data reset restores the opt-in default');
  console.log('UI motion settings checks passed');
} finally {
  const resolvedRoot = path.resolve(temporaryRoot);
  assert.equal(path.dirname(resolvedRoot), path.resolve(os.tmpdir()));
  assert(path.basename(resolvedRoot).startsWith('sydtrack-ui-motion-settings-'));
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}
