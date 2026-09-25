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
const { writeJournal, readJournal, replayJournal, purgeOne } = require('../src/retention');
const { writeRollup } = require('../src/rollups');
const { migrateStorage, STORAGE_SCHEMA_VERSION, readSchema, hasLegacyPayload, cleanupIncompleteBackups } = require('../src/storage-schema');
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
  const leftover = fs.existsSync(path.join(dir, 'migration-backups'))
    ? fs.readdirSync(path.join(dir, 'migration-backups')).filter((name) => name.startsWith('schema-1-'))
    : [];
  assert(leftover.length === 0, 'verified migration backup is pruned so raw history is not kept twice');
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
  fs.mkdirSync(path.join(dir, 'migration-backups', 'schema-1-x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'migration-backups', 'schema-1-x', 'stats.json'), '{}');
  const appData = tmp('appdata-erase');
  const legacy = path.join(appData, 'focusflow');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'stats.json'), '{}');
  const deleted = deleteAllMyData({
    dataDir: dir,
    store,
    sessionManager: sessions,
    focusProfiles: profiles,
    profileDefaults: require('../src/default-focus-profiles.json'),
    identitiesPath: path.join(dir, 'app-identities.json'),
    defaultIdentities: loadAppIdentitiesFrom(DEFAULT_APP_IDENTITIES_PATH),
    saveIdentities: saveAppIdentities,
    appData
  });
  assert(deleted.ok && deleted.failed.length === 0, 'delete-all reports success only when every path is gone');
  assert(store.snapshot().byCategory.productive === 0, 'delete-all clears today');
  assert(store.listHistoryDates().length === 0 && store.listRollupDates().length === 0, 'delete-all removes history and rollups');
  assert(sessions.getSessionsForDay(todayKey()).length === 0, 'delete-all removes sessions');
  assert(!fs.existsSync(path.join(dir, 'logs', 'errors.log')), 'delete-all removes local logs');
  assert(!fs.existsSync(path.join(dir, 'migration-backups')), 'delete-all removes migration-backups');
  assert(!fs.existsSync(legacy), 'delete-all removes the leftover focusflow data folder');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(appData, { recursive: true, force: true });
})();

(function csvValidationIsAtomic() {
  const dir = tmp('csv-atomic');
  const store = createStore(dir);
  const header = 'record,date,name,category,seconds,id,status,mode,started_at,ended_at,planned_sec,elapsed_sec,distractions,field,tag,active,value';
  const date = todayKey();
  const invalid = [header, `activity,${date},Code,productive,100,,,,,,,,,,,`, 'profile,,Broken,,,broken,,,,,,,,productive,code,1'].join('\n');
  const first = importCsv(store, invalid, { focusProfiles: createFocusProfiles({ dataDir: dir, rules: { productive: [], unproductive: [] }, ignore: [] }) });
  assert(!first.ok && store.snapshot().byCategory.productive === 0, 'invalid CSV is rejected before any activity is written');
  const second = importCsv(store, invalid, { focusProfiles: createFocusProfiles({ dataDir: dir, rules: { productive: [], unproductive: [] }, ignore: [] }) });
  assert(!second.ok && store.snapshot().byCategory.productive === 0, 'retrying an invalid CSV does not double-count activity');
  const valid = [header, `activity,${date},Code,productive,100,,,,,,,,,,,`].join('\n');
  const ok = importCsv(store, valid, {});
  assert(ok.ok && store.snapshot().byCategory.productive === 100, 'a later valid import writes the activity once');
  assert(ok.backupPath && fs.existsSync(path.join(ok.backupPath, 'BACKUP_COMPLETE.json')), 'import backs up settings before writing');
  fs.rmSync(dir, { recursive: true, force: true });
})();

