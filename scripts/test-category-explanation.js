'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyWithReason } = require('../src/classifier');
const { createExplanation, formatExplanation } = require('../src/classification-explanation');
const { createStore } = require('../src/store');
const { createTracker } = require('../src/tracker');
const { createFocusProfiles } = require('../src/focus-profiles');
const { createQuickCorrections } = require('../src/quick-corrections');

const win = (title, app = 'chrome') => ({ owner: { name: app }, title });
const profileRules = (fields = {}) => ({ productive: [], unproductive: [], other: [],
  profileId: 'default', profileName: 'Work', ...fields });
const explain = (window, rules) => {
  const activity = classifyWithReason(window, rules);
  return { activity, info: createExplanation({ activity, category: activity.category, rules }) };
};

assert.equal(createExplanation({ activity: null, category: 'other' }), null, 'no foreground activity has no category explanation');

// A grouped browser reason is the correction identity, not necessarily the tag
// that won. Explanation metadata must keep those two values separate.
for (const broad of ['r/', 'reddit']) {
  const { activity, info } = explain(win('Admissions - r/jhu'), profileRules({ unproductive: [broad] }));
  assert.equal(activity.reason, 'r/jhu', 'recorded browser group stays stable');
  assert.equal(activity.matchedRule, broad, 'explanation identifies the broad tag actually matched');
  assert.equal(info.kind, 'rule');
  assert.equal(info.rule, broad);
  assert.equal(info.origin, 'profile');
  assert.equal(info.profileId, 'default');
  assert.equal(info.profileName, 'Work');
  assert.match(formatExplanation(info), new RegExp(broad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

const neutral = explain(win('Admissions - r/jhu'), profileRules({ unproductive: ['reddit'], other: ['admissions'] }));
assert.equal(neutral.activity.reason, 'r/jhu');
assert.equal(neutral.activity.matchedRule, 'admissions');
assert.equal(neutral.info.category, 'other');
assert.equal(neutral.info.rule, 'admissions', 'an explicit Other exception explains its true winning keyword');
assert.equal(neutral.info.origin, 'profile');

const specific = explain(win('Python question - r/learnpython'), profileRules({ productive: ['r/learnpython'], unproductive: ['reddit'] }));
assert.equal(specific.info.category, 'productive');
assert.equal(specific.info.rule, 'r/learnpython', 'a specific source exception explains the specific tag');

for (const [title, keyword] of [['Repository - GitHub', 'github'], ['Homework notes', 'homework']]) {
  const global = explain(win(title), profileRules({ browserKeywords: { productive: [keyword], unproductive: [] } }));
  assert.equal(global.info.rule, keyword);
  assert.equal(global.info.origin, 'browser', 'global Browser Keywords are not attributed to the active profile');
  assert.match(formatExplanation(global.info), /browser/i);
}
const website = win('Private project title');
website.url = 'https://docs.example.com/projects/private';
const site = explain(website, profileRules({ unproductive: ['site:example.com'], productive: ['site:docs.example.com'] }));
assert.equal(site.info.rule, 'site:docs.example.com', 'the most specific website rule is explained');
assert.equal(site.info.origin, 'profile');

const native = explain(win('Private project with YouTube notes', 'Code'), profileRules({
  unproductive: ['youtube'], identities: { productiveApps: ['code'] }
}));
assert.equal(native.info.category, 'productive');
assert.equal(native.info.kind, 'app', 'built-in app identity is not presented as a literal keyword');
assert.match(formatExplanation(native.info), /app/i);
const unknown = explain(win('Untitled page - Google Chrome'), profileRules());
assert.equal(unknown.info.kind, 'none');
assert.match(formatExplanation(unknown.info), /no matching/i);
assert.equal(createExplanation({ activity: native.activity, category: 'ignored', correction: 'productive', ignored: true,
  rules: profileRules() }).kind, 'ignore', 'an authoritative self-exclusion is not attributed to a conflicting today correction');
assert.match(formatExplanation(specific.info, { demo: true }), /demo/i, 'demo context remains visible in explanation copy');

const datedCorrection = createExplanation({ activity: specific.activity, category: 'productive', correction: 'productive',
  correctionDate: '2026-10-01', rules: profileRules() });
assert.equal(datedCorrection.correctionDate, '2026-10-01', 'today-only correction metadata remembers its store day');
assert.match(formatExplanation(datedCorrection, { today: '2026-10-01' }), /for today only/i);
const afterMidnight = formatExplanation(datedCorrection, { today: '2026-10-02' });
assert.match(afterMidnight, /for 2026-10-01 only/i, 'retained focus names the original correction day after midnight');
assert.doesNotMatch(afterMidnight, /today/i, 'yesterday\'s correction does not claim to apply today');
assert.match(formatExplanation(datedCorrection, { today: '2026-10-02', demo: true }), /demo/i);
assert.equal(createExplanation({ activity: specific.activity, category: specific.activity.category,
  correctionDate: '2026-10-01', rules: profileRules() }).correctionDate, undefined, 'profile rules do not acquire today-only date metadata');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-category-explanation-'));
const trackers = [];
function fixture(name, foreground, fields = {}) {
  const store = createStore(path.join(root, name));
  const rulesHolder = { rules: profileRules(fields) };
  const ignoreHolder = { ignore: [] };
  let at = Date.now(), tick;
  const context = { foreground };
  const tracker = createTracker({ store, rulesHolder, ignoreHolder, now: () => at,
    backend: { getActiveWindow: async () => ({ window: context.foreground, idleSec: 0 }) },
    onTick: value => { tick = value; } });
  trackers.push(tracker);
  return { store, tracker, rulesHolder, ignoreHolder, context,
    async poll() { at += 1000; await tracker.poll(); return tick; } };
}

async function run() {
  try {
    const focused = fixture('refresh', win('Private sample title - GitHub'), { productive: ['github'] });
    let tick = await focused.poll();
    assert.equal(tick.now.explanation.rule, 'github');
    assert.equal(tick.lastFocused.explanation.rule, 'github');
    assert.equal(tick.lastFocused.explanation.profileName, 'Work');
    const earned = focused.store.snapshot().byCategory.productive;
    focused.context.foreground = win('sydtrack', 'sydtrack');
    focused.rulesHolder.rules = profileRules({ unproductive: ['github'], profileName: 'Leisure' });
    focused.tracker.invalidateClassification({ preserveLastFocused: true });
    let last = focused.tracker.getLastFocused();
    assert.equal(last.category, 'unproductive');
    assert.equal(last.explanation.category, last.category, 'metadata refresh updates explanation together with category');
    assert.equal(last.explanation.rule, 'github');
    assert.equal(last.explanation.profileName, 'Leisure');
    assert.equal(focused.store.snapshot().byCategory.productive, earned, 'metadata refresh does not rewrite earned time');
    tick = await focused.poll();
    assert.equal(tick.lastFocused.explanation.profileName, 'Leisure', 'focus context survives while sydtrack is foreground');
    assert.equal(focused.store.snapshot().byCategory.unproductive, 0, 'metadata refresh does not invent new seconds');
    focused.ignoreHolder.ignore = ['chrome'];
    focused.tracker.invalidateClassification({ preserveLastFocused: true });
    last = focused.tracker.getLastFocused();
    assert.equal(last.category, 'ignored');
    assert.equal(last.explanation.kind, 'ignore');
    assert.match(formatExplanation(last.explanation), /ignor/i);

    const corrected = fixture('row-correction', win('Repository - GitHub'), { productive: ['github'] });
    tick = await corrected.poll();
    const activityId = corrected.store.snapshot().activityRows[0].id;
    corrected.store.correctActivityToday(activityId, 'productive');
    corrected.tracker.invalidateClassification({ preserveLastFocused: true });
    assert.equal(corrected.tracker.getLastFocused().explanation.kind, 'today', 'even a same-category explicit correction explains today-only scope');
    assert.equal(corrected.tracker.getLastFocused().explanation.correctionDate, corrected.store.getState().date,
      'refreshed same-category correction keeps its store date');
    tick = await corrected.poll();
    assert.equal(tick.now.explanation.kind, 'today');
    assert.equal(tick.now.explanation.correctionDate, corrected.store.getState().date);
    assert.match(formatExplanation(tick.now.explanation), /today/i);
    corrected.store.correctAppToday('chrome', 'unproductive');
    tick = await corrected.poll();
    assert.equal(tick.now.category, 'productive', 'activity correction retains precedence over an app correction');
    assert.equal(tick.now.explanation.category, 'productive');
    assert.equal(tick.now.explanation.kind, 'today');
    corrected.store.correctActivityToday(activityId, 'ignored');
    tick = await corrected.poll();
    assert.equal(tick.now.category, 'ignored');
    assert.equal(tick.now.explanation.kind, 'today', 'today-only Ignore is not explained as a saved profile Ignore');

    const appCorrected = fixture('app-correction', win('Private native task', 'ExampleApp'));
    appCorrected.store.correctAppToday('ExampleApp', 'productive');
    tick = await appCorrected.poll();
    assert.equal(tick.now.category, 'productive');
    assert.equal(tick.lastFocused.explanation.kind, 'today', 'app-wide corrections explain today-only scope');
    assert.equal(tick.lastFocused.explanation.correctionDate, appCorrected.store.getState().date,
      'app-wide correction captures the same store date as an activity correction');
    const self = fixture('self-exclusion', win('sydtrack', 'sydtrack'), { productive: ['sydtrack'] });
    self.store.correctAppToday('sydtrack', 'productive');
    tick = await self.poll();
    assert.equal(tick.now.category, 'ignored', 'self-exclusion retains precedence over corrections');
    assert.equal(tick.now.explanation.kind, 'ignore');
    assert.equal(tick.lastFocused, null);

    const identityIgnored = fixture('ignored-identity', win('Private system task', 'ExampleApp'), {
      identities: { ignoredApps: ['exampleapp'] }
    });
    tick = await identityIgnored.poll();
    assert.equal(tick.now.category, 'ignored');
    assert.equal(tick.now.explanation.kind, 'ignore', 'ignored app identity explains why tracking is excluded');
    const waiting = fixture('waiting', null);
    tick = await waiting.poll();
    assert.equal(tick.now.explanation, null, 'a waiting placeholder does not claim an unmatched category rule');

    const demo = fixture('demo', win('unused native window', 'ExampleApp'));
    demo.store.updateSettings({ demoMode: true });
    tick = await demo.poll();
    assert.equal(tick.now.source, 'demo');
    assert.equal(tick.lastFocused.source, 'demo');
    assert.match(formatExplanation(tick.lastFocused.explanation, { demo: tick.lastFocused.source === 'demo' }), /demo/i);

    const data = JSON.stringify(focused.store.getState());
    for (const value of ['Private sample title', 'explanation', 'matchedRule', 'ruleOrigin', 'profileName', 'Leisure']) {
      assert(!data.includes(value), 'ephemeral classification metadata is not persisted: ' + value);
    }
    const dayFile = path.join(root, 'refresh', 'stats.json');
    const disk = fs.readFileSync(dayFile, 'utf8');
    assert(!disk.includes('Private sample title') && !disk.includes('explanation'), 'disk history excludes titles and explanations');

    const quickRoot = path.join(root, 'quick');
    const quickStore = createStore(quickRoot);
    const profiles = createFocusProfiles({ dataDir: quickRoot, rules: { productive: ['github'], unproductive: [], other: [] }, ignore: [] });
    const changes = createQuickCorrections({ store: quickStore, profiles });
    const activity = classifyWithReason(win('Repository - GitHub'), profiles.active());
    quickStore.addSeconds('chrome', activity.category, 10, activity);
    const id = quickStore.snapshot().activityRows[0].id;
    quickStore.correctActivityToday(id, 'unproductive');
    const result = changes.quickSet({ profileId: 'default', app: 'chrome', title: 'Repository - GitHub',
      keyword: 'github', category: 'productive', toggle: false });
    assert.equal(result.previewCategory, 'unproductive');
    assert.equal(result.previewExplanation.kind, 'today', 'quick-rule preview explains the actual correction that still wins');
    assert.equal(result.previewExplanation.category, result.previewCategory);
    assert.equal(result.previewExplanation.correctionDate, quickStore.getState().date, 'quick preview preserves correction date');
    changes.clear();
    console.log('Category explanation checks passed: true winning tags, scope, corrections, refresh, demo, and private history.');
  } finally {
    for (const tracker of trackers) tracker.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
