'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const goals = require('../renderer/lib/goals');
const insights = require('../renderer/lib/insights');
const { goalPrefs, drillSharePercent, WEEK_HISTORY_DAYS } = require('../renderer/wellbeing-ui');
const { createStore } = require('../src/store');

function run(assert) {
  const eighty = goals.focusParts({ productive: 80, unproductive: 20, other: 90 }, false);
  assert(goals.sharePercent(eighty.share) === 80 && eighty.denominator === 100, 'default focus share excludes other');
  const withOther = goals.focusParts({ productive: 80, unproductive: 20, other: 90 }, true);
  assert(goals.sharePercent(withOther.share) === 42 && withOther.denominator === 190, 'optional focus share includes other');
  assert(goals.focusShareStatus({ productive: 80, unproductive: 20 }, { goalPct: 80 }).hit, '80% meets an 80% goal');

  const screen = goals.screenTimeStatus({ productive: 1000, unproductive: 1000, other: 1000 }, { enabled: true, limitSec: 2400 });
  assert(screen.trackedSec === 3000 && screen.over && screen.overBySec === 600, 'screen limit uses active tracked time');

  const days = [
    { date: '2026-09-01', byCategory: { productive: 80, unproductive: 20 } },
    { date: '2026-09-02', byCategory: { productive: 0, unproductive: 0 } },
    { date: '2026-09-03', byCategory: { productive: 50, unproductive: 50 } }
  ];
  const rolling = goals.rollingAverage(days, { window: 3, goalPct: 80 });
  assert(rolling.latest.percent === 65 && rolling.latest.samples === 2, 'rolling average skips empty days');
  assert(WEEK_HISTORY_DAYS === 14, 'weekly comparison uses 14 days');
  assert(goalPrefs({}).goalPct === 80 && !goalPrefs({}).screenEnabled, 'renderer goal preferences use quiet defaults');
  assert(drillSharePercent(700, 100) === 100 && drillSharePercent(50, 0) === null, 'app share stays bounded');
  assert(insights.appShare(700, 100) === 1, 'insight share stays bounded');

  const retired = ['decompressBreaksPerDay', 'decompressBreakMinutes', 'gamificationEnabled', 'duckEnabled'];
  const defaults = goals.goalSettingsDefaults();
  assert(retired.every((key) => !Object.prototype.hasOwnProperty.call(defaults, key)), 'retired settings are absent from defaults');
  const sanitized = goals.sanitizeGoalSettings({
    decompressBreaksPerDay: 3,
    decompressBreakMinutes: 10,
    gamificationEnabled: true,
    duckEnabled: true
  });
  assert(retired.every((key) => !Object.prototype.hasOwnProperty.call(sanitized, key)), 'retired settings are removed during sanitization');

  const html = fs.readFileSync(path.join(__dirname, '../renderer/index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '../renderer/wellbeing-ui.js'), 'utf8');
  assert(!html.includes('data-tab="decompress"') && !html.includes('id="view-decompress"'), 'Decompress is removed from navigation and views');
  assert(!/gamification|duck mascot|share-image|share-copy/i.test(html), 'gamification controls and share card are removed');
  assert(!/decompress|gamification|sydtrackStreaks|sydtrackGamification/i.test(ui), 'retired renderer behavior is removed');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-retired-'));
  try {
    fs.writeFileSync(path.join(root, 'decompress.json'), '{}');
    fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({
      goalsSchema: 2,
      focusShareGoalPct: 75,
      decompressBreaksPerDay: 3,
      gamificationEnabled: true,
      duckEnabled: true
    }));
    const store = createStore(root);
    const settings = store.getSettings();
    assert(!fs.existsSync(path.join(root, 'decompress.json')), 'retired break data is removed on startup');
    assert(settings.focusShareGoalPct === 75 && retired.every((key) => !Object.prototype.hasOwnProperty.call(settings, key)), 'retired preferences are removed without changing active goals');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  let failed = 0;
  const assert = (condition, message) => {
    if (condition) console.log('ok  ', message);
    else { failed += 1; console.error('FAIL', message); }
  };
  run(assert);
  if (failed) process.exit(1);
  console.log('goal and cleanup checks passed');
}

module.exports = { run };
