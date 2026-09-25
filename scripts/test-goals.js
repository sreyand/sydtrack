'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const goals = require('../src/goals');
const streaks = require('../src/streaks');
const decompress = require('../src/decompress');
const insights = require('../src/insights');
const gamification = require('../src/gamification');
const { createDecompressService } = require('../src/decompress-service');
const { createStore, needsGoalSettingsMigration, backupSettingsFile } = require('../src/store');
const { importBackup } = require('../src/backup');
const { goalPrefs } = require('../renderer/wellbeing-ui');

function run(assert) {
  const eighty = goals.focusParts({ productive: 80, unproductive: 20, other: 90 }, false);
  assert(goals.sharePercent(eighty.share) === 80 && eighty.denominator === 100, 'default focus share excludes other');
  const withOther = goals.focusParts({ productive: 80, unproductive: 20, other: 90 }, true);
  assert(goals.sharePercent(withOther.share) === 42 && withOther.denominator === 190, 'include-other focus share uses active tracked time');
  assert(goals.focusParts({ productive: 0, unproductive: 0, other: 50 }, false).share === null, 'no classified time has no focus share');

  const hit = goals.focusShareStatus({ productive: 80, unproductive: 20 }, { goalPct: 80, includeOther: false });
  assert(hit.percent === 80 && hit.hit && !hit.thin, '80% meets an 80% goal');
  const miss = goals.focusShareStatus({ productive: 79, unproductive: 21 }, { goalPct: 80 });
  assert(miss.percent === 79 && !miss.hit, '79% misses an 80% goal');
  const rounded = goals.focusShareStatus({ productive: 795, unproductive: 205 }, { goalPct: 80 });
  assert(rounded.percent === 80 && rounded.hit, '79.5% rounds to 80 and meets the goal');
  const thin = goals.focusShareStatus({ productive: 30, unproductive: 0 }, { goalPct: 80 });
  assert(thin.thin && !thin.hit && thin.percent === 100, 'under a minute is too thin to score');

  const screenOff = goals.screenTimeStatus({ productive: 10000, unproductive: 0, other: 0 }, { enabled: false, limitSec: 3600 });
  assert(!screenOff.over && !screenOff.within, 'screen-time limit stays inactive until enabled');
  const screenUnder = goals.screenTimeStatus({ productive: 1000, unproductive: 1000, other: 1000 }, { enabled: true, limitSec: 8 * 3600 });
  assert(screenUnder.trackedSec === 3000 && screenUnder.within && !screenUnder.over, 'screen time sums active tracked categories');
  const screenOver = goals.screenTimeStatus({ productive: 7000, unproductive: 1000, other: 1000 }, { enabled: true, limitSec: 7200 });
  assert(screenOver.over && screenOver.overBySec === 1800, 'screen time over the limit reports the surplus');

  const days = [
    { date: '2026-09-01', byCategory: { productive: 80, unproductive: 20, other: 0 } },
    { date: '2026-09-02', byCategory: { productive: 0, unproductive: 0, other: 0 } },
    { date: '2026-09-03', byCategory: { productive: 50, unproductive: 50, other: 0 } },
    { date: '2026-09-04', byCategory: { productive: 10, unproductive: 0, other: 0 } }
  ];
  const rolling = goals.rollingAverage(days, { window: 4, goalPct: 80, includeOther: false });
  assert(rolling.days[1].scored === false && rolling.days[3].scored === false, 'empty and sub-minute days are unscored');
  assert(rolling.series[2].percent === 65 && rolling.series[2].samples === 2, 'rolling average skips unscored days');
  assert(rolling.latest.percent === 65 && rolling.latest.samples === 2, 'latest rolling average uses the scored days in the window');

  const defaults = goals.goalSettingsDefaults();
  assert(
    defaults.focusShareGoalPct === 80 &&
      defaults.focusShareIncludeOther === false &&
      defaults.screenTimeLimitEnabled === false &&
      defaults.screenTimeLimitSec === 8 * 3600 &&
      defaults.decompressBreaksPerDay === 3 &&
      defaults.decompressBreakMinutes === 10 &&
      defaults.gamificationEnabled === false &&
      defaults.duckEnabled === false &&
      defaults.goalsSchema === 2,
    'goalSettingsDefaults are 80% share, Other off, screen limit off at 8h, 3x10 breaks, gamification off'
  );
  const prefs = goalPrefs({});
  assert(
    prefs.includeOther === false &&
      prefs.gamification === false &&
      prefs.duck === false &&
      prefs.screenEnabled === false &&
      prefs.goalPct === 80,
    'renderer goalPrefs defaults are all off'
  );

  const fresh = goals.migrateGoalSettings({}, { existingInstall: false });
  assert(fresh.focusShareGoalPct === 80 && fresh.focusShareIncludeOther === false, 'new install defaults to 80% focus share excluding other');
  assert(fresh.screenTimeLimitEnabled === false && fresh.screenTimeLimitSec === 8 * 3600, 'screen-time limit is off and presets to 8h');
  assert(fresh.gamificationEnabled === false && fresh.duckEnabled === false, 'gamification and duck start off');
  assert(fresh.decompressBreaksPerDay === 3 && fresh.decompressBreakMinutes === 10 && fresh.goalsSchema === 2, 'decompress defaults are 3 breaks of 10 minutes');

  const untouched = goals.migrateGoalSettings({ dailyGoalSec: 7200, futureSetting: 'retain' }, { existingInstall: true });
  assert(untouched.onboardingComplete === true && untouched.screenTimeLimitEnabled === false, 'existing default goal does not turn the screen limit on');
  assert(untouched.screenTimeLimitSec === 8 * 3600 && untouched.legacyProductiveGoalSec == null, 'default 2h goal is not reused as a screen limit');
  assert(untouched.dailyGoalSec === 7200 && untouched.futureSetting === 'retain' && untouched.focusShareGoalPct === 80, 'migration keeps the old goal field and unknown settings');

  const custom = goals.migrateGoalSettings({ dailyGoalSec: 5400, idleTimeoutSec: 300 }, { existingInstall: true });
  assert(custom.legacyProductiveGoalSec === 5400 && custom.screenTimeLimitSec === 5400 && custom.screenTimeLimitEnabled === false, 'custom productive-hour goal prefills a disabled screen limit');
  assert(custom.focusShareGoalPct === 80 && custom.onboardingComplete === true, 'custom hour goal migrates to the 80% focus-share default');

  const kept = goals.migrateGoalSettings({
    goalsSchema: 2,
    focusShareGoalPct: 70,
    screenTimeLimitEnabled: true,
    screenTimeLimitSec: 5 * 3600,
    onboardingComplete: true,
    dailyGoalSec: 5400
  }, { existingInstall: true });
  assert(kept.focusShareGoalPct === 70 && kept.screenTimeLimitEnabled === true && kept.screenTimeLimitSec === 5 * 3600, 'schema 2 settings are not migrated again');
  assert(goals.sanitizeGoalSettings({ focusShareGoalPct: 130, decompressBreaksPerDay: 0, decompressBreakMinutes: 90 }).focusShareGoalPct === 100, 'goal percent clamps to 100');
  assert(goals.sanitizeGoalSettings({ decompressBreaksPerDay: 0, decompressBreakMinutes: 90 }).decompressBreaksPerDay === 0, 'zero decompress breaks stays zero');
  assert(goals.sanitizeGoalSettings({ decompressBreakMinutes: 90 }).decompressBreakMinutes === 60, 'decompress minutes clamp to 60');

  const streakDays = [
    { date: '2026-09-01', byCategory: { productive: 900, unproductive: 0 } },
    { date: '2026-09-02', byCategory: { productive: 100, unproductive: 0 } },
    { date: '2026-09-03', byCategory: { productive: 800, unproductive: 200 } },
    { date: '2026-09-04', byCategory: { productive: 700, unproductive: 300 } },
    { date: '2026-09-05', byCategory: { productive: 0, unproductive: 0 } },
    { date: '2026-09-06', byCategory: { productive: 850, unproductive: 150 } }
  ];
  const streak = streaks.focusStreak(streakDays, { goalPct: 80, includeOther: false });
  assert(streak.marks[1].qualified === false, 'streak ignores days under 15 minutes');
  assert(streak.marks[2].hit === true && streak.marks[3].hit === false, 'streak uses the rounded focus-share goal');
  assert(streak.current === 1 && streak.longest === 2 && streak.lastQualifiedDate === '2026-09-06', 'inactive days do not break a streak and a miss does');

  assert(decompress.ON_TRACK_SEC === 3600, 'on-track hour is 3600 seconds');
  let state = decompress.createBreakState('2026-09-24');
  let step = decompress.applyTrackedTime(state, { category: 'productive', seconds: decompress.ON_TRACK_SEC - 1 }, { goalPct: 80, breaksPerDay: 3 });
  assert(!step.suggest && step.onTrackSec === 3599, '59:59 on track does not suggest a break');
  step = decompress.applyTrackedTime(step.state, { category: 'other', seconds: 5000 }, { goalPct: 80, includeOther: false, breaksPerDay: 3 });
  assert(!step.suggest && step.onTrackSec === 3599, 'other time does not count or reset the default stretch');
  step = decompress.applyTrackedTime(step.state, { category: 'productive', seconds: 1 }, { goalPct: 80, breaksPerDay: 3 });
  assert(step.suggest && step.onTrackSec === 3600 && step.state.suggested, 'an hour on track suggests one decompress break');
  step = decompress.applyTrackedTime(step.state, { category: 'productive', seconds: 60 }, { goalPct: 80, breaksPerDay: 3 });
  assert(!step.suggest, 'the same stretch does not suggest twice');

  const diluted = decompress.applyTrackedTime(
    decompress.createBreakState('2026-09-24'),
    { category: 'productive', seconds: 2880 },
    { goalPct: 80, breaksPerDay: 3 }
  );
  const stillOn = decompress.applyTrackedTime(diluted.state, { category: 'unproductive', seconds: 720 }, { goalPct: 80, breaksPerDay: 3 });
  assert(stillOn.suggest && stillOn.onTrackSec === 3600, '80% of a full hour still suggests');
  const dropped = decompress.applyTrackedTime(stillOn.state, { category: 'unproductive', seconds: 40 }, { goalPct: 80, breaksPerDay: 3 });
  assert(!dropped.suggest && dropped.onTrackSec === 0 && dropped.state.suggested === false, 'falling under the goal clears the stretch');

  const included = decompress.applyTrackedTime(
    decompress.createBreakState('2026-09-24'),
    { category: 'productive', seconds: 2880 },
    { goalPct: 80, includeOther: true, breaksPerDay: 3 }
  );
  const otherHour = decompress.applyTrackedTime(included.state, { category: 'other', seconds: 720 }, { goalPct: 80, includeOther: true, breaksPerDay: 3 });
  assert(otherHour.suggest, 'include-other counts other time inside the on-track hour');

  let budget = decompress.createBreakState('2026-09-24');
  budget.breaksUsed = 3;
  budget.suggested = false;
  const blocked = decompress.applyTrackedTime(budget, { category: 'productive', seconds: 3600 }, { goalPct: 80, breaksPerDay: 3 });
  assert(!blocked.suggest, 'suggestions stop when the daily break budget is used');
  const manual = decompress.startBreak(blocked.state, { nowMs: 1000, breaksPerDay: 3, breakMinutes: 10 });
  assert(manual.started && manual.overBudget && manual.state.breaksUsed === 4 && manual.state.active.durationSec === 600, 'a break can start after the budget');
  const busy = decompress.startBreak(manual.state, { nowMs: 2000, breaksPerDay: 3, breakMinutes: 10 });
  assert(!busy.started && busy.reason === 'active', 'a second break waits until the active one ends');
  const early = decompress.completeBreakIfDue(manual.state, 1000 + 599999);
  assert(!early.completed && early.remainingSec === 1, 'break stays active until its duration elapses');
  const done = decompress.completeBreakIfDue(manual.state, 1000 + 600000);
  assert(done.completed && done.state.active === null, 'break completes at the duration boundary');
  const again = decompress.applyTrackedTime(done.state, { category: 'productive', seconds: 3600 }, { goalPct: 80, breaksPerDay: 5 });
  assert(again.suggest, 'a new stretch can suggest after the break when budget remains');

  const zeroBudget = decompress.applyTrackedTime(
    decompress.createBreakState('2026-09-24'),
    { category: 'productive', seconds: 4000 },
    { goalPct: 80, breaksPerDay: 0 }
  );
  assert(!zeroBudget.suggest, 'zero breaks per day disables suggestions');

  const hour = (productive, unproductive) => ({ productive, unproductive, other: 0 });
  const patternDay = (date) => {
    const byHour = Array.from({ length: 24 }, () => hour(0, 0));
    byHour[13] = hour(540, 60);
    byHour[14] = hour(200, 400);
    byHour[15] = hour(500, 100);
    return { date, byHour };
  };
  const pattern = decompress.suggestDecompressHour(
    [patternDay('2026-09-01'), patternDay('2026-09-02'), patternDay('2026-09-03'), patternDay('2026-09-04')],
    { nowHour: 9, excludeDate: '2026-09-04', includeOther: false }
  );
  assert(pattern.reason === 'focus-dip' && pattern.hour === 14 && pattern.passed === false, 'upcoming focus dip is the suggested hour');
  assert(pattern.samples === 3 && pattern.fromPercent === 90 && pattern.toPercent === 33, 'dip reports the rounded shares and sample size');
  const passed = decompress.suggestDecompressHour(
    [patternDay('2026-09-01'), patternDay('2026-09-02'), patternDay('2026-09-03')],
    { nowHour: 16, includeOther: false }
  );
  assert(passed.hour === 14 && passed.passed === true, 'a dip that already started is labeled passed');
  const emptyPattern = decompress.suggestDecompressHour([]);
  assert(emptyPattern.reason === 'not-enough-pattern' && emptyPattern.hour === null, 'empty history does not invent a break hour');
  const thinPattern = decompress.suggestDecompressHour(
    [{ date: '2026-09-01', byHour: Array.from({ length: 24 }, () => hour(60, 0)) }],
    { nowHour: 9 }
  );
  assert(thinPattern.reason === 'not-enough-pattern' && thinPattern.hour === null, 'one day is not enough to invent a break time');
  const message = decompress.suggestionMessage({
    breakMinutes: 10,
    breaksUsed: 1,
    breaksPerDay: 3,
    pattern
  });
  assert(message.includes('10 minute') && message.includes('1 of 3') && message.includes('2:00 PM') && !/upload/i.test(message), 'suggestion copy uses the local pattern');

  const correction = decompress.trackedDeltas(
    { date: '2026-09-24', productive: 100, unproductive: 40, other: 0 },
    { date: '2026-09-24', productive: 80, unproductive: 60, other: 0 }
  );
  assert(correction.correction && correction.samples.length === 0, 'reclassification is not new tracked time');
  const grown = decompress.trackedDeltas(
    { date: '2026-09-24', productive: 10, unproductive: 0, other: 0 },
    { date: '2026-09-24', productive: 15, unproductive: 2, other: 0 }
  );
  assert(!grown.correction && grown.samples.length === 2 && grown.samples[0].seconds === 5, 'positive category deltas become stretch samples');

  const week = [];
  for (let i = 0; i < 14; i += 1) {
    const productive = i < 7 ? 60 : 80;
    const unproductive = i < 7 ? 40 : 20;
    week.push({
      date: '2026-09-' + String(i + 1).padStart(2, '0'),
      byCategory: { productive, unproductive, other: 30 },
      apps: [
        { name: i < 7 ? 'Editor' : 'Editor', seconds: productive, category: 'productive' },
        { name: 'Chrome', seconds: unproductive, category: 'unproductive' }
      ]
    });
  }
  const review = insights.compareWeeks(week, { includeOther: false, goalPct: 80 });
  assert(review.thisFocus.percent === 80 && review.lastFocus.percent === 60 && review.deltaPoints === 20, 'weekly review compares focus share with last week');
  assert(review.thisTracked === 7 * 130 && review.trackedDeltaSec === 0, 'tracked-time delta includes other and can be flat while share changes');
  assert(review.sentences[0].includes('20 points above') && review.sentences[1].includes('Chrome'), 'weekly sentences state the measured change and the top distraction');
  const onlyThisWeek = insights.compareWeeks(week.slice(7), { includeOther: false });
  assert(onlyThisWeek.comparable === false && /does not have enough/i.test(onlyThisWeek.sentences[0]), 'missing last week is stated instead of a fake delta');

  const byHour = Array.from({ length: 24 }, () => ({ productive: 0, unproductive: 0, other: 0, byApp: {} }));
  byHour[9].byApp['Code::productive'] = { seconds: 120, category: 'productive' };
  byHour[9].byApp['@activity:' + JSON.stringify(['Chrome', 'unproductive', 'youtube', 'unproductive'])] = { seconds: 30, category: 'unproductive' };
  byHour[11].byApp['Chrome::unproductive'] = { seconds: 45, category: 'unproductive' };
  const drill = insights.appDrilldown(byHour, 'Chrome');
  assert(drill.total === 75 && drill.hours.length === 2 && drill.hours[0].hour === 9 && drill.categories.unproductive === 75, 'app drill-down sums hourly rows for one app');
  byHour[9].byApp['CHROME::unproductive'] = { seconds: 25, category: 'unproductive' };
  byHour[9].byApp['@activity:' + JSON.stringify(['Chrome', 'unproductive', 'youtube', 'ignored'])] = { seconds: 600, category: 'ignored' };
  const merged = insights.appDrilldown(byHour, 'chrome');
  assert(merged.total === 100 && merged.categories.unproductive === 100 && merged.categories.other === 0, 'drill-down merges case variants and skips ignored time');
  const active = 100;
  const share = insights.appShare(merged.total, active);
  const over = insights.appShare(700, active);
  assert(share != null && share <= 1 && over === 1, 'app share never exceeds 100% even if ignored time is still in hourly rows');

  const calm = gamification.roundupCopy({ thin: false, hit: false, gamification: false, goalPct: 80 });
  const playful = gamification.roundupCopy({ thin: false, hit: true, gamification: true, goalPct: 80, streak: 3 });
  assert(calm.headline.includes('Below') && playful.sub.includes('3 days'), 'gamification swaps roundup copy and stays off otherwise');
  assert(gamification.analyticsNote({ gamification: false }) === '', 'analytics keeps quiet when gamification is off');
  const summary = gamification.progressSummary({
    date: '2026-09-24',
    percent: 80,
    goalPct: 80,
    gamification: true,
    streak: 2,
    definition: goals.focusDefinition(false),
    screen: { enabled: true, trackedLabel: '3h', limitLabel: '8h' }
  });
  assert(summary.includes('Not uploaded') && summary.includes('80%') && summary.includes('2 days'), 'share text is a local summary');

  assert(needsGoalSettingsMigration(null) && needsGoalSettingsMigration({ dailyGoalSec: 5400 }), 'missing goalsSchema still needs migration');
  assert(!needsGoalSettingsMigration({ goalsSchema: 2 }), 'schema 2 settings skip goal migration');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-goals-'));
  const extraDirs = [];
  try {
    const settingsPath = path.join(root, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ dailyGoalSec: 5400, futureSetting: 'keep' }));
    const helperBak = backupSettingsFile(settingsPath, new Date('2026-09-24T15:00:00.000Z'));
    assert(helperBak && path.basename(helperBak) === 'settings.json.2026-09-24T15-00-00-000Z.bak', 'backupSettingsFile writes a timestamped copy next to settings.json');
    assert(JSON.parse(fs.readFileSync(helperBak, 'utf8')).dailyGoalSec === 5400, 'helper backup keeps the original settings bytes');
    fs.unlinkSync(helperBak);
    const store = createStore(root);
    const saved = store.getSettings();
    assert(saved.focusShareGoalPct === 80 && saved.legacyProductiveGoalSec === 5400 && saved.futureSetting === 'keep', 'store migrates an existing productivity goal on load');
    assert(saved.screenTimeLimitEnabled === false && saved.gamificationEnabled === false, 'store migration leaves the screen limit and gamification off');
    const backups = fs.readdirSync(root).filter((f) => f.startsWith('settings.json.') && f.endsWith('.bak'));
    assert(backups.length === 1, 'goal migration writes a timestamped settings backup');
    assert(JSON.parse(fs.readFileSync(path.join(root, backups[0]), 'utf8')).dailyGoalSec === 5400, 'settings backup keeps the pre-migration file');
    store.updateSettings({ focusShareGoalPct: 65, gamificationEnabled: true });
    const restarted = createStore(root);
    assert(restarted.getSettings().focusShareGoalPct === 65 && restarted.getSettings().gamificationEnabled === true, 'a later launch does not overwrite saved goal settings');

    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-goals-new-'));
    extraDirs.push(freshDir);
    const freshStore = createStore(freshDir);
    assert(freshStore.getSettings().gamificationEnabled === false && freshStore.getSettings().dailyGoalSec === 7200, 'a new store keeps dailyGoalSec and leaves gamification off');

    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-goals-import-'));
    extraDirs.push(importDir);
    const importStore = createStore(importDir);
    importStore.updateSettings({ focusShareGoalPct: 80, goalsSchema: 2 });
    const imported = importBackup(importStore, {
      format: 'sydtrack-backup',
      schemaVersion: 1,
      days: {},
      settings: { dailyGoalSec: 5400, futureSetting: 'from-backup' }
    });
    assert(imported.ok && imported.appliedSettings, 'older backup settings are applied');
    const afterImport = importStore.getSettings();
    assert(afterImport.legacyProductiveGoalSec === 5400 && afterImport.screenTimeLimitEnabled === false && afterImport.futureSetting === 'from-backup', 'importing an older backup runs goal migration');
    const importBackups = fs.readdirSync(importDir).filter((f) => f.startsWith('settings.json.') && f.endsWith('.bak'));
    assert(importBackups.length >= 1, 'importing an older backup backs up settings.json first');

    let clock = Date.parse('2026-09-24T15:00:00');
    const service = createDecompressService({
      dataDir: root,
      getSettings: () => store.getSettings(),
      getHourlyHistory: () => [patternDay('2026-09-01'), patternDay('2026-09-02'), patternDay('2026-09-03')],
      now: () => clock
    });
    service.observe({ date: '2026-09-24', byCategory: { productive: 0, unproductive: 0, other: 0 } });
    const first = service.observe({ date: '2026-09-24', byCategory: { productive: 3600, unproductive: 0, other: 0 } });
    assert(first.suggest && first.message.includes('2:00 PM'), 'service suggests from tracked deltas and local history');
    const repeat = service.observe({ date: '2026-09-24', byCategory: { productive: 4000, unproductive: 0, other: 0 } });
    assert(!repeat.suggest, 'service does not repeat a suggestion for the same stretch');
    const started = service.startBreak();
    assert(started.started && started.publicState.active && started.publicState.active.durationSec === 600, 'service starts a local break');
    clock += 600000;
    const finished = service.observe({ date: '2026-09-24', byCategory: { productive: 4000, unproductive: 0, other: 0 } });
    assert(finished.breakEnded && finished.publicState.active === null, 'service completes the break from the clock');
    const reloaded = createDecompressService({
      dataDir: root,
      getSettings: () => ({ decompressBreaksPerDay: 3, decompressBreakMinutes: 10, focusShareGoalPct: 80 }),
      getHourlyHistory: () => [],
      now: () => clock
    });
    assert(reloaded.publicState().breaksUsed === 1, 'break count persists locally');
    const decompressPath = path.join(root, 'decompress.json');
    assert(fs.existsSync(decompressPath), 'started breaks are stored in decompress.json');
    const mtime = fs.statSync(decompressPath).mtimeMs;
    reloaded.observe({ date: '2026-09-24', byCategory: { productive: 4000, unproductive: 0, other: 0 } });
    reloaded.observe({ date: '2026-09-24', byCategory: { productive: 4000, unproductive: 0, other: 0 } });
    assert(fs.statSync(decompressPath).mtimeMs === mtime, 'decompress.json is not rewritten when state is unchanged');
    store.clearAllHistory();
    assert(!fs.existsSync(decompressPath), 'clearing data removes decompress.json');
    reloaded.reset();
    assert(reloaded.publicState().breaksUsed === 0 && !fs.existsSync(decompressPath), 'decompress reset clears memory and file');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    for (const dir of extraDirs) fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { run };
