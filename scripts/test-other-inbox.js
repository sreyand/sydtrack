'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');
const { validateIpcPayload } = require('../src/ipc-validate');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-other-inbox-'));
try {
  const store = createStore(root);
  const unmatched = { category: 'other', reason: 'No matching keyword' };
  const matched = { category: 'productive', reason: 'github' };
  store.addSeconds('Chrome', 'other', 60, unmatched);
  store.addSeconds('Chrome', 'productive', 30, matched);
  store.addSeconds('Code', 'other', 15);
  const before = store.snapshot();
  assert(before.otherApps[0].name === 'Chrome' && before.otherApps[0].seconds === 60);
  const corrected = store.correctOtherAppToday('Chrome', 'unproductive');
  assert.strictEqual(corrected.byCategory.other, 15);
  assert.strictEqual(corrected.byCategory.productive, 30, 'already-classified browser activity stays intact');
  assert.strictEqual(corrected.byCategory.unproductive, 60);
  assert(corrected.activityRows.some(row => row.name === 'Chrome' && row.reason === 'github' && row.category === 'productive'));
  assert.strictEqual(store.getActivityCorrection('Chrome', unmatched), 'unproductive');
  assert.strictEqual(store.getActivityCorrection('Chrome', matched), undefined);
  assert.strictEqual(createStore(root).snapshot().byCategory.unproductive, 60, 'correction survives restart');
  assert.throws(() => store.correctOtherAppToday('Chrome', 'productive'), /No unclassified/);
  assert.throws(() => store.correctOtherAppToday('Code', 'ignored'), /Invalid/);
  assert.deepStrictEqual(validateIpcPayload('apps:correctOtherToday', { name: 'Chrome', category: 'productive' }),
    { name: 'Chrome', category: 'productive' });
  assert.throws(() => validateIpcPayload('apps:correctOtherToday', { name: 'Chrome', category: 'ignored' }));
  assert.throws(() => validateIpcPayload('apps:correctOtherToday', { name: '../x', category: 'other' }));
  console.log('Other inbox correction checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
