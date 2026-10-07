'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const { THEME_IDS, isDarkTheme } = require('../src/theme');
const {
  poolForMode,
  normalizeRotationMode,
  validDateKey,
  millisecondsUntilNextDay,
  initializeThemeRotation,
  resolveDailyTheme
} = require('../src/theme-rotation');

function dateAfter(date, days) {
  const at = new Date(date + 'T12:00:00Z');
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function enabled(settings, today) {
  const source = { themeRotationEnabled: true, ...settings };
  return { ...source, ...initializeThemeRotation(source, today) };
}

function themeAt(settings, today) {
  return { ...settings, ...resolveDailyTheme(settings, today) }.theme;
}

assert.deepStrictEqual(poolForMode('dark'), ['midnight', 'tide', 'plum', 'forest', 'dusk']);
assert.deepStrictEqual(poolForMode('light'), ['linen', 'graphite', 'coral', 'starlight']);
assert.deepStrictEqual(poolForMode('any'), THEME_IDS);
assert(poolForMode('dark').every(isDarkTheme));
assert(poolForMode('light').every((theme) => !isDarkTheme(theme)));
assert.deepStrictEqual([...poolForMode('dark'), ...poolForMode('light')].sort(), [...THEME_IDS].sort());
const poolCopy = poolForMode('any');
poolCopy.reverse();
assert.deepStrictEqual(poolForMode('any'), THEME_IDS, 'callers cannot mutate the shared theme catalog through a pool');
for (const mode of ['dark', 'light', 'any']) assert.strictEqual(normalizeRotationMode(mode), mode);
for (const mode of [undefined, null, true, false, 1, 'Dark', 'all', '', {}, []]) {
  assert.strictEqual(normalizeRotationMode(mode), 'dark');
}

for (const date of ['2026-10-07', '2024-02-29', '2000-02-29', '2026-12-31']) assert(validDateKey(date));
for (const date of [undefined, null, 20261007, new Date(), '2026-2-03', '2026-02-29', '1900-02-29',
  '2026-04-31', '2026-00-07', '2026-13-01', '2026-10-00', '2026-10-07T00:00:00Z', '2026-10-07 ']) {
  assert.strictEqual(validDateKey(date), false, 'invalid local calendar date is rejected: ' + date);
}

for (const mode of ['dark', 'light', 'any']) {
  const pool = poolForMode(mode);
  for (const theme of pool) {
    const anchor = enabled({ theme, themeRotationMode: mode }, '2026-10-07');
    assert.strictEqual(anchor.theme, theme, mode + ' keeps the current eligible appearance when enabled');
    assert.strictEqual(anchor.themeRotationAnchorTheme, theme);
    assert.strictEqual(anchor.themeRotationAnchorDate, '2026-10-07');
    assert.deepStrictEqual(resolveDailyTheme(anchor, '2026-10-07'), {}, 'enabling does not rotate again on the same day');
    for (let day = 1; day <= pool.length * 2; day += 1) {
      const next = themeAt(anchor, dateAfter('2026-10-07', day));
      assert.strictEqual(next, pool[(pool.indexOf(theme) + day) % pool.length]);
      assert.notStrictEqual(next, themeAt(anchor, dateAfter('2026-10-07', day - 1)), 'adjacent dates do not repeat');
    }
    assert.strictEqual(themeAt(anchor, dateAfter('2026-10-07', pool.length)), theme, 'each eligible cycle wraps');
    const skipped = dateAfter('2026-10-07', pool.length * 3 + 2);
    assert.strictEqual(themeAt(anchor, skipped), pool[(pool.indexOf(theme) + 2) % pool.length],
      'skipped calendar dates advance by the entire gap, not one launch');
  }
}

assert.strictEqual(initializeThemeRotation({ theme: 'coral', themeRotationMode: 'dark' }, '2026-10-07').theme, 'midnight');
assert.strictEqual(initializeThemeRotation({ theme: 'forest', themeRotationMode: 'light' }, '2026-10-07').theme, 'linen');
assert.strictEqual(initializeThemeRotation({ theme: 'forest', themeRotationMode: 'any' }, '2026-10-07').theme, 'forest');
assert.strictEqual(initializeThemeRotation({ theme: 'unknown', themeRotationMode: 'light' }, '2026-10-07').theme, 'linen');
assert.strictEqual(initializeThemeRotation({ theme: false, themeRotationMode: 'light' }, '2026-10-07').theme, 'graphite');

const original = Object.freeze(enabled({ theme: 'forest', themeRotationMode: 'dark' }, '2026-10-07'));
const nextDay = { ...original, ...resolveDailyTheme(original, '2026-10-08') };
assert.strictEqual(nextDay.theme, 'dusk');
assert.deepStrictEqual(resolveDailyTheme(nextDay, '2026-10-08'), {}, 'same-day state refresh needs no write');
const restarted = JSON.parse(JSON.stringify(nextDay));
assert.deepStrictEqual(resolveDailyTheme(restarted, '2026-10-08'), {}, 'restart does not advance a daily theme');
assert.strictEqual(themeAt(restarted, '2026-10-10'), 'tide', 'restart keeps the original anchor, not the last resolved theme');
const reorderedSettings = Object.fromEntries(Object.entries(restarted).reverse());
assert.deepStrictEqual(resolveDailyTheme(reorderedSettings, '2026-10-10'), resolveDailyTheme(restarted, '2026-10-10'));
assert.strictEqual(themeAt(nextDay, '2026-10-06'), 'plum', 'backward dates resolve deterministically with positive modulo');
assert.strictEqual(themeAt(nextDay, '2026-10-01'), 'plum', 'backward dates can wrap more than once');
assert.strictEqual(themeAt(nextDay, '2026-10-07'), 'forest', 'returning to an earlier day restores that calendar theme');
assert.strictEqual(original.theme, 'forest', 'pure resolution does not mutate source settings');

// A stable theme ID, not an ordinal, is the persisted anchor. Future cycle
// order follows the theme catalog if a later release deliberately reorders it.
const originalOrder = THEME_IDS.slice();
try {
  THEME_IDS.reverse();
  assert.strictEqual(themeAt(original, '2026-10-07'), 'forest', 'catalog reorder does not move the anchor theme');
  assert.strictEqual(themeAt(original, '2026-10-08'), 'plum', 'the next day follows the reordered eligible catalog');
} finally {
  THEME_IDS.splice(0, THEME_IDS.length, ...originalOrder);
}

// Date keys are LOCAL dates chosen by main. Across the New York DST changes,
// their UTC calendar-label ordinal still advances exactly one step per date.
for (const [anchorDate, dates] of [
  ['2026-03-07', ['2026-03-08', '2026-03-09', '2026-03-10']],
  ['2026-10-31', ['2026-11-01', '2026-11-02', '2026-11-03']],
  ['2024-02-28', ['2024-02-29', '2024-03-01', '2024-03-02']],
  ['2026-12-31', ['2027-01-01', '2027-01-02', '2027-01-03']]
]) {
  const anchor = enabled({ theme: 'midnight', themeRotationMode: 'any' }, anchorDate);
  for (let i = 0; i < dates.length; i += 1) assert.strictEqual(themeAt(anchor, dates[i]), THEME_IDS[i + 1]);
}
const dateNow = Date.now;
try {
  Date.now = () => { throw new Error('The pure helper must not consult the wall clock.'); };
  assert.strictEqual(themeAt(original, '2026-10-08'), 'dusk');
} finally {
  Date.now = dateNow;
}

for (const settings of [undefined, null, {}, { themeRotationEnabled: false },
  { themeRotationEnabled: 1 }, { themeRotationEnabled: 'true' }, { ...original, themeRotationEnabled: false }]) {
  assert.deepStrictEqual(resolveDailyTheme(settings, '2026-10-08'), {}, 'rotation requires explicit true opt-in');
}
for (const today of [undefined, null, '2026-02-29', '2026-10-07T01:00:00Z']) {
  assert.deepStrictEqual(initializeThemeRotation(original, today), {});
  assert.deepStrictEqual(resolveDailyTheme(original, today), {}, 'invalid today never changes the theme or anchor');
}
for (const invalidAnchor of [
  { themeRotationAnchorDate: undefined },
  { themeRotationAnchorDate: '2026-02-29' },
  { themeRotationAnchorTheme: undefined },
  { themeRotationAnchorTheme: 'unknown' },
  { themeRotationAnchorTheme: 'coral' }
]) {
  const source = { ...original, ...invalidAnchor };
  const patch = resolveDailyTheme(source, '2026-10-08');
  assert.deepStrictEqual(patch, initializeThemeRotation(source, '2026-10-08'), 'invalid anchors initialize from today/current eligible theme');
  assert.strictEqual(patch.theme, 'forest');
  assert.deepStrictEqual(resolveDailyTheme({ ...source, ...patch }, '2026-10-08'), {}, 'repaired anchors stay stable on that day');
}
const malformedMode = { ...original, themeRotationMode: 'unknown' };
assert.deepStrictEqual(resolveDailyTheme(malformedMode, '2026-10-07'), { themeRotationMode: 'dark' });
const changedMode = { ...original, themeRotationMode: 'light' };
assert.deepStrictEqual(resolveDailyTheme(changedMode, '2026-10-08'), initializeThemeRotation(changedMode, '2026-10-08'));
assert.deepStrictEqual(initializeThemeRotation({ ...original, themeRotationMode: 'any', theme: 'dusk' }, '2026-10-08'), {
  theme: 'dusk', themeRotationMode: 'any', themeRotationAnchorDate: '2026-10-08', themeRotationAnchorTheme: 'dusk'
}, 'main can explicitly re-anchor a mode change even when the old anchor remains eligible');

const beforeMidnight = new Date(2026, 9, 7, 23, 59, 59, 999);
const previousTime = beforeMidnight.getTime();
assert.strictEqual(millisecondsUntilNextDay(beforeMidnight), 1, 'the midnight timer always has a positive delay');
assert.strictEqual(beforeMidnight.getTime(), previousTime, 'scheduler calculation does not mutate its Date input');
for (const invalid of [undefined, null, {}, '2026-10-07', 0, new Date(NaN), new Date(8.64e15)]) {
  assert.strictEqual(millisecondsUntilNextDay(invalid), 60000, 'invalid clock input gets a bounded retry, not an immediate loop');
}
const dstSource = [
  'const assert = require("assert");',
  'const { millisecondsUntilNextDay, initializeThemeRotation, resolveDailyTheme } = require(' + JSON.stringify(require.resolve('../src/theme-rotation')) + ');',
  'assert.strictEqual(millisecondsUntilNextDay(new Date(2026, 2, 8, 0)), 23 * 3600000);',
  'assert.strictEqual(millisecondsUntilNextDay(new Date(2026, 10, 1, 0)), 25 * 3600000);',
  'assert.strictEqual(millisecondsUntilNextDay(new Date(2026, 9, 7, 0)), 24 * 3600000);',
  'assert.strictEqual(millisecondsUntilNextDay(new Date(2026, 2, 8, 23, 59, 59, 999)), 1);',
  'const key = date => date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");',
  'const source = { theme: "midnight", themeRotationEnabled: true, themeRotationMode: "any" };',
  'const spring = { ...source, ...initializeThemeRotation(source, key(new Date(2026, 2, 8, 0))) };',
  'assert.strictEqual(resolveDailyTheme(spring, key(new Date(2026, 2, 9, 0))).theme, "tide");',
  'const fall = { ...source, ...initializeThemeRotation(source, key(new Date(2026, 10, 1, 0))) };',
  'assert.strictEqual(resolveDailyTheme(fall, key(new Date(2026, 10, 2, 0))).theme, "tide");',
  'const secondOneAm = new Date("2026-11-01T01:30:00-05:00");',
  'assert.deepStrictEqual(resolveDailyTheme(fall, key(secondOneAm)), {});',
  'console.log("local DST rotation and scheduler checks passed");'
].join('\n');
assert.strictEqual(execFileSync(process.execPath, ['-e', dstSource], {
  env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8'
}).trim(), 'local DST rotation and scheduler checks passed');

console.log('theme rotation checks passed');
