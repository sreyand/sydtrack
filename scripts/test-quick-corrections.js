'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, emptyDay } = require('../src/store');
const { createFocusProfiles } = require('../src/focus-profiles');
const { createQuickCorrections } = require('../src/quick-corrections');
const { validateIpcPayload } = require('../src/ipc-validate');
const { createTracker } = require('../src/tracker');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-quick-corrections-'));
async function run() {
try {
  const store = createStore(root);
  const profiles = createFocusProfiles({ dataDir: root, rules: { productive: ['jhu'], unproductive: ['r/'], other: [] }, ignore: ['chrome'] });
  const identities = { browserApps: ['researchtool'], productiveApps: [], ignoredApps: [] };
  let clock = Date.now();
  const changes = createQuickCorrections({ store, profiles, getIdentities: () => identities, now: () => clock });
  const request = { profileId: 'default', app: 'chrome', title: 'Discussion - r/jhu - Google Chrome',
    keyword: 'r/jhu', category: 'productive', toggle: true };
  let result = changes.quickSet(validateIpcPayload('rules:quickSet', request));
  assert.equal(result.profileName, 'Default', 'confirmation identifies the profile actually saved');
  profiles.save('default', { name: 'Coding' });
  assert.equal(result.profileName, 'Default', 'a later rename does not relabel an earlier save');
  assert(profiles.active().productive.includes('r/jhu'));
  assert(!profiles.active().ignore.includes('chrome'));
  assert(profiles.active().unproductive.includes('r/'), 'precise exception retains broad source rule');
  assert.deepEqual(store.snapshot().byCategory, { productive: 0, unproductive: 0, other: 0 }, 'Home rules do not rewrite history');
  profiles.save('default', { productive: [...profiles.active().productive, 'github'] });
  changes.undo(result.undoToken);
  assert(!profiles.active().productive.includes('r/jhu'));
  assert(profiles.active().productive.includes('github'), 'Undo preserves unrelated rules');
  assert(profiles.active().ignore.includes('chrome'), 'Undo restores atomically removed Ignore');
  assert.throws(() => changes.undo(result.undoToken), /expired/);

  const phrase = { ...request, title: 'A guide to linear algebra - Google Chrome', keyword: 'linear algebra', toggle: false };
  result = changes.quickSet(phrase);
  assert.equal(result.profileName, 'Coding', 'named-profile saves return their exact display name');
  assert(profiles.active().productive.includes('linear algebra'));
  assert(!profiles.active().productive.includes('algebra'), 'no guessed last-word keyword');
  const again = changes.quickSet(phrase);
  changes.undo(again.undoToken);
  assert(profiles.active().productive.includes('linear algebra'), 'idempotent phrase save does not toggle the rule off');
  changes.undo(result.undoToken);
  assert(!profiles.active().productive.includes('linear algebra'));
  for (const keyword of ['google chrome', 'site:example.com', 'imagined phrase', 'inear algebr']) {
    assert.throws(() => changes.quickSet({ ...phrase, keyword }), /Choose words/);
  }
  assert.throws(() => changes.quickSet({ ...phrase, app: 'researchtool', title: 'Report - researchtool', keyword: 'researchtool' }), /Choose words/);
  assert.throws(() => changes.quickSet({ ...phrase, app: 'Code', keyword: 'linear algebra' }), /app name/);
  result = changes.quickSet({ ...phrase, app: 'Code.exe', keyword: 'code', title: 'Project' });
  assert(profiles.active().productive.includes('code'));
  changes.undo(result.undoToken);

  result = changes.quickSet({ ...request, category: 'ignored', keyword: '' });
  assert(!profiles.active().ignore.includes('chrome'), 'explicit Ignore toggles off');
  profiles.save('default', { other: ['neutral edit'] });
  changes.undo(result.undoToken);
  assert(profiles.active().ignore.includes('chrome') && profiles.active().other.includes('neutral edit'));
  result = changes.quickSet(phrase);
  profiles.save('default', { productive: profiles.active().productive.filter(tag => tag !== 'linear algebra'), other: ['linear algebra'] });
  assert.throws(() => changes.undo(result.undoToken), /changed again/);
  result = changes.quickSet(phrase);
  profiles.save(null, { name: 'Work', productive: [], unproductive: [], other: [], ignore: [] });
  const work = profiles.snapshot().profiles.find(p => p.name === 'Work');
  profiles.activate(work.id);
  assert.throws(() => changes.quickSet(phrase), /profile changed/i);
  assert.throws(() => changes.undo(result.undoToken), /profile changed/i);
  profiles.activate('default');
  changes.undo(result.undoToken);
  result = changes.quickSet(phrase);
  clock += 120001;
  assert.throws(() => changes.undo(result.undoToken), /expired/);

  // Disk failures retain old state and do not consume a usable Undo token.
  result = changes.quickSet({ ...request, app: 'Code', keyword: 'code', title: 'Project' });
  const before = profiles.snapshot();
  const originalSave = profiles.save;
  profiles.save = () => { throw new Error('disk full'); };
  assert.throws(() => changes.undo(result.undoToken), /disk full/);
  assert.deepEqual(profiles.snapshot(), before);
  profiles.save = originalSave;
  changes.undo(result.undoToken);
  assert(!profiles.active().productive.includes('code'));

  const activity = { category: 'unproductive', reason: 'youtube' };
  store.addSeconds('Chrome', 'unproductive', 60, activity);
  store.addSeconds('Code', 'productive', 30, { category: 'productive', reason: 'App identity' });
  const id = store.snapshot().activityRows.find(row => row.reason === 'youtube').id;
  result = changes.correctActivity(id, 'productive');
  assert.equal(result.stats.byCategory.productive, 90);
  store.addSeconds('Chrome', 'productive', 15, activity);
  store.addSeconds('Code', 'productive', 10, { category: 'productive', reason: 'App identity' });
  let undone = changes.undo(result.undoToken).stats;
  assert.equal(undone.byCategory.unproductive, 75, 'Undo includes newly earned seconds');
  assert.equal(undone.byCategory.productive, 40, 'Undo leaves other apps untouched');
  assert.equal(store.getActivityCorrection('Chrome', activity), undefined, 'Undo removes an override that was originally absent');
  const hours = undone.byHour.reduce((sum, hour) => sum + hour.unproductive, 0);
  assert.equal(hours, 75, 'hourly totals are restored too');
  store.correctActivityToday(id, 'other');
  result = changes.correctActivity(id, 'ignored');
  undone = changes.undo(result.undoToken).stats;
  assert.equal(undone.byCategory.other, 75);
  assert.equal(store.getActivityCorrection('Chrome', activity), 'other', 'Undo restores a prior explicit override');
  assert.equal(createStore(root).getActivityCorrection('Chrome', activity), 'other', 'restored override survives restart');
  const githubActivity = { category: 'productive', reason: 'github' };
  store.addSeconds('Chrome', 'productive', 20, githubActivity);
  const githubId = store.snapshot().activityRows.find(row => row.reason === 'github').id;
  const dayChange = changes.correctActivity(githubId, 'unproductive');
  const futureRule = changes.quickSet({ ...request, app: 'Chrome', title: 'Repository - GitHub', keyword: 'github', toggle: false });
  assert.equal(futureRule.previewCategory, 'unproductive', 'Home reports the actual today-only override, not just the future rule');
  changes.undo(futureRule.undoToken);
  changes.undo(dayChange.undoToken);
  result = changes.correctActivity(id, 'productive');
  store.correctActivityToday(id, 'unproductive');
  assert.throws(() => changes.undo(result.undoToken), /changed again/);
  store.addSeconds('Chrome', 'other', 15, { category: 'other', reason: 'No matching keyword' });
  const unknown = store.snapshot().activityRows.find(row => row.reason === 'No matching keyword').id;
  assert.throws(() => changes.correctActivity(unknown, 'productive'), /Unrecognized browser/);
  result = changes.correctActivity(id, 'productive');
  const current = structuredClone(store.getState());
  store.replaceToday(emptyDay('2000-01-01'));
  assert.throws(() => changes.undo(result.undoToken));
  store.replaceToday(current);
  changes.clear();
  assert.throws(() => changes.undo(result.undoToken), /expired/);

  assert.throws(() => validateIpcPayload('corrections:undo', { id, previousCategory: 'productive' }));
  assert.throws(() => validateIpcPayload('rules:quickSet', { ...phrase, profileId: null }));
  assert.throws(() => validateIpcPayload('rules:quickSet', { ...phrase, title: 'x'.repeat(4097) }));
  assert.throws(() => validateIpcPayload('rules:quickSet', { ...phrase, extra: true }));

  // While the app itself is foreground, a correction must not erase the last
  // real window. Refresh its true category without recording a new sample.
  const trackingStore = createStore(path.join(root, 'tracker'));
  const rulesHolder = { rules: { productive: ['github'], unproductive: [], other: [] } };
  const ignoreHolder = { ignore: [] };
  let foreground = { owner: { name: 'chrome' }, title: 'Repository - GitHub' }, at = Date.now(), lastTick;
  const tracker = createTracker({ store: trackingStore, rulesHolder, ignoreHolder, now: () => at,
    backend: { getActiveWindow: async () => ({ window: foreground, idleSec: 0 }) }, onTick: tick => { lastTick = tick; } });
  try {
    at += 1000; await tracker.poll();
    const focused = tracker.getLastFocused();
    assert.equal(focused.category, 'productive');
    const earned = trackingStore.snapshot().byCategory.productive;
    foreground = { owner: { name: 'sydtrack' }, title: 'sydtrack' };
    rulesHolder.rules = { productive: [], unproductive: ['github'], other: [] };
    tracker.invalidateClassification({ preserveLastFocused: true });
    assert.equal(tracker.getLastFocused().category, 'unproductive');
    assert.equal(tracker.getLastFocused().title, focused.title);
    assert.equal(trackingStore.snapshot().byCategory.productive, earned, 'refresh does not rewrite earned time');
    at += 1000; await tracker.poll();
    assert.equal(lastTick.lastFocused.category, 'unproductive', 'context survives a foreground sydtrack sample');
    assert.equal(trackingStore.snapshot().byCategory.unproductive, 0, 'refresh does not invent tracked seconds');
    ignoreHolder.ignore = ['chrome'];
    tracker.invalidateClassification({ preserveLastFocused: true });
    assert.equal(tracker.getLastFocused().category, 'ignored', 'whole-app Ignore keeps its reversible context');
    ignoreHolder.ignore = [];
    rulesHolder.rules = { productive: ['github'], unproductive: [], other: [] };
    const trackedId = trackingStore.snapshot().activityRows[0].id;
    trackingStore.correctActivityToday(trackedId, 'other');
    tracker.invalidateClassification({ preserveLastFocused: true });
    assert.equal(tracker.getLastFocused().category, 'other', 'today-only corrections remain authoritative over future rules');
    tracker.invalidateClassification();
    assert.equal(tracker.getLastFocused(), null, 'destructive data invalidation still clears ephemeral focus');
  } finally { tracker.stop(); }
  console.log('Quick corrections checks passed: literal phrases, precise sources, atomic Ignore, guarded Undo, new seconds, restart, expiry and failures.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
}
run().catch(error => { console.error(error); process.exitCode = 1; });
