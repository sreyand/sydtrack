'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pauseForMinutes, pauseFor15Minutes, createTimedPause } = require('../src/timed-pause');
const { validateIpcPayload } = require('../src/ipc-validate');
const { createStore } = require('../src/store');
const { createTracker } = require('../src/tracker');

for (const minutes of [15, 30, 60]) {
  assert.deepStrictEqual(pauseForMinutes(minutes, 1_000_000), {
    trackingPaused: true, trackingPauseUntil: 1_000_000 + minutes * 60_000
  }, 'supported duration produces one durable pause deadline');
  assert.strictEqual(validateIpcPayload('tracking:pauseFor', minutes), minutes);
}
assert.deepStrictEqual(pauseFor15Minutes(1_000_000), pauseForMinutes(15, 1_000_000), 'legacy helper keeps the 15-minute contract');
for (const invalid of [undefined, null, false, true, '15', '30', '60', 0, -15, 15.5, 16, 45, 90, NaN, Infinity, [], [30], { minutes: 30 }]) {
  assert.throws(() => pauseForMinutes(invalid), /Pause duration/);
  assert.throws(() => validateIpcPayload('tracking:pauseFor', invalid), /Invalid IPC payload/);
}

let clock = 1_000_000;
let settings = { trackingPaused: false, trackingPauseUntil: 0 };
let nextTimer = null;
let expired = 0;
const timer = createTimedPause({
  getSettings: () => settings,
  onExpire: () => {
    expired += 1;
    settings = { trackingPaused: false, trackingPauseUntil: 0 };
    timer.sync();
  },
  now: () => clock,
  setTimer: (fn, delay) => { nextTimer = { fn, delay }; return nextTimer; },
  clearTimer: (handle) => { if (nextTimer === handle) nextTimer = null; }
});

settings = pauseFor15Minutes(clock);
assert.deepStrictEqual(settings, { trackingPaused: true, trackingPauseUntil: clock + 900_000 });
timer.sync();
assert.strictEqual(nextTimer.delay, 60_000, 'long pause is checked in bounded intervals');
clock += 60_000;
nextTimer.fn();
assert.strictEqual(expired, 0, 'pause stays active before its deadline');

settings = { trackingPaused: true, trackingPauseUntil: 0 };
timer.sync();
assert.strictEqual(nextTimer, null, 'switching to indefinite pause cancels automatic resume');

settings = pauseFor15Minutes(clock);
timer.sync();
clock += 900_000;
nextTimer.fn();
assert.strictEqual(expired, 1, 'timed pause resumes at its deadline');
assert.strictEqual(settings.trackingPaused, false);

settings = { trackingPaused: true, trackingPauseUntil: clock - 1 };
timer.sync();
assert.strictEqual(expired, 2, 'expired persisted pause resumes on app startup');

for (const minutes of [15, 30, 60]) {
  settings = pauseForMinutes(minutes, clock);
  const deadline = settings.trackingPauseUntil;
  timer.sync();
  assert.strictEqual(nextTimer.delay, 60_000);
  clock = deadline - 1;
  nextTimer.fn();
  assert.strictEqual(settings.trackingPaused, true, 'pause stays active for its entire chosen duration');
  assert.strictEqual(nextTimer.delay, 1, 'the last scheduled check reaches the exact deadline');
  const before = expired;
  clock = deadline;
  nextTimer.fn();
  assert.strictEqual(expired, before + 1, 'chosen duration expires exactly once at its deadline');
  assert.deepStrictEqual(settings, { trackingPaused: false, trackingPauseUntil: 0 });
  assert.strictEqual(nextTimer, null);
}

settings = pauseForMinutes(30, clock);
timer.sync();
const oldDeadline = settings.trackingPauseUntil;
settings = pauseForMinutes(60, clock);
timer.sync();
clock = oldDeadline;
nextTimer.fn();
assert.strictEqual(settings.trackingPaused, true, 'extending a pause replaces the earlier automatic-resume deadline');
settings = { trackingPaused: false, trackingPauseUntil: 0 };
timer.sync();
assert.strictEqual(nextTimer, null, 'manual resume cancels the pending automatic resume');

