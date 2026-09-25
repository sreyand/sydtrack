'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { electronLaunchArgs } = require('./launch-args');
const { resolveElectronBinary, MISSING_ELECTRON_MESSAGE } = require('./electron-bin');

const root = path.join(__dirname, '..');
const bin = resolveElectronBinary();
if (!bin) {
  console.error(MISSING_ELECTRON_MESSAGE);
  process.exit(1);
}
const extra = process.argv.slice(2);
const env = Object.assign({}, process.env);
const launched = electronLaunchArgs({
  platform: process.platform,
  env,
  appPath: root,
  extra
});
if (launched.headless && env.SYDTRACK_DEMO == null) env.SYDTRACK_DEMO = '1';
if (launched.headless && env.SYDTRACK_THRESHOLD_SEC == null) env.SYDTRACK_THRESHOLD_SEC = '30';

function go(cmd, argv) {
  const child = spawn(cmd, argv, { stdio: 'inherit', env });
  child.on('exit', function (code, signal) {
    if (signal) process.kill(process.pid, signal);
    process.exit(code == null ? 1 : code);
  });
  child.on('error', function (err) {
    console.error('Failed to launch:', err.message);
    process.exit(1);
  });
}

if (launched.headless) {
  console.log('[sydtrack] No DISPLAY — starting under xvfb (demo mode, 30s reminder).');
  go('xvfb-run', ['-a', '--auto-servernum', '--server-args=-screen 0 1280x800x24', bin].concat(launched.args));
} else {
  go(bin, launched.args);
}
