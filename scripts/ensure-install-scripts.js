'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveElectronBinary, MISSING_ELECTRON_MESSAGE } = require('./electron-bin');

const root = path.join(__dirname, '..');

function electronInstallScript(rootDir) {
  return path.join(rootDir, 'node_modules', 'electron', 'install.js');
}

function activeWinDir(rootDir) {
  return path.join(rootDir, 'node_modules', 'active-win');
}

function hasNativeBinding(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.node')) return true;
    if (entry.isDirectory() && hasNativeBinding(full)) return true;
  }
  return false;
}

function resolveNodePreGyp(rootDir) {
  const nested = path.join(
    rootDir,
    'node_modules',
    'active-win',
    'node_modules',
    '@mapbox',
    'node-pre-gyp',
    'bin',
    'node-pre-gyp.js'
  );
  if (fs.existsSync(nested)) return nested;
  const hoisted = path.join(rootDir, 'node_modules', '@mapbox', 'node-pre-gyp', 'bin', 'node-pre-gyp.js');
  if (fs.existsSync(hoisted)) return hoisted;
  try {
    return require.resolve('@mapbox/node-pre-gyp/bin/node-pre-gyp');
  } catch (_) {
    return null;
  }
}

function ensureElectron({
  rootDir = root,
  resolveBin = resolveElectronBinary,
  spawn = spawnSync,
  exists = (candidate) => fs.existsSync(candidate)
} = {}) {
  if (resolveBin()) return { ok: true, skipped: true };

  const installJs = electronInstallScript(rootDir);
  if (!exists(installJs)) return { ok: false, reason: 'electron-package-missing' };

  const result = spawn(process.execPath, [installJs], {
    stdio: 'inherit',
    cwd: path.dirname(installJs),
    env: process.env
  });
  if (result.status !== 0) return { ok: false, reason: 'electron-install-failed' };
  return { ok: true, skipped: false };
}

function ensureActiveWin({
  rootDir = root,
  spawn = spawnSync,
  exists = (candidate) => fs.existsSync(candidate),
  hasBinding = hasNativeBinding
} = {}) {
  const pkgDir = activeWinDir(rootDir);
  if (!exists(pkgDir)) return { ok: true, skipped: true };
  if (hasBinding(path.join(pkgDir, 'lib', 'binding'))) return { ok: true, skipped: true };

  const preGyp = resolveNodePreGyp(rootDir);
  if (!preGyp) return { ok: true, skipped: true, reason: 'node-pre-gyp-missing' };

  const result = spawn(process.execPath, [preGyp, 'install', '--fallback-to-build'], {
    stdio: 'inherit',
    cwd: pkgDir,
    env: process.env
  });
  if (result.status !== 0) return { ok: false, skipped: false, reason: 'active-win-install-failed' };
  return { ok: true, skipped: false };
}

function main() {
  const electron = ensureElectron();
  if (!electron.ok && electron.reason === 'electron-install-failed') {
    console.error(MISSING_ELECTRON_MESSAGE);
    process.exit(1);
  }
  const native = ensureActiveWin();
  if (!native.ok) {
    console.warn('[sydtrack] active-win native addon was not built. Window tracking may use a fallback.');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  activeWinDir,
  electronInstallScript,
  ensureActiveWin,
  ensureElectron,
  hasNativeBinding,
  resolveNodePreGyp
};
