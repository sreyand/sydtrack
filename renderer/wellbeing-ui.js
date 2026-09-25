'use strict';

let wellbeingDecompress = null;
let wellbeingStats = null;
let wellbeingDate = '';
let wellbeingStreak = 0;
let drillApp = '';
const historyCache = { date: '', at: 0, days: null, pending: null, pendingDate: '' };

function wellbeingEl(id) {
  return document.getElementById(id);
}

function wellbeingEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function goalPrefs(settings) {
  const src = settings || (typeof latestGoalSettings !== 'undefined' ? latestGoalSettings : {}) || {};
  return {
    goalPct: Number(src.focusShareGoalPct) || 80,
    includeOther: !!src.focusShareIncludeOther,
    gamification: !!src.gamificationEnabled,
    duck: !!src.duckEnabled,
    screenEnabled: !!src.screenTimeLimitEnabled,
    screenLimit: Number(src.screenTimeLimitSec) || 8 * 3600
  };
}

function fmtShort(seconds) {
  if (typeof fmtGoalShort === 'function') return fmtGoalShort(seconds);
  const sec = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h && m) return h + 'h ' + m + 'm';
  if (h) return h + 'h';
  return m + 'm';
}

function syncWellbeingSettings(settings) {
  if (!settings) return;
  const setNum = (id, value) => {
    const el = wellbeingEl(id);
    if (el && document.activeElement !== el) el.value = value;
  };
  const setCheck = (id, value) => {
    const el = wellbeingEl(id);
    if (el && document.activeElement !== el) el.checked = !!value;
  };
  setNum('focus-share-goal', settings.focusShareGoalPct == null ? 80 : settings.focusShareGoalPct);
  setCheck('focus-include-other', settings.focusShareIncludeOther);
  setCheck('screen-limit-toggle', settings.screenTimeLimitEnabled);
  setNum('screen-limit-hours', Math.round(((Number(settings.screenTimeLimitSec) || 28800) / 3600) * 100) / 100);
  const field = wellbeingEl('screen-limit-field');
  if (field) field.classList.toggle('hidden', !settings.screenTimeLimitEnabled);
  setNum('decompress-count', settings.decompressBreaksPerDay == null ? 3 : settings.decompressBreaksPerDay);
  setNum('decompress-minutes', settings.decompressBreakMinutes == null ? 10 : settings.decompressBreakMinutes);
  setCheck('gamification-toggle', settings.gamificationEnabled);
  setCheck('duck-toggle', settings.duckEnabled);
  const definition = wellbeingEl('focus-share-definition');
  if (definition && typeof sydtrackGoals !== 'undefined') {
    definition.textContent = sydtrackGoals.focusDefinition(!!settings.focusShareIncludeOther);
  }
  const hint = wellbeingEl('screen-limit-hint');
  if (hint) {
    let text = 'Optional and off by default. Active tracked time, not clock time.';
    if (Number(settings.legacyProductiveGoalSec) > 0) {
      const hours = Math.round((Number(settings.legacyProductiveGoalSec) / 3600) * 100) / 100;
      text += ' Your earlier productivity goal was ' + hours + 'h of productive time. The limit starts from that number and stays off until you enable it.';
    }
    hint.textContent = text;
  }
  const share = wellbeingEl('share-actions');
  if (share) share.classList.toggle('hidden', !settings.gamificationEnabled);
  const duck = wellbeingEl('roundup-duck');
  if (duck) duck.classList.toggle('hidden', !settings.duckEnabled);
}

function noteWellbeingPayload(payload) {
  if (!payload) return;
  if (payload.stats) wellbeingStats = payload.stats;
  if (payload.stats && payload.stats.date) wellbeingDate = payload.stats.date;
  if (payload.decompress) {
    wellbeingDecompress = payload.decompress;
    renderDecompress(payload.decompress);
  }
}