settings = pauseFor15Minutes(clock);
timer.sync();
timer.dispose();
assert.strictEqual(nextTimer, null, 'quit cancels the in-memory timer');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-timed-pause-'));
async function persistedPauseChecks() {
  let tracker, persistedTimer;
  try {
    for (const minutes of [15, 30, 60]) {
      const dataDir = path.join(root, String(minutes));
      const store = createStore(dataDir);
      const pause = pauseForMinutes(minutes, 2_000_000);
      store.updateSettings(pause);
      const restarted = createStore(dataDir);
      assert.strictEqual(restarted.getSettings().trackingPaused, true);
      assert.strictEqual(restarted.getSettings().trackingPauseUntil, pause.trackingPauseUntil, 'restart preserves the original deadline instead of starting a fresh duration');
      let at = pause.trackingPauseUntil - 500;
      let handle;
      const resume = createTimedPause({ getSettings: () => restarted.getSettings(), now: () => at,
        onExpire: () => restarted.updateSettings({ trackingPaused: false, trackingPauseUntil: 0 }),
        setTimer: (fn, delay) => { handle = { fn, delay }; return handle; },
        clearTimer: value => { if (handle === value) handle = null; } });
      resume.sync();
      assert.strictEqual(handle.delay, 500, 'a restart schedules only the remaining time');
      at += 500;
      handle.fn();
      resume.dispose();
      assert.strictEqual(createStore(dataDir).getSettings().trackingPaused, false, 'automatic resume is persisted for the next restart');
      assert.strictEqual(createStore(dataDir).getSettings().trackingPauseUntil, 0);
      restarted.updateSettings(pauseForMinutes(minutes, at));
      const expiredRestart = createStore(dataDir);
      const overdue = createTimedPause({ getSettings: () => expiredRestart.getSettings(), now: () => at + minutes * 60_000 + 1,
        onExpire: () => expiredRestart.updateSettings({ trackingPaused: false, trackingPauseUntil: 0 }),
        setTimer: () => { throw new Error('Expired startup deadline must not schedule a timer'); } });
      overdue.sync();
      overdue.dispose();
      assert.strictEqual(expiredRestart.getSettings().trackingPaused, false, 'an overdue persisted duration resumes on startup');
    }

    const store = createStore(path.join(root, 'tracking-boundary'));
    store.updateSettings({ demoMode: false, idleTimeoutSec: 0 });
    let at = Date.now(), probes = 0, tick, pending;
    tracker = createTracker({ store, rules: { productive: ['code'], unproductive: [] }, now: () => at,
      backend: { getActiveWindow: async () => { probes++; return { window: { owner: { name: 'Code' }, title: 'Private task' }, idleSec: 0 }; } },
      onTick: value => { tick = value; } });
    at += 1000;
    await tracker.poll();
    const earned = store.snapshot().byCategory.productive;
    const lastFocused = tracker.getLastFocused();
    store.updateSettings(pauseForMinutes(30, at));
    tracker.markPauseBoundary();
    persistedTimer = createTimedPause({ getSettings: () => store.getSettings(), now: () => at,
      onExpire: () => {
        store.updateSettings({ trackingPaused: false, trackingPauseUntil: 0 });
        tracker.markPauseBoundary();
      },
      setTimer: (fn, delay) => { pending = { fn, delay }; return pending; },
      clearTimer: handle => { if (pending === handle) pending = null; } });
    persistedTimer.sync();
    at += 30 * 60_000 - 1;
    await tracker.poll();
    assert.strictEqual(probes, 1, 'a flexible timed pause does not read the foreground window');
    assert.strictEqual(tick.now.source, 'paused');
    assert.strictEqual(store.snapshot().byCategory.productive, earned, 'paused elapsed time never changes earned totals');
    assert.deepStrictEqual(tracker.getLastFocused(), lastFocused, 'pause preserves the last focused snapshot');
    at += 1;
    pending.fn();
    await tracker.poll();
    assert.strictEqual(probes, 2, 'expiry resumes the same tracker');
    assert.strictEqual(store.snapshot().byCategory.productive, earned, 'the resume boundary does not backfill paused time');
    at += 1000;
    await tracker.poll();
    assert.strictEqual(store.snapshot().byCategory.productive, earned + 1, 'ordinary tracking restarts from the resume boundary');
    console.log('timed-pause checks passed: supported durations, validation, durable restart/expiry, cancellation, and private tracking boundaries');
  } finally {
    if (persistedTimer) persistedTimer.dispose();
    if (tracker) tracker.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

persistedPauseChecks().catch(error => { console.error(error); process.exitCode = 1; });
