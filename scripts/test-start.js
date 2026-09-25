'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { MISSING_ELECTRON_MESSAGE, resolveElectronBinary } = require('./electron-bin');
const {
  ensureActiveWin,
  ensureElectron,
  electronInstallScript,
  hasNativeBinding
} = require('./ensure-install-scripts');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok  ', msg);
  }
}

assert(
  MISSING_ELECTRON_MESSAGE === '[sydtrack] Electron binary missing. From this folder run: npm install',
  'missing-binary message is the one CMD-safe line'
);
assert(!MISSING_ELECTRON_MESSAGE.includes('\n'), 'missing-binary message is a single line');
assert(!/`|\|\||&&|rmdir|approve-scripts|install-scripts/.test(MISSING_ELECTRON_MESSAGE), 'missing-binary message stays CMD-safe');

assert(
  resolveElectronBinary({
    requireElectron: () => {
      throw new Error('Electron failed to install correctly, please delete node_modules/electron and try installing again');
    },
    exists: () => true
  }) === null,
  'require(electron) throw is treated as a missing binary'
);

assert(
  resolveElectronBinary({
    requireElectron: () => path.join(os.tmpdir(), 'sydtrack-no-such-electron'),
    exists: () => false
  }) === null,
  'returned path that does not exist is treated as missing'
);

const present = path.join(os.tmpdir(), 'sydtrack-fake-electron');
assert(
  resolveElectronBinary({
    requireElectron: () => present,
    exists: (candidate) => candidate === present
  }) === present,
  'existing binary path is returned'
);

const calls = [];
const alreadyInstalled = ensureElectron({
  resolveBin: () => present,
  spawn: (...args) => {
    calls.push(args);
    return { status: 0 };
  }
});
assert(alreadyInstalled.ok && alreadyInstalled.skipped && calls.length === 0, 'ensureElectron skips when the binary exists');

const missingPkg = ensureElectron({
  rootDir: path.join(os.tmpdir(), 'sydtrack-no-modules'),
  resolveBin: () => null,
  exists: () => false,
  spawn: () => ({ status: 0 })
});
assert(missingPkg.reason === 'electron-package-missing', 'ensureElectron reports a missing electron package');

let spawned;
const downloaded = ensureElectron({
  rootDir: path.join(os.tmpdir(), 'sydtrack-root'),
  resolveBin: () => null,
  exists: () => true,
  spawn: (cmd, argv, opts) => {
    spawned = { cmd, argv, opts };
    return { status: 0 };
  }
});
assert(downloaded.ok && !downloaded.skipped, 'ensureElectron runs electron/install.js when the binary is missing');
assert(spawned.cmd === process.execPath, 'electron install is invoked with this Node');
assert(spawned.argv[0] === electronInstallScript(path.join(os.tmpdir(), 'sydtrack-root')), 'electron install.js path is used');

const failedDownload = ensureElectron({
  resolveBin: () => null,
  exists: () => true,
  spawn: () => ({ status: 1 })
});
assert(failedDownload.reason === 'electron-install-failed', 'ensureElectron surfaces a failed electron download');

const tmpBinding = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-binding-'));
assert(!hasNativeBinding(tmpBinding), 'empty binding dir has no .node');
fs.writeFileSync(path.join(tmpBinding, 'addon.node'), 'x');
assert(hasNativeBinding(tmpBinding), '.node files count as a native binding');

const skippedNative = ensureActiveWin({
  rootDir: path.join(os.tmpdir(), 'sydtrack-no-active-win'),
  exists: () => false,
  spawn: () => {
    throw new Error('should not spawn');
  }
});
assert(skippedNative.ok && skippedNative.skipped, 'ensureActiveWin skips when the package is absent');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
const electronVersion = lock.packages['node_modules/electron'].version;
const activeWinVersion = lock.packages['node_modules/active-win'].version;
assert(pkg.allowScripts.electron === true, 'name-only electron allowScripts entry is kept');
assert(pkg.allowScripts['active-win'] === true, 'name-only active-win allowScripts entry is kept');
assert(pkg.allowScripts['electron@' + electronVersion] === true, 'electron allowScripts pin matches the lockfile');
assert(pkg.allowScripts['active-win@' + activeWinVersion] === true, 'active-win allowScripts pin matches the lockfile');
assert(pkg.scripts.postinstall === 'node scripts/ensure-install-scripts.js', 'postinstall verifies install scripts');
assert(pkg.scripts.start === 'node scripts/start.js', 'npm start uses scripts/start.js');
assert(pkg.engines && pkg.engines.node === '>=18', 'engines.node is Node 18+');

const preload = `
'use strict';
const Module = require('module');
const orig = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    throw new Error('Electron failed to install correctly, please delete node_modules/electron and try installing again');
  }
  return orig.apply(this, arguments);
};
`;
const preloadFile = path.join(os.tmpdir(), 'sydtrack-mock-electron-' + process.pid + '.js');
fs.writeFileSync(preloadFile, preload);
const launched = spawnSync(process.execPath, ['-r', preloadFile, path.join(__dirname, 'start.js')], {
  encoding: 'utf8',
  env: process.env
});
assert(launched.status === 1, 'start.js exits non-zero when the Electron binary is missing');
const errOut = (launched.stderr || '') + (launched.stdout || '');
assert(errOut.includes(MISSING_ELECTRON_MESSAGE), 'start.js prints the one-liner');
assert(!errOut.includes('Electron failed to install correctly'), 'start.js hides the raw Electron install stack');
assert((errOut.match(/\[sydtrack\] Electron binary missing/g) || []).length === 1, 'start.js prints the missing-binary line once');

if (failed) {
  console.error(failed + ' start check(s) failed');
  process.exitCode = 1;
} else {
  console.log('start checks passed');
}
