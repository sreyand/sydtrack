'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const roots = [
  path.join(__dirname, '..', 'src'),
  path.join(__dirname)
];

function listJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJs(full);
    return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });
}

const files = roots.flatMap(listJs).sort();
if (!files.some((file) => file.endsWith(`${path.sep}main.js`))) {
  console.error('check-syntax: src/main.js was not scanned');
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  const rel = path.relative(path.join(__dirname, '..'), file);
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(result.stderr || result.stdout || `FAIL ${rel}\n`);
  } else {
    console.log('ok  ', rel);
  }
}

if (failed) {
  console.error(failed + ' syntax error(s)');
  process.exit(1);
}
console.log('syntax checks passed (' + files.length + ' files)');