(function deleteAllReportsFailures() {
  const dir = tmp('erase-fail');
  const store = createStore(dir);
  fs.mkdirSync(path.join(dir, 'migration-backups', 'schema-1-x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'migration-backups', 'schema-1-x', 'stats.json'), '{}');
  const original = fs.rmSync;
  fs.rmSync = (filePath, opts) => {
    if (String(filePath).includes('migration-backups')) throw new Error('locked');
    return original.call(fs, filePath, opts);
  };
  try {
    const deleted = deleteAllMyData({ dataDir: dir, store });
    assert(!deleted.ok && deleted.failed.some((item) => String(item.path).includes('migration-backups')), 'delete-all reports leftover paths instead of ok:true');
  } finally {
    fs.rmSync = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

(function journalIsWrittenBeforeUnlink() {
  const dir = tmp('journal-write');
  const old = daysAgo(MAX_HISTORY_DAYS + 2);
  const day = writeRaw(dir, old, 5);
  const historyDir = path.join(dir, 'history');
  const rollupDir = path.join(dir, 'rollups');
  fs.mkdirSync(rollupDir, { recursive: true });
  const original = fs.unlinkSync;
  let sawJournal = false;
  fs.unlinkSync = (filePath) => {
    if (String(filePath).endsWith(`${old}.json`)) sawJournal = readJournal(dir).includes(old);
    return original.call(fs, filePath);
  };
  try {
    purgeOne(old, { dataDir: dir, historyDir, rollupDir, readRawDay: () => Object.assign(emptyDay(old), day, { date: old }), buildRollup: toRollup });
    assert(sawJournal, 'journal is written before the raw file is unlinked');
  } finally {
    fs.unlinkSync = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

(function journalReplayStandalone() {
  const dir = tmp('replay');
  const old = daysAgo(MAX_HISTORY_DAYS + 3);
  const day = writeRaw(dir, old, 77);
  const historyDir = path.join(dir, 'history');
  const rollupDir = path.join(dir, 'rollups');
  fs.mkdirSync(rollupDir, { recursive: true });
  writeRollup(rollupDir, toRollup(day));
  writeJournal(dir, [old]);
  const readRawDay = (key) => {
    const file = path.join(historyDir, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    return Object.assign(emptyDay(key), JSON.parse(fs.readFileSync(file, 'utf8')), { date: key });
  };
  replayJournal({ dataDir: dir, historyDir, rollupDir, readRawDay, buildRollup: toRollup });
  assert(!fs.existsSync(path.join(historyDir, `${old}.json`)), 'journal replay deletes a raw file that already has a matching rollup');
  assert(!readJournal(dir).includes(old), 'journal replay clears a finished date');
  writeJournal(dir, [old]);
  replayJournal({ dataDir: dir, historyDir, rollupDir, readRawDay, buildRollup: toRollup });
  assert(!readJournal(dir).includes(old), 'crash after unlink and before journal clear is finished by replay');
  fs.rmSync(dir, { recursive: true, force: true });
})();

(function retentionBoundary() {
  const dir = tmp('boundary');
  const keep = daysAgo(90);
  const drop = daysAgo(91);
  writeRaw(dir, keep, 11);
  writeRaw(dir, drop, 22);
  const store = createStore(dir);
  store.pruneOldHistory();
  assert(MAX_HISTORY_DAYS === 90, 'raw retention is 90 days');
  assert(store.listHistoryDates().includes(keep), 'day -90 is kept as raw history');
  assert(!store.listHistoryDates().includes(drop), 'day -91 is purged from raw history');
  assert(store.listRollupDates().includes(drop), 'day -91 survives as a rollup');
  fs.rmSync(dir, { recursive: true, force: true });
})();

(function mismatchedRollupAbortsPurge() {
  const rollups = require('../src/rollups');
  const original = rollups.readRollup;
  rollups.readRollup = (dir, date) => {
    const value = original(dir, date);
    if (!value) return value;
    return Object.assign({}, value, { byCategory: { productive: 1, unproductive: 0, other: 0 } });
  };
  const dir = tmp('mismatch');
  const old = daysAgo(MAX_HISTORY_DAYS + 1);
  writeRaw(dir, old, 50);
  try {
    const store = createStore(dir);
    store.pruneOldHistory();
    assert(fs.existsSync(path.join(dir, 'history', `${old}.json`)), 'a rollup that does not match on read-back aborts the purge');
  } finally {
    rollups.readRollup = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

(function focusflowBothFoldersAndResume() {
  const appData = tmp('both');
  const legacy = path.join(appData, 'focusflow');
  const target = path.join(appData, 'sydtrack');
  fs.mkdirSync(legacy, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'stats.json'), JSON.stringify({ date: '2026-01-01', source: 'legacy' }));
  fs.writeFileSync(path.join(target, 'stats.json'), JSON.stringify({ date: '2026-02-02', source: 'target' }));
  const both = migrateLegacyUserData(target, { appData });
  assert(!both.migrated && JSON.parse(fs.readFileSync(path.join(target, 'stats.json'), 'utf8')).source === 'target', 'existing sydtrack data is not overwritten when both folders exist');
  const resumeRoot = tmp('resume');
  const resumeLegacy = path.join(resumeRoot, 'focusflow');
  const resumeTarget = path.join(resumeRoot, 'sydtrack');
  fs.mkdirSync(resumeLegacy, { recursive: true });
  fs.writeFileSync(path.join(resumeLegacy, 'stats.json'), JSON.stringify({ date: '2026-03-03' }));
  const stage = path.join(resumeTarget, '.legacy-import');
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, 'stats.json'), JSON.stringify({ date: '2026-03-03', resumed: true }));
  fs.writeFileSync(path.join(stage, 'COPY_COMPLETE.json'), JSON.stringify({ completedAt: new Date().toISOString() }));
  const resumed = migrateLegacyUserData(resumeTarget, { appData: resumeRoot });
  assert(resumed.migrated && resumed.resumed && JSON.parse(fs.readFileSync(path.join(resumeTarget, 'stats.json'), 'utf8')).resumed, 'an interrupted copy resumes from COPY_COMPLETE');
  fs.rmSync(appData, { recursive: true, force: true });
  fs.rmSync(resumeRoot, { recursive: true, force: true });
})();

(function incompleteBackupRetry() {
  const dir = tmp('incomplete');
  writeRaw(dir, daysAgo(2), 8);
  const incomplete = path.join(dir, 'migration-backups', 'schema-1-incomplete');
  fs.mkdirSync(incomplete, { recursive: true });
  fs.writeFileSync(path.join(incomplete, 'stats.json'), '{}');
  fs.mkdirSync(incomplete, { recursive: true });
  fs.writeFileSync(path.join(incomplete, 'stats.json'), '{}');
  createStore(dir);
  assert(!fs.existsSync(incomplete), 'migration retry removes an incomplete schema-1 backup folder');
  fs.rmSync(dir, { recursive: true, force: true });
})();

(function failedBackupSkipsPurge() {
  const dir = tmp('skip-backup');
  const old = daysAgo(MAX_HISTORY_DAYS + 2);
  writeRaw(dir, old, 9);
  const original = fs.cpSync;
  fs.cpSync = () => { throw new Error('disk full'); };
  try {
    const store = createStore(dir);
    assert(store.migration && store.migration.skipped, 'a failed backup skips migration');
    assert(!readSchema(dir), 'schema 1 stays in place when the backup fails');
    assert(fs.existsSync(path.join(dir, 'history', `${old}.json`)), 'purge does not run after a failed backup');
  } finally {
    fs.cpSync = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

console.log(failed ? `\n${failed} storage checks failed` : '\nall storage checks passed');
process.exitCode = failed ? 1 : 0;
