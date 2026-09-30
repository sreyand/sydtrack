'use strict';

// Synthetic browser titles only: never reads a person's activity or profiles.
// Optional --compare-head measures the committed matcher against the working tree.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { performance } = require('perf_hooks');
const root = path.join(__dirname, '..');
const compile = source => {
  const module = { exports: {} };
  vm.runInNewContext(source, { module, URL }, { filename: 'browser-rules.js' });
  return module.exports;
};
const current = compile(fs.readFileSync(path.join(root, 'src/browser-rules.js'), 'utf8'));
const baseline = process.argv.includes('--compare-head')
  ? compile(execFileSync('git', ['show', 'HEAD:src/browser-rules.js'], { cwd: root, encoding: 'utf8' })) : null;
const preset = require('../src/default-focus-profiles.json').profiles[0];
const fallback = require('../src/default-browser-keywords.json');
const titles = [
  'Workspace - GitHub - Google Chrome', 'Research notes - Google Docs - Google Chrome',
  'Question - r/jhu - Google Chrome', 'Python question - r/learnpython - Reddit - Google Chrome',
  'GitHub tutorial - YouTube - Google Chrome', 'Home / X - Google Chrome',
  'How to do it - Google Chrome', 'New Tab - Google Chrome',
  'Daily planning - Notion - Mozilla Firefox', 'Chrome DevTools guide - Google Chrome'
];
const entries = titles.map(title => ({ title, owner: { name: 'chrome' }, url: '' }));

function measure(matcher, rules, repetitions) {
  for (let i = 0; i < 100; i++) for (const entry of entries) matcher.browserMatch(entry, rules);
  const start = performance.now();
  let classified = 0;
  for (let i = 0; i < repetitions; i++) for (const entry of entries) {
    if (matcher.browserMatch(entry, rules).category !== 'other') classified++;
  }
  const calls = repetitions * entries.length;
  return { microsecondsPerCall: (performance.now() - start) * 1000 / calls, calls, classified };
}

for (const [name, rules, repetitions] of [
  ['General profile', { ...preset, browserKeywords: fallback }, 400],
  ['1,500 custom terms', {
    productive: Array.from({ length: 1000 }, (_, i) => 'synthetic work ' + i),
    unproductive: Array.from({ length: 500 }, (_, i) => 'synthetic distraction ' + i),
    other: [], browserKeywords: fallback
  }, 100]
]) {
  const samples = [], previous = [];
  for (let i = 0; i < 3; i++) {
    if (baseline) previous.push(measure(baseline, rules, repetitions).microsecondsPerCall);
    samples.push(measure(current, rules, repetitions).microsecondsPerCall);
  }
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const now = median(samples);
  console.log(name + ': ' + now.toFixed(1) + ' µs/classification (median of 3 runs)' +
    (baseline ? '; HEAD ' + median(previous).toFixed(1) + ' µs, ' + (median(previous) / now).toFixed(2) + '× speed ratio' : ''));
}
console.log('Timing measures matcher cost, not classification accuracy or total application CPU.');
