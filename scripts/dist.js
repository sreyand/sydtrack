'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const target = String(process.argv[2] || '').toLowerCase();
const flags = {
  win: ['--win'],
  windows: ['--win'],
  mac: ['--mac'],
  macos: ['--mac'],
  darwin: ['--mac'],
  linux: ['--linux'],
  dir: ['--dir'],
  portable: ['--win', 'portable']
};

if (!flags[target]) {
  console.error('Usage: node scripts/dist.js <win|mac|linux|dir|portable>');
  process.exit(1);
}

const env = Object.assign({}, process.env);
// The build must not publish a release or an update feed.
delete env.GH_TOKEN;
delete env.GITHUB_TOKEN;

if (env.SYDTRACK_SIGN === '1') {
  console.log('[sydtrack] SYDTRACK_SIGN=1. electron-builder will sign when CSC_LINK or CSC_NAME is set. See build/README.md.');
} else {
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  console.log('[sydtrack] Unsigned build (no update feed). See build/README.md to enable signing.');
}

const cli = path.join(__dirname, '..', 'node_modules', 'electron-builder', 'cli.js');
const config = path.join(__dirname, '..', 'build', 'electron-builder.config.js');
const result = spawnSync(process.execPath, [cli, '--config', config].concat(flags[target]), {
  stdio: 'inherit',
  env
});
process.exit(result.status == null ? 1 : result.status);
