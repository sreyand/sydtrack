'use strict';

// Optional copy and a local share card. Nothing here uploads.
// Streaks are described without treating a miss as a personal failure.

(function (root) {
  function roundupCopy(info) {
    const src = info || {};
    if (src.thin) {
      return src.gamification
        ? {
            headline: 'Warming up',
            sub: 'A little more tracked time and the focus-share streak can start counting.'
          }
        : {
            headline: 'Quiet start',
            sub: 'Not enough tracked time yet to judge the focus-share goal.'
          };
    }
    if (src.noFocus) {
      return {
        headline: 'Focus share unavailable',
        sub: src.includeOther
          ? 'No active tracked time in the focus-share denominator yet.'
          : 'Uncategorized apps are excluded from the default focus share, so there is no percentage yet.'
      };
    }
    if (src.hit) {
      if (!src.gamification) {
        return {
          headline: 'Focus share met',
          sub: 'Today\'s focus share is at or above your ' + src.goalPct + '% goal.'
        };
      }
      const days = Math.max(0, Math.round(Number(src.streak) || 0));
      return {
        headline: 'Goal met',
        sub: days > 1
          ? 'Focus-share streak: ' + days + ' days.'
          : 'Today counts toward the focus-share streak.'
      };
    }
    if (!src.gamification) {
      return {
        headline: 'Below the focus-share goal',
        sub: 'Today\'s mix is under ' + src.goalPct + '%. The notes below are totals, not a verdict.'
      };
    }
    return {
      headline: 'Under the goal',
      sub: 'Today is below the focus-share goal. Days with little or no tracking are not counted as misses.'
    };
  }

  function analyticsNote(info) {
    const src = info || {};
    if (!src.gamification) return '';
    const days = Math.max(0, Math.round(Number(src.streak) || 0));
    if (!days) return 'Focus-share streak: 0 days. A day counts after 15 minutes of the focus-share denominator.';
    return 'Focus-share streak: ' + days + ' day' + (days === 1 ? '' : 's') + '. Inactive days are skipped.';
  }

  function duckLine(info) {
    const src = info || {};
    if (src.breakActive) return 'The duck is on a decompress break too.';
    if (src.thin || src.noFocus) return 'The duck is waiting for enough tracked time to show a focus share.';
    if (src.hit) return 'The duck is here for the ratio. It is not a grade.';
    return 'The duck is just here. The ratio is below the goal.';
  }

  function progressSummary(info) {
    const src = info || {};
    const lines = ['sydtrack ' + (src.date || 'today')];
    if (src.percent == null) lines.push('Focus share: not enough classified time');
    else lines.push('Focus share: ' + src.percent + '% (goal ' + src.goalPct + '%)');
    lines.push(src.definition || 'Focus share is a category ratio.');
    if (src.gamification) {
      const days = Math.max(0, Math.round(Number(src.streak) || 0));
      lines.push('Focus-goal streak: ' + days + ' day' + (days === 1 ? '' : 's'));
    }
    if (src.screen && src.screen.enabled) {
      lines.push('Active tracked time: ' + src.screen.trackedLabel + ' of ' + src.screen.limitLabel + ' limit');
    }
    lines.push('Local summary from this computer. Not uploaded.');
    return lines.join('\n');
  }

  const api = { roundupCopy, analyticsNote, duckLine, progressSummary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.sydtrackGamification = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
