'use strict';

// Focus share, screen-time limit, and day scores.
// No Electron, filesystem, or network. Safe for the renderer and unit tests.
//
// Focus share (default):
//   productive / (productive + unproductive)
//   Uncategorized "other" is outside the ratio.
// Focus share (setting focusShareIncludeOther):
//   productive / active tracked time
//   active tracked time = productive + unproductive + other
//   Idle and ignored time never enter these totals.
// Displayed percent is Math.round(share * 100). A day meets the goal when that
// integer is >= focusShareGoalPct, so the label and the hit state match.
// Days with a denominator under MIN_DISPLAY_SEC (60) are too thin to score.
// Rolling averages skip unscored days. They are not treated as zero.

(function (root) {
  const DEFAULT_FOCUS_SHARE_GOAL_PCT = 80;
  const DEFAULT_SCREEN_TIME_LIMIT_SEC = 8 * 3600;
  const DEFAULT_DAILY_GOAL_SEC = 7200;
  const MIN_DISPLAY_SEC = 60;
  const MIN_STREAK_SEC = 15 * 60;
  const GOALS_SCHEMA = 2;

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function clampInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function totals(byCategory) {
    const src = byCategory && typeof byCategory === 'object' ? byCategory : {};
    return {
      productive: Math.max(0, num(src.productive)),
      unproductive: Math.max(0, num(src.unproductive)),
      other: Math.max(0, num(src.other))
    };
  }

  function activeTrackedSec(byCategory) {
    const t = totals(byCategory);
    return t.productive + t.unproductive + t.other;
  }

  function focusParts(byCategory, includeOther) {
    const t = totals(byCategory);
    const include = !!includeOther;
    const denominator = include
      ? t.productive + t.unproductive + t.other
      : t.productive + t.unproductive;
    const share = denominator > 0 ? t.productive / denominator : null;
    return {
      productive: t.productive,
      unproductive: t.unproductive,
      other: t.other,
      denominator,
      share,
      includeOther: include
    };
  }

  function sharePercent(share) {
    if (share == null || !Number.isFinite(share)) return null;
    return Math.round(share * 100);
  }

  function meetsGoal(share, goalPct) {
    const pct = sharePercent(share);
    const goal = clampInt(goalPct, 50, 100, DEFAULT_FOCUS_SHARE_GOAL_PCT);
    return pct != null && pct >= goal;
  }

  function focusShareStatus(byCategory, options) {
    const opts = options || {};
    const parts = focusParts(byCategory, opts.includeOther);
    const goalPct = clampInt(opts.goalPct, 50, 100, DEFAULT_FOCUS_SHARE_GOAL_PCT);
    const minSec = Number.isFinite(Number(opts.minSeconds)) ? Number(opts.minSeconds) : MIN_DISPLAY_SEC;
    const thin = parts.denominator < minSec;
    const percent = sharePercent(parts.share);
    return {
      ...parts,
      goalPct,
      percent,
      thin,
      hit: !thin && meetsGoal(parts.share, goalPct)
    };
  }

  function screenTimeStatus(byCategory, options) {
    const opts = options || {};
    const enabled = !!opts.enabled;
    const limitSec = clampInt(opts.limitSec, 15 * 60, 16 * 3600, DEFAULT_SCREEN_TIME_LIMIT_SEC);
    const trackedSec = activeTrackedSec(byCategory);
    const thin = trackedSec < MIN_DISPLAY_SEC;
    const over = enabled && !thin && trackedSec > limitSec;
    const percent = limitSec > 0 ? Math.min(100, Math.round((trackedSec / limitSec) * 100)) : 0;
    return {
      enabled,
      limitSec,
      trackedSec,
      remainingSec: Math.max(0, limitSec - trackedSec),
      overBySec: Math.max(0, trackedSec - limitSec),
      thin,
      within: enabled && !thin && !over,
      over,
      percent
    };
  }

  function dayFocusScore(day, options) {
    const opts = options || {};
    const status = focusShareStatus(day && day.byCategory, opts);
    return {
      date: day && day.date,
      percent: status.percent,
      share: status.share,
      scored: !status.thin && status.share != null,
      thin: status.thin,
      hit: status.hit,
      productive: status.productive,
      denominator: status.denominator,
      includeOther: status.includeOther
    };
  }

  function rollingAverage(days, options) {
    const opts = options || {};
    const windowSize = clampInt(opts.window, 1, 90, 7);
    const scores = (Array.isArray(days) ? days : []).map((day) => dayFocusScore(day, opts));
    const series = scores.map((score, index) => {
      const start = Math.max(0, index - windowSize + 1);
      const sample = scores.slice(start, index + 1).filter((item) => item.scored && item.share != null);
      if (!sample.length) {
        return { date: score.date, percent: null, samples: 0, window: windowSize };
      }
      const mean = sample.reduce((sum, item) => sum + item.share, 0) / sample.length;
      return {
        date: score.date,
        percent: sharePercent(mean),
        share: mean,
        samples: sample.length,
        window: windowSize
      };
    });
    return {
      days: scores,
      series,
      latest: series.length ? series[series.length - 1] : { percent: null, samples: 0, window: windowSize }
    };
  }

  function goalSettingsDefaults() {
    return {
      focusShareGoalPct: DEFAULT_FOCUS_SHARE_GOAL_PCT,
      focusShareIncludeOther: false,
      screenTimeLimitEnabled: false,
      screenTimeLimitSec: DEFAULT_SCREEN_TIME_LIMIT_SEC,
      decompressBreaksPerDay: 3,
      decompressBreakMinutes: 10,
      gamificationEnabled: false,
      duckEnabled: false,
      goalsSchema: GOALS_SCHEMA
    };
  }

  function sanitizeGoalSettings(settings) {
    const next = Object.assign({}, settings || {});
    const defaults = goalSettingsDefaults();
    next.focusShareGoalPct = clampInt(next.focusShareGoalPct, 50, 100, defaults.focusShareGoalPct);
    next.focusShareIncludeOther = !!next.focusShareIncludeOther;
    next.screenTimeLimitEnabled = !!next.screenTimeLimitEnabled;
    next.screenTimeLimitSec = clampInt(next.screenTimeLimitSec, 15 * 60, 16 * 3600, defaults.screenTimeLimitSec);
    next.decompressBreaksPerDay = clampInt(next.decompressBreaksPerDay, 0, 8, defaults.decompressBreaksPerDay);
    next.decompressBreakMinutes = clampInt(next.decompressBreakMinutes, 1, 60, defaults.decompressBreakMinutes);
    next.gamificationEnabled = !!next.gamificationEnabled;
    next.duckEnabled = !!next.duckEnabled;
    delete next.onboardingComplete;
    next.goalsSchema = GOALS_SCHEMA;
    const legacyGoal = Number(next.dailyGoalSec);
    if (!Number.isFinite(legacyGoal) || legacyGoal <= 0) next.dailyGoalSec = DEFAULT_DAILY_GOAL_SEC;
    return next;
  }

  // Existing installs keep dailyGoalSec for older builds and backups.
  // A customized productive-hours goal is not a screen-time cap, so the limit
  // stays off. The number is only the starting value if they later enable it.
  // The untouched 2h default is not treated as a personal budget; the optional
  // limit then starts at 8h of active tracked time.
  function migrateGoalSettings(settings, _options) {
    const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    const next = Object.assign(goalSettingsDefaults(), source);
    if (Number(source.goalsSchema) >= GOALS_SCHEMA) {
      return sanitizeGoalSettings(next);
    }
    if (!Object.prototype.hasOwnProperty.call(source, 'focusShareGoalPct')) {
      next.focusShareGoalPct = DEFAULT_FOCUS_SHARE_GOAL_PCT;
    }
    if (!Object.prototype.hasOwnProperty.call(source, 'focusShareIncludeOther')) {
      next.focusShareIncludeOther = false;
    }
    if (!Object.prototype.hasOwnProperty.call(source, 'screenTimeLimitEnabled')) {
      next.screenTimeLimitEnabled = false;
    }
    if (!Object.prototype.hasOwnProperty.call(source, 'screenTimeLimitSec')) {
      const legacy = Number(source.dailyGoalSec);
      const custom = Number.isFinite(legacy) && legacy > 0 && Math.round(legacy) !== DEFAULT_DAILY_GOAL_SEC;
      next.screenTimeLimitSec = custom ? legacy : DEFAULT_SCREEN_TIME_LIMIT_SEC;
      if (custom && !Object.prototype.hasOwnProperty.call(source, 'legacyProductiveGoalSec')) {
        next.legacyProductiveGoalSec = legacy;
      }
    }
    if (!Object.prototype.hasOwnProperty.call(source, 'decompressBreaksPerDay')) next.decompressBreaksPerDay = 3;
    if (!Object.prototype.hasOwnProperty.call(source, 'decompressBreakMinutes')) next.decompressBreakMinutes = 10;
    if (!Object.prototype.hasOwnProperty.call(source, 'gamificationEnabled')) next.gamificationEnabled = false;
    if (!Object.prototype.hasOwnProperty.call(source, 'duckEnabled')) next.duckEnabled = false;
    next.goalsSchema = GOALS_SCHEMA;
    return sanitizeGoalSettings(next);
  }

  function focusDefinition(includeOther) {
    return includeOther
      ? 'productive ÷ active tracked time (productive + unproductive + other)'
      : 'productive ÷ (productive + unproductive). Other apps are excluded.';
  }

  const api = {
    DEFAULT_FOCUS_SHARE_GOAL_PCT,
    DEFAULT_SCREEN_TIME_LIMIT_SEC,
    DEFAULT_DAILY_GOAL_SEC,
    MIN_DISPLAY_SEC,
    MIN_STREAK_SEC,
    GOALS_SCHEMA,
    totals,
    activeTrackedSec,
    focusParts,
    sharePercent,
    meetsGoal,
    focusShareStatus,
    screenTimeStatus,
    dayFocusScore,
    rollingAverage,
    goalSettingsDefaults,
    sanitizeGoalSettings,
    migrateGoalSettings,
    focusDefinition
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.sydtrackGoals = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
