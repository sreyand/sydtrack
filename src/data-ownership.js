'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('./json-file');
const { LEGACY_PRODUCT_NAMES } = require('./legacy-data-dir');

function collectFailure(failed, filePath, err) {
  failed.push({ path: filePath, message: err && err.message ? err.message : String(err) });
}

function removePath(filePath, failed) {
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { recursive: true, force: true });
  } catch (err) {
    collectFailure(failed, filePath, err);
  }
}

function removeMatchingFiles(dir, predicate, failed) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(full); } catch (err) {
      collectFailure(failed, full, err);
      continue;
    }
    if (stat.isFile() && predicate(name)) removePath(full, failed);
  }
}

function backupUserConfig(dataDir) {
  if (!dataDir) return null;
  const names = ['settings.json', 'focus-profiles.json', 'rules.json', 'ignore.json'];
  if (!names.some((name) => fs.existsSync(path.join(dataDir, name)))) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dataDir, 'import-backups', `pre-import-${stamp}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of names) {
    const source = path.join(dataDir, name);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(dest, name));
  }
  writeJson(path.join(dest, 'BACKUP_COMPLETE.json'), {
    completedAt: new Date().toISOString(),
    kind: 'pre-import'
  });
  return dest;
}

function legacyDataDirs(appData) {
  if (!appData) return [];
  return LEGACY_PRODUCT_NAMES
    .map((name) => path.join(appData, name))
    .filter((dir, index, all) => fs.existsSync(dir) && all.indexOf(dir) === index);
}

/**
 * Remove locally stored activity, sessions, settings, tags, profiles, logs,
 * migration copies, and leftover focusflow data folders. Reports every path
 * that could not be deleted.
 */
function deleteAllMyData({
  dataDir,
  store,
  sessionManager,
  focusProfiles,
  profileDefaults,
  identitiesPath,
  defaultIdentities,
  saveIdentities,
  appData
}) {
  const failed = [];
  if (sessionManager && typeof sessionManager.eraseAll === 'function') {
    const erased = sessionManager.eraseAll();
    if (erased && Array.isArray(erased.failed)) failed.push(...erased.failed);
  }
  if (store && typeof store.eraseActivityAndSettings === 'function') {
    const erased = store.eraseActivityAndSettings();
    if (erased && Array.isArray(erased.failed)) failed.push(...erased.failed);
  }
  for (const name of ['rules.json', 'ignore.json']) removePath(path.join(dataDir, name), failed);
  for (const dir of [dataDir, path.join(dataDir, 'history'), path.join(dataDir, 'sessions'), path.join(dataDir, 'logs')]) {
    removeMatchingFiles(dir, (name) => name.includes('.recovery-'), failed);
  }
  removePath(path.join(dataDir, 'logs'), failed);
  removePath(path.join(dataDir, 'migration-backups'), failed);
  removePath(path.join(dataDir, 'import-backups'), failed);
  removePath(path.join(dataDir, '.legacy-import'), failed);
  for (const dir of legacyDataDirs(appData)) {
    if (path.resolve(dir) === path.resolve(dataDir)) continue;
    removePath(dir, failed);
  }
  try {
    if (focusProfiles && profileDefaults && typeof focusProfiles.resetBundled === 'function') {
      focusProfiles.resetBundled(profileDefaults);
    }
    // TODO(#18): after erase-all, re-run goal migration so bundled goals are restored.
  } catch (err) {
    collectFailure(failed, focusProfiles && focusProfiles.filePath || path.join(dataDir, 'focus-profiles.json'), err);
  }
  try {
    if (saveIdentities && identitiesPath && defaultIdentities) saveIdentities(identitiesPath, defaultIdentities);
  } catch (err) {
    collectFailure(failed, identitiesPath, err);
  }
  return { ok: failed.length === 0, failed };
}

module.exports = { deleteAllMyData, backupUserConfig, legacyDataDirs };
