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

/**
 * Copy the data directory before rewriting it. BACKUP_COMPLETE.json is written
 * last, so a crash mid-copy leaves an incomplete directory that the next
 * attempt does not treat as the backup.
 */
function backupLegacyData(dataDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dataDir, 'migration-backups', `schema-1-${stamp}`);
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
 * Schema 2 adds storage-schema.json and compact rollups. The schema file is
 * written only after the backup marker and the rollups, so a crash retries.
 */
function migrateStorage(dataDir, { buildRollup }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const current = readSchema(dataDir);
  if (current && Number(current.schemaVersion) >= STORAGE_SCHEMA_VERSION) {
    return { migrated: false, schemaVersion: Number(current.schemaVersion), backupPath: null };
  }
  const legacy = hasLegacyPayload(dataDir);
  const backupPath = legacy ? backupLegacyData(dataDir) : null;
  const failed = legacy ? rollupExistingHistory(dataDir, buildRollup) : [];
  const schema = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    product: 'sydtrack',
    rawRetentionDays: 90,
    migratedAt: new Date().toISOString(),
    backup: backupPath ? path.basename(backupPath) : null
  };
  writeJson(schemaPath(dataDir), schema);
  return { migrated: true, schemaVersion: STORAGE_SCHEMA_VERSION, backupPath, failed };
}

module.exports = {
  STORAGE_SCHEMA_VERSION,
  SCHEMA_FILE,
  readSchema,
  hasLegacyPayload,
  backupLegacyData,
  migrateStorage
};
