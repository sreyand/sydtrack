'use strict';

const {
  HIDDEN_ARG,
  loginItemOptions,
  shouldStartHidden,
  syncLoginItem,
  supportsLoginItems
} = require('../src/startup');

let failed = 0;
function assert(condition, message) {
  if (condition) console.log('ok  ', message);
  else {
    failed += 1;
    console.error('FAIL', message);
  }
}

assert(supportsLoginItems('win32') && supportsLoginItems('darwin'), 'Windows and macOS support login items');
assert(!supportsLoginItems('linux'), 'Linux hides the unsupported login-item control');
assert(loginItemOptions({ enabled: true, platform: 'win32', isPackaged: false, execPath: 'dev.exe' }) === null,
  'development launches never modify system startup');

const installed = loginItemOptions({
  enabled: true,
  platform: 'win32',
  isPackaged: true,
  execPath: 'C:\\Apps\\sydtrack.exe',
  env: {}
});
assert(installed.openAtLogin && installed.enabled && installed.path === 'C:\\Apps\\sydtrack.exe',
  'installed Windows app registers its executable');
assert(installed.args.length === 1 && installed.args[0] === HIDDEN_ARG,
  'Windows login launch starts quietly in the tray');

const portable = loginItemOptions({
  enabled: true,
  platform: 'win32',
  isPackaged: true,
  execPath: 'C:\\Temp\\unpacked.exe',
  env: { PORTABLE_EXECUTABLE_FILE: 'D:\\sydtrack-portable.exe' }
});
assert(portable.path === 'D:\\sydtrack-portable.exe', 'portable builds register the outer executable');

const disabled = loginItemOptions({
  enabled: false,
  platform: 'win32',
  isPackaged: true,
  execPath: 'C:\\Apps\\sydtrack.exe'
});
assert(!disabled.openAtLogin && !disabled.enabled, 'turning the setting off disables the login item');

const mac = loginItemOptions({ enabled: true, platform: 'darwin', isPackaged: true, execPath: '/Applications/sydtrack' });
assert(mac.openAtLogin && mac.openAsHidden, 'macOS login item opens hidden');

let applied = null;
const result = syncLoginItem({ setLoginItemSettings(value) { applied = value; } }, true, {
  platform: 'win32', isPackaged: true, execPath: 'C:\\Apps\\sydtrack.exe', env: {}
});
assert(result.supported && applied && applied.openAtLogin, 'startup preference is applied through Electron');
assert(shouldStartHidden({ argv: ['app', HIDDEN_ARG], platform: 'win32' }), 'hidden command-line launch is detected');
assert(shouldStartHidden({ argv: [], platform: 'darwin', appApi: { getLoginItemSettings: () => ({ wasOpenedAsHidden: true }) } }),
  'macOS hidden login launch is detected');
assert(!shouldStartHidden({ argv: [], platform: 'win32' }), 'ordinary launch opens the window');

if (failed) {
  console.error(`${failed} startup check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('startup checks passed');
}
