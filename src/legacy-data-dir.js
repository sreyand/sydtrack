'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('./json-file');

const LEGACY_PRODUCT_NAMES = ['focusflow', 'FocusFlow'];
const LEGACY_BACKUP_FORMAT = 'focusflow-backup';
const LEGACY_PROFILE_FORMAT = 'focusflow-profile';
const MIGRATION_MARKER = 'migrated-to-sydtrack.json';
const STAGE_DIR = '.legacy-import';

const USER_FILES = [
  'stats.json',
  'settings.json',
  'rules.json',
  'ignore.json',
  'app-identities.json',
  'focus-profiles.json',
  'focus-profiles-seeded-v1.json',
  'active-session.json',
  'storage-schema.json',
  'retention-journal.json'
];
const USER_DIRS = ['history', 'sessions', 'rollups', 'logs', 'migration-backups'];

function hasUserData(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  if (USER_FILES.some((name) => fs.existsSync(path.join(dir, name)))) return true;
  return USER_DIRS.some((name) => {
    const sub = path.join(dir, name);
    return fs.existsSync(sub) && fs.readdirSync(sub).some((entry) => !entry.startsWith('.'));
  });
}

function finishInstall(stage, targetDir) {
  for (const name of fs.readdirSync(stage)) {
    if (name === 'COPY_COMPLETE.json') continue;
    const dest = path.join(targetDir, name);
    if (fs.existsSync(dest)) continue;
    fs.renameSync(path.join(stage, name), dest);
  }
  fs.rmSync(stage, { recursive: true, force: true });
}

function copyUserData(sourceDir, stage) {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const name of USER_FILES) {
    const source = path.join(sourceDir, name);
    if (fs.existsSync(source) && fs.statSync(source).isFile()) fs.cpSync(source, path.join(stage, name));
  }
  for (const name of USER_DIRS) {
    const source = path.join(sourceDir, name);
    if (fs.existsSync(source) && fs.statSync(source).isDirectory()) {
      fs.cpSync(source, path.join(stage, name), { recursive: true });
    }
  }
  writeJson(path.join(stage, 'COPY_COMPLETE.json'), { completedAt: new Date().toISOString() });
}

/**
 * Packaged builds keep user data in the sydtrack user-data directory.
 * The app was previously named focusflow, so an existing sibling directory is
 * copied once. The old directory stays in place as the user's copy.
 * Development data lives in ./data and is not matched.
 */
function migrateLegacyUserData(targetDir, { appData } = {}) {
  if (!targetDir || !appData) return { migrated: false, reason: 'missing-path' };
  if (path.basename(targetDir).toLowerCase() !== 'sydtrack') return { migrated: false, reason: 'not-packaged-name' };
  fs.mkdirSync(targetDir, { recursive: true });
  const stage = path.join(targetDir, STAGE_DIR);
  const legacyDir = LEGACY_PRODUCT_NAMES
    .map((name) => path.join(appData, name))
    .find((dir) => dir !== targetDir && fs.existsSync(dir));

  if (fs.existsSync(path.join(stage, 'COPY_COMPLETE.json'))) {
    finishInstall(stage, targetDir);
    if (legacyDir && !fs.existsSync(path.join(legacyDir, MIGRATION_MARKER))) {
      writeJson(path.join(legacyDir, MIGRATION_MARKER), {
        migratedTo: targetDir,
        migratedAt: new Date().toISOString(),
        product: 'sydtrack'
      });
    }
    return { migrated: true, source: legacyDir || null, resumed: true };
  }

  if (!legacyDir || !hasUserData(legacyDir)) return { migrated: false, reason: 'nothing-to-migrate' };
  if (fs.existsSync(path.join(legacyDir, MIGRATION_MARKER))) return { migrated: false, reason: 'already-migrated' };
  if (hasUserData(targetDir)) return { migrated: false, reason: 'target-has-data' };

  copyUserData(legacyDir, stage);
  finishInstall(stage, targetDir);
  writeJson(path.join(legacyDir, MIGRATION_MARKER), {
    migratedTo: targetDir,
    migratedAt: new Date().toISOString(),
    product: 'sydtrack'
  });
  return { migrated: true, source: legacyDir, resumed: false };
}

module.exports = {
  LEGACY_PRODUCT_NAMES,
  LEGACY_BACKUP_FORMAT,
  LEGACY_PROFILE_FORMAT,
  MIGRATION_MARKER,
  hasUserData,
  migrateLegacyUserData
};
