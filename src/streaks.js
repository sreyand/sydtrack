'use strict';

// Focus-goal streaks. A qualified day has at least MIN_STREAK_SEC of the
// focus-share denominator. Qualified days at or above the goal extend the
// streak. Qualified days under the goal reset it. Days under the minimum
// are skipped: an unused computer does not break or extend a streak.

(function (root) {
  const goals = typeof module !== 'undefined' && module.exports
    ? require('./goals')
    : root.sydtrackGoals;

  function focusStreak(days, options) {
    const opts = options || {};
    const goalPct = goals.sanitizeGoalSettings({ focusShareGoalPct: opts.goalPct }).focusShareGoalPct;
    const includeOther = !!opts.includeOther;
    const minSeconds = Number.isFinite(Number(opts.minSeconds)) ? Number(opts.minSeconds) : goals.MIN_STREAK_SEC;
    let run = 0;
    let longest = 0;
    let lastQualifiedDate = null;
    let lastQualifiedHit = null;
    const marks = [];
    for (const day of Array.isArray(days) ? days : []) {
      const parts = goals.focusParts(day && day.byCategory, includeOther);
      if (parts.share == null || parts.denominator < minSeconds) {
        marks.push({ date: day && day.date, qualified: false, hit: null });
        continue;
      }
      const hit = goals.meetsGoal(parts.share, goalPct);
      lastQualifiedDate = day && day.date;
      lastQualifiedHit = hit;
      if (hit) {
        run += 1;
        if (run > longest) longest = run;
      } else {
        run = 0;
      }
      marks.push({ date: day && day.date, qualified: true, hit, percent: goals.sharePercent(parts.share) });
    }
    return {
      current: run,
      longest,
      lastQualifiedDate,
      lastQualifiedHit,
      marks
    };
  }

  const api = { focusStreak };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.sydtrackStreaks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
