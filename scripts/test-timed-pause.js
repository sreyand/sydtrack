'use strict';

const assert = require('assert');
const { pauseFor15Minutes, createTimedPause } = require('../src/timed-pause');

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

settings = pauseFor15Minutes(clock);
timer.sync();
timer.dispose();
assert.strictEqual(nextTimer, null, 'quit cancels the in-memory timer');
console.log('timed-pause checks passed');
