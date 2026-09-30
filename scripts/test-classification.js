'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classify, classifyWithReason } = require('../src/classifier');
const { contentTitle, titleSource, quickKeyword } = require('../src/browser-rules');
const { createStore } = require('../src/store');
const { buildRollup } = require('../src/rollups');
const { appEntryName } = require('../src/store');

const window = (title, app = 'Google Chrome') => ({ owner: { name: app }, title });
const match = (title, rules, app) => classifyWithReason(window(title, app), rules);

for (const category of ['productive', 'unproductive', 'other']) {
  const rules = { [category]: ['google chrome', 'chrome', 'browser'], productive: category === 'productive' ? ['google chrome', 'chrome', 'browser', 'github'] : ['github'] };
  assert.equal(match('Untitled page - Google Chrome', rules).category, 'other');
  assert.equal(match('Project - GitHub - Google Chrome', rules).category, 'productive');
}
assert.equal(match('Google - Google Chrome', { productive: ['google chrome'] }).category, 'other');
assert.equal(match('Untitled page - Google Chrome', { productive: ['google'] }).category, 'other');
assert.equal(match('Chrome DevTools guide - Google Chrome', { productive: ['chrome devtools'] }).category, 'productive');
for (const [app, suffix] of [['Chrome', 'Google Chrome'], ['msedge', 'Microsoft Edge'],
  ['Firefox', 'Mozilla Firefox'], ['Brave', 'Brave'], ['Opera', 'Opera'], ['LibreWolf', 'LibreWolf']]) {
  assert.equal(contentTitle('Notes — ' + suffix), 'Notes');
  assert.equal(match('Notes — ' + suffix, { productive: [suffix.toLowerCase()] }, app).category, 'other');
}
assert.equal(contentTitle('Notes - Microsoft Edge (InPrivate)'), 'Notes');
assert.equal(contentTitle('Notes - Research Browser', ['research browser']), 'Notes');
assert.equal(match('Notes - Research Browser', { productive: ['research browser'], identities: { browserApps: ['research browser'] } }, 'research browser').category, 'other');

const rules = { productive: ['jhu', 'python', 'github', 'r/learnpython'], unproductive: ['r/', 'reddit', 'youtube'], other: [] };
assert.equal(match('Admissions - r/JHU - Google Chrome', rules).reason, 'r/jhu');
assert.equal(match('Admissions - r/JHU - Google Chrome', rules).category, 'unproductive');
assert.equal(match('Python question - r/learnpython', rules).category, 'productive');
assert.equal(match('Python question - r/learnpython - Reddit', rules).reason, 'r/learnpython');
assert.equal(match('GitHub tutorial - YouTube', rules).category, 'unproductive');
assert.equal(match('Reddit issue tracker - GitHub', rules).category, 'productive');
assert.equal(match('GitHub - example/youtube-tools: project documentation', rules).category, 'productive');
assert.equal(match('GitHub - example/youtube-tools - Reddit', rules).category, 'unproductive');
assert.equal(match('Reddit fixes · GitHub', rules).category, 'productive');
assert.equal(titleSource('GitHub tips for YouTube'), null);
assert.equal(titleSource('GitHub - example/repo - Google Search'), null);
assert.equal(match('GitHub tutorial - YouTube', { ...rules, productive: ['github tutorial'] }).category, 'unproductive');
assert.equal(match('YouTube lecture - YouTube', { ...rules, productive: ['youtube lecture'] }).category, 'productive');
assert.equal(match('YouTube lecture - YouTube', { ...rules, other: ['lecture'] }).category, 'other');
assert.equal(match('Admissions - r/jhu', { ...rules, other: ['r/jhu'] }).category, 'other');
assert.equal(match('Python - r/learnpython', { ...rules, other: ['r/'] }).category, 'productive');
assert.equal(match('Admissions - r/jhu', { ...rules, other: ['r/'] }).category, 'other');
assert.equal(match('Discussion - r/jhu', { productive: ['jhu'], browserKeywords: { unproductive: ['reddit'] } }).category, 'unproductive');
assert.equal(match('Research - GitHub', { unproductive: ['research'], browserKeywords: { productive: ['github'] } }).category, 'productive');
assert.equal(match('Library r/ reference', rules).category, 'other');
assert.equal(match('JHU war/jhu archive', rules).category, 'productive');
assert.equal(titleSource('How to use Reddit - Google Search'), null);
assert.equal(titleSource('What is r/jhu - Google Search'), null);
assert.equal(match('What is r/jhu - Google Search', { unproductive: ['r/'] }).category, 'other');
assert.equal(match('Library r/jhu reference', { unproductive: ['r/'] }).category, 'other');
assert.equal(match('How to read r/jhu', { unproductive: ['r/'] }).category, 'other');
assert.equal(titleSource('Query - Google Chrome'), null);
assert.equal(titleSource('Home / X')?.id, 'x.com');
assert.equal(titleSource('Notifications / X')?.id, 'x.com');

