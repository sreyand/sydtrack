'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Exercise the renderer's production formatters without opening the app or data.
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
const helpersEnd = source.indexOf('function $(id)');
assert.ok(helpersEnd > 0, 'duration formatters remain available before renderer initialization');
const context = vm.createContext({});
vm.runInContext(source.slice(0, helpersEnd), context);

for (const [seconds, expected] of [
  [0, '0m'], [1, '1s'], [59.99, '59s'], [60, '1m'], [61, '1m 1s'],
  [1519, '25m 19s'], [3599, '59m 59s'], [3600, '1h'], [3601, '1h'],
  [3661, '1h 1m'], [28380, '7h 53m'], [90000, '25h']
]) assert.equal(context.fmtFriendly(seconds), expected, 'compact card duration for ' + seconds + ' seconds');

for (const value of [-1, null, undefined, NaN, Infinity, 'invalid']) {
  assert.equal(context.fmtFriendly(value), '0m', 'unusable duration has a readable zero');
}

assert.equal(context.fmtDuration(1519), '25m', 'minute-level charts keep their previous precision');
assert.equal(context.fmtGoalShort(28380), '7h 53m', 'goal durations use the same h/m notation');
assert.equal(context.fmt(3661), '1:01:01', 'clock-style session elapsed values remain unchanged');

for (const [seconds, exact, full] of [
  [0, '0s', '0 seconds'], [1, '1s', '1 second'], [60, '1m', '1 minute'],
  [61, '1m 1s', '1 minute 1 second'], [1519, '25m 19s', '25 minutes 19 seconds'],
  [3601, '1h 1s', '1 hour 1 second'], [3661, '1h 1m 1s', '1 hour 1 minute 1 second'],
  [28380, '7h 53m', '7 hours 53 minutes'], [90000, '25h', '25 hours']
]) {
  assert.equal(context.fmtDurationExact(seconds), exact, 'tooltip keeps seconds for ' + seconds);
  assert.equal(context.fmtDurationLong(seconds), full, 'full duration units for ' + seconds);
}

console.log('Compact duration formatting, full descriptions, boundary precision and clock preservation passed.');
