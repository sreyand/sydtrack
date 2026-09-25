'use strict';

const { createLiveTicker, createLiveTotalsClock } = require('../renderer/lib/live-ticker');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok  ', msg);
  }
}

let now = 1_000_000;
const queue = [];
const ticks = [];

function schedule(fn, ms) {
  const id = queue.length + 1;
  queue.push({ id, at: now + ms, fn });
  return id;
}

function clear(id) {
  const idx = queue.findIndex((item) => item.id === id);
  if (idx >= 0) queue.splice(idx, 1);
}

const ticker = createLiveTicker({
  interval: 1000,
  now: () => now,
  schedule,
  clear,
  onTick: (at) => ticks.push(at)
});

ticker.start();
assert(queue.length === 1 && queue[0].at === now + 1000, 'first fire is scheduled 1000ms out');

function stepTo(target) {
  while (queue.length) {
    queue.sort((a, b) => a.at - b.at);
    const next = queue[0];
    if (next.at > target) break;
    now = next.at;
    queue.shift();
    next.fn();
  }
  now = target;
}

stepTo(now + 10_000);
assert(ticks.length === 10, 'ten wall-clock seconds emit ten ticks');
const gaps = [];
for (let i = 1; i < ticks.length; i += 1) gaps.push(ticks[i] - ticks[i - 1]);
assert(gaps.every((gap) => Math.abs(gap - 1000) <= 200), 'each tick is 1000ms ±200ms from the last');
assert(gaps.every((gap) => gap === 1000), 'no skipped seconds on a steady clock');

const lateStart = ticks.length;
now += 80;
assert(queue[0] && queue[0].at === ticks[ticks.length - 1] + 1000, 'next fire stays on the intended deadline after slop');
stepTo(now + 920);
assert(ticks.length === lateStart + 1, 'an 80ms-late clock still emits the next second once');
assert(Math.abs(ticks[ticks.length - 1] - ticks[ticks.length - 2] - 1000) <= 200, 'late fire stays within ±200ms of 1000');

ticks.length = 0;
const lateFrom = now;
stepTo(lateFrom + 2500);
assert(ticks.length >= 2 && ticks.length <= 3, 'a 2.5s jump still emits the missed seconds instead of one leap');
assert(ticks[1] - ticks[0] === 1000, 'catch-up ticks stay on the 1000ms grid');

ticker.stop();
assert(queue.length === 0, 'stop clears the pending timeout');

const clock = createLiveTotalsClock();
clock.ingest({ productive: 100, unproductive: 20, other: 5 }, 'productive');
assert(clock.snapshot().productive === 100, 'ingest sets the baseline without adding a second');
clock.ingest({ productive: 100, unproductive: 20, other: 5 }, 'productive');
assert(clock.snapshot().productive === 100, 'a tracker sample at the same total does not advance the display');
clock.tick();
clock.tick();
clock.tick();
assert(clock.snapshot().productive === 103, 'three wall-clock ticks add three displayed seconds');
clock.ingest({ productive: 101, unproductive: 20, other: 5 }, 'productive');
assert(clock.snapshot().productive === 103, 'a late sample cannot rewind or skip the live second');
clock.tick();
assert(clock.snapshot().productive === 104, 'the next tick is still +1s after a sample');
clock.ingest({ productive: 0, unproductive: 0, other: 0 }, null);
assert(clock.snapshot().productive === 0, 'a cleared day resets the baseline');
clock.tick();
assert(clock.snapshot().productive === 0, 'idle ticks do not invent tracked seconds');

if (failed) {
  console.error(failed + ' live ticker checks failed');
  process.exit(1);
}
console.log('all live ticker checks passed');
