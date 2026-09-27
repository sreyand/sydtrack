'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildAppSlices, periodEntries, conicStops } = require('../renderer/lib/apps-analytics');
const { createStore } = require('../src/store');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-apps-analytics-'));
try {
  const store = createStore(root);
  store.addSeconds('Chrome', 'productive', 60, { category: 'productive', reason: 'github' });
  store.addSeconds('Chrome', 'unproductive', 30, { category: 'unproductive', reason: 'youtube' });
  store.addSeconds('Code', 'productive', 40, { category: 'productive', reason: 'App identity' });
  store.addSeconds('Explorer', 'ignored', 80);
  let snapshot = store.snapshot();
  let model = buildAppSlices(snapshot.appBreakdown);
  assert.equal(model.total, 130);
  assert.equal(model.slices.length, 2);
  assert.equal(model.slices[0].name, 'Chrome');
  assert.equal(model.slices[0].seconds, 90);
  assert.deepEqual(model.slices[0].byCategory, { productive: 60, unproductive: 30, other: 0 });
  assert.equal(model.slices[1].name, 'Code');
  assert(!model.slices.some(slice => slice.name === 'Explorer'));
  assert.equal(snapshot.activityRows.filter(row => row.name === 'Chrome').length, 2);
  assert.match(conicStops(model.slices, model.total), /100\.000%$/);

  const youtube = snapshot.activityRows.find(row => row.name === 'Chrome' && row.reason === 'youtube');
  snapshot = store.correctActivityToday(youtube.id, 'productive');
  model = buildAppSlices(snapshot.appBreakdown);
  assert.equal(model.total, 130);
  assert.deepEqual(model.slices[0].byCategory, { productive: 90, unproductive: 0, other: 0 });
  assert.equal(snapshot.activityRows.find(row => row.name === 'Chrome' && row.reason === 'github').seconds, 60);

  const grouped = buildAppSlices([
    { name: 'A', category: 'productive', seconds: 10 }, { name: 'B', category: 'other', seconds: 9 },
    { name: 'C', category: 'other', seconds: 8 }, { name: 'D', category: 'other', seconds: 7 }
  ], 2);
  assert.equal(grouped.appCount, 4);
  assert.deepEqual(grouped.slices.map(slice => slice.seconds), [10, 9, 15]);
  assert.equal(grouped.slices[2].name, 'Remaining apps');
  assert.equal(buildAppSlices([]).total, 0);
  assert.equal(conicStops([], 0), '');
  const today = store.snapshot();
  const days = store.historySummary(7);
  assert.equal(buildAppSlices(periodEntries(days, today)).total, 130);
  const sampleDays = [
    { date: '2026-01-01', apps: [{ name: 'Chrome', category: 'unproductive', seconds: 120 }] },
    { date: today.date, apps: [{ name: 'Chrome', category: 'unproductive', seconds: 999 }] }
  ];
  const period = buildAppSlices(periodEntries(sampleDays, today));
  assert.equal(period.total, 250);
  assert.deepEqual(period.apps.find(app => app.name === 'Chrome').byCategory,
    { productive: 90, unproductive: 120, other: 0 });
  console.log('Apps analytics checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
