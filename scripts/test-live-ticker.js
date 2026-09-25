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
const origin = ticker.getOrigin();
assert(queue.length === 1 && queue[0].at === now + 1000, 'first fire is scheduled 1000ms out');
assert(origin === 1_000_000, 'ticker origin is the wall clock at start');

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

function fireLate(slop) {
  if (!queue.length) return;
  queue.sort((a, b) => a.at - b.at);
  const next = queue[0];
  now = next.at + slop;
  queue.shift();
  next.fn();
}

stepTo(now + 10_000);
assert(ticks.length === 10, 'ten wall-clock seconds emit ten ticks');
const gaps = [];
for (let i = 1; i < ticks.length; i += 1) gaps.push(ticks[i] - ticks[i - 1]);
assert(gaps.every((gap) => Math.abs(gap - 1000) <= 200), 'each tick is 1000ms ±200ms from the last');
assert(gaps.every((gap) => gap === 1000), 'no skipped seconds on a steady clock');
assert(
  ticks.every((at, i) => at === origin + (i + 1) * 1000),
  'fires stay on origin + n * 1000, not lastFire + 1000'
);

const lateStart = ticks.length;
now += 80;
assert(queue[0] && queue[0].at === ticks[ticks.length - 1] + 1000, 'next fire stays on the intended deadline after slop');
stepTo(now + 920);
assert(ticks.length === lateStart + 1, 'an 80ms-late clock still emits the next second once');
assert(Math.abs(ticks[ticks.length - 1] - ticks[ticks.length - 2] - 1000) <= 200, 'late fire stays within ±200ms of 1000');
assert(ticks[ticks.length - 1] === origin + 11 * 1000, 'late fire still lands on the wall-clock grid');

ticks.length = 0;
const freezeFrom = ticker.getNextAt();
now = freezeFrom + 2500;
assert(queue.length === 1, 'a 2.5s freeze keeps one pending timeout');
const stale = queue.shift();
stale.fn();
assert(ticks.length === 1, 'a 2.5s freeze paints once instead of a catch-up burst');
assert(ticker.getNextAt() === origin + Math.floor((now - origin) / 1000) * 1000 + 1000, 'after a freeze the next fire is the next grid slot');
assert(queue[0] && queue[0].at === ticker.getNextAt(), 'the shortened delay aims at that grid slot');

ticker.stop();
assert(queue.length === 0, 'stop clears the pending timeout');

const driftTicks = [];
let driftNow = 2_000_000;
const driftQueue = [];
function driftSchedule(fn, ms) {
  const id = driftQueue.length + 1;
  driftQueue.push({ id, at: driftNow + ms, fn });
  return id;
}
function driftClear(id) {
  const idx = driftQueue.findIndex((item) => item.id === id);
  if (idx >= 0) driftQueue.splice(idx, 1);
}
const driftTicker = createLiveTicker({
  interval: 1000,
  now: () => driftNow,
  schedule: driftSchedule,
  clear: driftClear,
  onTick: (at) => driftTicks.push(at)
});
driftTicker.start();
const driftOrigin = driftTicker.getOrigin();
for (let i = 0; i < 20; i += 1) {
  driftQueue.sort((a, b) => a.at - b.at);
  const next = driftQueue.shift();
  driftNow = next.at + 80;
  next.fn();
}
assert(driftTicks.length === 20, 'twenty late fires still emit twenty ticks');
assert(
  driftTicks.every((at, i) => at === driftOrigin + (i + 1) * 1000),
  '80ms slop per fire does not accumulate — deadlines stay on the 1000ms grid'
);
assert(
  driftTicker.getNextAt() === driftOrigin + 21 * 1000,
  'the 21st fire is still origin + 21000, not lastFire + 1000'
);
driftTicker.stop();

let clockNow = 5_000_000;
const clock = createLiveTotalsClock({ now: () => clockNow });
clock.ingest({ productive: 100, unproductive: 20, other: 5 }, 'productive');
assert(clock.snapshot().productive === 100, 'ingest sets the baseline without adding a second');
clock.ingest({ productive: 100, unproductive: 20, other: 5 }, 'productive');
assert(clock.snapshot().productive === 100, 'a tracker sample at the same total does not advance the display');
clockNow += 3000;
assert(clock.snapshot().productive === 103, 'three wall-clock seconds add three displayed seconds');
clock.ingest({ productive: 101, unproductive: 20, other: 5 }, 'productive');
assert(clock.snapshot().productive === 103, 'a late sample cannot rewind or skip the live second');
clockNow += 1000;
assert(clock.snapshot().productive === 104, 'the next wall-clock second is still +1s after a sample');
clock.ingest({ productive: 0, unproductive: 0, other: 0 }, null);
assert(clock.snapshot().productive === 0, 'a cleared day resets the baseline');
clockNow += 1000;
assert(clock.snapshot().productive === 0, 'idle time does not invent tracked seconds');

if (failed) {
  console.error(failed + ' live ticker checks failed');
  process.exit(1);
}
console.log('all live ticker checks passed');
