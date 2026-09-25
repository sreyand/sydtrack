'use strict';

const fs = require('fs');

// One CMD-safe line. No PowerShell, no chained commands, no approve-scripts ritual.
const MISSING_ELECTRON_MESSAGE =
  '[sydtrack] Electron binary missing. From this folder run: npm install';

function defaultRequireElectron() {
  return require('electron');
}

function resolveElectronBinary({ requireElectron, exists } = {}) {
  const load = requireElectron || defaultRequireElectron;
  const pathExists = exists || ((candidate) => typeof candidate === 'string' && fs.existsSync(candidate));
  let bin;
  try {
    bin = load();
  } catch (_) {
    return null;
  }
  if (typeof bin !== 'string' || !pathExists(bin)) return null;
  return bin;
}

module.exports = {
  MISSING_ELECTRON_MESSAGE,
  resolveElectronBinary
};
