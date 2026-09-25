'use strict';

// Decompress breaks.
// "On track for an hour" means 3600 seconds of the focus-share denominator
// accumulated since the last reset, while the stretch's rounded focus share
// stays at or above the goal. Idle is not passed in. With the default
// setting, uncategorized other time neither counts nor resets the stretch.
// A sample that pulls the rounded share under the goal clears the stretch.
// Suggestions stop once today's started breaks reach the daily budget.
// Starting a break by hand is still allowed past that budget.
// The suggested hour comes from the user's own hourly history: the next
// upcoming hour where mean focus share drops by at least 5 points from the
// previous hour, on at least 3 separate days with 5 minutes in each hour.
// Today is excluded by the caller so a partial day cannot invent the pattern.

(function (root) {
  const goals = typeof module !== 'undefined' && module.exports
    ? require('./goals')
    : root.sydtrackGoals;

  const ON_TRACK_SEC = 3600;
  const MIN_PATTERN_DAYS = 3;
  const MIN_HOUR_SEC = 5 * 60;
  const MIN_DROP = 0.05;

  function emptyStretch() {
    return { productive: 0, unproductive: 0, other: 0 };
  }

  function createBreakState(date) {
    return {
      date: date || '',
      breaksUsed: 0,
      active: null,
      stretch: emptyStretch(),
      suggested: false
    };
  }

  function cloneState(state) {
    const src = state || createBreakState('');
    return {
      date: src.date || '',
      breaksUsed: Math.max(0, Math.round(Number(src.breaksUsed) || 0)),
      active: src.active && Number(src.active.durationSec) > 0
        ? {
            startedAtMs: Number(src.active.startedAtMs) || 0,
            durationSec: Math.max(1, Math.round(Number(src.active.durationSec) || 0))
          }
        : null,
      stretch: {
        productive: Math.max(0, Number(src.stretch && src.stretch.productive) || 0),
        unproductive: Math.max(0, Number(src.stretch && src.stretch.unproductive) || 0),
        other: Math.max(0, Number(src.stretch && src.stretch.other) || 0)
      },
      suggested: !!src.suggested
    };
  }

  function rollState(state, date) {
    const next = cloneState(state);
    if (!date || next.date !== date) return createBreakState(date || '');
    return next;
  }

  function onTrackSec(stretch, includeOther, goalPct) {
    const parts = goals.focusParts(stretch, includeOther);
    if (!goals.meetsGoal(parts.share, goalPct)) return 0;
    return parts.denominator;
  }

  function applyTrackedTime(state, sample, options) {
    const opts = options || {};
    const next = cloneState(state);
    const seconds = Number(sample && sample.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0 || next.active) {
      return { state: next, suggest: false, onTrackSec: onTrackSec(next.stretch, opts.includeOther, opts.goalPct) };
    }
    const category = sample.category === 'productive' || sample.category === 'unproductive' || sample.category === 'other'
      ? sample.category
      : 'other';
    const includeOther = !!opts.includeOther;
    const goalPct = goals.sanitizeGoalSettings({ focusShareGoalPct: opts.goalPct }).focusShareGoalPct;
    const breaksPerDay = goals.sanitizeGoalSettings({ decompressBreaksPerDay: opts.breaksPerDay }).decompressBreaksPerDay;
    if (!includeOther && category === 'other') {
      return { state: next, suggest: false, onTrackSec: onTrackSec(next.stretch, includeOther, goalPct) };
    }
    next.stretch[category] += seconds;
    const parts = goals.focusParts(next.stretch, includeOther);
    if (!goals.meetsGoal(parts.share, goalPct)) {
      next.stretch = emptyStretch();
      next.suggested = false;
      if (category === 'productive') next.stretch.productive = seconds;
      return { state: next, suggest: false, onTrackSec: onTrackSec(next.stretch, includeOther, goalPct) };
    }
    const tracked = onTrackSec(next.stretch, includeOther, goalPct);
    const suggest = !next.suggested && tracked >= ON_TRACK_SEC && next.breaksUsed < breaksPerDay;
    if (suggest) next.suggested = true;
    return { state: next, suggest, onTrackSec: tracked };
  }

  function startBreak(state, options) {
    const opts = options || {};
    const next = cloneState(state);
    if (next.active) return { state: next, started: false, reason: 'active', overBudget: false };
    const breaksPerDay = goals.sanitizeGoalSettings({ decompressBreaksPerDay: opts.breaksPerDay }).decompressBreaksPerDay;
    const durationSec = goals.sanitizeGoalSettings({ decompressBreakMinutes: opts.breakMinutes }).decompressBreakMinutes * 60;
    next.active = {
      startedAtMs: Number(opts.nowMs) || 0,
      durationSec: Number.isFinite(Number(opts.durationSec)) && Number(opts.durationSec) > 0
        ? Math.round(Number(opts.durationSec))
        : durationSec
    };
    next.breaksUsed += 1;
    next.stretch = emptyStretch();
    next.suggested = false;
    return {
      state: next,
      started: true,
      reason: 'started',
      overBudget: next.breaksUsed > breaksPerDay
    };
  }

  function endBreak(state) {
    const next = cloneState(state);
    if (!next.active) return { state: next, ended: false };
    next.active = null;
    return { state: next, ended: true };
  }

  function completeBreakIfDue(state, nowMs) {
    const next = cloneState(state);
    if (!next.active) return { state: next, completed: false, remainingSec: 0 };
    const elapsed = (Number(nowMs) || 0) - next.active.startedAtMs;
    const remainingMs = next.active.durationSec * 1000 - elapsed;
    if (remainingMs > 0) {
      return { state: next, completed: false, remainingSec: Math.ceil(remainingMs / 1000) };
    }
    next.active = null;
    return { state: next, completed: true, remainingSec: 0 };
  }

  function trackedDeltas(previous, next) {
    const keys = ['productive', 'unproductive', 'other'];
    if (!previous || previous.date !== next.date) return { reset: true, samples: [], correction: false };
    const samples = [];
    for (const key of keys) {
      const delta = (Number(next[key]) || 0) - (Number(previous[key]) || 0);
      if (delta < -0.001) return { reset: false, samples: [], correction: true };
      if (delta > 0) samples.push({ category: key, seconds: delta });
    }
    return { reset: false, samples, correction: false };
  }

  function hourShares(days, includeOther) {
    const hours = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const shares = [];
      for (const day of days || []) {
        const bucket = day && Array.isArray(day.byHour) ? day.byHour[hour] : null;
        const parts = goals.focusParts(bucket, includeOther);
        if (parts.share != null && parts.denominator >= MIN_HOUR_SEC) shares.push(parts.share);
      }
      hours.push({
        hour,
        samples: shares.length,
        share: shares.length ? shares.reduce((sum, value) => sum + value, 0) / shares.length : null
      });
    }
    return hours;
  }

  function suggestDecompressHour(days, options) {
    const opts = options || {};
    const includeOther = !!opts.includeOther;
    const nowHour = clampHour(opts.nowHour);
    const excludeDate = opts.excludeDate || '';
    const history = (Array.isArray(days) ? days : []).filter((day) => !excludeDate || day.date !== excludeDate);
    const hours = hourShares(history, includeOther);
    const dips = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const prev = hours[(hour + 23) % 24];
      const cur = hours[hour];
      if (cur.samples < MIN_PATTERN_DAYS || prev.samples < MIN_PATTERN_DAYS) continue;
      if (cur.share == null || prev.share == null) continue;
      const drop = prev.share - cur.share;
      if (drop < MIN_DROP) continue;
      dips.push({
        hour,
        drop,
        from: prev.share,
        to: cur.share,
        samples: Math.min(prev.samples, cur.samples)
      });
    }
    if (!dips.length) {
      return {
        hour: null,
        reason: 'not-enough-pattern',
        passed: false,
        samples: 0,
        minDays: MIN_PATTERN_DAYS,
        minHourSec: MIN_HOUR_SEC
      };
    }
    const upcoming = dips.filter((dip) => dip.hour > nowHour);
    const pool = upcoming.length ? upcoming : dips;
    pool.sort((a, b) => b.drop - a.drop || a.hour - b.hour);
    const best = pool[0];
    return {
      hour: best.hour,
      drop: best.drop,
      fromPercent: goals.sharePercent(best.from),
      toPercent: goals.sharePercent(best.to),
      samples: best.samples,
      passed: best.hour <= nowHour,
      reason: 'focus-dip',
      minDays: MIN_PATTERN_DAYS,
      minHourSec: MIN_HOUR_SEC
    };
  }

  function clampHour(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return 0;
    return Math.min(23, Math.max(0, n));
  }

  function noticesEnabled(settings) {
    const src = settings || {};
    return src.notificationsEnabled !== false && Number(src.decompressBreaksPerDay) > 0;
  }

  function formatHour(hour) {
    const h = clampHour(hour);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const twelve = h % 12 || 12;
    return twelve + ':00 ' + suffix;
  }

  function suggestionMessage(info) {
    const src = info || {};
    const minutes = goals.sanitizeGoalSettings({ decompressBreakMinutes: src.breakMinutes }).decompressBreakMinutes;
    const used = Math.max(0, Math.round(Number(src.breaksUsed) || 0));
    const budget = goals.sanitizeGoalSettings({ decompressBreaksPerDay: src.breaksPerDay }).decompressBreaksPerDay;
    const pattern = src.pattern;
    let timing = 'You can start the ' + minutes + ' minute break whenever you want.';
    if (pattern && pattern.reason === 'focus-dip' && pattern.hour != null) {
      const when = formatHour(pattern.hour);
      timing = pattern.passed
        ? 'Your usual focus dip around ' + when + ' has already started today (' + pattern.fromPercent + '% to ' + pattern.toPercent + '% across ' + pattern.samples + ' days).'
        : 'A break around ' + when + ' matches a dip in your days (' + pattern.fromPercent + '% to ' + pattern.toPercent + '% across ' + pattern.samples + ' days).';
    } else if (pattern && pattern.reason === 'not-enough-pattern') {
      timing = 'There is not a repeated hourly pattern yet. A suggestion needs ' + MIN_PATTERN_DAYS + ' days with at least 5 minutes in neighboring hours.';
    }
    return 'You have been on track with your focus-share goal for an hour. ' +
      minutes + ' minute decompress break, ' + used + ' of ' + budget + ' started today. ' + timing;
  }

  const api = {
    ON_TRACK_SEC,
    MIN_PATTERN_DAYS,
    MIN_HOUR_SEC,
    MIN_DROP,
    createBreakState,
    cloneState,
    rollState,
    onTrackSec,
    applyTrackedTime,
    startBreak,
    endBreak,
    completeBreakIfDue,
    trackedDeltas,
    suggestDecompressHour,
    formatHour,
    suggestionMessage,
    noticesEnabled
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.sydtrackDecompress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
