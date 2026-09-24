'use strict';

const fs = require('fs');
const path = require('path');

function removeMatchingFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(full); } catch (_) { continue; }
    if (stat.isFile() && predicate(name)) fs.unlinkSync(full);
  }
}

/**
 * Remove locally stored activity, sessions, settings, tags, profiles, logs,
 * and migration copies. Safe to retry: each step deletes files or rewrites a
 * known-good default, and a crash leaves the remaining files readable.
 */
function deleteAllMyData({
  dataDir,
  store,
  sessionManager,
  focusProfiles,
  profileDefaults,
  identitiesPath,
  defaultIdentities,
  saveIdentities
}) {
  if (sessionManager && typeof sessionManager.eraseAll === 'function') sessionManager.eraseAll();
  if (store && typeof store.eraseActivityAndSettings === 'function') store.eraseActivityAndSettings();
  for (const name of ['rules.json', 'ignore.json']) {
    const filePath = path.join(dataDir, name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  for (const dir of [dataDir, path.join(dataDir, 'history'), path.join(dataDir, 'sessions'), path.join(dataDir, 'logs')]) {
    removeMatchingFiles(dir, (name) => name.includes('.recovery-'));
  }
  fs.rmSync(path.join(dataDir, 'logs'), { recursive: true, force: true });
  fs.rmSync(path.join(dataDir, 'migration-backups'), { recursive: true, force: true });
  fs.rmSync(path.join(dataDir, '.legacy-import'), { recursive: true, force: true });
  if (focusProfiles && profileDefaults && typeof focusProfiles.resetBundled === 'function') {
    focusProfiles.resetBundled(profileDefaults);
  }
  if (saveIdentities && identitiesPath && defaultIdentities) saveIdentities(identitiesPath, defaultIdentities);
  return { ok: true };
}

module.exports = { deleteAllMyData };
