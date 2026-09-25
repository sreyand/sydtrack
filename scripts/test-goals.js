'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const goals = require('../renderer/lib/goals');
const streaks = require('../renderer/lib/streaks');
const decompress = require('../renderer/lib/decompress');
const insights = require('../renderer/lib/insights');
const gamification = require('../renderer/lib/gamification');
const { createDecompressService } = require('../src/decompress-service');
const { createStore, needsGoalSettingsMigration, backupSettingsFile, SETTINGS_BACKUP_KEEP } = require('../src/store');
const { importBackup } = require('../src/backup');
const { goalPrefs, drillSharePercent, WEEK_HISTORY_DAYS, STREAK_HISTORY_DAYS, renderDecompress } = require('../renderer/wellbeing-ui');

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
  assert(untouched.screenTimeLimitEnabled === false, 'existing default goal does not turn the screen limit on');
  assert(!Object.prototype.hasOwnProperty.call(untouched, 'onboardingComplete'), 'existing-install migration does not write onboardingComplete');
  assert(untouched.screenTimeLimitSec === 8 * 3600 && untouched.legacyProductiveGoalSec == null, 'default 2h goal is not reused as a screen limit');
  assert(untouched.dailyGoalSec === 7200 && untouched.futureSetting === 'retain' && untouched.focusShareGoalPct === 80, 'migration keeps the old goal field and unknown settings');

  const custom = goals.migrateGoalSettings({ dailyGoalSec: 5400, idleTimeoutSec: 300 }, { existingInstall: true });
  assert(custom.legacyProductiveGoalSec === 5400 && custom.screenTimeLimitSec === 5400 && custom.screenTimeLimitEnabled === false, 'custom productive-hour goal prefills a disabled screen limit');
  assert(custom.focusShareGoalPct === 80 && !Object.prototype.hasOwnProperty.call(custom, 'onboardingComplete'), 'custom hour goal migrates to the 80% focus-share default without onboardingComplete');

  const kept = goals.migrateGoalSettings({
    goalsSchema: 2,
    focusShareGoalPct: 70,
    screenTimeLimitEnabled: true,
    screenTimeLimitSec: 5 * 3600,
    onboardingComplete: true,
    dailyGoalSec: 5400
  }, { existingInstall: true });
  assert(kept.focusShareGoalPct === 70 && kept.screenTimeLimitEnabled === true && kept.screenTimeLimitSec === 5 * 3600, 'schema 2 settings are not migrated again');
  assert(!Object.prototype.hasOwnProperty.call(kept, 'onboardingComplete'), 'sanitize drops leftover onboardingComplete');
  assert(!Object.prototype.hasOwnProperty.call(goals.sanitizeGoalSettings({ onboardingComplete: true }), 'onboardingComplete'), 'sanitize does not keep onboardingComplete');
  assert(!Object.prototype.hasOwnProperty.call(goals.goalSettingsDefaults(), 'onboardingComplete'), 'goal defaults do not include onboardingComplete');
  assert(!Object.prototype.hasOwnProperty.call(fresh, 'onboardingComplete'), 'new-install migration does not write onboardingComplete');
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
  assert(WEEK_HISTORY_DAYS === 14 && STREAK_HISTORY_DAYS === 90, 'week review stays 14 days; streaks fetch the 90-day store max');
  const longHitDays = [];
  for (let i = 1; i <= 20; i += 1) {
    longHitDays.push({
      date: '2026-09-' + String(i).padStart(2, '0'),
      byCategory: { productive: 900, unproductive: 0 }
    });
  }
  const longStreak = streaks.focusStreak(longHitDays, { goalPct: 80 });
  assert(longStreak.current === 20 && longStreak.longest === 20, '20 qualified hit days are not capped at 14');
  assert(streaks.focusStreak(longHitDays.slice(-14), { goalPct: 80 }).current === 14, 'a 14-day fetch would hide a longer streak');
  const wellbeingSrc = fs.readFileSync(path.join(__dirname, '../renderer/wellbeing-ui.js'), 'utf8');
  assert(/loadGoalHistory\(stats\.date, STREAK_HISTORY_DAYS\)/.test(wellbeingSrc), 'renderer streak path fetches STREAK_HISTORY_DAYS');
  assert(/getHistorySummary\(count\)/.test(wellbeingSrc) && !/getHistorySummary\(14\)/.test(wellbeingSrc), 'renderer no longer hardcodes a 14-day streak fetch');
  const rendererSrc = fs.readFileSync(path.join(__dirname, '../renderer/renderer.js'), 'utf8');
  assert(!/productive target/i.test(rendererSrc) && !/productive goal/i.test(rendererSrc), 'roundup copy no longer says productive target');
  assert(/focus-share goal/.test(rendererSrc), 'roundup hit copy names the focus-share goal');

  assert(decompress.ON_TRACK_SEC === 3600, 'on-track hour is 3600 seconds');
  assert(decompress.MIN_PATTERN_DAYS === 3 && decompress.MIN_HOUR_SEC === 5 * 60 && decompress.MIN_DROP === 0.05, 'pattern thresholds are 3 days, 5 minutes, and a 5 point drop');
  assert(decompress.noticesEnabled({ notificationsEnabled: true, decompressBreaksPerDay: 3 }), 'breaks on allows decompress notices');
  assert(!decompress.noticesEnabled({ notificationsEnabled: true, decompressBreaksPerDay: 0 }), 'zero breaks gates decompress notices');
  assert(!decompress.noticesEnabled({ notificationsEnabled: false, decompressBreaksPerDay: 3 }), 'notifications off gates decompress notices');
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
  const twoDays = decompress.suggestDecompressHour(
    [patternDay('2026-09-01'), patternDay('2026-09-02')],
    { nowHour: 9 }
  );
  assert(twoDays.reason === 'not-enough-pattern' && twoDays.minDays === decompress.MIN_PATTERN_DAYS, 'two days stay under MIN_PATTERN_DAYS');
  const shortHour = (productive, unproductive) => hour(productive, unproductive);
  const underMin = [];
  for (let i = 1; i <= 3; i += 1) {
    const byHour = Array.from({ length: 24 }, () => hour(0, 0));
    byHour[13] = shortHour(decompress.MIN_HOUR_SEC - 1, 0);
    byHour[14] = shortHour(decompress.MIN_HOUR_SEC - 1, 0);
    underMin.push({ date: '2026-09-0' + i, byHour });
  }
  const thinHours = decompress.suggestDecompressHour(underMin, { nowHour: 9 });
  assert(thinHours.reason === 'not-enough-pattern' && thinHours.minHourSec === decompress.MIN_HOUR_SEC, 'hours under MIN_HOUR_SEC do not invent a dip');
  const smallDrop = [];
  for (let i = 1; i <= 3; i += 1) {
    const byHour = Array.from({ length: 24 }, () => hour(0, 0));
    byHour[13] = hour(600, 0);
    byHour[14] = hour(580, 20);
    smallDrop.push({ date: '2026-09-0' + i, byHour });
  }
  const noDrop = decompress.suggestDecompressHour(smallDrop, { nowHour: 9 });
  assert(noDrop.reason === 'not-enough-pattern', 'a drop under MIN_DROP does not invent a break hour');
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
  assert(drillSharePercent(700, 100) === 100 && drillSharePercent(50, 0) === null, 'renderer appShare path clamps share and stays empty without active time');

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

  const html = fs.readFileSync(path.join(__dirname, '../renderer/index.html'), 'utf8');
  assert(
    /src="lib\/goals\.js"/.test(html) &&
      /src="lib\/streaks\.js"/.test(html) &&
      /src="lib\/decompress\.js"/.test(html) &&
      /src="lib\/insights\.js"/.test(html) &&
      /src="lib\/gamification\.js"/.test(html),
    'renderer loads wellbeing modules from renderer/lib'
  );
  assert(
    !/src="\.\.\/src\/(goals|streaks|decompress|insights|gamification)\.js"/.test(html),
    'renderer does not load wellbeing modules from src/'
  );
  assert(
    html.includes('data-tab="decompress"') && html.includes('id="view-decompress"') && html.includes('id="decompress-log"'),
    'Decompress has its own nav entry, view, and past-breaks list'
  );
  const roundupChunk = html.slice(html.indexOf('id="view-roundup"'), html.indexOf('id="view-analytics"'));
  assert(
    !!roundupChunk && !roundupChunk.includes('decompress-card') && !roundupChunk.includes('decompress-start'),
    'Roundup no longer owns Decompress UI'
  );
  const fake = {};
  const makeEl = (id) => {
    const cls = new Set();
    fake[id] = {
      textContent: '',
      innerHTML: '',
      disabled: false,
      classList: {
        toggle(name, on) { if (on) cls.add(name); else cls.delete(name); },
        contains(name) { return cls.has(name); }
      },
      setAttribute(name, value) { fake[id][name] = value; }
    };
    return fake[id];
  };
  [
    'decompress-status', 'decompress-pattern', 'decompress-start', 'decompress-end',
    'decompress-timer', 'decompress-kicker', 'decompress-card', 'decompress-log', 'decompress-log-note'
  ].forEach(makeEl);
  const prevDoc = global.document;
  global.document = { getElementById: (id) => fake[id] || null };
  try {
    renderDecompress({
      date: '2026-09-25',
      breaksUsed: 2,
      breaksPerDay: 3,
      breakMinutes: 10,
      active: { startedAtMs: Date.parse('2026-09-25T15:42:00'), durationSec: 600, remainingSec: 247 },
      onTrackSec: 0,
      sessions: [
        { id: 'open-1', date: '2026-09-25', startedAtMs: Date.parse('2026-09-25T15:42:00'), durationSec: 600, status: 'open' },
        { id: 'done-1', date: '2026-09-25', startedAtMs: Date.parse('2026-09-25T14:10:00'), durationSec: 600, status: 'done' }
      ],
      pattern: { reason: 'not-enough-pattern' }
    });
    assert(fake['decompress-kicker'].textContent === 'Continue last decompress', 'active hero names the restore path');
    assert(fake['decompress-timer'].textContent === '04:07', 'active hero shows remaining time');
    assert(fake['decompress-start'].classList.contains('hidden') && !fake['decompress-end'].classList.contains('hidden'), 'active hero swaps Start for End');
    assert(fake['decompress-log'].innerHTML.includes('Resume a break') && fake['decompress-log'].innerHTML.includes('Finished'), 'past breaks list can resume an open session');
    renderDecompress({
      date: '2026-09-25',
      breaksUsed: 0,
      breaksPerDay: 3,
      breakMinutes: 10,
      active: null,
      onTrackSec: 0,
      sessions: [],
      pattern: null
    });
    assert(fake['decompress-kicker'].textContent === 'This break', 'idle hero is a start path');
    assert(fake['decompress-log'].innerHTML.includes('No breaks yet'), 'empty past breaks uses human wording');
  } finally {
    global.document = prevDoc;
  }

  assert(needsGoalSettingsMigration(null) && needsGoalSettingsMigration({ dailyGoalSec: 5400 }), 'missing goalsSchema still needs migration');
  assert(!needsGoalSettingsMigration({ goalsSchema: 2 }), 'schema 2 settings skip goal migration');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-goals-'));
  const extraDirs = [];
  try {
    const settingsPath = path.join(root, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ dailyGoalSec: 5400, futureSetting: 'keep', onboardingComplete: true }));
    const helperBak = backupSettingsFile(settingsPath, new Date('2026-09-24T15:00:00.000Z'));
    assert(helperBak && path.basename(helperBak) === 'settings.json.2026-09-24T15-00-00-000Z.bak', 'backupSettingsFile writes a timestamped copy next to settings.json');
    assert(JSON.parse(fs.readFileSync(helperBak, 'utf8')).dailyGoalSec === 5400, 'helper backup keeps the original settings bytes');
    fs.unlinkSync(helperBak);
    assert(SETTINGS_BACKUP_KEEP === 3, 'settings backup retention is 3');
    for (let i = 1; i <= 5; i += 1) {
      backupSettingsFile(settingsPath, new Date(Date.UTC(2026, 0, i, 12)));
    }
    const pruned = fs.readdirSync(root).filter((f) => f.startsWith('settings.json.') && f.endsWith('.bak'));
    assert(pruned.length === SETTINGS_BACKUP_KEEP, 'settings backups keep only the newest ' + SETTINGS_BACKUP_KEEP);
    assert(!pruned.some((f) => /2026-01-0[12]T/.test(f)), 'oldest settings.json.*.bak files are pruned');
    for (const name of pruned) fs.unlinkSync(path.join(root, name));
    const store = createStore(root);
    const saved = store.getSettings();
    assert(saved.focusShareGoalPct === 80 && saved.legacyProductiveGoalSec === 5400 && saved.futureSetting === 'keep', 'store migrates an existing productivity goal on load');
    assert(saved.screenTimeLimitEnabled === false && saved.gamificationEnabled === false, 'store migration leaves the screen limit and gamification off');
    assert(!Object.prototype.hasOwnProperty.call(saved, 'onboardingComplete'), 'migrated settings drop onboardingComplete');
    assert(!Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), 'onboardingComplete'), 'settings.json does not write onboardingComplete');
    const backups = fs.readdirSync(root).filter((f) => f.startsWith('settings.json.') && f.endsWith('.bak'));
    assert(backups.length === 1, 'goal migration writes a timestamped settings backup');
    assert(JSON.parse(fs.readFileSync(path.join(root, backups[0]), 'utf8')).dailyGoalSec === 5400, 'settings backup keeps the pre-migration file');
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert(written.goalsSchema === 2 && written.focusShareGoalPct === 80 && written.legacyProductiveGoalSec === 5400, 'migrated settings are saved to disk');
    store.updateSettings({ focusShareGoalPct: 65, gamificationEnabled: true });
    const restarted = createStore(root);
    assert(restarted.getSettings().focusShareGoalPct === 65 && restarted.getSettings().gamificationEnabled === true, 'a later launch does not overwrite saved goal settings');

    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-goals-new-'));
    extraDirs.push(freshDir);
    const freshStore = createStore(freshDir);
    assert(freshStore.getSettings().gamificationEnabled === false && freshStore.getSettings().dailyGoalSec === 7200, 'a new store keeps dailyGoalSec and leaves gamification off');

    const orphanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-goals-orphan-'));
    extraDirs.push(orphanDir);
    fs.writeFileSync(path.join(orphanDir, 'settings.json'), JSON.stringify({
      goalsSchema: 2,
      focusShareGoalPct: 70,
      onboardingComplete: true
    }));
    const orphanStore = createStore(orphanDir);
    assert(orphanStore.getSettings().focusShareGoalPct === 70 && !Object.prototype.hasOwnProperty.call(orphanStore.getSettings(), 'onboardingComplete'), 'schema 2 settings drop onboardingComplete without remigrating');
    assert(!Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(path.join(orphanDir, 'settings.json'), 'utf8')), 'onboardingComplete'), 'schema 2 settings.json is rewritten without onboardingComplete');

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
    assert(
      started.publicState.sessions &&
        started.publicState.sessions[0] &&
        started.publicState.sessions[0].status === 'open',
      'started breaks appear in the decompress session log'
    );
    clock += 600000;
    const finished = service.observe({ date: '2026-09-24', byCategory: { productive: 4000, unproductive: 0, other: 0 } });
    assert(finished.breakEnded && finished.publicState.active === null, 'service completes the break from the clock');
    assert(
      finished.publicState.sessions &&
        finished.publicState.sessions[0] &&
        finished.publicState.sessions[0].status === 'done',
      'finished breaks stay in the decompress session log'
    );
    const reloaded = createDecompressService({
      dataDir: root,
      getSettings: () => ({ decompressBreaksPerDay: 3, decompressBreakMinutes: 10, focusShareGoalPct: 80 }),
      getHourlyHistory: () => [],
      now: () => clock
    });
    assert(reloaded.publicState().breaksUsed === 1, 'break count persists locally');
    const decompressPath = path.join(root, 'decompress.json');
    assert(fs.existsSync(decompressPath), 'started breaks are stored in decompress.json');
    const stored = JSON.parse(fs.readFileSync(decompressPath, 'utf8'));
    assert(Array.isArray(stored.sessions) && stored.sessions.length >= 1, 'decompress.json keeps past breaks');
    const mtime = fs.statSync(decompressPath).mtimeMs;
    reloaded.observe({ date: '2026-09-24', byCategory: { productive: 4000, unproductive: 0, other: 0 } });
    reloaded.observe({ date: '2026-09-24', byCategory: { productive: 4100, unproductive: 0, other: 0 } });
    reloaded.observe({ date: '2026-09-24', byCategory: { productive: 4200, unproductive: 10, other: 0 } });
    assert(fs.statSync(decompressPath).mtimeMs === mtime, 'changing totals do not rewrite decompress.json every tick');
    store.updateSettings({ focusShareGoalPct: 65, gamificationEnabled: true });
    const erased = store.eraseActivityAndSettings();
    assert(erased.ok && store.getSettings().focusShareGoalPct === 80 && store.getSettings().gamificationEnabled === false, 'erase-all remigrates goal defaults');
    assert(!fs.existsSync(decompressPath), 'clearing data removes decompress.json');
    reloaded.reset();
    assert(reloaded.publicState().breaksUsed === 0 && !fs.existsSync(decompressPath), 'decompress reset clears memory and file');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    for (const dir of extraDirs) fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { run };