assert.equal(quickKeyword(window('Thread - r/jhu'), rules), 'r/jhu');
assert.equal(quickKeyword(window('Google - Google Chrome'), rules), null);
assert.equal(quickKeyword(window('How to do it - Google Chrome'), rules), null);
assert.equal(quickKeyword(window('A random word githubish - Google Chrome'), rules), null);
assert.equal(quickKeyword(window('Article - GitHub'), rules), 'github');
assert.equal(quickKeyword(window('YouTube lecture - YouTube'), { productive: ['youtube lecture'], unproductive: ['youtube'] }), 'youtube lecture');
assert.equal(quickKeyword(window('YouTube video editor'), { unproductive: ['youtube'] }), 'youtube');
const reordered = { productive: ['docs', 'google docs'], unproductive: [] };
assert.equal(match('Essay - Google Docs', reordered).reason, 'google docs');
reordered.productive = ['gradescope'];
assert.equal(match('Homework - Gradescope', reordered).reason, 'gradescope');
assert.equal(match('Essay - Google Docs', reordered).category, 'other');
reordered.productive.push('google docs');
assert.equal(match('Essay - Google Docs', reordered).category, 'productive');
reordered.productive[1] = 'canva';
assert.equal(match('Essay - Google Docs', reordered).category, 'other');
reordered.productive.splice(0, 2, 'github');
assert.equal(match('Project - GitHub', reordered).category, 'productive');
const changingIdentities = { productive: ['researchtool'], identities: { browserApps: [] } };
assert.equal(match('researchtool manual', changingIdentities).category, 'productive');
changingIdentities.identities.browserApps.push('researchtool');
assert.equal(match('researchtool manual', changingIdentities).category, 'other');
assert.equal(match('Question - r/learnpython', { productive: ['r/learnpython'], unproductive: ['r/learnpython'] }).category, 'unproductive');
assert.equal(match('Question - r/learnpython', { productive: ['r/learnpython'], other: ['r/learnpython'] }).category, 'other');
assert.equal(match('C++ reference', { productive: ['c++'] }).category, 'productive');
assert.equal(match('Artisan notes', { unproductive: ['art'] }).category, 'other');
assert.equal(match('Ｈｏｍｅｗｏｒｋ — Ｇｒａｄｅｓｃｏｐｅ', { productive: ['gradescope'] }).category, 'productive');
assert.equal(match('Project with YouTube notes', { identities: { productiveApps: ['code'] }, unproductive: ['youtube'] }, 'Code').category, 'productive');
assert.equal(classify(window('Project - GitHub'), rules), match('Project - GitHub', rules).category);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-classification-'));
try {
  const store = createStore(root);
  const jhu = match('Admissions - r/jhu', rules);
  const gaming = match('Discussion - r/gaming', rules);
  const unknown = match('An unknown title - Google Chrome', rules);
  store.addSeconds('chrome', jhu.category, 60, jhu);
  store.addSeconds('chrome', gaming.category, 30, gaming);
  store.addSeconds('chrome', unknown.category, 20, unknown);
  const jhuRow = store.snapshot().activityRows.find(row => row.reason === 'r/jhu');
  store.correctActivityToday(jhuRow.id, 'productive');
  assert.equal(store.getActivityCorrection('chrome', jhu), 'productive');
  assert.equal(store.getActivityCorrection('chrome', gaming), undefined);
  const unknownRow = store.snapshot().activityRows.find(row => row.reason === 'No matching rule');
  for (const category of ['productive', 'unproductive', 'ignored']) {
    assert.throws(() => store.correctActivityToday(unknownRow.id, category), /cannot be changed as one group/);
  }
  store.addSeconds('researchtool', 'other', 10, unknown);
  const customUnknown = store.snapshot().activityRows.find(row => row.name === 'researchtool');
  assert.throws(() => store.correctActivityToday(customUnknown.id, 'productive', { browserApps: ['researchtool'] }), /cannot be changed as one group/);
  assert.equal(store.snapshot().byCategory.productive, 60);
  assert.equal(store.snapshot().byCategory.unproductive, 30);
  const rollup = buildRollup(store.getState(), appEntryName);
  assert(!JSON.stringify(rollup).includes('r/jhu'));
  assert(!JSON.stringify(rollup).includes('unknown title'));
  const restarted = createStore(root);
  assert.equal(restarted.getActivityCorrection('chrome', jhu), 'productive');
  assert.equal(restarted.getActivityCorrection('chrome', gaming), undefined);
  assert.equal(restarted.snapshot().activityRows.find(row => row.reason === 'r/gaming').seconds, 30);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Classification checks passed: browser labels, source precedence, precise exceptions, quick rules, and private corrections.');