function patternText(pattern) {
  if (!pattern || typeof sydtrackDecompress === 'undefined') return '';
  if (pattern.reason === 'not-enough-pattern') {
    return 'No repeated hourly dip yet. A suggestion needs 3 days with at least 5 minutes in neighboring hours.';
  }
  if (pattern.reason !== 'focus-dip' || pattern.hour == null) return '';
  const when = sydtrackDecompress.formatHour(pattern.hour);
  const detail = pattern.fromPercent + '% to ' + pattern.toPercent + '% across ' + pattern.samples + ' days';
  return pattern.passed
    ? 'Usual dip around ' + when + ' already started today (' + detail + ').'
    : 'A break around ' + when + ' matches your days (' + detail + ').';
}

function renderDecompress(state) {
  const status = wellbeingEl('decompress-status');
  const pattern = wellbeingEl('decompress-pattern');
  const start = wellbeingEl('decompress-start');
  const end = wellbeingEl('decompress-end');
  if (!status || !state) return;
  if (state.active) {
    status.textContent = 'Break in progress. ' + fmtShort(state.active.remainingSec) + ' left.';
  } else if (!state.breaksPerDay) {
    status.textContent = 'Suggestions are off. You can still start a ' + state.breakMinutes + ' minute break.';
  } else {
    const minutes = Math.floor((Number(state.onTrackSec) || 0) / 60);
    status.textContent = minutes + ' min on track toward 60. ' +
      state.breaksUsed + ' of ' + state.breaksPerDay + ' suggested breaks started.';
  }
  if (pattern) pattern.textContent = patternText(state.pattern);
  if (start) start.disabled = !!state.active;
  if (end) end.classList.toggle('hidden', !state.active);
}

function loadGoalHistory(date) {
  const key = date || wellbeingDate || '';
  if (historyCache.days && historyCache.date === key && Date.now() - historyCache.at < 60000) {
    return Promise.resolve(historyCache.days);
  }
  if (historyCache.pending && historyCache.pendingDate === key) return historyCache.pending;
  const bridge = window.sydtrack;
  if (!bridge || !bridge.getHistorySummary) return Promise.resolve([]);
  const pending = bridge.getHistorySummary(14).then((days) => {
    historyCache.date = key;
    historyCache.at = Date.now();
    historyCache.days = days || [];
    historyCache.pending = null;
    historyCache.pendingDate = '';
    return historyCache.days;
  }).catch(() => {
    historyCache.pending = null;
    historyCache.pendingDate = '';
    return [];
  });
  historyCache.pending = pending;
  historyCache.pendingDate = key;
  return pending;
}

function applyStreakCopy(stats, days) {
  if (!stats || typeof sydtrackGoals === 'undefined' || typeof sydtrackStreaks === 'undefined') return;
  const prefs = goalPrefs(stats.settings);
  const focus = sydtrackGoals.focusShareStatus(stats.byCategory, {
    includeOther: prefs.includeOther,
    goalPct: prefs.goalPct
  });
  const streak = sydtrackStreaks.focusStreak(days || [], {
    includeOther: prefs.includeOther,
    goalPct: prefs.goalPct
  });
  wellbeingStreak = streak.current;
  const streakEl = wellbeingEl('roundup-streak');
  if (streakEl) {
    streakEl.classList.toggle('hidden', !prefs.gamification);
    streakEl.textContent = prefs.gamification
      ? 'Focus-share streak: ' + streak.current + ' day' + (streak.current === 1 ? '' : 's') +
        '. Longest ' + streak.longest + '. Inactive days are skipped.'
      : '';
  }
  const note = wellbeingEl('analytics-gamification-note');
  if (note && typeof sydtrackGamification !== 'undefined') {
    const text = sydtrackGamification.analyticsNote({ gamification: prefs.gamification, streak: streak.current });
    note.textContent = text;
    note.classList.toggle('hidden', !text);
  }
  if (prefs.gamification && typeof sydtrackGamification !== 'undefined') {
    const copy = sydtrackGamification.roundupCopy({
      thin: focus.thin,
      noFocus: !focus.thin && focus.percent == null,
      hit: focus.hit,
      gamification: true,
      goalPct: focus.goalPct,
      includeOther: prefs.includeOther,
      streak: streak.current
    });
    const headline = wellbeingEl('roundup-headline');
    const sub = wellbeingEl('roundup-sub');
    if (headline) headline.textContent = copy.headline;
    if (sub) sub.textContent = copy.sub;
  }
  const duckLine = wellbeingEl('roundup-duck-line');
  if (duckLine && prefs.duck && typeof sydtrackGamification !== 'undefined') {
    duckLine.textContent = sydtrackGamification.duckLine({
      thin: focus.thin,
      noFocus: !focus.thin && focus.percent == null,
      hit: focus.hit,
      breakActive: !!(wellbeingDecompress && wellbeingDecompress.active)
    });
  }
}

