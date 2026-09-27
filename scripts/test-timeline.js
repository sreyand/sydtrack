'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, todayKey, toRollup } = require('../src/store');
const { createTracker } = require('../src/tracker');
const { buildExport, importBackup } = require('../src/backup');
const { validateIpcPayload } = require('../src/ipc-validate');
const { model, rowsForDate, activityWindow, zoomWindow, overviewBuckets } = require('../renderer/lib/day-timeline');

const temporary = [];
function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-timeline-'));
  temporary.push(dir);
  return dir;
}

async function run() {
  const now = Date.now();
  const date = todayKey(now);
  const store = createStore(temp());
  store.addInterval('Code', 'productive', now - 9000, now - 6000, null, 'coding');
  store.addInterval('Code', 'productive', now - 6000, now - 3000, null, 'coding');
  store.addTimelineGap(now - 3000, now - 2000);
  store.addInterval('chrome', 'unproductive', now - 2000, now - 1000, null, 'general');
  const timeline = store.timelineDay(date);
  assert.deepStrictEqual(timeline.timeline.map(s => s.kind), ['productive', 'idle', 'unproductive']);
  assert.strictEqual(timeline.timeline[0].end - timeline.timeline[0].start, 6000);
  assert.strictEqual(timeline.timeline[0].profileId, 'coding');
  assert.strictEqual(timeline.timeline[1].profileId, null);
  assert(!JSON.stringify(timeline.timeline).includes('Code') && !JSON.stringify(timeline.timeline).includes('chrome'));
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const beforeMidnight = todayKey(midnight.getTime() - 1);
  store.addInterval('Code', 'productive', midnight.getTime() - 1000, midnight.getTime() + 1000, null, 'coding');
  assert(store.timelineDay(beforeMidnight).timeline.some(s => s.end === midnight.getTime()));
  assert(store.timelineDay(date).timeline.some(s => s.start === midnight.getTime()));
  const filtered = model(timeline, 'productive', 'coding');
  assert.strictEqual(filtered.visible.length, 1);
  assert.strictEqual(filtered.longestProductive.end - filtered.longestProductive.start, 6000);
  assert.strictEqual(model(timeline, 'productive', 'general').visible.length, 0);
  assert.strictEqual(model(timeline, 'productive', 'general').longestProductive, null);
  const blockDay = { date, byHour: [], timeline: [
    { start: now - 120000, end: now - 90000, kind: 'productive', profileId: 'coding' },
    { start: now - 90000, end: now - 60000, kind: 'productive', profileId: 'general' },
    { start: now - 60000, end: now - 55000, kind: 'idle', profileId: null },
    { start: now - 55000, end: now - 35000, kind: 'productive', profileId: 'coding' },
    { start: now - 30000, end: now - 20000, kind: 'productive', profileId: 'coding' }
  ] };
  assert.strictEqual(model(blockDay).longestProductive.end - model(blockDay).longestProductive.start, 60000,
    'adjacent productive segments form one block even across profiles');
  assert.strictEqual(model(blockDay, 'all', 'coding').longestProductive.end - model(blockDay, 'all', 'coding').longestProductive.start, 30000,
    'a profile filter does not bridge a hidden profile interval');
  assert.strictEqual(model({ date, byHour: timeline.byHour, timeline: [] }).precision, 'hourly');
  assert.strictEqual(model({ date, byHour: timeline.byHour, timeline: [] }).longestProductive, null,
    'hourly-only history never fabricates a longest block');
  assert.strictEqual(model({ date, byCategory: { productive: 120 }, byHour: [], timeline: [] }).precision, 'daily');
  assert.strictEqual(model({ date, byHour: [{ productive: 600 }], timeline: timeline.timeline }).precision, 'partial');
  const rows = rowsForDate('2026-09-26');
  const evening = hour => new Date(2026, 8, 26, hour).getTime();
  const viewport = activityWindow(rows, [{ kind: 'productive', start: evening(20), end: evening(21) }]);
  assert(viewport.start <= evening(20) && viewport.end >= evening(21));
  assert(viewport.end - viewport.start >= 3 * 3600000 && viewport.end - viewport.start < 86400000,
    'the default viewport gives short evening activity readable width');
  const zoomed = zoomWindow(viewport, rows[0].start, rows[3].end, 0.5, 0.25);
  assert(zoomed.end - zoomed.start < viewport.end - viewport.start);
  assert(Math.abs(zoomed.start + (zoomed.end - zoomed.start) * 0.25 -
    (viewport.start + (viewport.end - viewport.start) * 0.25)) < 1,
  'pinch zoom keeps the pointed-at time in place');
  const minimum = zoomWindow(viewport, rows[0].start, rows[3].end, 0.001, 0.5);
  assert.strictEqual(minimum.end - minimum.start, 15 * 60000);
  const wholeDay = zoomWindow(viewport, rows[0].start, rows[3].end, 100, 0.5);
  assert.deepStrictEqual(wholeDay, { start: rows[0].start, end: rows[3].end });
  const bucketStart = evening(20);
  const bins = overviewBuckets([
    { kind: 'productive', start: bucketStart, end: bucketStart + 7 * 60000 },
    { kind: 'unproductive', start: bucketStart + 7 * 60000, end: bucketStart + 9 * 60000 }
  ], bucketStart, bucketStart + 20 * 60000, rows[0].start, 10 * 60000);
  assert.deepStrictEqual(bins.map(bin => bin.kind), ['productive', 'untracked'],
    'overview shows the dominant state without fabricating activity across gaps');
  assert.strictEqual(bins[0].durations.unproductive, 2 * 60000,
    'the exact minority category remains available in bucket detail');
  const mixed = overviewBuckets([
    { kind: 'productive', start: bucketStart, end: bucketStart + 5 * 60000 },
    { kind: 'unproductive', start: bucketStart + 5 * 60000, end: bucketStart + 10 * 60000 }
  ], bucketStart, bucketStart + 10 * 60000, rows[0].start, 10 * 60000);
  assert.strictEqual(mixed[0].kind, 'mixed', 'a 50/50 interval is not mislabeled productive');
  assert.strictEqual(validateIpcPayload('history:timelineDay', date), date);
  assert.throws(() => validateIpcPayload('history:timelineDay', '../settings'));
  assert(!Object.hasOwn(toRollup(store.getState()), 'timeline'), 'long-term rollups retain hourly/category totals, not exact segments');

  const backup = buildExport(store);
  assert(backup.days[date].timeline.length >= 3);
  const restored = createStore(temp());
  assert(importBackup(restored, backup, { mode: 'replace' }).ok);
  assert.deepStrictEqual(restored.timelineDay(date).timeline, store.timelineDay(date).timeline);
  const malformed = structuredClone(backup);
  malformed.days[date].timeline[0].title = 'Never import this';
  // Unknown keys on old backup objects are tolerated, but the stored model strips them.
  const stripped = createStore(temp());
  assert(importBackup(stripped, malformed, { mode: 'replace' }).ok);
  assert(!JSON.stringify(stripped.timelineDay(date).timeline).includes('title'));
  const previous = todayKey(now - 86400000);
  const oldDay = { date: previous, byCategory: { productive: 3600, unproductive: 0, other: 0 },
    byHour: Array.from({ length: 24 }, (_, hour) => ({ productive: hour === 10 ? 3600 : 0, unproductive: 0, other: 0, byApp: {} })), byApp: {} };
  restored.writeHistoryDay(oldDay);
  assert.strictEqual(model(restored.timelineDay(previous)).precision, 'hourly', 'pre-timeline data is not given false sequence or idle gaps');

  const trackerStore = createStore(temp());
  trackerStore.updateSettings({ demoMode: false, idleTimeoutSec: 5, trackingPaused: false });
  let clock = Date.now();
  let idleSec = 0;
  const tracker = createTracker({
    store: trackerStore,
    rulesHolder: { rules: { productive: ['Code'], unproductive: [], profileId: 'coding' } },
    ignore: [], now: () => clock,
    backend: { getActiveWindow: async () => ({ window: { owner: { name: 'Code' }, title: 'main.js' }, idleSec }) }
  });
  clock += 1000; await tracker.poll();
  idleSec = 10;
  clock += 1000; await tracker.poll();
  clock += 1000; await tracker.poll();
  idleSec = 0;
  clock += 1000; await tracker.poll();
  const observed = trackerStore.timelineDay(todayKey(clock)).timeline;
  assert(observed.some(s => s.kind === 'idle'));
  assert(observed.some(s => s.kind === 'productive' && s.profileId === 'coding'));
  const count = observed.length;
  tracker.markPauseBoundary();
  trackerStore.updateSettings({ trackingPaused: true });
  clock += 1000; await tracker.poll();
  assert.strictEqual(trackerStore.timelineDay(todayKey(clock)).timeline.length, count);
  tracker.stop();
  console.log('timeline checks passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true });
});
