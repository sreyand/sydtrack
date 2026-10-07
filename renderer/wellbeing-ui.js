'use strict';

let wellbeingStats = null;
let wellbeingDate = '';
const WEEK_HISTORY_DAYS = 14;
const historyCache = { date: '', at: 0, count: 0, days: null, pending: null, pendingDate: '', pendingCount: 0 };

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
}

function noteWellbeingPayload(payload) {
  if (!payload) return;
  if (payload.stats) wellbeingStats = payload.stats;
  if (payload.stats && payload.stats.date) wellbeingDate = payload.stats.date;
}

function historyDayCount(days) {
  const n = Math.floor(Number(days));
  return Number.isFinite(n) ? Math.min(90, Math.max(1, n)) : WEEK_HISTORY_DAYS;
}

function loadGoalHistory(date, days) {
  const key = date || wellbeingDate || '';
  const count = historyDayCount(days);
  if (historyCache.days && historyCache.date === key && historyCache.count === count && Date.now() - historyCache.at < 60000) {
    return Promise.resolve(historyCache.days);
  }
  if (historyCache.pending && historyCache.pendingDate === key && historyCache.pendingCount === count) {
    return historyCache.pending;
  }
  const bridge = window.sydtrack;
  if (!bridge || !bridge.getHistorySummary) return Promise.resolve([]);
  const pending = bridge.getHistorySummary(count).then((rows) => {
    historyCache.date = key;
    historyCache.at = Date.now();
    historyCache.count = count;
    historyCache.days = rows || [];
    historyCache.pending = null;
    historyCache.pendingDate = '';
    historyCache.pendingCount = 0;
    return historyCache.days;
  }).catch(() => {
    historyCache.pending = null;
    historyCache.pendingDate = '';
    historyCache.pendingCount = 0;
    return [];
  });
  historyCache.pending = pending;
  historyCache.pendingDate = key;
  historyCache.pendingCount = count;
  return pending;
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
}

// History caches remain bounded; the current day's totals are already supplied
// by the live renderer and must not be replaced by an older cached snapshot.
function historyWithCurrentDay(days) {
  const live = wellbeingStats;
  return (Array.isArray(days) ? days : []).map(day => live && day.date === live.date ? {
    ...day,
    byCategory: live.byCategory || day.byCategory,
    topApps: live.topApps || day.topApps,
    apps: live.appBreakdown || day.apps
  } : day);
}

function renderScoreList(target, days, windowSize) {
  if (!target || typeof sydtrackGoals === 'undefined') return;
  const prefs = goalPrefs();
  const rolling = sydtrackGoals.rollingAverage(historyWithCurrentDay(days), {
    window: windowSize,
    includeOther: prefs.includeOther,
    goalPct: prefs.goalPct
  });
  if (!rolling.days.length) {
    target.textContent = 'No days to score yet.';
    return;
  }
  const markup = '<div class="week-score-grid">' + rolling.days.map((day) => {
    const date = String(day.date || '');
    const label = date.length >= 10 ? date.slice(5, 7) + '/' + date.slice(8, 10) : date;
    const title = date + ': ' + (day.scored ? day.percent + '% focus' : day.limited ? 'most tracked time is Other; no score' : 'no score');
    return focusScoreTile(day, 'week', label, title);
  }).join('') + '</div>';
  if (window.sydtrackDOM) window.sydtrackDOM.patchChildren(target, markup, { key: 'data-score-date' });
  else target.innerHTML = markup;
}

function renderWeekWellbeing() {
  const date = wellbeingDate;
  return loadGoalHistory(date, WEEK_HISTORY_DAYS).then((days) => {
    if (date !== wellbeingDate) return;
    days = historyWithCurrentDay(days);
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
  const list = wellbeingEl('month-focus-score-list');
  if (typeof sydtrackGoals === 'undefined') return;
  const prefs = goalPrefs();
  const month = sydtrackGoals.rollingAverage(historyWithCurrentDay(days), { window: 30, includeOther: prefs.includeOther, goalPct: prefs.goalPct });
  if (!list) return;
  const markup = '<div class="month-score-grid">' + month.days.map((day, index) => {
    const avg = month.series[index];
    const date = String(day.date || '');
    const label = date.length >= 10 ? date.slice(5, 7) + '/' + date.slice(8, 10) : date;
    const title = date + ': ' + (day.scored ? day.percent + '% focus share' : day.limited ? 'most tracked time is Other; no score' : 'no scored activity') +
      (avg && avg.percent != null ? '; 30-day average ' + avg.percent + '%' : '');
    return focusScoreTile(day, 'month', label, title);
  }).join('') + '</div>';
  if (window.sydtrackDOM) window.sydtrackDOM.patchChildren(list, markup, { key: 'data-score-date' });
  else list.innerHTML = markup;
}

function focusScoreTile(day, period, label, title) {
  const date = String(day.date || '');
  return '<button type="button" class="' + period + '-score-day focus-score-day" data-score-date="' + wellbeingEsc(date) +
    '" data-score-period="' + period + '" data-hit="' + (day.scored ? (day.hit ? 'yes' : 'no') : 'na') +
    '" title="' + wellbeingEsc(title + '; open Day Analytics') + '" aria-label="' + wellbeingEsc('View Day Analytics for ' + title) +
    '"><span class="' + period + '-score-date">' + wellbeingEsc(label) + '</span><strong>' +
    (day.scored ? day.percent + '%' : '—') + '</strong><span class="focus-score-open" aria-hidden="true">↗</span></button>';
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
  for (const id of ['week-focus-score-list', 'month-focus-score-list']) {
    on(id, 'click', event => {
      const button = event.target.closest('.focus-score-day');
      if (button && event.currentTarget.contains(button) && typeof openFocusScoreDay === 'function') {
        openFocusScoreDay(button.dataset.scoreDate, button.dataset.scorePeriod);
      }
    });
  }
}

function drillSharePercent(total, active) {
  const api = typeof sydtrackInsights !== 'undefined'
    ? sydtrackInsights
    : (typeof require === 'function' ? require('./lib/insights') : null);
  if (api && typeof api.appShare === 'function') {
    const ratio = api.appShare(total, active);
    return ratio == null ? null : Math.round(ratio * 100);
  }
  const activeSec = Math.max(0, Number(active) || 0);
  const totalSec = Math.max(0, Number(total) || 0);
  if (!activeSec) return null;
  return Math.round(Math.min(1, totalSec / activeSec) * 100);
}

if (typeof document !== 'undefined') bindWellbeing();
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { goalPrefs, drillSharePercent, WEEK_HISTORY_DAYS };
}