function renderScreenGoal(stats) {
  const card = wellbeingEl('roundup-screen-card');
  if (!card || !stats || typeof sydtrackGoals === 'undefined') return;
  const prefs = goalPrefs(stats.settings);
  card.classList.toggle('hidden', !prefs.screenEnabled);
  if (!prefs.screenEnabled) return;
  const screen = sydtrackGoals.screenTimeStatus(stats.byCategory, {
    enabled: true,
    limitSec: prefs.screenLimit
  });
  card.setAttribute('data-hit', screen.thin ? 'na' : screen.over ? 'no' : 'yes');
  const value = wellbeingEl('roundup-screen-value');
  const pct = wellbeingEl('roundup-screen-pct');
  const fill = wellbeingEl('roundup-screen-fill');
  const bar = wellbeingEl('roundup-screen-bar');
  if (value) {
    value.textContent = screen.over
      ? fmtShort(screen.overBySec) + ' over ' + fmtShort(screen.limitSec)
      : fmtShort(screen.trackedSec) + ' / ' + fmtShort(screen.limitSec);
  }
  if (pct) pct.textContent = screen.over ? 'Over the limit' : 'Within the limit';
  if (fill) fill.style.width = screen.percent + '%';
  if (bar) bar.setAttribute('aria-valuenow', String(screen.percent));
}

function renderWellbeing(stats) {
  if (!stats) return;
  wellbeingStats = stats;
  if (stats.date) wellbeingDate = stats.date;
  renderScreenGoal(stats);
  const duck = wellbeingEl('roundup-duck');
  const prefs = goalPrefs(stats.settings);
  if (duck) duck.classList.toggle('hidden', !prefs.duck);
  const share = wellbeingEl('share-actions');
  if (share) share.classList.toggle('hidden', !prefs.gamification);
  loadGoalHistory(stats.date).then((days) => {
    if (!wellbeingStats || wellbeingStats.date !== stats.date) return;
    applyStreakCopy(stats, days);
  });
}

function renderScoreList(target, days, windowSize) {
  if (!target || typeof sydtrackGoals === 'undefined') return;
  const prefs = goalPrefs();
  const rolling = sydtrackGoals.rollingAverage(days || [], {
    window: windowSize,
    includeOther: prefs.includeOther,
    goalPct: prefs.goalPct
  });
  if (!rolling.days.length) {
    target.textContent = 'No days to score yet.';
    return;
  }
  target.innerHTML = rolling.days.map((day, index) => {
    const avg = rolling.series[index];
    return '<div class="focus-score-row"><span>' + wellbeingEsc(day.date || '') + '</span><span>' +
      (day.scored ? day.percent + '%' : '—') + '</span><span class="muted">' +
      (avg && avg.percent != null ? avg.percent + '% over ' + avg.samples + ' scored day' + (avg.samples === 1 ? '' : 's') : '—') +
      '</span></div>';
  }).join('');
}

