'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pauseForMinutes, pauseFor15Minutes, createTimedPause } = require('../src/timed-pause');
const { validateIpcPayload } = require('../src/ipc-validate');
const { createStore, todayKey } = require('../src/store');
const { createTracker } = require('../src/tracker');
const { buildExport } = require('../src/backup');
const { buildCsvExport } = require('../src/data-export');

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

function nextDayPauseChecks() {
  const evening = new Date(2026, 2, 7, 23, 59, 58).getTime();
  const midnight = new Date(2026, 2, 8).getTime();
  const morning = new Date(2026, 2, 8, 8).getTime();
  const pause = {
    trackingPaused: true, trackingPauseUntil: 0,
    resumeTrackingNextDay: true, trackingPauseDate: todayKey(evening)
  };
  let at = evening, current = { ...pause }, pending, attempts = 0, fail = false;
  const controller = createTimedPause({
    getSettings: () => current,
    onExpire: () => {
      attempts++;
      if (fail) return false;
      current = { ...current, trackingPaused: false, trackingPauseUntil: 0, trackingPauseDate: '' };
    },
    now: () => at,
    setTimer: (fn, delay) => { pending = { fn, delay }; return pending; },
    clearTimer: handle => { if (pending === handle) pending = null; }
  });
  const fire = () => {
    const handle = pending;
    pending = null;
    handle.fn();
  };

  controller.sync();
  assert.strictEqual(pending.delay, midnight - evening, 'automatic resume targets local midnight');
  at = midnight - 1;
  fire();
  assert.strictEqual(attempts, 0, 'no restart before the local date changes');
  assert.strictEqual(pending.delay, 1, 'recheck reaches the local day boundary');
  at = midnight;
  fire();
  assert.strictEqual(attempts, 1, 'resumes at the start of the next local day');
  assert.strictEqual(current.trackingPaused, false);
  assert.strictEqual(pending, null);
  controller.sync();
  assert.strictEqual(attempts, 1, 'resumes exactly once');

  at = morning;
  current = { ...pause };
  controller.sync();
  assert.strictEqual(attempts, 2, 'a skipped midnight resumes on the next sync after wake or relaunch');

  at = new Date(2026, 2, 6, 23, 59, 59).getTime();
  current = { ...pause };
  controller.sync();
  assert.strictEqual(attempts, 2, 'clock rollback to an earlier local date does not resume');
  assert(current.trackingPaused);

  at = evening;
  current = { ...pause, ...pauseForMinutes(15, at) };
  controller.sync();
  at = midnight;
  controller.sync();
  assert.strictEqual(attempts, 2, 'a timed pause is not shortened by midnight');
  at = current.trackingPauseUntil;
  fire();
  assert.strictEqual(attempts, 3, 'the timed deadline still resumes normally');

  at = evening;
  current = { ...pause };
  controller.sync();
  assert(pending, 'the opted-in pause has a scheduled check');
  current.resumeTrackingNextDay = false;
  controller.sync();
  assert.strictEqual(pending, null, 'disabling the option cancels the automatic resume');
  at = morning;
  for (const override of [
    { resumeTrackingNextDay: false }, { resumeTrackingNextDay: 'true' },
    { trackingPauseDate: '' }, { trackingPauseDate: '2026-02-30' }, { onboardingComplete: false }
  ]) {
    current = { ...pause, ...override };
    controller.sync();
    assert.strictEqual(attempts, 3, 'only a valid, opted-in manual pause can expire');
    assert.strictEqual(pending, null);
    assert(current.trackingPaused);
  }

  current = { ...pause };
  fail = true;
  controller.sync();
  assert.strictEqual(attempts, 4, 'a failed resume is attempted only once in the current check');
  assert(current.trackingPaused, 'failed resume stays paused');
  assert(pending && pending.delay > 0 && pending.delay <= 60_000, 'failed resume retries after a bounded delay');
  fail = false;
  at += pending.delay;
  fire();
  assert.strictEqual(attempts, 5, 'retry can resume once persistence returns');
  assert.strictEqual(current.trackingPaused, false);
  controller.dispose();
}

nextDayPauseChecks();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-timed-pause-'));
async function persistedPauseChecks() {
  let tracker, persistedTimer;
  try {
    const nextDayDir = path.join(root, 'next-day');
    const nextDayStore = createStore(nextDayDir);
    assert.strictEqual(nextDayStore.getSettings().resumeTrackingNextDay, false, 'daily resume is opt-in');
    for (const value of [true, false]) {
      assert.deepStrictEqual(validateIpcPayload('settings:update', { resumeTrackingNextDay: value }), { resumeTrackingNextDay: value });
    }
    for (const value of ['true', 1, null, {}]) {
      assert.throws(() => validateIpcPayload('settings:update', { resumeTrackingNextDay: value }), /Invalid IPC payload/);
    }
    const pauseDate = todayKey();
    assert.throws(() => validateIpcPayload('settings:update', { trackingPauseDate: pauseDate }), /Invalid IPC payload/);
    nextDayStore.updateSettings({ resumeTrackingNextDay: true, trackingPaused: true, trackingPauseUntil: 0, trackingPauseDate: pauseDate });
    const restarted = createStore(nextDayDir);
    assert.strictEqual(restarted.getSettings().resumeTrackingNextDay, true, 'the preference survives a restart');
    assert.strictEqual(restarted.getSettings().trackingPauseDate, pauseDate, 'a manual pause date survives a restart');
    const backup = buildExport(restarted, { includeSettings: true });
    assert.strictEqual(backup.settings.resumeTrackingNextDay, true);
    assert(!Object.hasOwn(backup.settings, 'trackingPauseDate'), 'JSON exports exclude the device-local pause date');
    const csv = buildCsvExport(restarted, { includeSettings: true });
    assert(csv.includes('resumeTrackingNextDay') && !csv.includes('trackingPauseDate'), 'CSV exports retain only the preference');
    const importedDay = '2026-01-01';
    restarted.applyImportedSettings({ trackingPauseDate: importedDay });
    assert.strictEqual(restarted.getSettings().trackingPauseDate, '', 'importing settings clears the local marker and cannot arm from the imported marker');
    restarted.applyImportedSettings({ resumeTrackingNextDay: true, trackingPaused: true, trackingPauseUntil: 0, trackingPauseDate: importedDay });
    assert.strictEqual(restarted.getSettings().trackingPauseDate, '', 'an imported pause cannot arm an automatic resume');
    restarted.updateSettings({ resumeTrackingNextDay: 'true', trackingPauseDate: '2026-02-30' });
    assert.strictEqual(restarted.getSettings().resumeTrackingNextDay, false, 'nonboolean settings cannot opt in');
    assert.strictEqual(restarted.getSettings().trackingPauseDate, '', 'invalid persisted dates cannot arm an automatic resume');

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
    console.log('pause checks passed: timed durations, opt-in local-day resume, restart/expiry, import safety, retry, cancellation, and private tracking boundaries');
  } finally {
    if (persistedTimer) persistedTimer.dispose();
    if (tracker) tracker.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

persistedPauseChecks().catch(error => { console.error(error); process.exitCode = 1; });
