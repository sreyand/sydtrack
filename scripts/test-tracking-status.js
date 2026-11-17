'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe } = require('../renderer/lib/tracking-status');
const { createTracker } = require('../src/tracker');

async function run() {
  const at = new Date(2026, 10, 17, 14, 30).getTime();
  const prefs = { onboardingComplete: true, trackingPaused: false, demoMode: false };
  const live = { source: 'real', app: 'code', category: 'productive', idle: false,
    idleReason: 'active', lastSuccessfulSampleAt: at - 1000 };
  assert.equal(describe(live, prefs, at).key, 'live');
  assert.equal(describe(live, prefs, at).lastSuccessfulSampleAt, at - 1000);
  assert.equal(describe(null, prefs, at).key, 'waiting');
  assert.equal(describe(live, { ...prefs, onboardingComplete: false }, at).key, 'onboarding');

  const paused = describe({ ...live, trackingError: 'private backend details' }, { ...prefs, trackingPaused: true }, at);
  assert.equal(paused.key, 'paused', 'saved pause takes precedence over an old error');
  assert.deepEqual(paused.action, { kind: 'resume', label: 'Resume tracking' });
  assert.match(paused.description, /until you resume/);
  const timed = describe(live, { ...prefs, trackingPaused: true, trackingPauseUntil: at + 15 * 60_000 }, at);
  assert.ok(timed.description.includes(new Date(at + 15 * 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
  const expired = describe(live, { ...prefs, trackingPaused: true, trackingPauseUntil: at - 1 }, at);
  assert.match(expired.description, /Waiting/);
  const nextDay = describe(live, { ...prefs, trackingPaused: true, resumeTrackingNextDay: true, trackingPauseDate: '2026-11-17' }, at);
  const tomorrow = new Date(2026, 10, 18);
  assert.ok(nextDay.description.includes(tomorrow.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })));
  assert.match(describe(live, { ...prefs, trackingPaused: true, resumeTrackingNextDay: true, trackingPauseDate: '2026-02-30' }, at).description,
    /until you resume/, 'invalid pause marker must not promise an automatic restart');
  assert.equal(describe({ ...live, source: 'paused' }, prefs, at).key, 'waiting', 'resume waits for a fresh reading');

  const unavailable = describe({ ...live, trackingError: 'private title/path error', title: 'private page title' }, prefs, at);
  assert.equal(unavailable.key, 'unavailable');
  assert.equal(unavailable.action.kind, 'settings');
  assert.match(unavailable.description, /retries automatically/);
  assert.ok(!JSON.stringify(unavailable).includes('private'), 'status details do not echo titles or backend errors');
  for (const [reason, key] of [['sleep', 'sleep'], ['lock', 'lock'], ['screen-off', 'screen-off'],
    ['stopped', 'stopped'], ['clock', 'waiting'], ['no-window', 'no-window'], ['idle', 'idle']]) {
    assert.equal(describe({ ...live, source: 'idle', idle: true, idleReason: reason }, prefs, at).key, key);
  }
  assert.equal(describe({ ...live, ignored: true, category: 'ignored' }, prefs, at).key, 'ignored');
  assert.match(describe({ ...live, ignored: true }, prefs, at).description, /No time/);
  assert.equal(describe({ ...live, source: 'demo' }, prefs, at).key, 'waiting');
  assert.equal(describe(live, { ...prefs, demoMode: true }, at).key, 'waiting');
  const demo = describe({ ...live, source: 'demo' }, { ...prefs, demoMode: true }, at);
  assert.equal(demo.key, 'demo');
  assert.match(demo.description, /simulated/);
  for (const value of [at + 1, '1700000000000', -1, Infinity, NaN, null]) {
    assert.equal(describe({ ...live, lastSuccessfulSampleAt: value }, prefs, at).lastSuccessfulSampleAt, null);
  }
  const browserContext = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'lib', 'tracking-status.js'), 'utf8'), browserContext);
  assert.equal(typeof browserContext.window.sydtrackTrackingStatus.describe, 'function');

  // A fake backend/store isolates health metadata from personal files and timers.
  let clock = at, probes = 0, tick;
  const settings = { ...prefs, notificationsEnabled: false, pollMs: 1000, idleTimeoutSec: 300 };
  const store = { getSettings: () => settings, snapshot: () => ({}), addSeconds() {}, resetStreak() {} };
  let response = { window: { owner: { name: 'code' }, title: 'private document' }, idleSec: 0 };
  const tracker = createTracker({ store, rules: { productive: ['code'], unproductive: [], other: [] }, ignore: [],
    now: () => clock, backend: { getActiveWindow: async () => { probes++; return response; } }, onTick: value => { tick = value; } });
  try {
    clock += 1000; await tracker.poll();
    assert.equal(tick.now.lastSuccessfulSampleAt, clock, 'valid real probes update the timestamp');
    const firstSuccessful = clock;
    response = { window: null, error: 'unavailable', idleSec: 0 };
    clock += 1000; await tracker.poll();
    assert.equal(tick.now.trackingError, 'unavailable');
    assert.equal(tick.now.lastSuccessfulSampleAt, firstSuccessful, 'failures preserve the last successful timestamp');
    response = { window: null, error: null, idleSec: 0 };
    clock += 1000; await tracker.poll();
    assert.equal(tick.now.trackingError, null, 'successful empty probes clear the current error');
    assert.equal(tick.now.lastSuccessfulSampleAt, firstSuccessful, 'no foreground app does not count as a successful app reading');
    response = { window: { owner: { name: 'sydtrack' }, title: 'sydtrack' }, idleSec: 0 };
    clock += 1000; await tracker.poll();
    assert.equal(tick.now.category, 'ignored');
    assert.equal(tick.now.lastSuccessfulSampleAt, clock, 'health readings include ignored apps without logging them');
    const ignoredSuccessful = clock;
    const beforePause = probes;
    settings.trackingPaused = true;
    tracker.markPauseBoundary();
    clock += 1000; await tracker.poll();
    assert.equal(probes, beforePause, 'viewing paused status never probes the foreground app');
    assert.equal(tick.now.lastSuccessfulSampleAt, ignoredSuccessful);
    settings.trackingPaused = false;
    settings.demoMode = true;
    clock += 1000; await tracker.poll();
    assert.equal(probes, beforePause, 'demo status does not probe real windows');
    assert.equal(tick.now.lastSuccessfulSampleAt, ignoredSuccessful, 'simulated samples do not replace real health metadata');
  } finally { tracker.stop(); }

  settings.trackingPaused = true;
  const restarted = createTracker({ store, rules: { productive: [], unproductive: [], other: [] }, ignore: [], now: () => clock,
    backend: { getActiveWindow: async () => { throw new Error('paused restart must not probe'); } }, onTick: value => { tick = value; } });
  try {
    await restarted.poll();
    assert.equal(tick.now.lastSuccessfulSampleAt, null, 'last reading remains session-only on restart');
  } finally { restarted.stop(); }
  console.log('Tracking status checks passed: pause precedence, safe details, real reading timestamps, privacy and restart.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