function renderWeekWellbeing() {
  loadGoalHistory(wellbeingDate).then((days) => {
    const body = wellbeingEl('week-review-body');
    const list = wellbeingEl('week-focus-score-list');
    if (body && typeof sydtrackInsights !== 'undefined') {
      const prefs = goalPrefs();
      const review = sydtrackInsights.compareWeeks(days || [], {
        includeOther: prefs.includeOther,
        goalPct: prefs.goalPct
      });
      body.innerHTML = review.sentences.map((line) => '<p>' + wellbeingEsc(line) + '</p>').join('');
    }
    renderScoreList(list, (days || []).slice(-7), 7);
  });
}

function renderMonthFocusScores(days) {
  const average = wellbeingEl('month-focus-average');
  const list = wellbeingEl('month-focus-score-list');
  if (typeof sydtrackGoals === 'undefined') return;
  const prefs = goalPrefs();
  const week = sydtrackGoals.rollingAverage(days || [], { window: 7, includeOther: prefs.includeOther, goalPct: prefs.goalPct });
  const month = sydtrackGoals.rollingAverage(days || [], { window: 30, includeOther: prefs.includeOther, goalPct: prefs.goalPct });
  if (average) {
    const weekText = week.latest && week.latest.percent != null ? week.latest.percent + '% over ' + week.latest.samples + ' scored day' + (week.latest.samples === 1 ? '' : 's') : 'not enough scored days';
    const monthText = month.latest && month.latest.percent != null ? month.latest.percent + '% over ' + month.latest.samples + ' scored day' + (month.latest.samples === 1 ? '' : 's') : 'not enough scored days';
    average.textContent = '7-day average ' + weekText + '. 30-day average ' + monthText + '. Empty days are skipped, not counted as zero.';
  }
  renderScoreList(list, days || [], 7);
}

function renderAppDrilldown(stats) {
  const host = wellbeingEl('app-drill');
  if (!host) return;
  if (!drillApp || typeof sydtrackInsights === 'undefined' || typeof sydtrackGoals === 'undefined') {
    host.textContent = 'Choose Hours on an app to see when it was tracked today.';
    return;
  }
  const drill = sydtrackInsights.appDrilldown(stats && stats.byHour, drillApp);
  const active = sydtrackGoals.activeTrackedSec(stats && stats.byCategory);
  const ratio = sydtrackInsights.appShare(drill.total, active);
  const share = ratio == null ? null : Math.round(ratio * 100);
  if (!drill.total) {
    host.textContent = drillApp + ' has no hourly time recorded today.';
    return;
  }
  const hours = drill.hours.map((hour) => {
    const label = typeof hourLabel === 'function' ? hourLabel(hour.hour) : hour.hour + ':00';
    return label + ' ' + fmtShort(hour.seconds);
  }).join(' · ');
  host.textContent = drill.name + ' is ' + fmtShort(drill.total) +
    (share == null ? '' : ' (' + share + '% of active tracked time today)') +
    '. ' + hours + '.';
}

function summaryText(stats) {
  const prefs = goalPrefs(stats && stats.settings);
  const focus = sydtrackGoals.focusShareStatus(stats && stats.byCategory, {
    includeOther: prefs.includeOther,
    goalPct: prefs.goalPct
  });
  const screen = sydtrackGoals.screenTimeStatus(stats && stats.byCategory, {
    enabled: prefs.screenEnabled,
    limitSec: prefs.screenLimit
  });
  return sydtrackGamification.progressSummary({
    date: stats && stats.date,
    percent: focus.percent,
    goalPct: focus.goalPct,
    gamification: prefs.gamification,
    streak: wellbeingStreak,
    definition: sydtrackGoals.focusDefinition(prefs.includeOther),
    screen: prefs.screenEnabled ? {
      enabled: true,
      trackedLabel: fmtShort(screen.trackedSec),
      limitLabel: fmtShort(screen.limitSec)
    } : null
  });
}

function summaryImage(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 880;
  canvas.height = 520;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1c1b22';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f4f1ea';
  ctx.font = '28px sans-serif';
  String(text || '').split('\n').forEach((line, index) => {
    ctx.fillText(line.slice(0, 80), 48, 84 + index * 42);
  });
  return canvas.toDataURL('image/png');
}

