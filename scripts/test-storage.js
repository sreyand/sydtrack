'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createStore,
  todayKey,
  emptyDay,
  MAX_HISTORY_DAYS,
  retentionCutoffKey,
  toRollup
} = require('../src/store');
const { buildRollup, totalsMatch, readRollup } = require('../src/rollups');
const { writeJournal, readJournal, replayJournal } = require('../src/retention');
const { migrateStorage, STORAGE_SCHEMA_VERSION, readSchema, hasLegacyPayload } = require('../src/storage-schema');
const { migrateLegacyUserData, MIGRATION_MARKER } = require('../src/legacy-data-dir');
const { buildExport, importBackup } = require('../src/backup');
const { buildCsvExport, importCsv } = require('../src/data-export');
const { deleteAllMyData } = require('../src/data-ownership');
const { createSessionManager } = require('../src/sessions');
const { createFocusProfiles } = require('../src/focus-profiles');
const { writeDataset } = require('./generate-activity');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else console.log('ok  ', msg);
}

function tmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sydtrack-${name}-`));
}

function writeRaw(dir, date, productive) {
  const history = path.join(dir, 'history');
  fs.mkdirSync(history, { recursive: true });
  const day = emptyDay(date);
  day.byApp['Code::productive'] = { seconds: productive, category: 'productive' };
  day.byCategory.productive = productive;
  day.byHour[10].productive = productive;
  day.byHour[10].byApp['Code::productive'] = { seconds: productive, category: 'productive' };
  fs.writeFileSync(path.join(history, `${date}.json`), JSON.stringify(day));
  return day;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayKey(d.getTime());
}

(function rollupTests() {
  const day = emptyDay('2026-01-15');
  day.byApp['Code::productive'] = { seconds: 120, category: 'productive' };
  day.byApp['@activity:["Chrome","unproductive","youtube","unproductive"]'] = { seconds: 40, category: 'unproductive' };
  day.byCategory.productive = 120;
  day.byCategory.unproductive = 40;
  day.byHour[9].productive = 120;
  const rollup = toRollup(day);
  assert(rollup.schemaVersion === 1 && rollup.date === '2026-01-15', 'rollup schema and date');
  assert(rollup.byCategory.productive === 120 && rollup.byCategory.unproductive === 40, 'rollup copies category totals');
  assert(rollup.apps.some((a) => a.name === 'Code' && a.seconds === 120), 'rollup keeps app totals');
  assert(rollup.apps.some((a) => a.name === 'Chrome' && a.category === 'unproductive'), 'rollup keeps browser category');
  assert(totalsMatch(day, rollup), 'rollup totals match the raw day');
})();

(function purgeAndJournal() {
  const dir = tmp('purge');
  const old = daysAgo(MAX_HISTORY_DAYS + 5);
  const kept = daysAgo(3);
  writeRaw(dir, old, 500);
  writeRaw(dir, kept, 80);
  const store = createStore(dir);
  store.pruneOldHistory();
  assert(!store.listHistoryDates().includes(old), 'raw file older than 90 days is purged');
  assert(store.listHistoryDates().includes(kept), 'raw file inside 90 days is kept');
  assert(store.listRollupDates().includes(old), 'purged day keeps a rollup');
  const loaded = store.loadHistoryDay(old);
  assert(loaded && loaded.byCategory.productive === 500, 'purged day is readable from its rollup');
  assert(store.allDaysMap()[old].byCategory.productive === 500, 'export map includes rollup-only days');
  fs.rmSync(dir, { recursive: true, force: true });
})();

(function crashDuringPurge() {
  const dir = tmp('crash-purge');
  const old = daysAgo(MAX_HISTORY_DAYS + 8);
  const day = writeRaw(dir, old, 321);
  const historyDir = path.join(dir, 'history');
  const rollupDir = path.join(dir, 'rollups');
  fs.mkdirSync(rollupDir, { recursive: true });
  const { writeRollup } = require('../src/rollups');
  writeRollup(rollupDir, toRollup(day));
  writeJournal(dir, [old]);
  assert(fs.existsSync(path.join(historyDir, `${old}.json`)), 'raw file still present after a crash mid-purge');
  const store = createStore(dir);
  store.pruneOldHistory();
  assert(!fs.existsSync(path.join(historyDir, `${old}.json`)), 'restart finishes the journaled unlink');
  assert(readRollup(rollupDir, old).byCategory.productive === 321, 'verified rollup survives the crash');
  assert(!readJournal(dir).includes(old), 'journal entry is cleared after replay');
  fs.rmSync(dir, { recursive: true, force: true });
})();

(function failedRollupKeepsRaw() {
  const dir = tmp('keep-raw');
  const old = daysAgo(MAX_HISTORY_DAYS + 4);
  fs.mkdirSync(path.join(dir, 'history'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'history', `${old}.json`), '{not-json');
  const store = createStore(dir);
  const result = store.pruneOldHistory();
  assert(fs.existsSync(path.join(dir, 'history', `${old}.json`)), 'unreadable raw day is not deleted');
  assert(result.errors.some((e) => e.date === old), 'failed purge is reported');
  fs.rmSync(dir, { recursive: true, force: true });
})();

(function schemaMigration() {
  const dir = tmp('schema');
  writeRaw(dir, daysAgo(2), 44);
  fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(emptyDay(todayKey())));
  assert(hasLegacyPayload(dir) && !readSchema(dir), 'schema 1 data has no version file');
  const store = createStore(dir);
  const schema = readSchema(dir);
  assert(schema && schema.schemaVersion === STORAGE_SCHEMA_VERSION, 'createStore writes schema 2');
  const backups = fs.readdirSync(path.join(dir, 'migration-backups'));
  assert(backups.length === 1, 'migration copies the previous data directory');
  assert(fs.existsSync(path.join(dir, 'migration-backups', backups[0], 'BACKUP_COMPLETE.json')), 'backup marker is written last');
  assert(store.listRollupDates().includes(daysAgo(2)), 'existing history is rolled up during migration');
  const again = migrateStorage(dir, { buildRollup: toRollup });
  assert(again.migrated === false, 'schema 2 is not migrated twice');
  fs.rmSync(dir, { recursive: true, force: true });
})();

(function focusflowDirectory() {
  const appData = tmp('appdata');
  const legacy = path.join(appData, 'focusflow');
  const target = path.join(appData, 'sydtrack');
  fs.mkdirSync(path.join(legacy, 'history'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'stats.json'), JSON.stringify(emptyDay('2026-01-01')));
  const first = migrateLegacyUserData(target, { appData });
  assert(first.migrated && fs.existsSync(path.join(target, 'stats.json')), 'focusflow user-data is copied into sydtrack');
  assert(fs.existsSync(path.join(legacy, MIGRATION_MARKER)), 'old directory keeps a migrated marker');
  fs.writeFileSync(path.join(legacy, 'extra.json'), '{}');
  const second = migrateLegacyUserData(target, { appData });
  assert(!second.migrated, 'already-copied directory is not copied again');
  fs.rmSync(appData, { recursive: true, force: true });
})();

(function fakeActivityAndExport() {
  const dir = tmp('fake');
  const generated = writeDataset(dir, { days: 100, seed: 7, includeToday: true });
  assert(generated.days >= 100, 'generator writes 3+ months of days');
  const store = createStore(dir);
  store.pruneOldHistory();
  assert(store.listHistoryDates().length <= MAX_HISTORY_DAYS, 'generated raw history is capped at 90 days');
  assert(store.listRollupDates().length >= 100 - MAX_HISTORY_DAYS, 'days past the cap survive as rollups');
  const json = buildExport(store, { includeSettings: true });
  assert(json.format === 'sydtrack-backup' && Object.keys(json.days).length >= 90, 'JSON export includes retained days');
  const dest = createStore(tmp('import-json'));
  const imported = importBackup(dest, json, { mode: 'replace' });
  assert(imported.ok && imported.daysImported >= 90, 'JSON import restores exported days');
  const csv = buildCsvExport(store, { includeSettings: true });
  assert(csv.startsWith('record,date,name,category,seconds'), 'CSV export has a stable header');
  const csvDest = createStore(tmp('import-csv'));
  const csvResult = importCsv(csvDest, csv, {});
  assert(csvResult.ok && csvResult.daysImported > 0, 'CSV import restores activity rows');
  const legacy = importBackup(createStore(tmp('legacy-bak')), {
    format: 'focusflow-backup',
    schemaVersion: 1,
    days: { [todayKey()]: emptyDay(todayKey()) }
  }, { mode: 'merge' });
  assert(legacy.ok, 'focusflow-backup files still import');
  fs.rmSync(dir, { recursive: true, force: true });
})();

(function deleteAllLocal() {
  const dir = tmp('erase');
  const store = createStore(dir);
  store.addSeconds('Code', 'productive', 30);
  store.writeHistoryDay(Object.assign(emptyDay(daysAgo(2)), { byCategory: { productive: 9, unproductive: 0, other: 0 } }));
  const sessions = createSessionManager({ dataDir: dir, getSettings: () => store.getSettings() });
  sessions.startSession({ mode: 'pomodoro' });
  sessions.stopSession();
  const profiles = createFocusProfiles({
    dataDir: dir,
    rules: { productive: ['x'], unproductive: [] },
    ignore: [],
    defaults: require('../src/default-focus-profiles.json')
  });
  const { loadAppIdentitiesFrom, saveAppIdentities, DEFAULT_APP_IDENTITIES_PATH } = require('../src/classifier');
  saveAppIdentities(path.join(dir, 'app-identities.json'), loadAppIdentitiesFrom(DEFAULT_APP_IDENTITIES_PATH));
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'logs', 'errors.log'), 'x');
  deleteAllMyData({
    dataDir: dir,
    store,
    sessionManager: sessions,
    focusProfiles: profiles,
    profileDefaults: require('../src/default-focus-profiles.json'),
    identitiesPath: path.join(dir, 'app-identities.json'),
    defaultIdentities: loadAppIdentitiesFrom(DEFAULT_APP_IDENTITIES_PATH),
    saveIdentities: saveAppIdentities
  });
  assert(store.snapshot().byCategory.productive === 0, 'delete-all clears today');
  assert(store.listHistoryDates().length === 0 && store.listRollupDates().length === 0, 'delete-all removes history and rollups');
  assert(sessions.getSessionsForDay(todayKey()).length === 0, 'delete-all removes sessions');
  assert(!fs.existsSync(path.join(dir, 'logs', 'errors.log')), 'delete-all removes local logs');
  fs.rmSync(dir, { recursive: true, force: true });
})();

console.log(failed ? `\n${failed} storage checks failed` : '\nall storage checks passed');
process.exitCode = failed ? 1 : 0;
