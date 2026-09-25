'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson, validDateKey } = require('./json-file');
const { writeRollup } = require('./rollups');

const STORAGE_SCHEMA_VERSION = 2;
const SCHEMA_FILE = 'storage-schema.json';

function schemaPath(dataDir) {
  return path.join(dataDir, SCHEMA_FILE);
}

function backupsRoot(dataDir) {
  return path.join(dataDir, 'migration-backups');
}

function readSchema(dataDir) {
  try {
    const value = JSON.parse(fs.readFileSync(schemaPath(dataDir), 'utf8'));
    if (!value || typeof value !== 'object' || !Number.isFinite(Number(value.schemaVersion))) return null;
    return value;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

function hasLegacyPayload(dataDir) {
  const files = ['stats.json', 'settings.json', 'rules.json', 'ignore.json', 'focus-profiles.json', 'active-session.json'];
  if (files.some((name) => fs.existsSync(path.join(dataDir, name)))) return true;
  for (const sub of ['history', 'sessions']) {
    const dir = path.join(dataDir, sub);
    if (!fs.existsSync(dir)) continue;
    if (fs.readdirSync(dir).some((name) => name.endsWith('.json'))) return true;
  }
  return false;
}

function listSchema1BackupDirs(dataDir) {
  const root = backupsRoot(dataDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((name) => name.startsWith('schema-1-'))
    .map((name) => path.join(root, name))
    .filter((dir) => {
      try { return fs.statSync(dir).isDirectory(); } catch (_) { return false; }
    });
}

/** Folders without BACKUP_COMPLETE.json are leftover copies, not backups. */
function cleanupIncompleteBackups(dataDir) {
  const removed = [];
  for (const dir of listSchema1BackupDirs(dataDir)) {
    if (fs.existsSync(path.join(dir, 'BACKUP_COMPLETE.json'))) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  return removed;
}

/**
 * After schema 2 is on disk and rollups exist, delete the schema-1 copy.
 * Keeping it would retain raw history past 90 days in a second tree.
 */
function pruneVerifiedMigrationBackups(dataDir) {
  const removed = [];
  for (const dir of listSchema1BackupDirs(dataDir)) {
    if (!fs.existsSync(path.join(dir, 'BACKUP_COMPLETE.json'))) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  return removed;
}

/**
 * Copy the data directory before rewriting it. BACKUP_COMPLETE.json is written
 * last, so a crash mid-copy leaves an incomplete directory that the next
 * attempt does not treat as the backup.
 */
function backupLegacyData(dataDir) {
  cleanupIncompleteBackups(dataDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupsRoot(dataDir), `schema-1-${stamp}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(dataDir)) {
    if (name === 'migration-backups') continue;
    fs.cpSync(path.join(dataDir, name), path.join(dest, name), { recursive: true });
  }
  writeJson(path.join(dest, 'BACKUP_COMPLETE.json'), {
    completedAt: new Date().toISOString(),
    schemaFrom: 1,
    schemaTo: STORAGE_SCHEMA_VERSION
  });
  return dest;
}

function rollupExistingHistory(dataDir, buildRollup) {
  const historyDir = path.join(dataDir, 'history');
  const rollupDir = path.join(dataDir, 'rollups');
  if (!fs.existsSync(historyDir)) return [];
  const failed = [];
  for (const name of fs.readdirSync(historyDir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
    const date = name.replace(/\.json$/, '');
    if (!validDateKey(date)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(historyDir, name), 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('history day is not an object');
      raw.date = date;
      writeRollup(rollupDir, buildRollup(raw));
    } catch (err) {
      failed.push(date);
      console.error('[storage] left unreadable history in place', date, err.message);
    }
  }
  return failed;
}

/**
 * Schema 1 is the original per-day history with no version file.
 * Schema 2 adds storage-schema.json and compact rollups. A failed backup
 * skips migration and purge for this launch so the app still starts.
 */
function migrateStorage(dataDir, { buildRollup }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const current = readSchema(dataDir);
  if (current && Number(current.schemaVersion) >= STORAGE_SCHEMA_VERSION) {
    cleanupIncompleteBackups(dataDir);
    pruneVerifiedMigrationBackups(dataDir);
    return { migrated: false, skipped: false, schemaVersion: Number(current.schemaVersion), backupPath: null };
  }
  cleanupIncompleteBackups(dataDir);
  const legacy = hasLegacyPayload(dataDir);
  let backupPath = null;
  if (legacy) {
    try {
      backupPath = backupLegacyData(dataDir);
    } catch (err) {
      console.error('[storage] migration backup failed; skipping migration and purge this launch', err.message);
      cleanupIncompleteBackups(dataDir);
      return { migrated: false, skipped: true, schemaVersion: 1, backupPath: null, error: err.message };
    }
  }
  const failed = legacy ? rollupExistingHistory(dataDir, buildRollup) : [];
  const schema = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    product: 'sydtrack',
    rawRetentionDays: 90,
    migratedAt: new Date().toISOString(),
    backup: backupPath ? path.basename(backupPath) : null
  };
  writeJson(schemaPath(dataDir), schema);
  pruneVerifiedMigrationBackups(dataDir);
  return { migrated: true, skipped: false, schemaVersion: STORAGE_SCHEMA_VERSION, backupPath, failed };
}

module.exports = {
  STORAGE_SCHEMA_VERSION,
  SCHEMA_FILE,
  readSchema,
  hasLegacyPayload,
  backupLegacyData,
  migrateStorage,
  cleanupIncompleteBackups,
  pruneVerifiedMigrationBackups
};