function setShareStatus(text) {
  const el = wellbeingEl('share-status');
  if (el) el.textContent = text || '';
}

function bindWellbeing() {
  const on = (id, event, fn) => {
    const el = wellbeingEl(id);
    if (el) el.addEventListener(event, fn);
  };
  on('focus-share-goal', 'change', () => pushSettings({ focusShareGoalPct: Number(wellbeingEl('focus-share-goal').value) }));
  on('focus-include-other', 'change', () => pushSettings({ focusShareIncludeOther: !!wellbeingEl('focus-include-other').checked }));
  on('screen-limit-toggle', 'change', () => pushSettings({ screenTimeLimitEnabled: !!wellbeingEl('screen-limit-toggle').checked }));
  on('screen-limit-hours', 'change', () => {
    const hours = Number(wellbeingEl('screen-limit-hours').value);
    if (!Number.isFinite(hours) || hours <= 0) return;
    pushSettings({ screenTimeLimitSec: Math.round(hours * 3600) });
  });
  on('decompress-count', 'change', () => pushSettings({ decompressBreaksPerDay: Number(wellbeingEl('decompress-count').value) }));
  on('decompress-minutes', 'change', () => pushSettings({ decompressBreakMinutes: Number(wellbeingEl('decompress-minutes').value) }));
  on('gamification-toggle', 'change', () => pushSettings({ gamificationEnabled: !!wellbeingEl('gamification-toggle').checked }));
  on('duck-toggle', 'change', () => pushSettings({ duckEnabled: !!wellbeingEl('duck-toggle').checked }));
  on('decompress-start', 'click', async () => {
    if (!window.sydtrack || !window.sydtrack.startBreak) return;
    const result = await window.sydtrack.startBreak();
    if (result && result.breakEnded && typeof showBanner === 'function') {
      showBanner('The break is over.', 'Decompress');
    }
    if (result && result.publicState) {
      wellbeingDecompress = result.publicState;
      renderDecompress(result.publicState);
    }
  });
  on('decompress-end', 'click', async () => {
    if (!window.sydtrack || !window.sydtrack.endBreak) return;
    const result = await window.sydtrack.endBreak();
    if (result && result.publicState) {
      wellbeingDecompress = result.publicState;
      renderDecompress(result.publicState);
    }
  });
  on('share-copy', 'click', async () => {
    if (!wellbeingStats || !window.sydtrack || !window.sydtrack.copySummary) return;
    await window.sydtrack.copySummary(summaryText(wellbeingStats));
    setShareStatus('Copied. Nothing was uploaded.');
  });
  on('share-image', 'click', async () => {
    if (!wellbeingStats || !window.sydtrack || !window.sydtrack.saveSummaryImage) return;
    const result = await window.sydtrack.saveSummaryImage(summaryImage(summaryText(wellbeingStats)));
    if (result && result.canceled) setShareStatus('Save canceled.');
    else if (result && result.ok) setShareStatus('Saved on this computer. Nothing was uploaded.');
    else setShareStatus('Could not save the image.');
  });
  const list = wellbeingEl('app-list');
  if (list) {
    list.addEventListener('click', (ev) => {
      const btn = ev.target.closest && ev.target.closest('button[data-drill]');
      if (!btn) return;
      drillApp = btn.getAttribute('data-drill') || '';
      renderAppDrilldown(wellbeingStats);
    });
  }
  if (window.sydtrack && window.sydtrack.onWellbeingNotice) {
    window.sydtrack.onWellbeingNotice((payload) => {
      if (typeof showBanner === 'function') showBanner((payload && payload.body) || '', (payload && payload.kicker) || 'Decompress');
    });
  }
}

if (typeof document !== 'undefined') bindWellbeing();
if (typeof module !== 'undefined' && module.exports) module.exports = { goalPrefs };
