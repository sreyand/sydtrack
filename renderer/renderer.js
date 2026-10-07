'use strict';

function fmt(s) {
  s = Math.max(0, Math.floor(+s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return h
    ? h + ':' + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0')
    : m + ':' + String(x).padStart(2, '0');
}

function fmtDuration(s) {
  s = Math.max(0, Math.floor(+s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 1) return m ? h + 'h ' + m + 'm' : h + 'h';
  return m + 'm';
}

function fmtFriendly(s) {
  s = Math.max(0, Math.floor(+s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 1) {
    const hp = h === 1 ? '1 hour' : h + ' hours';
    if (m <= 0) return hp;
    const mp = m === 1 ? '1 minute' : m + ' minutes';
    return hp + ' ' + mp;
  }
  if (m >= 1) {
    if (sec <= 0) return m === 1 ? '1 min' : m + ' min';
    const sp = sec === 1 ? '1 second' : sec + ' seconds';
    return (m === 1 ? '1 min' : m + ' min') + ' ' + sp;
  }
  if (sec <= 0) return '0 min';
  return sec === 1 ? '1 second' : sec + ' seconds';
}

/** Compact goal display: 1h 12m, 2h, 45m */
function fmtGoalShort(s) {
  s = Math.max(0, Math.floor(+s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 1) {
    if (m <= 0) return h + 'h';
    return h + 'h ' + m + 'm';
  }
  return m + 'm';
}

function $(id) {
  return document.getElementById(id);
}

// Generated chart markup only; keep surviving interactive nodes during live updates.
function patchChartMarkup(target, markup, key) {
  if (window.sydtrackDOM) window.sydtrackDOM.patchChildren(target, markup, { key });
  else target.innerHTML = markup;
}

let settingsSelectMenu = null;
let appearanceSaving = false;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setAppTrunc(el, text, tipLabel) {
  if (!el) return;
  const t = text == null ? '' : String(text);
  el.textContent = t;
  if (t && t !== '—' && t !== 'Waiting for an app…') {
    el.setAttribute('data-full', t);
    el.classList.add('app-trunc');
    if (tipLabel) el.setAttribute('data-tip-label', tipLabel);
  } else {
    el.setAttribute('data-full', '');
    el.removeAttribute('data-tip-label');
  }
}

function hideNameTip() {
  const tip = $('name-tip');
  if (tip) tip.classList.add('hidden');
}

function showNameTip(ev) {
  const el = ev.target && ev.target.closest && ev.target.closest('.app-trunc, .has-tip');
  const tip = $('name-tip');
  if (!el || !tip) {
    hideNameTip();
    return;
  }
  const full = (el.getAttribute('data-full') || el.getAttribute('title') || el.textContent || '').trim();
  if (!full || full === '—' || full === 'Waiting for an app…') {
    hideNameTip();
    return;
  }
  const always = el.classList.contains('has-tip');
  const truncated = el.scrollWidth > el.clientWidth + 1;
  if (!always && !truncated) {
    hideNameTip();
    return;
  }
  const kind = el.getAttribute('data-tip-label') || 'Full text';
  tip.innerHTML =
    '<div class="nt-label">' +
    esc(kind) +
    '</div><div class="nt-full">' +
    esc(full) +
    '</div>';
  tip.classList.remove('hidden');
  const pad = 12;
  const tw = tip.offsetWidth || 200;
  const th = tip.offsetHeight || 60;
  let left = ev.clientX + 14;
  let top = ev.clientY + 14;
  if (left + tw > window.innerWidth - pad) left = ev.clientX - tw - 12;
  if (top + th > window.innerHeight - pad) top = ev.clientY - th - 10;
  tip.style.left = Math.max(pad, left) + 'px';
  tip.style.top = Math.max(pad, top) + 'px';
}


const api = window.sydtrack;
let applying = false;
let pauseUiSettings = null;
let pauseActionBusy = false;
let pauseActionError = '';
/** Cached rules/ignore for one-click reclassify. */
let cachedRules = { productive: [], unproductive: [], other: [] };
let cachedBrowserApps = [];
let cachedIgnoredApps = [];
let cachedIgnore = [];
let tagsQuickSaving = false;
/** Last focused window for Home quick-classify (P/U/O). */
let lastFocusedCache = null;
let lfClassifySaving = false;
/** Session overrides so Last focused chip/buttons don't snap back before tracker reclassifies. */
const lfSessionClass = Object.create(null);

function lfOverrideKey(entry) {
  if (!entry || !entry.app) return '';
  const kw = keywordForQuickClassify(entry);
  return entry.app.toLowerCase() + '\u0000' + (kw || '').toLowerCase();
}

function applyLfButtonOutlines(category) {
  const keyword = keywordForQuickClassify(lastFocusedCache);
  const canChoosePhrase = !!lastFocusedCache && isBrowserApp(lastFocusedCache.app) &&
    !!window.sydtrackBrowserRules.contentTitle(lastFocusedCache.title, cachedBrowserApps);
  for (const [id, value] of [['lf-prod', 'productive'], ['lf-unprod', 'unproductive'], ['lf-other', 'other'], ['lf-ignore', 'ignored']]) {
    const button = $(id);
    if (!button) continue;
    const active = category === value;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
    button.dataset.saving = String(lfClassifySaving);
    button.disabled = lfClassifySaving || !lastFocusedCache || (value !== 'ignored' && !keyword && !canChoosePhrase);
    const label = value === 'ignored' ? 'Ignore' : value[0].toUpperCase() + value.slice(1);
    button.title = !lastFocusedCache ? 'Waiting for an app' : value === 'ignored'
      ? 'Ignore the whole app: ' + lastFocusedCache.app
      : keyword ? label + ' rule for “' + keyword + '” in this profile'
      : 'Choose a title phrase for a ' + label.toLowerCase() + ' rule';
  }
}

function processNameForIgnore(entry) {
  if (!entry || !entry.app) return null;
  return (
    String(entry.app)
      .replace(/\.exe$/i, '')
      .trim() || null
  );
}

/** Threshold before FocusBoost was armed (seconds). */
let thresholdBeforeBoost = null;
const FOCUSBOOST_DEFAULT_SEC = 3 * 60;

function focusBoostSecFromSettings(settings) {
  const n = Number(settings && settings.focusBoostSec);
  if (Number.isFinite(n) && n >= 5) return Math.round(n);
  return FOCUSBOOST_DEFAULT_SEC;
}

function parseHmToMinutes(hm) {
  const raw = String(hm || '').trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function isInFocusBoostScheduleWindow(settings, now) {
  if (!settings || !settings.focusBoostScheduleEnabled) return false;
  const start = parseHmToMinutes(settings.focusBoostScheduleStart || '09:00');
  const end = parseHmToMinutes(settings.focusBoostScheduleEnd || '17:00');
  if (start == null || end == null) return false;
  const d = now || new Date();
  const cur = d.getHours() * 60 + d.getMinutes();
  if (start === end) return true; // 24h window
  if (start < end) return cur >= start && cur < end;
  // overnight: e.g. 22:00–06:00
  return cur >= start || cur < end;
}

/** Last desired schedule state we applied (true/false/null). Transition-only. */
let focusBoostScheduleDesired = null;

async function armFocusBoostFromSchedule(settings) {
  const boostSec = focusBoostSecFromSettings(settings);
  const restore =
    Number(settings.focusBoostRestoreSec) ||
    (Number(settings.thresholdSec) && Number(settings.thresholdSec) !== boostSec
      ? Number(settings.thresholdSec)
      : thresholdBeforeBoost) ||
    600;
  thresholdBeforeBoost = restore;
  const next = await pushSettings({
    focusBoost: true,
    thresholdSec: boostSec,
    focusBoostRestoreSec: restore,
    focusBoostSec: boostSec
  });
  syncFocusBoostUi(
    next || {
      focusBoost: true,
      thresholdSec: boostSec,
      focusBoostSec: boostSec,
      focusBoostScheduleEnabled: true
    }
  );
}

async function disarmFocusBoostFromSchedule(settings) {
  const boostSec = focusBoostSecFromSettings(settings);
  const restore =
    Number(settings.focusBoostRestoreSec) || thresholdBeforeBoost || 600;
  const next = await pushSettings({
    focusBoost: false,
    thresholdSec: restore
  });
  syncFocusBoostUi(
    next || {
      focusBoost: false,
      thresholdSec: restore,
      focusBoostSec: boostSec
    }
  );
}

async function applyFocusBoostSchedule(settings, opts) {
  const force = !!(opts && opts.force);
  if (!settings || !settings.focusBoostScheduleEnabled) {
    focusBoostScheduleDesired = null;
    return;
  }
  const desired = isInFocusBoostScheduleWindow(settings);
  if (!force && focusBoostScheduleDesired === desired) return;
  focusBoostScheduleDesired = desired;
  const on = !!settings.focusBoost;
  if (desired && !on) {
    await armFocusBoostFromSchedule(settings);
  } else if (!desired && on) {
    await disarmFocusBoostFromSchedule(settings);
  }
}

const reduceMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

for (const scrollArea of document.querySelectorAll('.main, .rail, textarea')) {
  let hideScrollThumb;
  const revealScrollThumb = () => {
    scrollArea.classList.add('scroll-active');
    clearTimeout(hideScrollThumb);
    hideScrollThumb = setTimeout(() => scrollArea.classList.remove('scroll-active'), reduceMotion ? 600 : 1100);
  };
  scrollArea.addEventListener('scroll', revealScrollThumb, { passive: true });
  scrollArea.addEventListener('pointermove', revealScrollThumb, { passive: true });
  scrollArea.addEventListener('pointerenter', revealScrollThumb, { passive: true });
  scrollArea.addEventListener('keydown', revealScrollThumb);
}

/** Session-only Analytics segment. */
let analyticsSegment = 'day';
let currentPlatform = null;
let lifetimeRequest = 0;
let latestGoalSettings = null;
let timelineDayData = null;
let timelineRequest = 0;
let timelineLastRefresh = 0;
let liveDayDate = null;
let timelineFollowsToday = true;
let timelineProfileNames = {};
let timelineManualViewport = null;
let timelineViewport = null;
let focusScoreReturn = null;

function localDateKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function timelineTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function timelineAxis(start, end) {
  const span = end - start;
  const minute = 60000;
  const interval = [5, 10, 15, 30, 60, 120, 180, 240, 360]
    .find(value => span / (value * minute) <= 5) || 360;
  const ticks = [start];
  for (let time = Math.ceil(start / (interval * minute)) * interval * minute;
    time < end; time += interval * minute) {
    if ((time - start) / span > 0.12 && (end - time) / span > 0.12) ticks.push(time);
  }
  ticks.push(end);
  return ticks.map((time, index) => {
    const percent = (time - start) / span * 100;
    const align = index === 0 ? 'first' : index === ticks.length - 1 ? 'last' : '';
    return '<span class="' + align + '" style="left:' + percent + '%">' + esc(timelineTime(time)) + '</span>';
  }).join('');
}

function renderTimeline() {
  const visual = $('timeline-visual');
  if (!visual) return;
  const date = $('timeline-date').value;
  const day = timelineDayData && timelineDayData.date === date ? timelineDayData : { date, timeline: [], byHour: [] };
  const data = sydtrackDayTimeline.model(day);
  const hourlyCard = $('day-hourly-card');
  if (hourlyCard) hourlyCard.classList.toggle('hidden', data.precision !== 'hourly' && data.precision !== 'partial');
  const precision = $('timeline-precision');
  const longest = $('timeline-longest');
  const showLongest = (data.precision === 'segments' || data.precision === 'partial') && data.longestProductive &&
    data.longestProductive.end - data.longestProductive.start >= 300000;
  longest.classList.toggle('hidden', !showLongest);
  if (showLongest) {
    const block = data.longestProductive;
    const duration = (block.end - block.start) / 1000;
    longest.textContent = (data.precision === 'partial' ? 'Longest recorded productive block: ' : 'Longest productive block: ') +
      (duration < 60 ? fmtFriendly(duration) : fmtDuration(duration)) + ' · ' + timelineTime(block.start) + '–' + timelineTime(block.end);
  } else longest.textContent = '';
  precision.textContent = data.precision === 'hourly'
    ? 'Earlier activity is available as hourly totals below; its order and idle gaps were not recorded.'
    : data.precision === 'daily'
      ? 'Only daily totals were recorded. Hourly order and idle gaps are unavailable.'
    : data.precision === 'partial'
      ? 'Segments began after some activity was recorded. Earlier activity remains in hourly totals below.'
      : data.precision === 'empty'
        ? 'No activity recorded for this day.'
        : 'Colors show activity; gaps are untracked.';
  if (data.precision === 'hourly' || data.precision === 'daily' || data.precision === 'empty') {
    timelineViewport = null;
    $('timeline-recenter').classList.add('hidden');
    $('timeline-footer').classList.add('hidden');
    visual.classList.add('hidden');
    $('timeline-legend').classList.add('hidden');
    $('timeline-text').innerHTML = '<li>No precise segments for this day.</li>';
    return;
  }
  visual.classList.remove('hidden');
  $('timeline-legend').classList.remove('hidden');
  const labels = { productive: 'Productive', unproductive: 'Unproductive', other: 'Other', idle: 'Idle' };
  const viewport = timelineManualViewport && timelineManualViewport.date === date
    ? timelineManualViewport
    : sydtrackDayTimeline.activityWindow(data.rows, data.visible);
  timelineViewport = { ...viewport, dayStart: data.rows[0].start, dayEnd: data.rows[data.rows.length - 1].end, date };
  const { start, end } = viewport;
  const recenter = $('timeline-recenter');
  recenter.classList.toggle('hidden', !(timelineManualViewport && timelineManualViewport.date === date));
  $('timeline-footer').classList.toggle('hidden', !showLongest && recenter.classList.contains('hidden'));
  const spanHours = (end - start) / 3600000;
  const bucketMinutes = spanHours > 12 ? 30 : spanHours > 4 ? 15 : spanHours > 1 ? 10 : spanHours > 0.75 ? 5 : 0;
  if (data.precision === 'segments') precision.textContent = bucketMinutes
    ? bucketMinutes + '-min overview · dominant state or mix; gaps untracked.'
    : 'Exact category changes; gaps are untracked.';
  else if (data.precision === 'partial' && bucketMinutes) precision.textContent +=
    ' The timeline is a ' + bucketMinutes + '-minute dominant-state overview; zoom in for exact changes.';
  const overview = bucketMinutes
    ? sydtrackDayTimeline.overviewBuckets(data.visible, start, end, data.rows[0].start, bucketMinutes * 60000)
    : null;
  $('timeline-mixed-key').classList.toggle('hidden', !overview || !overview.some(bucket => bucket.kind === 'mixed'));
  const displaySegments = overview ? overview.filter(bucket => bucket.kind !== 'untracked') : data.visible;
  const blocks = displaySegments.flatMap(segment => {
    const from = Math.max(start, segment.start);
    const to = Math.min(end, segment.end);
    if (to <= from) return [];
    const label = overview
      ? timelineTime(from) + '–' + timelineTime(to) + ' · ' +
        Object.entries(segment.durations).filter(([, ms]) => ms >= 1000)
          .map(([kind, ms]) => (labels[kind] || 'Untracked') + ' ' + (ms >= 60000 ? fmtDuration(ms / 1000) : Math.round(ms / 1000) + 's')).join(' · ')
      : labels[segment.kind] + ' · ' + timelineTime(from) + '–' + timelineTime(to) +
        (segment.profileId ? ' · ' + (timelineProfileNames[segment.profileId] || segment.profileId) : '');
    return ['<span class="timeline-block ' + segment.kind + '" style="left:' + ((from - start) / (end - start) * 100) +
      '%;width:' + ((to - from) / (end - start) * 100) + '%" title="' + esc(label) + '"></span>'];
  });
  visual.innerHTML = '<div class="timeline-track">' + blocks.join('') + '</div>' +
    '<div class="timeline-axis" aria-hidden="true">' + timelineAxis(start, end) + '</div>';
  visual.setAttribute('aria-label', 'Timeline for ' + date + '. ' + precision.textContent +
    ' Showing ' + timelineTime(start) + ' to ' + timelineTime(end) + '. ' + data.visible.length +
    ' recorded segments. Pinch to zoom, or press plus and minus. Press zero to reset. Text list follows.');
  const entries = data.visible.map(segment => timelineTime(segment.start) + '–' + timelineTime(segment.end) +
    ': ' + labels[segment.kind] + (segment.profileId ? ' · ' + (timelineProfileNames[segment.profileId] || segment.profileId) : ''));
  $('timeline-text').innerHTML = entries.length
    ? entries.map(entry => '<li>' + esc(entry) + '</li>').join('')
    : '<li>No segments match these filters.</li>';
}

const timelineRecenter = $('timeline-recenter');
if (timelineRecenter) timelineRecenter.addEventListener('click', () => {
  timelineManualViewport = null;
  renderTimeline();
  $('timeline-visual').focus();
});

const timelineVisual = $('timeline-visual');
if (timelineVisual) {
  timelineVisual.addEventListener('wheel', event => {
    if (!event.ctrlKey || !timelineViewport) return;
    event.preventDefault();
    const track = timelineVisual.querySelector('.timeline-track');
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const fraction = rect.width ? (event.clientX - rect.left) / rect.width : 0.5;
    const scale = Math.exp(Math.max(-120, Math.min(120, event.deltaY)) * 0.008);
    const next = sydtrackDayTimeline.zoomWindow(timelineViewport, timelineViewport.dayStart,
      timelineViewport.dayEnd, scale, fraction);
    timelineManualViewport = { ...next, date: timelineViewport.date };
    renderTimeline();
  }, { passive: false });
  timelineVisual.addEventListener('keydown', event => {
    if (!timelineViewport) return;
    if (event.key === '0') {
      event.preventDefault();
      timelineManualViewport = null;
      renderTimeline();
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      const next = sydtrackDayTimeline.zoomWindow(timelineViewport, timelineViewport.dayStart,
        timelineViewport.dayEnd, event.key === '-' ? 1.5 : 2 / 3, 0.5);
      timelineManualViewport = { ...next, date: timelineViewport.date };
      renderTimeline();
    }
  });
  timelineVisual.addEventListener('dblclick', () => {
    if (!timelineViewport) return;
    timelineManualViewport = null;
    renderTimeline();
  });
}

async function loadTimelineDay() {
  const dateInput = $('timeline-date');
  if (!dateInput || !dateInput.value) return;
  const date = dateInput.value;
  const request = ++timelineRequest;
  if (!timelineDayData || timelineDayData.date !== date) {
    timelineDayData = { date, timeline: [], byHour: [], byCategory: {} };
    renderTimeline();
    if (analyticsSegment === 'day') renderDay(timelineDayData);
  }
  $('timeline-precision').textContent = 'Loading activity…';
  $('timeline-longest').classList.add('hidden');
  $('timeline-longest').textContent = '';
  try {
    const [day, profiles] = await Promise.all([api.getTimelineDay(date), api.getProfiles()]);
    if (request !== timelineRequest || dateInput.value !== date) return;
    timelineProfileNames = Object.fromEntries(((profiles && profiles.profiles) || []).map(p => [p.id, p.name]));
    timelineDayData = day || { date, timeline: [], byHour: [] };
    renderTimeline();
    if (analyticsSegment === 'day') renderDay(timelineDayData);
    const status = $('focus-score-status');
    if (status && analyticsSegment === 'day') status.textContent = 'Day Analytics loaded for ' + date + '.';
    timelineLastRefresh = Date.now();
  } catch (_) {
    if (request === timelineRequest) $('timeline-precision').textContent = 'Could not load this day.';
  }
}

function describeFocus(byCategory) {
  const includeOther = !!(latestGoalSettings && latestGoalSettings.focusShareIncludeOther);
  const goalPct = Number(latestGoalSettings && latestGoalSettings.focusShareGoalPct) || 80;
  if (typeof sydtrackGoals === 'undefined') return null;
  return sydtrackGoals.focusShareStatus(byCategory, { includeOther, goalPct });
}

function focusBasis(focus) {
  if (!focus || !focus.trackedSec) return 'No tracked time yet';
  const duration = seconds => seconds < 60 ? Math.floor(seconds) + 's' : fmtDuration(seconds);
  if (focus.includeOther) return 'Of all ' + duration(focus.trackedSec) + ' tracked';
  return 'Based on ' + duration(focus.classifiedSec) + ' of ' + duration(focus.trackedSec) + ' tracked';
}
let historyRequest = 0;
let historicalWeek = null;
let fullHistoryCache = null;
let fullHistoryPromise = null;
let fullHistoryGeneration = 0;

function setHistoryLoading(on, message) {
  const el = $('analytics-loading');
  if (!el) return;
  if (on) {
    el.textContent = message || 'Loading history…';
    el.classList.remove('hidden');
  } else if (message) {
    el.textContent = message;
    el.classList.remove('hidden');
  } else el.classList.add('hidden');
}

function invalidateHistoryViews() {
  historyRequest++;
  fullHistoryGeneration++;
  fullHistoryCache = null;
  fullHistoryPromise = null;
  historicalWeek = null;
}

async function ensureFullHistory(fetchHistory = api && api.getHistorySummary) {
  if (fullHistoryCache) return fullHistoryCache;
  if (!fetchHistory) return null;
  if (!fullHistoryPromise) {
    setHistoryLoading(true, 'Loading history…');
    const generation = fullHistoryGeneration;
    fullHistoryPromise = Promise.resolve(fetchHistory(90)).then((days) => {
      if (generation !== fullHistoryGeneration) return null;
      fullHistoryCache = Array.isArray(days) ? days : [];
      setHistoryLoading(false);
      return fullHistoryCache;
    }).catch(() => {
      if (generation !== fullHistoryGeneration) return null;
      fullHistoryPromise = null;
      setHistoryLoading(false, 'Could not load history. Reopen this tab to retry.');
      return null;
    });
  }
  return fullHistoryPromise;
}

async function loadAnalyticsHistory(fetchHistory = api && api.getHistorySummary) {
  if (!fetchHistory || !['week', 'month'].includes(analyticsSegment)) return;
  const request = ++historyRequest;
  const segment = analyticsSegment;
  const target = segment === 'week' ? $('week-chart') : $('month-history');
  if (target) target.textContent = 'Loading history…';
  try {
    const all = await ensureFullHistory(fetchHistory);
    if (request !== historyRequest || analyticsSegment !== segment) return;
    const days = historyWithCurrentDay(all).slice(segment === 'week' ? -7 : -30);
    if (segment === 'week') { historicalWeek = days; renderWeek({ week: days }); }
    else if (target) target.innerHTML = monthMarkup(days);
    if (segment === 'week' && typeof renderWeekWellbeing === 'function') await renderWeekWellbeing();
    if (segment === 'month' && typeof renderMonthFocusScores === 'function') renderMonthFocusScores(days);
  } catch (_) { if (request === historyRequest && target) target.textContent = 'Could not load history. Reopen this tab to retry.'; }
}

function monthMarkup(days) {
  const totals = { productive: 0, unproductive: 0, other: 0 };
  const apps = new Map();
  let activeDays = 0;
  for (const day of days) {
    let daily = 0;
    for (const category of Object.keys(totals)) { const value = Math.max(0, Number(day.byCategory[category]) || 0); totals[category] += value; daily += value; }
    if (daily > 0) activeDays++;
    for (const app of day.apps || []) {
      if (app.category === 'ignored') continue;
      const key = app.name.toLowerCase();
      const previous = apps.get(key) || { name: app.name, seconds: 0 };
      previous.seconds += Math.max(0, Number(app.seconds) || 0); apps.set(key, previous);
    }
  }
  const total = totals.productive + totals.unproductive + totals.other;
  const classified = totals.productive + totals.unproductive;
  const includeOther = typeof latestGoalSettings !== 'undefined' && latestGoalSettings && !!latestGoalSettings.focusShareIncludeOther;
  const focusDenom = includeOther ? total : classified;
  const focus = describeFocus(totals);
  const share = focusDenom ? Math.round(totals.productive / focusDenom * 100) + '%' : '—';
  const p = total ? totals.productive / total * 360 : 0;
  const u = total ? (totals.productive + totals.unproductive) / total * 360 : 0;
  const gradient = total ? 'conic-gradient(var(--prod) 0deg ' + p + 'deg,var(--unprod) ' + p + 'deg ' + u + 'deg,var(--other) ' + u + 'deg 360deg)' : 'var(--line-strong)';
  const top = [...apps.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 5);
  return '<article class="card month-pie-card"><div class="month-pie-wrap"><div class="pie-chart" role="img" aria-label="Last 30 days: ' + share + ' focus share" style="background:' + gradient + '"></div>' +
    '<div class="pie-center"><div id="month-focus-share" class="pie-total">' + share + '</div><div class="muted tiny">focus share</div></div></div>' +
    '<p class="muted tiny">' + esc(focusBasis(focus)) + '</p><div class="month-legend">' +
    [['productive', 'Productive'], ['unproductive', 'Unproductive'], ['other', 'Other']].map(([key, label]) => '<span><i class="month-dot ' + key + '"></i>' + label + ' <strong>' + esc(fmtFriendly(totals[key])) + '</strong></span>').join('') +
    '</div></article><div class="month-summary"><article class="card"><h3>Last 30 days</h3><div class="month-stat"><span class="muted">Total tracked</span><strong>' + esc(fmtFriendly(total)) + '</strong></div>' +
    '<div class="month-stat"><span class="muted">Days with activity</span><strong>' + activeDays + '</strong></div>' +
    '<div class="month-stat"><span class="muted">Average per active day</span><strong>' + esc(fmtFriendly(activeDays ? total / activeDays : 0)) + '</strong></div></article>' +
    '<article class="card"><h3>Top apps</h3>' + (top.length ? top.map(app => '<div class="month-stat"><span class="month-app" title="' + esc(app.name) + '">' + esc(app.name) + '</span><strong>' + esc(fmtFriendly(app.seconds)) + '</strong></div>').join('') : '<p class="muted">No activity recorded yet</p>') + '</article></div>';
}

const ANALYTICS_SUBTITLES = {
  day: 'Timeline and hourly totals',
  week: 'Last 7 days',
  month: 'Last 30 days',
  apps: 'App time and classifications',
  lifetime: 'All the time you have tracked'
};

function lifetimeDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '—';
  return new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderLifetime(summary) {
  const total = Math.max(0, Number(summary && summary.totalSeconds) || 0);
  const totals = summary && summary.byCategory || {};
  $('lifetime-total').textContent = fmtGoalShort(total) + ' tracked';
  $('lifetime-range').textContent = summary && summary.firstDay
    ? 'Since ' + lifetimeDate(summary.firstDay)
    : 'Your first tracked day will appear here.';
  $('lifetime-days').textContent = String(summary && summary.activeDays || 0);
  $('lifetime-average').textContent = fmtGoalShort(summary && summary.averageSeconds || 0);
  $('lifetime-best').textContent = summary && summary.longestDay && summary.longestDay.date
    ? fmtGoalShort(summary.longestDay.seconds) + ' · ' + lifetimeDate(summary.longestDay.date)
    : '—';
  const pieces = [['productive', 'Productive'], ['unproductive', 'Unproductive'], ['other', 'Other']];
  $('lifetime-breakdown').innerHTML = pieces.map(([key, label]) => {
    const seconds = Math.max(0, Number(totals[key]) || 0);
    const percentage = total ? Math.round(seconds / total * 100) : 0;
    return '<div class="lifetime-category"><div class="lifetime-category-label"><span><i class="month-dot ' + key + '"></i>' + label + '</span><strong>' + fmtGoalShort(seconds) + '</strong></div>' +
      '<div class="lifetime-track"><span class="' + key + '" style="width:' + percentage + '%"></span></div></div>';
  }).join('');
}

async function loadLifetime() {
  if (!api || !api.getLifetimeSummary) return;
  const request = ++lifetimeRequest;
  try {
    const summary = await api.getLifetimeSummary();
    if (request === lifetimeRequest && analyticsSegment === 'lifetime') renderLifetime(summary);
  } catch (_) {
    if (request === lifetimeRequest) $('lifetime-range').textContent = 'Could not load lifetime totals.';
  }
}

function setAnalyticsSegment(segment, preserveScoreReturn = false) {
  hideChartTip('day-tip');
  hideChartTip('week-tip');
  if (segment !== 'day' && segment !== 'week' && segment !== 'month' && segment !== 'apps' && segment !== 'lifetime') {
    segment = 'day';
  }
  analyticsSegment = segment;
  if (!preserveScoreReturn) focusScoreReturn = null;
  const scoreBack = $('focus-score-back');
  if (scoreBack) scoreBack.classList.toggle('hidden', segment !== 'day' || !focusScoreReturn);
  document.querySelectorAll('.segment-btn[data-segment]').forEach((b) => {
    const on = b.getAttribute('data-segment') === segment;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.analytics-panel').forEach((panel) => {
    const id = panel.getAttribute('data-panel') || panel.id.replace(/^panel-/, '');
    panel.classList.toggle('hidden', id !== segment);
  });
  if ($('apps-range')) $('apps-range').classList.toggle('hidden', segment !== 'apps');
  const sub = $('analytics-subtitle');
  if (sub) sub.textContent = ANALYTICS_SUBTITLES[segment] || ANALYTICS_SUBTITLES.day;
  historyRequest++;
  const historyLoad = loadAnalyticsHistory();
  if (segment === 'lifetime') loadLifetime();
  if (segment === 'day') loadTimelineDay();
  if (segment === 'apps' && appsRange !== 'day') setAppsRange(appsRange);
  return historyLoad;
}

function openFocusScoreDay(date, period) {
  if (!['week', 'month'].includes(period) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T12:00:00');
  if (!Number.isFinite(parsed.getTime()) || parsed.getFullYear() !== Number(date.slice(0, 4)) ||
    parsed.getMonth() + 1 !== Number(date.slice(5, 7)) || parsed.getDate() !== Number(date.slice(8, 10)) || date > localDateKey()) return false;
  const input = $('timeline-date');
  const main = document.querySelector('.main');
  if (!input || !main) return false;
  focusScoreReturn = { date, period, scrollTop: main.scrollTop };
  input.max = localDateKey();
  input.value = date;
  // A score tile represents this specific date, including across midnight.
  timelineFollowsToday = false;
  timelineManualViewport = null;
  setAnalyticsSegment('day', true);
  main.scrollTop = 0;
  $('focus-score-status').textContent = 'Opening Day Analytics for ' + date + '.';
  document.querySelector('.segment-btn[data-segment="day"]')?.focus({ preventScroll: true });
  return true;
}

async function returnToFocusScores() {
  const origin = focusScoreReturn;
  if (!origin) return;
  await setAnalyticsSegment(origin.period, true);
  if (focusScoreReturn !== origin || analyticsSegment !== origin.period || $('view-analytics').classList.contains('hidden')) return;
  const list = $(origin.period + '-focus-score-list');
  const tile = list && [...list.querySelectorAll('.focus-score-day')].find(button => button.dataset.scoreDate === origin.date);
  const focusTarget = tile || document.querySelector('.segment-btn[data-segment="' + origin.period + '"]');
  if (focusTarget) focusTarget.focus({ preventScroll: true });
  document.querySelector('.main').scrollTop = origin.scrollTop;
}

const focusScoreBack = $('focus-score-back');
if (focusScoreBack) focusScoreBack.addEventListener('click', returnToFocusScores);
const scoreAnalyticsView = $('view-analytics');
if (scoreAnalyticsView) scoreAnalyticsView.addEventListener('keydown', event => {
  if (event.key === 'Escape' && focusScoreReturn && analyticsSegment === 'day') {
    event.preventDefault();
    returnToFocusScores();
  }
});

function initSettingsPanels() {
  const tracking = $('settings-panel-tracking');
  const wellbeing = $('settings-panel-wellbeing');
  const notifications = $('settings-panel-notifications');
  const trackerCard = $('settings-tracker-card');
  const wellbeingCard = $('settings-wellbeing-card');
  const notificationCard = $('settings-notifications-card');
  if (!tracking || !wellbeing || !notifications || !trackerCard || !wellbeingCard || !notificationCard) return;
  wellbeingCard.append($('goals-settings'), $('settings-breaks'));
  notificationCard.append(document.querySelector('.fb-schedule-block'), $('settings-reminder-timing'), $('settings-messages'));
  trackerCard.append($('settings-idle'));
  $('settings-data-card').insertBefore(document.querySelector('.settings-meta'), $('settings-storage-details'));
  tracking.append($('settings-appearance-card'), trackerCard, $('settings-updates-card'), $('settings-data-card'), document.querySelector('.font-credit'));
  wellbeing.append(wellbeingCard);
  notifications.append(notificationCard);
  document.querySelectorAll('[data-settings-tab]').forEach(button => button.addEventListener('click', () => {
    closePauseMenu();
    const tab = button.dataset.settingsTab;
    document.querySelectorAll('[data-settings-tab]').forEach(candidate => {
      const selected = candidate === button;
      candidate.classList.toggle('active', selected);
      candidate.setAttribute('aria-selected', String(selected));
    });
    for (const name of ['tracking', 'wellbeing', 'notifications']) {
      $('settings-panel-' + name).classList.toggle('hidden', name !== tab);
    }
  }));
}
initSettingsPanels();

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    closePauseMenu();
    hideChartTip('day-tip');
    hideChartTip('week-tip');
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.getAttribute('data-tab');
    $('view-home').classList.toggle('hidden', tab !== 'home');
    const analyticsView = $('view-analytics');
    if (analyticsView) analyticsView.classList.toggle('hidden', tab !== 'analytics');
    const roundupView = $('view-roundup');
    if (roundupView) roundupView.classList.toggle('hidden', tab !== 'roundup');
    const sessionsView = $('view-sessions');
    if (sessionsView) sessionsView.classList.toggle('hidden', tab !== 'sessions');
    const tagsView = $('view-tags');
    if (tagsView) tagsView.classList.toggle('hidden', tab !== 'tags' && tab !== 'focus-tags');
    $('view-settings').classList.toggle('hidden', tab !== 'settings');
    if (tab === 'analytics') setAnalyticsSegment(analyticsSegment);
    if (tab === 'sessions') refreshSessionLog();
    if ((tab === 'tags' || tab === 'focus-tags') && !window.sydtrackProfilesUI) loadRulesAndIgnore();
  });
});

document.querySelectorAll('.segment-btn[data-segment]').forEach((btn) => {
  btn.addEventListener('click', () => {
    setAnalyticsSegment(btn.getAttribute('data-segment') || 'day');
  });
});

const timelineDateInput = $('timeline-date');
if (timelineDateInput) {
  timelineDateInput.max = localDateKey();
  timelineDateInput.value = localDateKey();
  timelineDateInput.addEventListener('change', () => {
    if (timelineDateInput.value > timelineDateInput.max) timelineDateInput.value = timelineDateInput.max;
    timelineFollowsToday = timelineDateInput.value === timelineDateInput.max;
    timelineManualViewport = null;
    loadTimelineDay();
  });
}

const navToggle = $('nav-toggle');
if (navToggle) {
  navToggle.addEventListener('click', () => {
    document.body.classList.toggle('nav-collapsed');
    const collapsed = document.body.classList.contains('nav-collapsed');
    navToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    navToggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    navToggle.setAttribute('aria-label', navToggle.title);
  });
}

let bannerHideTimer = null;
function hideBanner() {
  const b = $('banner');
  if (b) b.classList.add('hidden');
  if (bannerHideTimer) {
    clearTimeout(bannerHideTimer);
    bannerHideTimer = null;
  }
}
function showBanner(text, kicker) {
  const b = $('banner');
  if (!b) return;
  const kickerEl = b.querySelector('.banner-kicker');
  if (kickerEl) kickerEl.textContent = kicker || 'Refocus';
  if ($('banner-text')) $('banner-text').textContent = text || 'Time to refocus.';
  b.classList.remove('hidden');
  if (bannerHideTimer) clearTimeout(bannerHideTimer);
  bannerHideTimer = setTimeout(hideBanner, 15000);
}
$('banner-dismiss').addEventListener('click', hideBanner);

function updateSourcePill(now) {
  if (!now) return;
  const pill = $('source-pill');
  const source = now.source || 'idle';
  const labels = {
    real: 'Live tracking',
    demo: 'Demo mode',
    paused: 'Paused',
    idle: 'Waiting',
    'fallback-demo': 'Fallback'
  };
  pill.textContent = labels[source] || source;
  pill.title = pill.textContent;
  pill.className = 'status-pill ' + source;
}


function isBrowserApp(app) {
  return window.sydtrackBrowserRules.isBrowserName(app, cachedBrowserApps);
}

/** Category labels agree with Analytics, including unrecognized browser pages. */
function chipDisplay(category, app, browserFlag) {
  const cat = category || 'other';
  return { className: 'chip ' + cat, label: cat };
}

function applyCategoryChip(el, category, app, browserFlag) {
  if (!el) return;
  const d = chipDisplay(category, app, browserFlag);
  el.textContent = d.label;
  el.className = d.className;
}

function keywordForQuickClassify(entry) {
  if (!entry || !entry.app) return null;
  if (isBrowserApp(entry.app)) {
    const host = window.sydtrackBrowserRules.hostname(entry.url || '');
    if (host) return `site:${host}`;
    return window.sydtrackBrowserRules.quickKeyword(entry, cachedRules);
  }
  return String(entry.app)
    .replace(/\.exe$/i, '')
    .trim() || null;
}


function listHasKey(arr, key) {
  if (key == null || key === '') return false;
  const k = String(key).toLowerCase();
  return (arr || []).some((x) => String(x).toLowerCase() === k);
}

/**
 * Client-side default category from remaining rules (mimic classifier):
 * ignore by process name → ignored; unproductive keyword wins, then productive;
 * unrecognized browser titles and native apps → Other.
 */
function defaultCategoryFromRules(entry, rules, ignore) {
  if (!entry) return 'other';
  const r = rules || cachedRules || { productive: [], unproductive: [], other: [] };
  const ign = ignore != null ? ignore : cachedIgnore || [];
  const pname = processNameForIgnore(entry);
  if (pname) {
    const pk = pname.toLowerCase();
    if (cachedIgnoredApps.some(name => String(name).toLowerCase().replace(/\.exe$/i, '') === pk)) return 'ignored';
    for (const x of ign) {
      const k = String(x || '').toLowerCase();
      if (!k) continue;
      if (window.sydtrackBrowserRules.exactKeyword(pk, k)) return 'ignored';
    }
  }
  if (isBrowserApp(entry.app)) return window.sydtrackBrowserRules.classifyBrowser(entry, r);
  const key = (pname || '').toLowerCase();
  const text = (key + ' ' + (entry.title || '')).toLowerCase();
  const matches = type => (r[type] || []).some(tag => !tag.startsWith('site:') && window.sydtrackBrowserRules.exactKeyword(text, tag));
  if (matches('other')) return 'other';
  if (listHasKey(r.unproductive, key)) return 'unproductive';
  if (listHasKey(r.identities && r.identities.productiveApps, key)) return 'productive';
  if (matches('unproductive')) return 'unproductive';
  if (matches('productive')) return 'productive';
  return 'other';
}


function refreshLastFocusedAfterToggle(key) {
  if (key && lfSessionClass[key]) delete lfSessionClass[key];
  if (!lastFocusedCache) return;
  const lfKey = lfOverrideKey(lastFocusedCache);
  const lfKw = (keywordForQuickClassify(lastFocusedCache) || '').toLowerCase();
  const lfName = (processNameForIgnore(lastFocusedCache) || '').toLowerCase();
  if (!(lfKey === key || lfKw === key || lfName === key)) return;
  if (lfKey) delete lfSessionClass[lfKey];
  lastFocusedCache.category = defaultCategoryFromRules(
    lastFocusedCache,
    cachedRules,
    cachedIgnore
  );
  // A renderer preview cannot explain the main process's current correction.
  // Clear stale evidence until the authoritative metadata arrives.
  lastFocusedCache.explanation = null;
  applyCategoryChip(
    $('lf-cat'),
    lastFocusedCache.category,
    lastFocusedCache.app,
    lastFocusedCache.browser
  );
  applyLfButtonOutlines(lastFocusedCache.category);
  window.sydtrackCategoryUI?.update(lastFocusedCache);
  window.sydtrackQuickUI?.focusChanged();
}

function renderLastFocused(lf, now) {
  const appEl = $('lf-app');
  const titleEl = $('lf-title');
  const catEl = $('lf-cat');
  if (!appEl) return;

  // Prefer lastFocused (survives while sydtrack is foreground); never show self as last focused
  const selfish =
    now &&
    (now.ignored ||
      /sydtrack/i.test(now.app || '') ||
      (/electron/i.test(now.app || '') && /sydtrack/i.test(now.title || '')));

  const use = lf || (!selfish && now && now.app ? now : null);
  if (!use || !use.app) {
    lastFocusedCache = null;
    setAppTrunc(appEl, 'Waiting for an app…');
    if (titleEl) setAppTrunc(titleEl, '');
    if (catEl) {
      catEl.textContent = '—';
      catEl.className = 'chip other';
    }
    applyLfButtonOutlines(null);
    window.sydtrackCategoryUI?.update(null);
    window.sydtrackQuickUI?.focusChanged();
    return;
  }
  lastFocusedCache = {
    app: use.app,
    title: use.title || '',
    url: use.url || '',
    category: use.category || 'other',
    explanation: use.explanation || null,
    source: use.source,
    browser: use.browser === true || isBrowserApp(use.app)
  };
  const oKey = lfOverrideKey(lastFocusedCache);
  if (oKey && lfSessionClass[oKey]) {
    if (lfSessionClass[oKey] === lastFocusedCache.category) delete lfSessionClass[oKey];
    else { lastFocusedCache.category = lfSessionClass[oKey]; lastFocusedCache.explanation = null; }
  }
  setAppTrunc(appEl, use.app);
  if (titleEl) setAppTrunc(titleEl, use.title || '');
  if (catEl) {
    applyCategoryChip(
      catEl,
      lastFocusedCache.category,
      lastFocusedCache.app,
      use.browser === true
    );
  }
  applyLfButtonOutlines(lastFocusedCache.category);
  window.sydtrackCategoryUI?.update(lastFocusedCache);
  window.sydtrackQuickUI?.focusChanged();
}

const MOOD_COPY = {
  thriving: { label: 'Thriving: almost all productive', title: 'Productive share is 80% or higher of classified time.' },
  focused: { label: 'Focused: more productive than not', title: 'Productive share is 60% or higher of classified time.' },
  meh: { label: 'Split: productive and unproductive even', title: 'Classified time is near even, or nothing is classified yet.' },
  idle: { label: 'Quiet start', title: 'Nothing classified as productive or unproductive yet today.' },
  distracted: { label: 'Drifting: unproductive is winning', title: 'Productive share is 20% or higher but below 40%.' },
  doomscroll: { label: 'Sinking: mostly unproductive', title: 'Productive share is below 20% of classified time.' }
};

function moodDisplay(mood) {
  const id = mood && mood.id;
  if (id === 'meh' && (mood.ratio == null || !Number.isFinite(mood.ratio))) return MOOD_COPY.idle;
  return MOOD_COPY[id] || MOOD_COPY.idle;
}

function formatPageDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(date);
  } catch (_) {
    return '';
  }
}

function applyPageDate(id, value) {
  const el = $(id);
  if (!el) return;
  const text = formatPageDate(value);
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function renderMood(stats) {
  const block = $('mood-block');
  if (!block) return;
  const mood = (stats && stats.mood) || { id: 'meh', ratio: null };
  const focus = describeFocus(stats && stats.byCategory);
  const partial = focus && focus.coverage != null && focus.coverage < sydtrackGoals.MIN_CLASSIFIED_COVERAGE;
  const copy = partial
    ? { label: 'Partial picture: most time is Other', title: 'Most tracked time has no P/U classification. Other is not counted as productive or unproductive.' }
    : moodDisplay(mood);
  block.setAttribute('data-mood', partial ? 'meh' : mood.id || 'meh');
  block.title = copy.title;
  const em = $('mood-emoji');
  const lab = $('mood-label');
  if (em) em.textContent = '';
  if (lab) lab.textContent = copy.label;
}

/** Latest Home pie slice geometry + apps for hover tip. */
let pieHoverState = { total: 0, ends: [0, 0, 0], appsByCat: { productive: [], unproductive: [], other: [] } };
let liveStats = null;
const liveTotalsClock = createLiveTotalsClock();

function setLiveStats(stats, sample) {
  liveStats = stats || null;
  liveTotalsClock.ingest(
    (stats && stats.byCategory) || {},
    sample && sample.category
  );
}

function paintLivePie() {
  if (!liveStats) return;
  const byCategory = liveTotalsClock.snapshot();
  renderPie(Object.assign({}, liveStats, { byCategory }));
  if ($('streak')) {
    const liveCategory = liveTotalsClock.currentCategory();
    const stored = Number(liveStats.byCategory && liveStats.byCategory.unproductive) || 0;
    const extra = Math.max(0, byCategory.unproductive - stored);
    const streak = liveCategory === 'unproductive'
      ? (Number(liveStats.unproductiveStreak) || 0) + extra
      : liveCategory === 'productive'
        ? 0
        : Number(liveStats.unproductiveStreak) || 0;
    $('streak').textContent = fmtDuration(streak);
  }
}

function renderLiveTotals() {
  renderPauseRemaining();
  if (!liveStats) return;
  paintLivePie();
}

function appsForCategory(stats, category) {
  const apps = (stats && stats.topApps) || [];
  return apps
    .filter((a) => {
      const cat =
        a.category === 'productive' || a.category === 'unproductive' ? a.category : 'other';
      return cat === category;
    })
    .slice(0, 3);
}

function renderPie(stats) {
  const pie = $('pie-chart');
  if (!pie) return;
  const cats = (stats && stats.byCategory) || {};
  const prod = cats.productive || 0;
  const unp = cats.unproductive || 0;
  const oth = cats.other || 0;
  const total = prod + unp + oth;
  $('prod-val').textContent = fmtDuration(prod);
  $('unprod-val').textContent = fmtDuration(unp);
  $('other-val').textContent = fmtDuration(oth);
  if ($('pie-total')) $('pie-total').textContent = fmtDuration(total);

  pieHoverState = {
    total,
    ends: [
      total ? (prod / total) * 360 : 0,
      total ? ((prod + unp) / total) * 360 : 0,
      360
    ],
    appsByCat: {
      productive: appsForCategory(stats, 'productive'),
      unproductive: appsForCategory(stats, 'unproductive'),
      other: appsForCategory(stats, 'other')
    }
  };
  pie.classList.toggle('has-data', total > 0);
  pie.setAttribute('role', total > 0 ? 'button' : 'img');
  pie.tabIndex = total > 0 ? 0 : -1;
  pie.setAttribute('aria-label', total > 0
    ? 'Time breakdown: ' + fmtDuration(prod) + ' productive, ' + fmtDuration(unp) + ' unproductive, ' +
      fmtDuration(oth) + ' other. Press Enter for today’s apps.'
    : 'No time tracked yet');

  const token = (name, fallback) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  };
  const prodColor = token('--color-data-productive', '#1F6F4A');
  const unprodColor = token('--color-data-unproductive', '#A63D40');
  const otherColor = token('--color-data-other', '#6B7280');
  const emptyColor = token('--color-border', '#E2E4E8');
  if (total <= 0) {
    pie.style.background = 'conic-gradient(' + emptyColor + ' 0deg 360deg)';
    hidePieTip();
    return;
  }
  const pDeg = (prod / total) * 360;
  const uDeg = (unp / total) * 360;
  const oDeg = (oth / total) * 360;
  pie.style.background =
    'conic-gradient(' +
    prodColor + ' 0deg ' + pDeg + 'deg,' +
    unprodColor + ' ' + pDeg + 'deg ' + (pDeg + uDeg) + 'deg,' +
    otherColor + ' ' + (pDeg + uDeg) + 'deg ' + (pDeg + uDeg + oDeg) + 'deg)';
}

function hidePieTip() {
  const tip = $('pie-tip');
  if (tip) tip.classList.add('hidden');
}

function categoryFromPieAngle(deg) {
  const ends = pieHoverState.ends || [0, 0, 360];
  if (deg < ends[0]) return 'productive';
  if (deg < ends[1]) return 'unproductive';
  return 'other';
}

function showPieTip(ev) {
  const pie = $('pie-chart');
  const tip = $('pie-tip');
  const wrap = pie && pie.closest('.pie-wrap');
  if (!pie || !tip || !wrap || pieHoverState.total <= 0) {
    hidePieTip();
    return;
  }
  const rect = pie.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = ev.clientX - cx;
  const dy = ev.clientY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const inner = Math.min(rect.width, rect.height) * 0.22;
  const outer = Math.min(rect.width, rect.height) / 2;
  if (dist < inner || dist > outer) {
    hidePieTip();
    return;
  }
  // CSS conic-gradient 0deg is 12 o'clock, clockwise
  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  const cat = categoryFromPieAngle(deg);
  const apps = pieHoverState.appsByCat[cat] || [];
  const title =
    cat === 'productive' ? 'Productive' : cat === 'unproductive' ? 'Unproductive' : 'Other';
  let body;
  if (!apps.length) {
    body = '<div class="pt-empty">No apps in this slice yet</div>';
  } else {
    body =
      '<ul>' +
      apps
        .map(
          (a) =>
            '<li><span class="pt-name app-trunc" data-full="' +
            esc(a.name) +
            '">' +
            esc(a.name) +
            '</span><span class="pt-secs">' +
            fmt(a.seconds) +
            '</span></li>'
        )
        .join('') +
      '</ul>';
  }
  tip.innerHTML = '<div class="pt-cat ' + cat + '">' + title + ' · top apps</div>' + body;
  tip.classList.remove('hidden');
  const wrapRect = wrap.getBoundingClientRect();
  let left = ev.clientX - wrapRect.left + 14;
  let top = ev.clientY - wrapRect.top + 14;
  tip.style.left = '0px';
  tip.style.top = '0px';
  const tw = tip.offsetWidth || 160;
  const th = tip.offsetHeight || 80;
  if (left + tw > wrapRect.width - 4) left = ev.clientX - wrapRect.left - tw - 12;
  if (top + th > wrapRect.height - 4) top = ev.clientY - wrapRect.top - th - 8;
  tip.style.left = Math.max(4, left) + 'px';
  tip.style.top = Math.max(4, top) + 'px';
}


function renderHomeWeekBars(stats) {
  const wrap = $('week-bars');
  if (!wrap) return;
  const week = (stats && stats.week) || [];
  if (!week.length) {
    hideChartTip('week-tip');
    weekHoverDays = [];
    wrap.hidden = true;
    return;
  }
  let max = 1;
  for (const d of week) {
    const c = d.byCategory || {};
    max = Math.max(max, (c.productive || 0) + (c.unproductive || 0) + (c.other || 0));
  }
  wrap.hidden = false;
  wrap.innerHTML = week
    .map((d) => {
      const c = d.byCategory || {};
      const p = c.productive || 0;
      const u = c.unproductive || 0;
      const o = c.other || 0;
      const sum = p + u + o;
      const h = Math.max(4, Math.round((sum / max) * 48));
      const pH = sum ? Math.round((p / sum) * h) : 0;
      const uH = sum ? Math.round((u / sum) * h) : 0;
      const oH = Math.max(0, h - pH - uH);
      const label = (d.date || '').slice(5); // MM-DD
      return (
        '<div class="week-col" title="' +
        esc(d.date) +
        '">' +
        '<div class="week-stack" style="height:' +
        h +
        'px">' +
        '<div class="week-seg prod" style="height:' +
        pH +
        'px"></div>' +
        '<div class="week-seg unprod" style="height:' +
        uH +
        'px"></div>' +
        '<div class="week-seg other" style="height:' +
        oH +
        'px"></div>' +
        '</div>' +
        '<span class="week-label">' +
        esc(label) +
        '</span></div>'
      );
    })
    .join('');
}

function formatWeekDateLabel(iso) {
  const raw = String(iso || '');
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw.slice(5) || raw || '—';
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(dt.getTime())) return raw.slice(5);
  try {
    return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch (_) {
    return raw.slice(5);
  }
}

function formatAxisDuration(seconds) {
  seconds = Math.max(0, Math.floor(+seconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 1) {
    if (m <= 0) return h + 'h';
    return h + 'h ' + m + 'm';
  }
  if (m >= 1) return m + 'm';
  if (seconds <= 0) return '0';
  return seconds + 's';
}

function niceAxisMaxSeconds(maxSeconds) {
  const max = Math.max(0, Number(maxSeconds) || 0);
  if (max <= 0) return 60 * 60;
  const steps = [
    60, 120, 300, 600, 900, 1800, 2700,
    3600, 5400, 7200, 10800, 14400, 18000, 21600,
    28800, 36000, 43200, 54000, 64800, 86400
  ];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] >= max) return steps[i];
  }
  return Math.ceil(max / 3600) * 3600;
}

function renderChartYAxis(elementId, axisMaxSeconds) {
  const el = $(elementId);
  if (!el) return;
  const max = Math.max(0, Number(axisMaxSeconds) || 0) || 60 * 60;
  const mid = max / 2;
  const markup =
    '<span class="chart-y-tick">' +
    esc(formatAxisDuration(max)) +
    '</span>' +
    '<span class="chart-y-tick">' +
    esc(formatAxisDuration(mid)) +
    '</span>' +
    '<span class="chart-y-tick">' +
    esc(formatAxisDuration(0)) +
    '</span>';
  patchChartMarkup(el, markup);
}

function weekTickLabel(iso) {
  const raw = String(iso || '');
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw.slice(5) || '';
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(dt.getTime())) return raw.slice(5);
  try {
    return dt.toLocaleDateString(undefined, { weekday: 'short' });
  } catch (_) {
    return raw.slice(5);
  }
}

function renderWeek(stats) {
  renderHomeWeekBars(stats);
  const chart = $('week-chart');
  if (!chart) return;
  const week = Array.isArray(stats && stats.week) ? stats.week : [];

  if (analyticsSegment === 'week') {
    const sub = $('analytics-subtitle');
    if (sub) sub.textContent = ANALYTICS_SUBTITLES.week;
  }

  const setMetrics = (bestVal, bestSub, totalVal, totalSub, shareVal, shareSub) => {
    const bv = $('week-best-value');
    const bs = $('week-best-sub');
    const tv = $('week-total');
    const ts = $('week-total-sub');
    const sv = $('week-focus-share');
    const ss = $('week-focus-sub');
    if (bv) bv.textContent = bestVal;
    if (bs) bs.textContent = bestSub;
    if (tv) tv.textContent = totalVal;
    if (ts) ts.textContent = totalSub;
    if (sv) sv.textContent = shareVal;
    if (ss) ss.textContent = shareSub;
  };

  if (!week.length) {
    patchChartMarkup(chart, '<div class="week-empty muted">No week data yet</div>');
    renderChartYAxis('week-y-axis', 60 * 60);
    setMetrics('—', 'No productive time yet', '0 min', 'All categories · last 7 days', '—', 'Of productive + unproductive');
    return;
  }

  let max = 0;
  let total = 0;
  let prodSum = 0;
  let unpSum = 0;
  let othSum = 0;
  let bestIdx = -1;
  let bestProd = -1;
  const days = week.map((d) => {
    const c = (d && d.byCategory) || {};
    const apps = Array.isArray(d && d.topApps) ? d.topApps : [];
    return {
      date: (d && d.date) || '',
      productive: Math.max(0, Number(c.productive) || 0),
      unproductive: Math.max(0, Number(c.unproductive) || 0),
      other: Math.max(0, Number(c.other) || 0),
      topApps: apps
        .map((a) => ({
          name: a.name,
          seconds: Math.max(0, Number(a.seconds) || 0),
          category: a.category || 'other'
        }))
        .filter((a) => a.seconds > 0)
        .slice(0, 3)
    };
  });

  for (let i = 0; i < days.length; i++) {
    const h = days[i];
    const sum = h.productive + h.unproductive + h.other;
    total += sum;
    prodSum += h.productive;
    unpSum += h.unproductive;
    othSum += h.other;
    if (sum > max) max = sum;
    if (h.productive > bestProd) {
      bestProd = h.productive;
      bestIdx = i;
    }
  }
  if (max < 1) max = 1;
  const axisMax = niceAxisMaxSeconds(max);
  renderChartYAxis('week-y-axis', axisMax);

  weekHoverDays = days.map((h) => ({
    date: h.date,
    label: formatWeekDateLabel(h.date),
    productive: h.productive,
    unproductive: h.unproductive,
    other: h.other,
    topApps: Array.isArray(h.topApps) ? h.topApps.slice(0, 3) : []
  }));
  const markup = days
    .map((h, i) => {
      const sum = h.productive + h.unproductive + h.other;
      const empty = sum <= 0;
      const trackPct = empty ? 0 : Math.max(6, Math.round((sum / axisMax) * 100));
      const pPct = sum ? (h.productive / sum) * 100 : 0;
      const uPct = sum ? (h.unproductive / sum) * 100 : 0;
      const oPct = sum ? (h.other / sum) * 100 : 0;
      const tick = weekTickLabel(h.date);
      const stack = empty
        ? '<div class="day-stack empty-slot" aria-hidden="true"></div>'
        : '<div class="day-stack">' +
          '<div class="day-seg prod" style="height:' +
          pPct +
          '%"></div>' +
          '<div class="day-seg unprod" style="height:' +
          uPct +
          '%"></div>' +
          '<div class="day-seg other" style="height:' +
          oPct +
          '%"></div>' +
          '</div>';
      return (
        '<div class="day-col' +
        (empty ? ' empty' : '') +
        '" data-day="' +
        i +
        '" style="--bar-h:' +
        trackPct +
        '%">' +
        stack +
        '<span class="day-tick">' +
        esc(tick) +
        '</span></div>'
      );
    })
    .join('');
  patchChartMarkup(chart, markup, 'data-day');

  refreshChartTip('week-tip', showWeekChartTip);
  if (total <= 0) {
    setMetrics('—', 'No productive time yet', '0 min', 'All categories · last 7 days', '—', 'Of productive + unproductive');
    return;
  }

  const bestVal = bestProd > 0 ? fmtFriendly(bestProd) : '—';
  const bestSub =
    bestProd > 0 && bestIdx >= 0
      ? formatWeekDateLabel(days[bestIdx].date)
      : 'No productive time yet';
  const weekFocus = describeFocus({ productive: prodSum, unproductive: unpSum, other: othSum });
  const focusDenom = weekFocus ? weekFocus.denominator : prodSum + unpSum;
  let focusShare = '—';
  let focusSub = weekFocus && weekFocus.includeOther ? 'Of active tracked time' : 'Of productive + unproductive';
  if (focusDenom > 0) {
    focusShare = (weekFocus ? weekFocus.percent : Math.round((prodSum / focusDenom) * 100)) + '%';
    focusSub = fmtFriendly(prodSum) + ' productive · ' + fmtFriendly(unpSum) + ' unproductive' +
      (weekFocus && weekFocus.includeOther ? ' · ' + fmtFriendly(othSum) + ' other' : '');
  }
  if (weekFocus && weekFocus.trackedSec > 0) focusSub = focusBasis(weekFocus);
  setMetrics(
    bestVal,
    bestSub,
    fmtFriendly(total),
    'All categories · last 7 days',
    focusShare,
    focusSub
  );
}

function applySettingsInputs(settings) {
  settings = settings || {};
  window.sydtrackUpdatesUI?.applySettings(settings);
  latestGoalSettings = settings;
  if (typeof syncWellbeingSettings === 'function') syncWellbeingSettings(settings);
  if (applying) return;
  applying = true;
  const sec = Number(settings.thresholdSec) || 600;
  if ($('threshold-min') && document.activeElement !== $('threshold-min')) {
    $('threshold-min').value = Math.round((sec / 60) * 10) / 10;
  }
  const fbSec = focusBoostSecFromSettings(settings);
  if ($('focusboost-min') && document.activeElement !== $('focusboost-min')) {
    $('focusboost-min').value = Math.round((fbSec / 60) * 10) / 10;
  }
  if ($('idle-timeout-min') && document.activeElement !== $('idle-timeout-min')) {
    const idleSec = Number(settings.idleTimeoutSec);
    $('idle-timeout-min').value = Math.round(((Number.isFinite(idleSec) ? idleSec : 300) / 60) * 10) / 10;
  }
  if ($('track-music-idle') && document.activeElement !== $('track-music-idle')) {
    $('track-music-idle').checked = settings.trackMusicWhileIdle === true;
  }
  if ($('track-video-idle') && document.activeElement !== $('track-video-idle')) {
    $('track-video-idle').checked = settings.trackVideoWhileIdle === true;
  }
  if ($('break-reminder-toggle') && document.activeElement !== $('break-reminder-toggle')) {
    $('break-reminder-toggle').checked = settings.breakReminderEnabled === true;
  }
  if ($('break-reminder-minutes') && document.activeElement !== $('break-reminder-minutes')) {
    $('break-reminder-minutes').value = String(Number(settings.breakReminderMinutes) || 60);
  }
  if ($('break-reminder-minutes')) $('break-reminder-minutes').disabled = settings.breakReminderEnabled !== true;
  if ($('launch-startup-toggle') && document.activeElement !== $('launch-startup-toggle')) {
    $('launch-startup-toggle').checked = settings.launchAtStartup !== false;
  }
  if ($('poll-mode') && document.activeElement !== $('poll-mode')) {
    const pollMs = Number(settings.pollMs);
    $('poll-mode').value = pollMs === 1000 || pollMs === 5000 ? String(pollMs) : '3000';
  }
  if ($('profile-shortcut') && document.activeElement !== $('profile-shortcut')) {
    $('profile-shortcut').value = settings.profileShortcut || '';
  }
  if ($('window-shortcut') && document.activeElement !== $('window-shortcut')) {
    $('window-shortcut').value = settings.windowShortcut || '';
  }
  syncAppearanceUi(settings);
  if ($('reminder-message') && document.activeElement !== $('reminder-message')) {
    $('reminder-message').value = settings.reminderMessage || "You've been on {app} for a while... maybe it's time to get back?";
  }
  if ($('focusboost-message') && document.activeElement !== $('focusboost-message')) {
    $('focusboost-message').value =
      settings.focusBoostReminderMessage || "Hey! focusboost is enabled. Maybe it's time to refocus?";
  }
  syncPauseUi(settings);
  syncNotifUi(settings);
  syncFocusBoostUi(settings);
  syncFocusBoostScheduleUi(settings);
  syncSessionSettingsUi(settings);
  applyTheme(settings && settings.theme);
  applying = false;
  settingsSelectMenu?.sync();
  applyFocusBoostSchedule(settings).catch(() => {});
}

const THEME_IDS = ['midnight', 'tide', 'plum', 'forest', 'dusk', 'linen', 'graphite', 'coral', 'starlight'];

function applyTheme(theme) {
  const id = THEME_IDS.indexOf(theme) >= 0 ? theme : 'midnight';
  document.documentElement.setAttribute('data-theme', id);
  document.querySelectorAll('[data-theme-id]').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.getAttribute('data-theme-id') === id ? 'true' : 'false');
  });
}

function syncNotifUi(settings) {
  const btn = $('notif-btn');
  if (!btn) return;
  const on = settings && settings.notificationsEnabled !== false;
  if ($('settings-notifications-toggle') && document.activeElement !== $('settings-notifications-toggle')) {
    $('settings-notifications-toggle').checked = on;
  }
  btn.setAttribute('data-muted', on ? 'off' : 'on');
  btn.setAttribute('aria-pressed', on ? 'false' : 'true');
  btn.title = on ? 'Alerts on' : 'Muted';
  const lab = btn.querySelector('.notif-label');
  if (lab) lab.textContent = on ? 'Alerts on' : 'Muted';
}

function syncPauseUi(settings) {
  const paused = !!(settings && settings.trackingPaused);
  const pauseUntil = paused ? Number(settings.trackingPauseUntil) || 0 : 0;
  const untilLabel = pauseUntil > 0 ? new Date(pauseUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const applyPauseBtn = (btn) => {
    if (!btn) return;
    btn.setAttribute('data-paused', paused ? 'on' : 'off');
    btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    btn.title = paused ? 'Resume tracking' : 'Pause tracking';
    btn.setAttribute('aria-label', paused ? 'Resume tracking' : 'Pause tracking');
  };
  applyPauseBtn($('pause-btn'));
  if (pauseUiSettings && (pauseUiSettings.trackingPaused !== paused || pauseUiSettings.trackingPauseUntil !== pauseUntil)) pauseActionError = '';
  pauseUiSettings = { trackingPaused: paused, trackingPauseUntil: pauseUntil, onboardingComplete: !settings || settings.onboardingComplete !== false };
  const control = $('pause-settings-btn');
  if (control) {
    control.dataset.paused = paused ? 'on' : 'off';
    $('pause-settings-label').textContent = paused ? 'Resume tracking' : 'Pause for…';
    $('pause-settings-caret').classList.toggle('hidden', paused);
    if (paused || !pauseUiSettings.onboardingComplete) closePauseMenu();
    if (paused) { control.removeAttribute('aria-haspopup'); control.removeAttribute('aria-expanded'); }
    else {
      control.setAttribute('aria-haspopup', 'menu');
      control.setAttribute('aria-expanded', String(!$('pause-settings-menu').classList.contains('hidden')));
    }
    control.disabled = pauseActionBusy || !pauseUiSettings.onboardingComplete;
  }
  if ($('pause-btn')) $('pause-btn').disabled = pauseActionBusy || !pauseUiSettings.onboardingComplete;
  const pauseStatus = $('pause-until-status');
  if (pauseStatus) {
    pauseStatus.textContent = pauseActionError || (untilLabel ? 'Resumes at ' + untilLabel : '');
    pauseStatus.classList.toggle('hidden', !pauseActionError && !untilLabel);
  }
  document.body.setAttribute('data-paused', paused ? 'on' : 'off');
  renderPauseRemaining();
}

function syncAppearanceUi(settings = latestGoalSettings || {}) {
  const enabled = settings.themeRotationEnabled === true;
  if ($('theme-rotation-toggle')) $('theme-rotation-toggle').checked = enabled;
  $('theme-rotation-options')?.classList.toggle('hidden', !enabled);
  if ($('theme-rotation-mode')) {
    $('theme-rotation-mode').value = ['dark', 'light', 'any'].includes(settings.themeRotationMode) ? settings.themeRotationMode : 'dark';
    $('theme-rotation-mode').disabled = appearanceSaving || !enabled;
  }
  if ($('theme-rotation-toggle')) $('theme-rotation-toggle').disabled = appearanceSaving;
  document.querySelectorAll('[data-theme-id]').forEach(btn => { btn.disabled = appearanceSaving; });
}

async function saveAppearance(partial) {
  if (appearanceSaving) throw new Error('An appearance change is already being saved');
  appearanceSaving = true;
  // Busy state only: do not confirm the select's optimistic value before saving.
  $('theme-rotation-toggle').disabled = true;
  document.querySelectorAll('[data-theme-id]').forEach(btn => { btn.disabled = true; });
  $('theme-rotation-mode').disabled = true;
  settingsSelectMenu?.refresh();
  const status = $('appearance-status');
  status.textContent = '';
  status.classList.add('hidden');
  try {
    if (!api) throw new Error('Settings are unavailable');
    return await pushSettings(partial);
  } catch (err) {
    applyTheme(latestGoalSettings?.theme);
    if (!Object.hasOwn(partial, 'themeRotationMode') || !settingsSelectMenu) {
      status.textContent = 'Could not save appearance. Try again.';
      status.classList.remove('hidden');
    }
    throw err;
  } finally {
    appearanceSaving = false;
    syncAppearanceUi();
    settingsSelectMenu?.sync();
  }
}

function renderPauseRemaining() {
  const pill = $('source-pill');
  if (!pill || !pauseUiSettings) return;
  if (pauseUiSettings.trackingPaused) {
    const until = pauseUiSettings.trackingPauseUntil;
    const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    const label = until > 0 ? 'Paused · ' + fmtCountdown(remaining) : 'Paused';
    if (pill.textContent !== label) pill.textContent = label;
    pill.title = until > 0 ? label + ' · resumes automatically' : label;
    pill.className = 'status-pill paused';
  } else if (pill.classList.contains('paused')) {
    pill.textContent = 'Waiting';
    pill.title = 'Waiting for the next tracking update';
    pill.className = 'status-pill idle';
  }
}

function syncFocusBoostUi(settings) {
  const btn = $('focusboost-btn');
  const shell = document.body;
  if (!btn) return;
  const boostSec = focusBoostSecFromSettings(settings);
  const armed =
    !!settings.focusBoost ||
    (Number(settings.thresholdSec) === boostSec && settings._boostArmed);
  const on = !!settings.focusBoost;
  btn.setAttribute('data-boost', on ? 'on' : 'off');
  btn.classList.toggle('armed', on);
  shell.setAttribute('data-boost', on ? 'on' : 'off');
  const label = $('focusboost-label');
  if (label && !label.querySelector('.fb-focus')) {
    label.innerHTML = '<span class="fb-focus">focus</span><span class="fb-boost">boost</span>';
  }
  const waitLabel = boostSec < 60 ? boostSec + 's' : Math.round((boostSec / 60) * 10) / 10 + ' min';
  const sched = !!(settings && settings.focusBoostScheduleEnabled);
  btn.title = on
    ? 'focusboost on · ~' + waitLabel + ' reminder' + (sched ? ' · scheduled' : '')
    : 'focusboost · ~' + waitLabel + ' reminder' + (sched ? ' · scheduled' : '');
  if ($('thresh-label')) $('thresh-label').textContent = fmt(settings.thresholdSec || 600);
}


function syncFocusBoostScheduleUi(settings) {
  const enabled = !!(settings && settings.focusBoostScheduleEnabled);
  const toggle = $('fb-schedule-toggle');
  const start = $('fb-schedule-start');
  const end = $('fb-schedule-end');
  const times = $('fb-schedule-times');
  if (toggle && document.activeElement !== toggle) toggle.checked = enabled;
  if (start && document.activeElement !== start) {
    start.value = settings.focusBoostScheduleStart || '09:00';
  }
  if (end && document.activeElement !== end) {
    end.value = settings.focusBoostScheduleEnd || '17:00';
  }
  if (times) times.classList.toggle('is-disabled', !enabled);
  if (start) start.disabled = !enabled;
  if (end) end.disabled = !enabled;
  window.sydtrackScheduleTimeUI?.sync();
}

function playBoostKick() {
  if (reduceMotion) return;
  let kick = $('boost-kick');
  if (!kick) {
    kick = document.createElement('div');
    kick.id = 'boost-kick';
    kick.className = 'boost-kick';
    kick.setAttribute('aria-hidden', 'true');
    document.body.appendChild(kick);
  }
  kick.classList.remove('play');
  void kick.offsetWidth;
  kick.classList.add('play');
  window.setTimeout(() => kick.classList.remove('play'), 520);
}

/** Physical button feedback: hard hit on arm, soft settle on disarm. */
function playFocusBoostFeel(arming) {
  if (reduceMotion) return;
  const btn = $('focusboost-btn');
  if (btn) {
    btn.classList.remove('fb-hit', 'fb-settle');
    void btn.offsetWidth;
    btn.classList.add(arming ? 'fb-hit' : 'fb-settle');
    window.setTimeout(
      () => btn.classList.remove('fb-hit', 'fb-settle'),
      arming ? 480 : 320
    );
  }
  if (arming) {
    // Overlay "FOCUS BOOST" flash removed — keep kick + button punch only.
    playBoostKick();
  }
}


function hourLabel(h) {
  const end = (h + 1) % 24;
  const pad = (n) => String(n).padStart(2, '0');
  return pad(h) + ':00–' + pad(end) + ':00';
}

function topAppsFromByApp(byApp, limit) {
  const lim = limit || 3;
  if (!byApp || typeof byApp !== 'object') return [];
  const merged = new Map();
  Object.entries(byApp)
    .map(([key, info]) => ({
      name: appEntryNameFromKey(key),
      seconds: Math.max(0, Number(info && info.seconds) || 0),
      category: (info && info.category) || 'other'
    }))
    .filter((e) => e.seconds > 0 && e.category !== 'ignored')
    .forEach((entry) => {
      const key = entry.name + '\u0000' + entry.category;
      const current = merged.get(key);
      if (current) current.seconds += entry.seconds;
      else merged.set(key, entry);
    });
  return Array.from(merged.values())
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, lim);
}

function appEntryNameFromKey(key) {
  try { if (String(key).startsWith('@activity:')) return JSON.parse(key.slice(10))[0]; } catch (_) {}
  const text = String(key);
  const marker = text.lastIndexOf('::');
  if (marker < 0) return text;
  const suffix = text.slice(marker + 2);
  return suffix === 'productive' || suffix === 'unproductive'
    ? text.slice(0, marker)
    : text;
}

function normalizeByHour(raw) {
  const zeros = () => ({ productive: 0, unproductive: 0, other: 0, topApps: [] });
  if (!Array.isArray(raw) || raw.length !== 24) {
    return Array.from({ length: 24 }, zeros);
  }
  return raw.map((h) => {
    const o = h && typeof h === 'object' ? h : {};
    return {
      productive: Math.max(0, Number(o.productive) || 0),
      unproductive: Math.max(0, Number(o.unproductive) || 0),
      other: Math.max(0, Number(o.other) || 0),
      topApps: topAppsFromByApp(o.byApp, 3)
    };
  });
}

let dayHoverHours = [];
let weekHoverDays = [];
const chartHoverPointers = Object.create(null);

function hideChartTip(id) {
  delete chartHoverPointers[id];
  const tip = $(id);
  if (tip) tip.classList.add('hidden');
}

function refreshChartTip(id, show) {
  const pointer = chartHoverPointers[id];
  if (!pointer) return;
  // Bars are replaced on every tick; resolve the new element under the same pointer.
  const target = document.elementFromPoint(pointer.clientX, pointer.clientY);
  if (!target) { hideChartTip(id); return; }
  show({ ...pointer, target });
}

function placeChartTip(tip, wrap, clientX, clientY) {
  if (!tip || !wrap) return;
  tip.classList.remove('hidden');
  const wrapRect = wrap.getBoundingClientRect();
  let left = clientX - wrapRect.left + 14;
  let top = clientY - wrapRect.top + 14;
  tip.style.left = '0px';
  tip.style.top = '0px';
  const tw = tip.offsetWidth || 180;
  const th = tip.offsetHeight || 90;
  if (left + tw > wrapRect.width - 4) left = clientX - wrapRect.left - tw - 12;
  if (top + th > wrapRect.height - 4) top = clientY - wrapRect.top - th - 8;
  tip.style.left = Math.max(4, left) + 'px';
  tip.style.top = Math.max(4, top) + 'px';
}

function tipAppsHtml(apps) {
  if (!apps || !apps.length) {
    return '<div class="pt-empty">No apps logged in this slice yet</div>';
  }
  return (
    '<ul>' +
    apps
      .map(
        (a) =>
          '<li><span class="pt-name app-trunc" data-full="' +
            esc(a.name) +
            '">' +
            esc(a.name) +
            '</span><span class="pt-secs">' +
          fmt(a.seconds) +
          '</span></li>'
      )
      .join('') +
    '</ul>'
  );
}

function showDayChartTip(ev) {
  const chart = $('day-chart');
  const tip = $('day-tip');
  const wrap = chart && chart.closest('.chart-tip-wrap');
  const col = ev.target.closest && ev.target.closest('.day-col');
  if (!chart || !tip || !wrap || !col || !chart.contains(col) || col.classList.contains('empty')) {
    hideChartTip('day-tip');
    return;
  }
  chartHoverPointers['day-tip'] = { clientX: ev.clientX, clientY: ev.clientY };
  const idx = Number(col.getAttribute('data-hour'));
  const h = dayHoverHours[idx];
  if (!h) {
    hideChartTip('day-tip');
    return;
  }
  const sum = h.productive + h.unproductive + h.other;
  const head =
    hourLabel(idx) +
    ' · ' +
    fmtFriendly(sum) +
    ' tracked';
  const meta =
    '<div class="pt-empty" style="margin-bottom:6px">P ' +
    fmt(h.productive) +
    ' · U ' +
    fmt(h.unproductive) +
    ' · O ' +
    fmt(h.other) +
    '</div>';
  tip.innerHTML =
    '<div class="pt-cat">Hour · top apps</div>' + meta + tipAppsHtml(h.topApps);
  placeChartTip(tip, wrap, ev.clientX, ev.clientY);
}

function showWeekChartTip(ev) {
  const chart = $('week-chart');
  const tip = $('week-tip');
  const wrap = chart && chart.closest('.chart-tip-wrap');
  const col = ev.target.closest && ev.target.closest('.day-col');
  if (!chart || !tip || !wrap || !col || !chart.contains(col) || col.classList.contains('empty')) {
    hideChartTip('week-tip');
    return;
  }
  chartHoverPointers['week-tip'] = { clientX: ev.clientX, clientY: ev.clientY };
  const idx = Number(col.getAttribute('data-day'));
  const d = weekHoverDays[idx];
  if (!d) {
    hideChartTip('week-tip');
    return;
  }
  const sum = d.productive + d.unproductive + d.other;
  const head = (d.label || d.date || 'Day') + ' · ' + fmtFriendly(sum) + ' tracked';
  const meta =
    '<div class="pt-empty" style="margin-bottom:6px">P ' +
    fmt(d.productive) +
    ' · U ' +
    fmt(d.unproductive) +
    ' · O ' +
    fmt(d.other) +
    '</div>';
  tip.innerHTML =
    '<div class="pt-cat">' +
    esc(head) +
    '</div>' +
    meta +
    tipAppsHtml(d.topApps);
  placeChartTip(tip, wrap, ev.clientX, ev.clientY);
}

function renderDay(stats) {
  const chart = $('day-chart');
  if (!chart) return;
  const hours = normalizeByHour(stats && stats.byHour);
  let max = 0;
  let total = 0;
  let peakHour = -1;
  let peakProd = -1;
  for (let i = 0; i < 24; i++) {
    const h = hours[i];
    const sum = h.productive + h.unproductive + h.other;
    total += sum;
    if (sum > max) max = sum;
    if (h.productive > peakProd) {
      peakProd = h.productive;
      peakHour = i;
    }
  }
  if (max < 1) max = 1;
  const axisMax = niceAxisMaxSeconds(max);
  renderChartYAxis('day-y-axis', axisMax);

  if (analyticsSegment === 'day') {
    const sub = $('analytics-subtitle');
    if (sub) {
      sub.textContent =
        stats && stats.date ? (stats.date === liveDayDate ? 'Today’s activity · ' : 'Activity · ') + stats.date : ANALYTICS_SUBTITLES.day;
    }
  }

  dayHoverHours = hours;
  const markup = hours
    .map((h, i) => {
      const sum = h.productive + h.unproductive + h.other;
      const empty = sum <= 0;
      const trackPct = empty ? 0 : Math.max(6, Math.round((sum / axisMax) * 100));
      const pPct = sum ? (h.productive / sum) * 100 : 0;
      const uPct = sum ? (h.unproductive / sum) * 100 : 0;
      const oPct = sum ? (h.other / sum) * 100 : 0;
      const tick = i % 3 === 0 ? String(i) : '';
      const stack = empty
        ? '<div class="day-stack empty-slot" aria-hidden="true"></div>'
        : '<div class="day-stack">' +
          '<div class="day-seg prod" style="height:' +
          pPct +
          '%"></div>' +
          '<div class="day-seg unprod" style="height:' +
          uPct +
          '%"></div>' +
          '<div class="day-seg other" style="height:' +
          oPct +
          '%"></div>' +
          '</div>';
      return (
        '<div class="day-col' +
        (empty ? ' empty' : '') +
        '" data-hour="' +
        i +
        '" style="--bar-h:' +
        trackPct +
        '%">' +
        stack +
        '<span class="day-tick">' +
        tick +
        '</span></div>'
      );
    })
    .join('');
  patchChartMarkup(chart, markup, 'data-hour');

  refreshChartTip('day-tip', showDayChartTip);
  const peakVal = $('day-peak-value');
  const peakSub = $('day-peak-sub');
  if (peakVal) {
    peakVal.textContent = peakProd > 0 ? fmtFriendly(peakProd) : '—';
  }
  if (peakSub) {
    peakSub.textContent = peakProd > 0 ? hourLabel(peakHour) : 'No productive time yet';
  }
  const coarse = stats && stats.byCategory || {};
  const coarseTotal = (Number(coarse.productive) || 0) + (Number(coarse.unproductive) || 0) + (Number(coarse.other) || 0);
  if (total === 0 && coarseTotal > 0) total = coarseTotal;
  const totalEl = $('day-total');
  if (totalEl) totalEl.textContent = fmtFriendly(total);
  const totalSub = $('day-total-sub');
  if (totalSub) totalSub.textContent = 'All categories on this day';

  let focusShare = '—';
  let focusSub = 'Of productive + unproductive';
  let prodSum = 0;
  let unpSum = 0;
  let othSum = 0;
  for (let i = 0; i < 24; i++) {
    prodSum += hours[i].productive;
    unpSum += hours[i].unproductive;
    othSum += hours[i].other;
  }
  if (prodSum + unpSum + othSum === 0 && coarseTotal > 0) {
    prodSum = Number(coarse.productive) || 0;
    unpSum = Number(coarse.unproductive) || 0;
    othSum = Number(coarse.other) || 0;
  }
  const dayFocus = describeFocus({ productive: prodSum, unproductive: unpSum, other: othSum });
  const focusDenom = dayFocus ? dayFocus.denominator : prodSum + unpSum;
  if (dayFocus && dayFocus.includeOther) focusSub = 'Of active tracked time';
  if (focusDenom > 0) {
    focusShare = (dayFocus ? dayFocus.percent : Math.round((prodSum / focusDenom) * 100)) + '%';
    focusSub = fmtFriendly(prodSum) + ' productive · ' + fmtFriendly(unpSum) + ' unproductive' +
      (dayFocus && dayFocus.includeOther ? ' · ' + fmtFriendly(othSum) + ' other' : '');
  }
  if (dayFocus && dayFocus.trackedSec > 0) focusSub = focusBasis(dayFocus);
  const shareEl = $('day-focus-share');
  if (shareEl) shareEl.textContent = focusShare;
  const shareSub = $('day-focus-sub');
  if (shareSub) shareSub.textContent = focusSub;
}


function formatRoundupDate(dateKey) {
  if (!dateKey) return formatPageDate(new Date());
  const parts = String(dateKey).split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return '';
  return formatPageDate(new Date(parts[0], parts[1] - 1, parts[2]));
}

function roundupHeadlines(moodId, hit, thin, limited) {
  if (limited) return { headline: 'Partial picture', sub: 'Most tracked time is Other.' };
  if (thin) {
    return {
      headline: 'Today so far',
      sub: 'Not enough activity yet.'
    };
  }
  return hit
    ? { headline: 'Goal reached', sub: 'Your focus share is on target.' }
    : { headline: 'Below goal', sub: 'Your focus share is under today’s target.' };
}

function renderRoundup(stats) {
  if (!$('view-roundup')) return;
  const cats = (stats && stats.byCategory) || {};
  const prod = Math.max(0, Number(cats.productive) || 0);
  const unp = Math.max(0, Number(cats.unproductive) || 0);
  const oth = Math.max(0, Number(cats.other) || 0);
  const total = prod + unp + oth;
  const thin = total < 60;
  const mood = (stats && stats.mood) || { id: 'meh', emoji: '😐', label: 'Meh' };
  const settings = (stats && stats.settings) || {};
  if (settings && Object.keys(settings).length) latestGoalSettings = Object.assign({}, latestGoalSettings, settings);
  const focus = describeFocus(cats);
  const hit = !!(focus && focus.hit);
  const goalPct = focus ? focus.goalPct : 80;

  applyPageDate('roundup-date', (() => {
    const key = stats && stats.date;
    if (!key) return new Date();
    const parts = String(key).split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  })());

  const hero = $('roundup-hero');
  if (hero) hero.setAttribute('data-mood', focus && focus.limited ? 'meh' : mood.id || 'meh');
  if ($('roundup-emoji')) $('roundup-emoji').textContent = focus && focus.limited ? '😐' : mood.emoji || '😐';
  const copy = roundupHeadlines(mood.id || 'meh', hit, thin || !!(focus && focus.thin), focus && focus.limited);
  if ($('roundup-headline')) $('roundup-headline').textContent = copy.headline;
  if ($('roundup-sub')) $('roundup-sub').textContent = copy.sub;

  const goalCard = $('roundup-goal-card');
  const focusPct = focus && focus.percent != null ? focus.percent : null;
  const actualPct = focusPct == null ? 0 : Math.min(100, Math.max(0, focusPct));
  if (goalCard) goalCard.setAttribute('data-hit', !focus || focus.thin || focus.limited ? 'na' : hit ? 'yes' : 'no');
  if ($('roundup-goal-basis')) $('roundup-goal-basis').textContent = focusBasis(focus);
  const goalKicker = goalCard && goalCard.querySelector('.lf-kicker');
  if (goalKicker) goalKicker.textContent = 'Daily focus share';
  if ($('roundup-goal-value')) {
    $('roundup-goal-value').textContent = focusPct == null ? '—' : focusPct + '%';
  }
  if ($('roundup-goal-pct')) {
    $('roundup-goal-pct').textContent = 'Goal ' + goalPct + '%';
  }
  if (goalCard) {
    goalCard.setAttribute(
      'data-full',
      focus && focus.includeOther
        ? 'Productive time as a share of all active tracked time, versus your goal. Other is included.'
        : 'Productive time as a share of productive + unproductive, versus your goal. Other is excluded. Goals are not scored when most tracked time is Other.'
    );
  }
  const fill = $('roundup-goal-fill');
  const bar = $('roundup-goal-bar');
  const mark = $('roundup-goal-mark');
  if (fill) fill.style.width = actualPct + '%';
  if (bar) {
    bar.setAttribute('aria-valuenow', String(actualPct));
    bar.setAttribute('aria-valuetext', (focusPct == null ? 'No focus share yet' : focusPct + '%') + ', ' + goalPct + '% goal. ' +
      focusBasis(focus) + (focus && focus.limited ? '. Partial picture; goal not scored.' : ''));
  }
  if (mark) {
    const showMark = focusPct != null && goalPct > 0 && goalPct < 100;
    mark.hidden = !showMark;
    mark.style.left = Math.min(100, Math.max(0, goalPct)) + '%';
  }
  const apps = (stats && stats.topApps) || [];
  const topP = apps.find((a) => a.category === 'productive');
  const topU = apps.find((a) => a.category === 'unproductive');
  const browserMatch = app => app && isBrowserApp(app.name) && app.topMatch && app.topMatch.reason
    ? app.topMatch : null;
  const focusMatch = browserMatch(topP);
  const distractionMatch = browserMatch(topU);
  setAppTrunc($('ru-top-focus'), topP ? topP.name : '—', 'App');
  setAppTrunc(
    $('ru-top-focus-sub'),
    topP ? fmtFriendly(topP.seconds) + ' productive' + (focusMatch ? ' · “' + focusMatch.reason + '” ' + fmtFriendly(focusMatch.seconds) : '') : 'No productive apps yet',
    'Detail'
  );
  setAppTrunc($('ru-distract'), topU ? topU.name : '—', 'App');
  setAppTrunc(
    $('ru-distract-sub'),
    topU ? fmtFriendly(topU.seconds) + ' unproductive' + (distractionMatch ? ' · “' + distractionMatch.reason + '” ' + fmtFriendly(distractionMatch.seconds) : '') : 'No unproductive apps yet',
    'Detail'
  );
  const hours = normalizeByHour(stats && stats.byHour);
  let peakHour = -1;
  let peakProd = -1;
  for (let i = 0; i < 24; i++) {
    if (hours[i].productive > peakProd) {
      peakProd = hours[i].productive;
      peakHour = i;
    }
  }
  setAppTrunc($('ru-peak'), peakProd > 0 ? hourLabel(peakHour) : '—', 'Peak hour');
  setAppTrunc(
    $('ru-peak-sub'),
    peakProd > 0 ? fmtFriendly(peakProd) + ' productive' : 'Most productive hour',
    'Detail'
  );

  const story = $('roundup-story');
  if (story) {
    if (thin) {
      story.textContent = 'Your daily summary will appear once there’s enough activity.';
      story.classList.add('muted');
    } else {
      const lines = [];
      if (topP) {
        lines.push(
          '<span class="story-app story-app-prod app-trunc" data-full="' +
            esc(topP.name) +
            '">' +
            esc(topP.name) +
            '</span> led productive time.' +
            (focusMatch ? ' “' + esc(focusMatch.reason) + '” accounted for ' + esc(fmtFriendly(focusMatch.seconds)) + '.' : '')
        );
      }
      if (topU) {
        lines.push(
          '<span class="story-app story-app-unprod app-trunc" data-full="' +
            esc(topU.name) +
            '">' +
            esc(topU.name) +
            '</span> led unproductive time.' +
            (distractionMatch ? ' “' + esc(distractionMatch.reason) + '” accounted for ' + esc(fmtFriendly(distractionMatch.seconds)) + '.' : '')
        );
      }
      if (!lines.length) {
        story.textContent = 'No app highlights yet.';
        story.classList.add('muted');
      } else {
        story.innerHTML = lines.map((l) => '<p class="story-line">' + l + '</p>').join('');
        story.classList.remove('muted');
      }
    }
  }
  if (typeof renderWellbeing === 'function') renderWellbeing(stats);
}

function renderStats(stats) {
  if (!stats) return;
  const dayChanged = liveDayDate && stats.date && liveDayDate !== stats.date;
  if (dayChanged) invalidateHistoryViews();
  if (stats.settings) latestGoalSettings = Object.assign({}, latestGoalSettings, stats.settings);
  renderMood(stats);
  if (stats.week) renderWeek(stats);
  else if (historicalWeek) {
    historicalWeek = historicalWeek.map(day => day.date === stats.date ? { ...day, byCategory: stats.byCategory, topApps: stats.topApps } : day);
    renderWeek({ week: historicalWeek });
  }
  liveDayDate = stats.date;
  if ($('timeline-date') && stats.date) {
    $('timeline-date').max = stats.date;
    if (timelineFollowsToday && $('timeline-date').value !== stats.date) $('timeline-date').value = stats.date;
  }
  if ($('timeline-date') && $('timeline-date').value === stats.date) {
    renderDay(stats);
    if (analyticsSegment === 'day' && Date.now() - timelineLastRefresh > 15000) loadTimelineDay();
  }
  renderRoundup(stats);
  // Overlay today's confirmed totals on cached score grids without refetching
  // history or replacing the focused/hovered day button.
  if (!dayChanged && !$('view-analytics').classList.contains('hidden')) {
    if (analyticsSegment === 'month' && fullHistoryCache) renderMonthFocusScores(fullHistoryCache.slice(-30));
    else if (analyticsSegment === 'week' && historicalWeek) renderScoreList($('week-focus-score-list'), historicalWeek, 7);
  }
  applyPageDate('home-date', new Date());
  $('streak').textContent = fmtDuration(stats.unproductiveStreak || 0);
  if (stats.settings) {
    $('thresh-label').textContent = fmt(stats.settings.thresholdSec || 600);
    applySettingsInputs(stats.settings);
    if (stats.dataDir && $('data-path')) $('data-path').textContent = stats.dataDir;
  }
  renderAppList(stats);
  if (dayChanged && ['week', 'month'].includes(analyticsSegment)) loadAnalyticsHistory();
}

let lastAppsStats = null;
let appCorrectionBusy = false;
let appsRange = 'day';
let appsHistoryDays = [];
let appsHistoryRange = null;
let appsHistoryDate = null;
let appsHistoryRequest = 0;
const appDuration = seconds => seconds < 60 ? Math.round(seconds) + 's' : fmtDuration(seconds);
const appsPeriodLabel = () => appsRange === 'day' ? 'Today' : appsRange === 'week' ? 'Last 7 days' : 'Last 30 days';

function renderAppsOverview(entries) {
  const { total, slices, appCount } = window.sydtrackAppsAnalytics.buildAppSlices(entries, 6);
  const donut = $('apps-donut');
  const legend = $('apps-legend');
  $('apps-total').textContent = appDuration(total);
  donut.style.backgroundImage = total ? 'conic-gradient(' + window.sydtrackAppsAnalytics.conicStops(slices, total) + ')' : 'none';
  donut.setAttribute('aria-label', total ? 'App time, ' + appsPeriodLabel().toLowerCase() + ': ' + slices.map(slice => slice.name + ', ' + appDuration(slice.seconds)).join('; ') : 'No app time tracked yet');
  legend.innerHTML = total ? slices.map((slice, index) => {
    const percent = Math.round(slice.seconds / total * 100);
    const mixed = slice.byCategory && Object.values(slice.byCategory).filter(seconds => seconds > 0).length > 1;
    return '<li>' +
      '<span class="apps-swatch" style="--slice-color:var(--apps-slice-' + Math.min(index + 1, 7) + ')" aria-hidden="true"></span>' +
      '<span class="apps-legend-name" title="' + esc(slice.name) + '">' + esc(slice.name) + (mixed ? ' <small>mixed</small>' : '') + '</span>' +
      '<span class="apps-legend-percent">' + percent + '%</span>' +
      '<span class="apps-legend-time">' + appDuration(slice.seconds) + '</span></li>';
  }).join('') : '<li class="empty">No apps tracked yet</li>';
  $('apps-overview-title').textContent = appCount ? 'Where your time went' : 'App time';
  $('apps-overview-note').classList.toggle('hidden', !appCount);
  $('apps-period-label').textContent = appsPeriodLabel() + ' · active app time';
}

function appReason(reason, app) {
  if (isBrowserApp(app) && window.sydtrackBrowserRules.isUnrecognizedReason(reason)) return 'Unrecognized pages';
  if (!reason || reason === 'Keyword not recorded') return 'Reason unavailable';
  if (reason === 'No matching rule' || reason === 'No matching keyword') return 'Default ruleset';
  if (reason === 'App identity') return 'App rule';
  if (/^r\/[a-z0-9_]{1,21}$/i.test(reason)) return reason;
  return 'Matched “' + reason + '”';
}

function appGroupSummary(group, showTotal = true) {
  const categories = [['productive', 'P', 'productive'], ['unproductive', 'U', 'unproductive'], ['other', 'O', 'other'], ['ignored', 'I', 'ignored']];
  const mix = categories.filter(([key]) => group.byCategory[key] > 0)
    .map(([key, letter, label]) => '<span aria-label="' + appDuration(group.byCategory[key]) + ' ' + label + '"><b aria-hidden="true">' + letter + '</b> ' +
      '<strong aria-hidden="true" class="app-group-duration ' + key + '">' + appDuration(group.byCategory[key]) + '</strong></span>').join(' · ');
  return '<div class="app-group-head"><strong>' + esc(group.name) + '</strong>' +
    (showTotal ? '<span>' + appDuration(group.seconds) + '</span>' : '') + '</div>' +
    '<p class="app-group-mix">' + mix + '</p>';
}

function renderAppsPeriod() {
  const entries = window.sydtrackAppsAnalytics.periodEntries(appsHistoryDays, lastAppsStats);
  const model = window.sydtrackAppsAnalytics.buildAppSlices(entries, 6);
  renderAppsOverview(entries);
  document.querySelector('.apps-detail-card').classList.toggle('hidden', !model.apps.length);
  $('apps-detail-title').textContent = 'Top apps';
  $('apps-detail-description').textContent = '';
  $('apps-detail-note').classList.add('hidden');
  $('apps-correction-status').textContent = '';
  $('app-list').innerHTML = model.apps.length ? model.apps.slice(0, 10).map(app =>
    '<li class="app-group">' + appGroupSummary(app) + '</li>').join('') :
    '<li class="empty">No app time in this period</li>';
}

function renderAppList(stats) {
  lastAppsStats = stats;
  if (appsRange !== 'day') {
    if (appsHistoryRange === appsRange) renderAppsPeriod();
    return;
  }
  renderAppsOverview(stats && stats.appBreakdown);
  $('apps-detail-title').textContent = 'Activity details';
  $('apps-detail-description').textContent = '';
  $('apps-detail-note').classList.add('hidden');
  const list = $('app-list');
  const openGroups = new Set([...list.querySelectorAll('.app-group-details[open]')]
    .map(details => details.closest('.app-group').dataset.groupName));
  const rows = (stats && (stats.activityRows || stats.topApps)) || [];
  document.querySelector('.apps-detail-card').classList.toggle('hidden', !rows.length);
  if (!rows.length) {
    list.innerHTML = '<li class="empty">No time logged yet</li>';
    return;
  }
  const groups = new Map();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: row.name, rows: [], seconds: 0, byCategory: { productive: 0, unproductive: 0, other: 0, ignored: 0 } });
    const group = groups.get(key);
    group.rows.push(row);
    group.byCategory[row.category] = (group.byCategory[row.category] || 0) + row.seconds;
    if (row.category !== 'ignored') group.seconds += row.seconds;
  }
  list.innerHTML = [...groups.values()].map(group => {
    const categories = [['productive', 'P', 'Productive'], ['unproductive', 'U', 'Unproductive'], ['other', 'O', 'Other'], ['ignored', 'I', 'Ignore']];
    const activeTypes = categories.filter(([value]) => group.rows.some(row => row.category === value));
    const groupKey = encodeURIComponent(group.name);
    const open = openGroups.has(groupKey);
    return '<li class="app-group" data-group-name="' + encodeURIComponent(group.name) + '">' +
      '<details class="app-group-details"' + (open ? ' open' : '') + '><summary>' + appGroupSummary(group, false) + '</summary>' +
      '<div class="app-group-activities"><p class="app-group-hint">Changes apply today only.</p>' +
      activeTypes.map(([value]) => {
        const typeRows = group.rows.filter(row => row.category === value).sort((a, b) => b.seconds - a.seconds);
        return '<div class="app-activity-type" role="group" aria-label="' + value + ' activity">' +
          typeRows.map(row => {
            const unrecognized = isBrowserApp(row.name) && window.sydtrackBrowserRules.isUnrecognizedReason(row.reason);
            const explanation = unrecognized ? 'These pages have no shared rule. Add a specific title keyword in Focus Tags.' : '';
            return '<div class="app-activity" data-unrecognized="' + unrecognized + '" data-row-id="' + encodeURIComponent(row.id || '') + '">' +
            '<div class="app-activity-row"><span class="app-activity-reason" title="' + explanation + '">' + esc(appReason(row.reason, row.name)) + '</span>' +
            '<span class="app-activity-time">' + appDuration(row.seconds) + '</span>' +
            (row.id ? '<span class="app-activity-actions" role="group" tabindex="' + (unrecognized ? '0' : '-1') + '" aria-label="' + esc(group.name) + ', ' + esc(appReason(row.reason, row.name)) + ': ' + esc(row.category) + ' today. ' + explanation + '">' +
              categories.map(([category, letter, name]) => '<button type="button" class="app-activity-category" data-app-command="choose" data-category="' + category + '" aria-label="' + name + '" aria-pressed="' + (row.category === category) + '" title="' + (unrecognized ? explanation : name + (row.category === category ? ' (current)' : ' for today')) + '"' + (row.category === category || (unrecognized && category !== 'other') ? ' disabled' : '') + '>' + letter + '</button>').join('') + '</span>' : '') + '</div></div>';
          }).join('') + '</div>';
      }).join('') + '</div></details></li>';
  }).join('');
}

async function setAppsRange(range) {
  if (!['day', 'week', 'month'].includes(range)) return;
  appsRange = range;
  document.querySelectorAll('[data-apps-range]').forEach(button => {
    const active = button.dataset.appsRange === range;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const request = ++appsHistoryRequest;
  const status = $('apps-range-status');
  if (range === 'day') { status.textContent = ''; renderAppList(lastAppsStats); return; }
  if (appsHistoryRange === range && appsHistoryDate === (lastAppsStats && lastAppsStats.date)) {
    status.textContent = ''; renderAppsPeriod(); return;
  }
  status.textContent = 'Loading app time…';
  appsHistoryRange = null;
  renderAppsOverview([]);
  $('app-list').innerHTML = '<li class="empty">Loading app time…</li>';
  try {
    if (!api || !api.getHistorySummary) throw new Error('History unavailable');
    const days = await api.getHistorySummary(range === 'week' ? 7 : 30);
    if (request !== appsHistoryRequest) return;
    appsHistoryDays = days;
    appsHistoryRange = range;
    appsHistoryDate = lastAppsStats && lastAppsStats.date;
    status.textContent = '';
    renderAppsPeriod();
  } catch (err) {
    if (request !== appsHistoryRequest) return;
    appsHistoryRange = null;
    status.textContent = 'Could not load app time. Select this range to retry.';
  }
}

document.querySelectorAll('[data-apps-range]').forEach(button => button.addEventListener('click', () => setAppsRange(button.dataset.appsRange)));

$('app-list').addEventListener('click', async ev => {
  const btn = ev.target.closest('button[data-app-command]');
  if (!btn || appCorrectionBusy) return;
  const row = btn.closest('.app-activity');
  const id = decodeURIComponent(row.dataset.rowId || '');
  if (!id) return;
  if (btn.dataset.appCommand !== 'choose' || btn.disabled || !api || !api.correctWithUndo) return;
  appCorrectionBusy = true;
  row.querySelectorAll('button').forEach(button => { button.disabled = true; });
  const groupName = row.closest('.app-group').dataset.groupName;
  try {
    const result = await api.correctWithUndo(id, btn.dataset.category);
    const stats = result.stats;
    historicalWeek = null;
    historyRequest++;
    setLiveStats(stats, lastFocusedCache);
    renderStats(stats);
    paintLivePie();
    $('apps-correction-status').textContent = 'Updated today’s activity. Future tracking is unchanged.';
    window.sydtrackQuickUI?.showUndo(result, 'Changed today’s activity.', { rowId: id });
    const group = [...$('app-list').querySelectorAll('.app-group')].find(item => item.dataset.groupName === groupName);
    if (group) group.querySelector('.app-activity[data-row-id="' + encodeURIComponent(id) + '"] .app-activity-actions')?.focus();
  } catch (err) {
    $('apps-correction-status').textContent = 'Could not change this activity. Try again.';
    console.warn('App correction failed', err);
    renderAppList(lastAppsStats);
    $('app-list').querySelector('.app-activity[data-row-id="' + encodeURIComponent(id) + '"] .app-activity-category[data-category="' + btn.dataset.category + '"]')?.focus();
  } finally { appCorrectionBusy = false; }
});

async function pushSettings(partial) {
  if (!api) return;
  const next = await api.updateSettings(partial);
  applySettingsInputs(next);
  return next;
}

if ($('threshold-min')) {
  $('threshold-min').addEventListener('change', () => {
    const min = Number($('threshold-min').value);
    if (!Number.isFinite(min) || min <= 0) return;
    pushSettings({ thresholdSec: Math.round(min * 60), focusBoost: false });
  });
}
if ($('focusboost-min')) {
  $('focusboost-min').addEventListener('change', async () => {
    const min = Number($('focusboost-min').value);
    if (!Number.isFinite(min) || min <= 0) return;
    const rounded = Math.max(5, Math.round(min * 60));
    const state = api && (await api.getState().catch(() => null));
    const settings = (state && state.stats && state.stats.settings) || {};
    const partial = { focusBoostSec: rounded };
    // If boost is armed, also retarget the live threshold
    if (settings.focusBoost) partial.thresholdSec = rounded;
    const next = await pushSettings(partial);
    syncFocusBoostUi(next || Object.assign({}, settings, partial));
  });
}

if ($('idle-timeout-min')) {
  const saveIdleTimeout = () => {
    const minutes = Math.max(0, Number($('idle-timeout-min').value) || 0);
    pushSettings({ idleTimeoutSec: Math.round(minutes * 60) });
  };
  $('idle-timeout-min').addEventListener('change', saveIdleTimeout);
}
if ($('track-music-idle')) {
  $('track-music-idle').addEventListener('change', () => {
    pushSettings({ trackMusicWhileIdle: $('track-music-idle').checked === true });
  });
}
if ($('track-video-idle')) {
  $('track-video-idle').addEventListener('change', () => {
    pushSettings({ trackVideoWhileIdle: $('track-video-idle').checked === true });
  });
}
if ($('break-reminder-toggle')) {
  $('break-reminder-toggle').addEventListener('change', () => {
    pushSettings({ breakReminderEnabled: $('break-reminder-toggle').checked === true });
  });
}
if ($('break-reminder-minutes')) {
  $('break-reminder-minutes').addEventListener('change', () => {
    const minutes = Math.round(Number($('break-reminder-minutes').value));
    if (Number.isInteger(minutes) && minutes >= 10 && minutes <= 240) pushSettings({ breakReminderMinutes: minutes });
  });
}
if ($('settings-notifications-toggle')) {
  $('settings-notifications-toggle').addEventListener('change', () => {
    pushSettings({ notificationsEnabled: $('settings-notifications-toggle').checked === true });
  });
}
if ($('launch-startup-toggle')) {
  $('launch-startup-toggle').addEventListener('change', () => {
    pushSettings({ launchAtStartup: $('launch-startup-toggle').checked === true });
  });
}
async function saveSettingsSelect(input, value) {
  if (!api) throw new Error('Settings are unavailable');
  if (input.id === 'theme-rotation-mode') return saveAppearance({ themeRotationMode: value });
  const field = { 'poll-mode': 'pollMs', 'profile-shortcut': 'profileShortcut', 'window-shortcut': 'windowShortcut' }[input.id];
  if (!field) throw new Error('Unknown settings control');
  const status = $(input.id + '-status');
  const old = latestGoalSettings?.[field] ?? (field === 'pollMs' ? 3000 : '');
  if (status) { status.textContent = ''; status.classList.add('hidden'); }
  try {
    return await pushSettings({ [field]: field === 'pollMs' ? Number(value) : value });
  } catch (err) {
    input.value = String(old);
    if (status && !input.hidden) {
      status.textContent = field === 'pollMs' ? 'Could not save this option. Try again.' : 'That shortcut is unavailable. Choose another.';
      status.classList.remove('hidden');
    }
    throw err;
  }
}
for (const id of ['poll-mode', 'profile-shortcut', 'window-shortcut', 'theme-rotation-mode']) {
  $(id)?.addEventListener('change', () => {
    saveSettingsSelect($(id), $(id).value).catch(() => {});
  });
}
settingsSelectMenu = window.sydtrackSelectMenuUI?.create({ root: $('view-settings'), onCommit: saveSettingsSelect }) || null;
if ($('reminder-message')) {
  const saveReminderMsg = () => {
    const text = String($('reminder-message').value || '').trim() || "You've been on {app} for a while... maybe it's time to get back?";
    pushSettings({ reminderMessage: text });
  };
  $('reminder-message').addEventListener('change', saveReminderMsg);
}
if ($('focusboost-message')) {
  const saveBoostMsg = () => {
    const text =
      String($('focusboost-message').value || '').trim() || "Hey! focusboost is enabled. Maybe it's time to refocus?";
    pushSettings({ focusBoostReminderMessage: text });
  };
  $('focusboost-message').addEventListener('change', saveBoostMsg);
}

async function setTrackingPaused(paused) {
  return performPauseAction(paused ? 0 : null, $('pause-btn'));
}


if ($('notif-btn')) {
  $('notif-btn').addEventListener('click', async () => {
    const muted = $('notif-btn').getAttribute('data-muted') === 'on';
    // muted on => currently off; click enables. muted off => currently on; click disables.
    const enable = muted;
    const next = await pushSettings({ notificationsEnabled: enable });
    syncNotifUi(next || { notificationsEnabled: enable });
  });
}

if ($('pause-btn')) {
  $('pause-btn').addEventListener('click', () => {
    if (pauseActionBusy) return;
    const on = $('pause-btn').getAttribute('data-paused') === 'on';
    setTrackingPaused(!on);
  });
}

async function saveFocusBoostSchedulePartial(partial) {
  focusBoostScheduleDesired = null; // re-evaluate after schedule edits
  const next = await pushSettings(partial);
  syncFocusBoostScheduleUi(next || Object.assign({}, partial));
  await applyFocusBoostSchedule(next || partial, { force: true });
}

if ($('fb-schedule-toggle')) {
  $('fb-schedule-toggle').addEventListener('change', async () => {
    await saveFocusBoostSchedulePartial({
      focusBoostScheduleEnabled: !!$('fb-schedule-toggle').checked
    });
  });
}
if ($('fb-schedule-start')) {
  $('fb-schedule-start').addEventListener('change', event => {
    const v = String($('fb-schedule-start').value || '09:00');
    const pending = saveFocusBoostSchedulePartial({ focusBoostScheduleStart: v });
    if (event.detail?.scheduleTimePicker) event.detail.pending = pending;
    else pending.catch(() => {});
  });
}
if ($('fb-schedule-end')) {
  $('fb-schedule-end').addEventListener('change', event => {
    const v = String($('fb-schedule-end').value || '17:00');
    const pending = saveFocusBoostSchedulePartial({ focusBoostScheduleEnd: v });
    if (event.detail?.scheduleTimePicker) event.detail.pending = pending;
    else pending.catch(() => {});
  });
}

function closePauseMenu(restoreFocus = false) {
  const menu = $('pause-settings-menu');
  if (!menu) return;
  menu.classList.add('hidden');
  menu.classList.remove('pause-menu-up');
  const button = $('pause-settings-btn');
  if (button.dataset.paused === 'on') button.removeAttribute('aria-expanded');
  else button.setAttribute('aria-expanded', 'false');
  if (restoreFocus) $('pause-settings-btn').focus({ preventScroll: true });
}

function openPauseMenu(last = false) {
  const control = $('pause-settings-btn');
  const menu = $('pause-settings-menu');
  if (!control || !menu || control.disabled || control.dataset.paused === 'on') return;
  pauseActionError = '';
  if (pauseUiSettings) syncPauseUi(pauseUiSettings);
  menu.classList.remove('hidden', 'pause-menu-up');
  menu.style.maxHeight = '';
  control.setAttribute('aria-expanded', 'true');
  const rect = control.getBoundingClientRect();
  const needed = menu.getBoundingClientRect().height;
  const below = window.innerHeight - rect.bottom - 12;
  const above = rect.top - 12;
  const upwards = below < needed && above > below;
  menu.classList.toggle('pause-menu-up', upwards);
  menu.style.maxHeight = Math.max(44, upwards ? above : below) + 'px';
  const choices = [...menu.querySelectorAll('button')];
  choices[last ? choices.length - 1 : 0]?.focus({ preventScroll: true });
}

async function performPauseAction(minutes, origin = $('pause-settings-btn')) {
  if (!api || pauseActionBusy || !pauseUiSettings || !pauseUiSettings.onboardingComplete ||
    ![null, 0, 15, 30, 60].includes(minutes)) return;
  const restoreFocus = document.activeElement === origin || $('pause-settings-menu').contains(document.activeElement);
  closePauseMenu(origin === $('pause-settings-btn'));
  pauseActionError = '';
  pauseActionBusy = true;
  syncPauseUi(pauseUiSettings);
  try {
    const next = minutes == null ? await pushSettings({ trackingPaused: false }) : minutes === 0
      ? await pushSettings({ trackingPaused: true }) : await api.pauseForMinutes(minutes);
    if (next && minutes > 0) applySettingsInputs(next);
    return next;
  } catch (_) {
    pauseActionError = minutes == null ? 'Could not resume tracking. Try again.' : 'Could not pause tracking. Try again.';
  } finally {
    pauseActionBusy = false;
    syncPauseUi(pauseUiSettings);
    if (restoreFocus && document.activeElement === document.body && origin.getClientRects().length && !origin.disabled) {
      origin.focus({ preventScroll: true });
    }
  }
}

const pauseSettingsControl = $('pause-settings-btn');
const pauseSettingsMenu = $('pause-settings-menu');
if (pauseSettingsControl && pauseSettingsMenu) {
  pauseSettingsControl.addEventListener('click', () => {
    if (pauseSettingsControl.dataset.paused === 'on') performPauseAction(null);
    else if (!pauseSettingsMenu.classList.contains('hidden')) closePauseMenu();
    else openPauseMenu();
  });
  pauseSettingsControl.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && pauseSettingsControl.dataset.paused !== 'on') {
      event.preventDefault(); openPauseMenu(event.key === 'ArrowUp');
    }
  });
  pauseSettingsMenu.addEventListener('click', event => {
    const choice = event.target.closest('[data-pause-minutes]');
    if (choice && pauseSettingsMenu.contains(choice)) performPauseAction(Number(choice.dataset.pauseMinutes));
  });
  pauseSettingsMenu.addEventListener('keydown', event => {
    const choices = [...pauseSettingsMenu.querySelectorAll('button')];
    const index = choices.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 :
        (index + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
      choices[next]?.focus();
    } else if (event.key === 'Tab') closePauseMenu(true);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !pauseSettingsMenu.classList.contains('hidden')) {
      event.preventDefault(); closePauseMenu(true);
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.pause-settings-actions')) closePauseMenu();
  });
  document.addEventListener('focusin', event => {
    if (!event.target.closest('.pause-settings-actions')) closePauseMenu();
  });
  window.addEventListener('resize', () => closePauseMenu());
  window.addEventListener('scroll', () => closePauseMenu(), { passive: true });
  document.querySelector('.main')?.addEventListener('scroll', () => closePauseMenu(), { passive: true });
}

async function toggleFocusBoost() {
  if (!api) return;
  const state = await api.getState();
  const settings = (state && state.stats && state.stats.settings) || {};
  const on = !!settings.focusBoost;
  const boostSec = focusBoostSecFromSettings(settings);
  if (!on) {
    thresholdBeforeBoost =
      Number(settings.thresholdSec) && Number(settings.thresholdSec) !== boostSec
        ? Number(settings.thresholdSec)
        : thresholdBeforeBoost || 600;
    const next = await pushSettings({
      focusBoost: true,
      thresholdSec: boostSec,
      focusBoostRestoreSec: thresholdBeforeBoost,
      focusBoostSec: boostSec
    });
    syncFocusBoostUi(
      next || {
        focusBoost: true,
        thresholdSec: boostSec,
        focusBoostSec: boostSec
      }
    );
    playFocusBoostFeel(true);
  } else {
    const restore =
      Number(settings.focusBoostRestoreSec) || thresholdBeforeBoost || 600;
    const next = await pushSettings({
      focusBoost: false,
      thresholdSec: restore
    });
    syncFocusBoostUi(
      next || {
        focusBoost: false,
        thresholdSec: restore,
        focusBoostSec: boostSec
      }
    );
    playFocusBoostFeel(false);
  }
}

function linesToList(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function fillRulesEditors(rules) {
  if (!rules) return;
  if (Array.isArray(rules.browserApps)) cachedBrowserApps = rules.browserApps.slice();
  if (Array.isArray(rules.ignoredApps)) cachedIgnoredApps = rules.ignoredApps.slice();
  cachedRules = {
    profileId: rules.profileId ?? cachedRules.profileId,
    productive: rules.productive || [],
    unproductive: rules.unproductive || [],
    other: rules.other || [],
    browserKeywords: rules.browserKeywords || cachedRules.browserKeywords || {},
    identities: {
      browserApps: cachedBrowserApps,
      ignoredApps: cachedIgnoredApps,
      productiveApps: rules.productiveApps || (cachedRules.identities && cachedRules.identities.productiveApps) || []
    }
  };
  for (const key of Object.keys(lfSessionClass)) delete lfSessionClass[key];
  if ($('rules-prod-edit')) $('rules-prod-edit').value = (rules.productive || []).join('\n');
  if ($('rules-unprod-edit')) $('rules-unprod-edit').value = (rules.unproductive || []).join('\n');
  if ($('rules-other-edit')) $('rules-other-edit').value = (rules.other || []).join('\n');
  if (rules.path && $('rules-path')) $('rules-path').textContent = rules.path;
  if (rules.path && $('rules-unprod-path')) $('rules-unprod-path').textContent = rules.path;
  if ($('rules-custom-label')) {
    $('rules-custom-label').textContent = rules.isCustom ? '(custom)' : '(defaults)';
  }
  if ($('rules-unprod-custom-label')) {
    $('rules-unprod-custom-label').textContent = rules.isCustom ? '(custom)' : '(defaults)';
  }
  updateTagsQuickStatus();
  applyLfButtonOutlines(lastFocusedCache && lastFocusedCache.category);
  window.sydtrackQuickUI?.focusChanged();
}

function fillIgnoreEditor(payload) {
  const items = (payload && payload.ignore) || [];
  cachedIgnore = items.slice();
  const ta = $('ignore-edit');
  if (ta) ta.value = items.join('\n');
  if (payload && payload.path && $('ignore-path')) $('ignore-path').textContent = payload.path;
  const label = $('ignore-custom-label');
  if (label) label.textContent = payload && payload.isCustom ? '(custom)' : '(defaults)';
  updateTagsQuickStatus();
}

function fillKeywordEditors(keywords) {
  const prod = (keywords && keywords.productive) || [];
  const unprod = (keywords && keywords.unproductive) || [];
  cachedRules.browserKeywords = { productive: prod, unproductive: unprod };
  if ($('kw-prod-edit')) $('kw-prod-edit').value = prod.join('\n');
  if ($('kw-unprod-edit')) $('kw-unprod-edit').value = unprod.join('\n');
}

async function loadBrowserKeywords() {
  if (!api || !api.getBrowserKeywords) return;
  try {
    fillKeywordEditors(await api.getBrowserKeywords());
  } catch (_) {}
}

async function loadRulesAndIgnore() {
  if (!api || tagsQuickSaving) return;
  try {
    const rules = await api.getRules();
    fillRulesEditors(rules);
    if (rules && rules.browserKeywords) fillKeywordEditors(rules.browserKeywords);
  } catch (err) {
    if ($('rules-status')) $('rules-status').textContent = 'Failed to load rules';
  }
  try {
    if (api.getIgnore) {
      const ign = await api.getIgnore();
      fillIgnoreEditor(ign);
    }
  } catch (_) {}
  await loadBrowserKeywords();
}

async function saveRulesFromEditors(statusId) {
  if (!api || !api.setRules || tagsQuickSaving) return;
    tagsQuickSaving = true;
  const status = $(statusId);
  if (status) status.textContent = 'Saving…';
  try {
    const next = await api.setRules({
      productive: linesToList(($('rules-prod-edit') && $('rules-prod-edit').value) || ''),
      unproductive: linesToList(($('rules-unprod-edit') && $('rules-unprod-edit').value) || ''),
      other: linesToList(($('rules-other-edit') && $('rules-other-edit').value) || '')
    });
    fillRulesEditors(next);
    if (status) status.textContent = 'Saved — live now';
    const other = statusId === 'rules-status' ? $('rules-unprod-status') : $('rules-status');
    if (other) other.textContent = 'Saved — live now';
  } catch (err) {
    if (status) status.textContent = 'Save failed';
  } finally { tagsQuickSaving = false; }
}

async function resetRulesFromEditors(statusId) {
  if (!api || !api.resetRules || tagsQuickSaving) return;
    tagsQuickSaving = true;
  const status = $(statusId);
  if (status) status.textContent = 'Resetting…';
  try {
    const next = await api.resetRules();
    fillRulesEditors(next);
    if (status) status.textContent = 'Defaults restored';
    const other = statusId === 'rules-status' ? $('rules-unprod-status') : $('rules-status');
    if (other) other.textContent = 'Defaults restored';
  } catch (err) {
    if (status) status.textContent = 'Reset failed';
  } finally { tagsQuickSaving = false; }
}

if ($('rules-save')) {
  $('rules-save').addEventListener('click', () => saveRulesFromEditors('rules-status'));
}

if ($('rules-reset')) {
  $('rules-reset').addEventListener('click', () => resetRulesFromEditors('rules-status'));
}

if ($('rules-unprod-save')) {
  $('rules-unprod-save').addEventListener('click', () => saveRulesFromEditors('rules-unprod-status'));
}

if ($('rules-unprod-reset')) {
  $('rules-unprod-reset').addEventListener('click', () => resetRulesFromEditors('rules-unprod-status'));
}
if ($('rules-other-save')) {
  $('rules-other-save').addEventListener('click', () => saveRulesFromEditors('rules-other-status'));
}

if ($('ignore-save')) {
  $('ignore-save').addEventListener('click', async () => {
    if (!api || !api.setIgnore || tagsQuickSaving) return;
    tagsQuickSaving = true;
    $('ignore-status').textContent = 'Saving…';
    try {
      const next = await api.setIgnore(linesToList($('ignore-edit').value));
      fillIgnoreEditor(next);
      $('ignore-status').textContent = 'Saved — live now';
    } catch (err) {
      $('ignore-status').textContent = 'Save failed';
    } finally { tagsQuickSaving = false; }
  });
}

if ($('kw-save')) {
  $('kw-save').addEventListener('click', async () => {
    if (!api || !api.setBrowserKeywords) return;
    const status = $('kw-status');
    if (status) status.textContent = 'Saving…';
    try {
      const next = await api.setBrowserKeywords({
        productive: linesToList(($('kw-prod-edit') && $('kw-prod-edit').value) || ''),
        unproductive: linesToList(($('kw-unprod-edit') && $('kw-unprod-edit').value) || '')
      });
      fillKeywordEditors(next);
      if (status) status.textContent = 'Saved — live now';
    } catch (_) {
      if (status) status.textContent = 'Save failed';
    }
  });
}

if ($('kw-reset')) {
  $('kw-reset').addEventListener('click', async () => {
    if (!api || !api.resetBrowserKeywords) return;
    const status = $('kw-status');
    if (status) status.textContent = 'Resetting…';
    try {
      fillKeywordEditors(await api.resetBrowserKeywords());
      if (status) status.textContent = 'Defaults restored';
    } catch (_) {
      if (status) status.textContent = 'Reset failed';
    }
  });
}

document.querySelectorAll('[data-theme-id]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const theme = btn.getAttribute('data-theme-id');
    if (!api) { applyTheme(theme); return; } // Standalone demo/preview, no durable settings.
    try { await saveAppearance({ theme, themeRotationEnabled: false }); } catch (_) {}
  });
});
$('theme-rotation-toggle')?.addEventListener('change', async (event) => {
  try { await saveAppearance({ themeRotationEnabled: event.currentTarget.checked }); } catch (_) {}
});

if ($('ignore-reset')) {
  $('ignore-reset').addEventListener('click', async () => {
    if (!api || !api.resetIgnore || tagsQuickSaving) return;
    tagsQuickSaving = true;
    $('ignore-status').textContent = 'Resetting…';
    try {
      const next = await api.resetIgnore();
      fillIgnoreEditor(next);
      $('ignore-status').textContent = 'Defaults restored';
    } catch (err) {
      $('ignore-status').textContent = 'Reset failed';
    } finally { tagsQuickSaving = false; }
  });
}

/* —— Focus Tags quick add / search —— */
function currentTagLists() {
  // The visible draft is authoritative, including an intentionally empty editor.
  const read = (id, fallback) => $(id) ? linesToList($(id).value) : fallback;
  return {
    productive: read('rules-prod-edit', cachedRules.productive),
    unproductive: read('rules-unprod-edit', cachedRules.unproductive),
    other: read('rules-other-edit', cachedRules.other),
    ignore: read('ignore-edit', cachedIgnore)
  };
}

function listsContainingKeyword(keyword) {
  const key = String(keyword || '').trim().toLowerCase();
  if (!key) return [];
  const lists = currentTagLists();
  const found = [];
  if (lists.productive.some((x) => x.toLowerCase() === key)) found.push('Productive');
  if (lists.unproductive.some((x) => x.toLowerCase() === key)) found.push('Unproductive');
  if (lists.other.some((x) => x.toLowerCase() === key)) found.push('Other');
  if (lists.ignore.some((x) => x.toLowerCase() === key)) found.push('Ignore');
  return found;
}

function updateBrowserRuleNotice() {
  const notice = $('tags-rule-notice');
  if (!notice) return;
  const lists = currentTagLists();
  const names = [...new Set([...lists.productive, ...lists.unproductive, ...lists.other]
    .filter(key => window.sydtrackBrowserRules.isBrowserName(key, cachedBrowserApps)))];
  notice.classList.toggle('hidden', !names.length);
  notice.textContent = names.length ? 'Browser names do not classify pages: ' + names.map(name => '“' + name + '”').join(', ') +
    '. Use a page/source keyword, or Ignore the whole browser.' : '';
}

function updateTagsQuickStatus() {
  updateBrowserRuleNotice();
  const status = $('tags-quick-status');
  const input = $('tags-quick-input');
  if (!status || !input) return;
  const kw = String(input.value || '').trim();
  if (!kw) {
    status.textContent = 'Type a keyword to see which list it is in.';
    return;
  }
  const found = listsContainingKeyword(kw);
  if (!found.length) {
    status.textContent = '“' + kw + '” is not in any list.';
    return;
  }
  status.textContent = '“' + kw + '” is in: ' + found.join(', ') + '.';
}

function stripKeywordCI(arr, keyword) {
  const key = String(keyword || '').trim().toLowerCase();
  return (arr || []).filter((x) => String(x).toLowerCase() !== key);
}

async function tagsQuickAdd(target) {
  if (tagsQuickSaving) return;
  const status = $('tags-quick-status');
  const input = $('tags-quick-input');
  if (!input) return;
  const kw = String(input.value || '').trim();
  if (!kw) {
    if (status) status.textContent = 'Enter a keyword first.';
    return;
  }
  if (target !== 'ignore' && window.sydtrackBrowserRules.isBrowserName(kw, cachedBrowserApps)) {
    if (status) status.textContent = 'Browser names cannot classify pages. Use a specific title/source keyword instead.';
    return;
  }
  if (typeof currentPlatform !== 'undefined' && currentPlatform === 'win32' && /^site:/i.test(kw)) {
    if (status) status.textContent = 'Windows uses window titles, not browser addresses. Add a title word instead.';
    return;
  }
  if (/^site:/i.test(kw) && (target === 'ignore' || !window.sydtrackBrowserRules.siteDomain(kw))) {
    if (status) status.textContent = 'Use site:example.com in Productive or Unproductive. Ignore applies to whole apps.';
    return;
  }
  if (!api) {
    if (status) status.textContent = 'API unavailable.';
    return;
  }

  // Source of truth for edits: live textareas (unsaved edits included)
  let prod = linesToList(($('rules-prod-edit') && $('rules-prod-edit').value) || '');
  let unprod = linesToList(($('rules-unprod-edit') && $('rules-unprod-edit').value) || '');
  let other = linesToList(($('rules-other-edit') && $('rules-other-edit').value) || '');
  let ignore = linesToList(($('ignore-edit') && $('ignore-edit').value) || '');

  const key = kw.toLowerCase();
  const inProd = prod.some((x) => x.toLowerCase() === key);
  const inUnprod = unprod.some((x) => x.toLowerCase() === key);
  const inOther = other.some((x) => x.toLowerCase() === key);
  const inIgnore = ignore.some((x) => x.toLowerCase() === key);

  if (target === 'productive' && inProd && !inUnprod && !inOther && !inIgnore) {
    if (status) status.textContent = 'Already in Productive.';
    return;
  }
  if (target === 'unproductive' && inUnprod && !inProd && !inOther && !inIgnore) {
    if (status) status.textContent = 'Already in Unproductive.';
    return;
  }
  if (target === 'ignore' && inIgnore && !inProd && !inUnprod && !inOther) {
    if (status) status.textContent = 'Already in Ignore.';
    return;
  }

  const movedFrom = [];
  if (target !== 'productive' && inProd) movedFrom.push('Productive');
  if (target !== 'unproductive' && inUnprod) movedFrom.push('Unproductive');
  if (inOther) movedFrom.push('Other');
  if (target !== 'ignore' && inIgnore) movedFrom.push('Ignore');

  prod = stripKeywordCI(prod, kw);
  unprod = stripKeywordCI(unprod, kw);
  other = stripKeywordCI(other, kw);
  ignore = stripKeywordCI(ignore, kw);
  if (target === 'productive') prod.push(kw);
  else if (target === 'unproductive') unprod.push(kw);
  else ignore.push(kw);

  if (status) status.textContent = 'Saving…';
  tagsQuickSaving = true;
  const controls = document.querySelectorAll('#view-tags button, #view-tags textarea');
  const disabledBefore = Array.from(controls, (el) => el.disabled);
  controls.forEach((el) => { el.disabled = true; });
  try {
    const rulesChanged =
      target === 'productive' ||
      target === 'unproductive' ||
      inProd ||
      inUnprod ||
      inOther;
    const ignoreChanged = target === 'ignore' || inIgnore;

    if (rulesChanged && api.setRules) {
      const next = await api.setRules({ productive: prod, unproductive: unprod, other });
      fillRulesEditors(next || { productive: prod, unproductive: unprod, other, isCustom: true });
    } else {
      if ($('rules-prod-edit')) $('rules-prod-edit').value = prod.join('\n');
      if ($('rules-unprod-edit')) $('rules-unprod-edit').value = unprod.join('\n');
      if ($('rules-other-edit')) $('rules-other-edit').value = other.join('\n');
      cachedRules = { ...cachedRules, productive: prod.slice(), unproductive: unprod.slice(), other: other.slice() };
    }

    if (ignoreChanged && api.setIgnore) {
      const payload = await api.setIgnore(ignore);
      fillIgnoreEditor(payload || { ignore, isCustom: true });
    } else {
      if ($('ignore-edit')) $('ignore-edit').value = ignore.join('\n');
      cachedIgnore = ignore.slice();
    }

    const label =
      target === 'productive' ? 'Productive' : target === 'unproductive' ? 'Unproductive' : 'Ignore';
    if (status) {
      status.textContent = movedFrom.length
        ? 'Moved “' + kw + '” → ' + label + ' (from ' + movedFrom.join(', ') + ').'
        : 'Added “' + kw + '” to ' + label + '.';
    }
  } catch (err) {
    if (status) status.textContent = 'Save failed.';
    console.warn('tags quick-add failed', err);
  } finally {
    tagsQuickSaving = false;
    controls.forEach((el, i) => { el.disabled = disabledBefore[i]; });
    // A slow save must not replace the search result for a newer query.
    if (String(input.value || '').trim() !== kw) updateTagsQuickStatus();
  }
}

(function wireTagsQuickAdd() {
  const input = $('tags-quick-input');
  if (!input) return;
  input.addEventListener('input', updateTagsQuickStatus);
  for (const id of ['rules-prod-edit', 'rules-unprod-edit', 'rules-other-edit', 'ignore-edit']) {
    if ($(id)) $(id).addEventListener('input', updateTagsQuickStatus);
  }
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      tagsQuickAdd('productive');
    }
  });
  if ($('tags-quick-prod')) {
    $('tags-quick-prod').addEventListener('click', () => tagsQuickAdd('productive'));
  }
  if ($('tags-quick-unprod')) {
    $('tags-quick-unprod').addEventListener('click', () => tagsQuickAdd('unproductive'));
  }
  if ($('tags-quick-ignore')) {
    $('tags-quick-ignore').addEventListener('click', () => tagsQuickAdd('ignore'));
  }
  updateTagsQuickStatus();
})();

if ($('data-export')) {
  $('data-export').addEventListener('click', async () => {
    if (!api || !api.exportData) return;
    $('data-status').textContent = 'Exporting…';
    try {
      const res = await api.exportData({
        includeSettings: true,
        includeRules: true,
        includeIgnore: true
      });
      if (res && res.canceled) $('data-status').textContent = 'Export canceled';
      else if (res && res.ok) $('data-status').textContent = 'Exported';
      else $('data-status').textContent = (res && res.error) || 'Export failed';
    } catch (err) {
      $('data-status').textContent = 'Export failed';
    }
  });
}

if ($('data-import')) {
  $('data-import').addEventListener('click', async () => {
    if (!api || !api.importData) return;
    if (window.sydtrackProfilesUI && !window.sydtrackProfilesUI.mayDiscard()) return;
    $('data-status').textContent = 'Importing…';
    try {
      const res = await api.importData({ mode: 'merge' });
      if (res && res.canceled) $('data-status').textContent = 'Import canceled';
      else if (res && res.ok) {
        $('data-status').textContent = 'Imported ' + (res.daysImported || 0) + ' day(s), ' + (res.sessionsImported || 0) + ' session(s) added or updated';
        invalidateHistoryViews();
        historyRequest++;
        const state = await api.getState();
        if (state) {
          setLiveStats(state.stats, state.now);
          renderStats(state.stats);
          paintLivePie();
        }
        await loadRulesAndIgnore();
        if (window.sydtrackProfilesUI) await window.sydtrackProfilesUI.reload(true, true);
        refreshSessionLog();
      } else $('data-status').textContent = (res && res.error) || 'Import failed';
    } catch (err) {
      $('data-status').textContent = 'Import failed';
    }
  });
}


if ($('data-clear-today')) {
  $('data-clear-today').addEventListener('click', async () => {
    if (!api || !api.clearToday) return;
    if (!confirm("Clear TODAY's tracked time?\n\nPermanently deletes today's stats on this device. No cloud backup. Cannot be undone.")) return;
    const res = await api.clearToday();
    if (res && res.ok) {
      $('data-status').textContent = 'Today cleared';
      setLiveStats(res.stats, null);
      renderStats(res.stats);
      paintLivePie();
    }
  });
}

if ($('data-clear-all')) {
  $('data-clear-all').addEventListener('click', async () => {
    if (!api || !api.clearAllHistory) return;
    if (!confirm("CLEAR ALL HISTORY?\n\nDeletes today and every archived day on this device. No cloud backup. Cannot be undone.")) return;
    const res = await api.clearAllHistory();
    if (res && res.ok) {
      $('data-status').textContent = 'All history cleared';
      invalidateHistoryViews();
      setLiveStats(res.stats, null);
      renderStats(res.stats);
      paintLivePie();
    }
  });
}

if ($('data-delete-all')) {
  $('data-delete-all').addEventListener('click', async () => {
    if (!api || !api.deleteAllMyData) return;
    if (!confirm('Delete all local sydtrack data on this device?\n\nThis removes activity, daily rollups, sessions, settings, Focus profiles, tags, error logs, migration backups, and the leftover focusflow data folder. Nothing is uploaded. This cannot be undone.')) return;
    const res = await api.deleteAllMyData();
    if (res && res.ok) {
      $('data-status').textContent = 'All local data deleted';
      invalidateHistoryViews();
      setLiveStats(res.stats, null);
      renderStats(res.stats);
      paintLivePie();
      await loadRulesAndIgnore();
      if (window.sydtrackProfilesUI) await window.sydtrackProfilesUI.reload(true, true);
      refreshSessionLog();
    } else {
      const leftover = (res && res.failed || []).map((item) => item.path).filter(Boolean);
      $('data-status').textContent = leftover.length
        ? 'Delete failed: ' + leftover.join(', ')
        : (res && res.error) || 'Delete failed';
    }
  });
}


/* ——— Focus sessions (Pomodoro / Deep / Custom) ——— */
const SESSION_MODE_PLANNED = { pomodoro: 25 * 60, deep: 90 * 60 };
let selectedSessionMode = 'pomodoro';
let activeSessionCache = null;
let sessionLogDay = null; // YYYY-MM-DD
let sessionUiTimer = null;

function sessionPlannedSec(mode, customMin) {
  if (mode === 'pomodoro') return 25 * 60;
  if (mode === 'deep') return 90 * 60;
  const m = Number(customMin);
  const mins = Number.isFinite(m) && m > 0 ? Math.min(1440, Math.max(1, Math.round(m))) : 45;
  return mins * 60;
}

function fmtCountdown(sec) {
  sec = Math.max(0, Math.ceil(+sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function fmtClock(ts) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function syncSessionSettingsUi(settings) {
  const hist = $('session-history-toggle');
  if (hist && document.activeElement !== hist) {
    hist.checked = settings.sessionHistoryEnabled !== false;
  }
  const customMin = Number(settings.sessionCustomMin);
  const mins = Number.isFinite(customMin) && customMin > 0 ? customMin : 45;
  const el = $('session-custom-min');
  if (el && document.activeElement !== el) el.value = mins;
  if (!activeSessionCache) {
    updateIdleCountdownDisplay();
  }
}

function bindSessionLogListClicks() {
  const sessionLogListEl = $('session-log-list');
  if (!sessionLogListEl || sessionLogListEl._expandBound) return;
  sessionLogListEl._expandBound = true;
  sessionLogListEl.addEventListener('click', (ev) => {
    const del = ev.target.closest('.session-log-delete');
    if (del && sessionLogListEl.contains(del)) {
      ev.preventDefault();
      ev.stopPropagation();
      const id = del.getAttribute('data-id');
      const dateKey = del.getAttribute('data-date') || sessionLogDay;
      if (id) deleteFocusSession(id, dateKey);
      return;
    }
    const btn = ev.target.closest('.session-log-summary');
    if (!btn || !sessionLogListEl.contains(btn)) return;
    const item = btn.closest('.session-log-item');
    if (!item) return;
    const open = item.getAttribute('data-open') === 'on';
    item.setAttribute('data-open', open ? 'off' : 'on');
    btn.setAttribute('aria-expanded', open ? 'false' : 'true');
  });
}

function setSelectedSessionMode(mode, opts) {
  const silent = opts && opts.silent;
  if (mode !== 'pomodoro' && mode !== 'deep' && mode !== 'custom') mode = 'pomodoro';
  selectedSessionMode = mode;
  bindSessionLogListClicks();
  document.querySelectorAll('[data-session-mode]').forEach((btn) => {
    const on = btn.getAttribute('data-session-mode') === mode;
    btn.classList.toggle('active', on);
  });
  const customRow = $('session-custom-row');
  if (customRow) customRow.classList.toggle('hidden', mode !== 'custom');
  if (!activeSessionCache && !silent) updateIdleCountdownDisplay();
}

function currentCustomMin() {
  const el = $('session-custom-min');
  const n = el ? Number(el.value) : 45;
  return Number.isFinite(n) && n > 0 ? Math.min(1440, Math.max(1, Math.round(n))) : 45;
}

function updateIdleCountdownDisplay() {
  const planned = sessionPlannedSec(selectedSessionMode, currentCustomMin());
  const label =
    selectedSessionMode === 'pomodoro'
      ? 'Pomodoro'
      : selectedSessionMode === 'deep'
        ? 'Deep work'
        : 'Custom';
  const text = fmtCountdown(planned);
  const big = $('session-timer-display');
  if (big) big.textContent = text;
  const modeLabel = $('session-timer-mode-label');
  if (modeLabel) modeLabel.textContent = label;
}

function remainingFromSession(session) {
  if (!session) return 0;
  if (session.endsAt) return Math.max(0, Math.ceil((Number(session.endsAt) - Date.now()) / 1000));
  if (typeof session.remainingMs === 'number') return Math.ceil(session.remainingMs / 1000);
  if (typeof session.remainingSec === 'number') return session.remainingSec;
  return 0;
}

function syncSessionControlsRunning(running) {
  const startBtn = $('session-start-btn');
  const stopBtn = $('session-stop-btn');
  const card = $('session-timer-card');
  if (card) card.setAttribute('data-running', running ? 'on' : 'off');
  if (startBtn) {
    startBtn.disabled = !!running;
    startBtn.classList.toggle('hidden', !!running);
    startBtn.setAttribute('aria-hidden', running ? 'true' : 'false');
  }
  if (stopBtn) {
    stopBtn.disabled = !running;
    stopBtn.classList.toggle('hidden', !running);
    stopBtn.setAttribute('aria-hidden', running ? 'false' : 'true');
  }
  // Disable mode switches while running
  document.querySelectorAll('[data-session-mode]').forEach((btn) => {
    btn.disabled = !!running;
  });
  const customEl = $('session-custom-min');
  if (customEl) customEl.disabled = !!running;
  // Live distractions count removed from timer card (still in session log).
}

function renderActiveSession(session) {
  activeSessionCache = session && session.status === 'running' ? session : null;
  if (!activeSessionCache) {
    syncSessionControlsRunning(false);
    updateIdleCountdownDisplay();
    stopSessionUiTicker();
    return;
  }
  syncSessionControlsRunning(true);
  if (session.mode) setSelectedSessionMode(session.mode, { silent: true });
  const rem = remainingFromSession(session);
  const text = fmtCountdown(rem);
  const big = $('session-timer-display');
  if (big) big.textContent = text;
  const modeLabel = $('session-timer-mode-label');
  if (modeLabel) modeLabel.textContent = session.modeLabel || 'Session';
  startSessionUiTicker();
}

function startSessionUiTicker() {
  if (sessionUiTimer) return;
  sessionUiTimer = window.setInterval(() => {
    if (!activeSessionCache) {
      stopSessionUiTicker();
      return;
    }
    // Recompute remaining from endsAt so UI stays smooth between tracker polls
    const rem = remainingFromSession(activeSessionCache);
    if (rem <= 0) {
      // Tracker will finalize; refresh from API
      api.getActiveSession().then((s) => {
        renderActiveSession(s);
        if (!s) refreshSessionLog();
      }).catch(() => {});
      return;
    }
    const text = fmtCountdown(rem);
    const big = $('session-timer-display');
    if (big) big.textContent = text;
  }, 250);
}

function stopSessionUiTicker() {
  if (sessionUiTimer) {
    clearInterval(sessionUiTimer);
    sessionUiTimer = null;
  }
}

async function startFocusSession() {
  if (!api) return;
  const opts = { mode: selectedSessionMode };
  if (selectedSessionMode === 'custom') opts.customMin = currentCustomMin();
  $('session-intention-status').textContent = '';
  try {
    const session = await api.startSession(opts);
    renderActiveSession(session);
    refreshSessionLog();
  } catch (err) {
    $('session-intention-status').textContent = 'Could not start this session.';
    console.warn('startSession failed', err);
  }
}

async function stopFocusSession() {
  if (!api) return;
  try {
    await api.stopSession();
    renderActiveSession(null);
    refreshSessionLog();
  } catch (err) {
    console.warn('stopSession failed', err);
  }
}

async function deleteFocusSession(id, dateKey) {
  if (!api || !api.deleteSession || !id) return;
  if (activeSessionCache && activeSessionCache.id === id) return;
  try {
    const res = await api.deleteSession(id, dateKey);
    if (res && res.ok === false && res.reason === 'active') return;
    refreshSessionLog(dateKey || sessionLogDay);
  } catch (err) {
    console.warn('deleteSession failed', err);
  }
}


/** Main elapsed unit for session titles: 5m24s → 5m; 29s → 0m; 75m → 1h. */
function fmtElapsedMainUnit(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s >= 3600) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 60) + 'm';
}

function statusChip(status) {
  if (status === 'completed') return '<span class="session-status-chip completed">Completed</span>';
  if (status === 'running') return '<span class="session-status-chip running">Running</span>';
  return '<span class="session-status-chip stopped">Stopped early</span>';
}

function renderSessionLogList(payload) {
  const list = $('session-log-list');
  const note = $('session-log-note');
  if (!list) return;
  const historyOn = !payload || payload.historyEnabled !== false;
  if (note) {
    note.textContent = historyOn
      ? 'Per day · top apps + distractions'
      : 'History off — only the most recent session is kept';
  }
  const sessions = (payload && payload.sessions) || [];
  // Include active session at top if same day
  const items = sessions.slice().reverse();
  if (activeSessionCache) {
    const d = new Date(activeSessionCache.startedAt);
    const key =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');
    if (key === (payload && payload.date)) {
      items.unshift({
        id: activeSessionCache.id,
        mode: activeSessionCache.mode,
        modeLabel: activeSessionCache.modeLabel,
        intention: activeSessionCache.intention,
        plannedSec: activeSessionCache.plannedSec,
        startedAt: activeSessionCache.startedAt,
        endedAt: null,
        elapsedSec: activeSessionCache.elapsedSec,
        status: 'running',
        distractionCount: activeSessionCache.distractionCount,
        topApps: activeSessionCache.topApps || []
      });
    }
  }
  if (!items.length) {
    list.innerHTML =
      '<div class="empty session-log-empty">' +
      (historyOn ? 'No sessions yet for this day' : 'No recent session yet — start one above') +
      '</div>';
    return;
  }
  list.innerHTML = items
    .map((s) => {
      const elapsed = Number(s.elapsedSec) || 0;
      const unit = fmtElapsedMainUnit(elapsed);
      const range =
        fmtClock(s.startedAt) +
        (s.endedAt ? ' – ' + fmtClock(s.endedAt) : ' – now');
      const apps = (s.topApps || [])
        .slice(0, 3)
        .map(
          (a) =>
            '<span class="session-app-pill"><span class="app-trunc" data-full="' +
            esc(a.name) +
            '">' +
            esc(a.name) +
            '</span><span class="sec">' +
            fmt(a.seconds) +
            '</span></span>'
        )
        .join('');
      const modeAndTime = esc(s.modeLabel || s.mode || 'Session') + ' · ' + unit;
      const title = s.intention ? esc(s.intention) : modeAndTime;
      const subtitle = s.intention ? '<span class="session-log-subtitle">' + modeAndTime + '</span>' : '';
      const canDelete = s.status !== 'running' && s.id;
      const dateAttr = esc((payload && payload.date) || sessionLogDay || '');
      const delBtn = canDelete
        ? '<button type="button" class="session-log-delete" data-id="' +
          esc(String(s.id)) +
          '" data-date="' +
          dateAttr +
          '" title="Delete session" aria-label="Delete session">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/><path d="M10 11v6M14 11v6"/>' +
          '</svg></button>'
        : '';
      return (
        '<div class="session-log-item" data-open="off" data-status="' +
        esc(s.status || 'stopped') +
        '" data-id="' +
        esc(String(s.id || '')) +
        '">' +
        '<div class="session-log-row">' +
        '<button type="button" class="session-log-summary" aria-expanded="false">' +
        '<span class="session-log-summary-left">' +
        '<span class="session-log-caret" aria-hidden="true">▶</span>' +
        '<span class="session-log-heading"><span class="session-log-title">' +
        title +
        '</span>' + subtitle + '</span>' +
        '</span>' +
        statusChip(s.status) +
        '</button>' +
        delBtn +
        '</div>' +
        '<div class="session-log-details">' +
        '<div class="session-log-meta">' +
        esc(range) +
        ' · elapsed ' +
        fmt(elapsed) +
        '</div>' +
        (apps
          ? '<div class="session-log-apps">' + apps + '</div>'
          : '<div class="session-log-meta">No app time logged yet</div>') +
        '<div class="session-log-distract">Distractions: <strong>' +
        esc(String(s.distractionCount || 0)) +
        '</strong></div>' +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}

function fillSessionDaySelect(payload) {
  const sel = $('session-day-select');
  if (!sel) return;
  const today = localDateKey();
  let days = (payload && payload.recentDays) || [];
  const requested = (payload && payload.date) || today;
  if (!days.includes(today)) days = [today].concat(days);
  if (!days.includes(requested)) days.push(requested);
  const prev = sessionLogDay || requested;
  sel.innerHTML = days
    .map((d) => '<option value="' + esc(d) + '">' + esc(d === today ? d + ' (today)' : d) + '</option>')
    .join('');
  if (days.includes(prev)) sel.value = prev;
  else sel.value = today;
  sessionLogDay = sel.value || today;
}

async function refreshSessionLog(dateKey) {
  if (!api || !api.getSessionsForDay) return;
  try {
    const key = dateKey || sessionLogDay || undefined;
    const payload = await api.getSessionsForDay(key);
    if (!sessionLogDay) sessionLogDay = payload.date;
    fillSessionDaySelect(payload);
    // If select changed day relative to request, re-fetch matching day list
    if (sessionLogDay && payload.date !== sessionLogDay) {
      const again = await api.getSessionsForDay(sessionLogDay);
      renderSessionLogList(again);
      return;
    }
    renderSessionLogList(payload);
  } catch (err) {
    console.warn('refreshSessionLog failed', err);
    fillSessionDaySelect({ date: sessionLogDay || localDateKey(), recentDays: [] });
    $('session-log-list').innerHTML = '<div class="empty session-log-empty">Could not load sessions.</div>';
  }
}

document.querySelectorAll('[data-session-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (activeSessionCache) return;
    setSelectedSessionMode(btn.getAttribute('data-session-mode') || 'pomodoro');
  });
});

function onCustomMinChange(el) {
  if (!el) return;
  const handler = () => {
    const mins = currentCustomMin();
    if (!activeSessionCache) updateIdleCountdownDisplay();
    if (selectedSessionMode === 'custom') {
      pushSettings({ sessionCustomMin: mins });
    }
  };
  el.addEventListener('change', handler);
  el.addEventListener('input', () => {
    if (!activeSessionCache && selectedSessionMode === 'custom') updateIdleCountdownDisplay();
  });
}
onCustomMinChange($('session-custom-min'));

if ($('session-start-btn')) {
  $('session-start-btn').addEventListener('click', () => startFocusSession());
}
if ($('session-stop-btn')) {
  $('session-stop-btn').addEventListener('click', () => stopFocusSession());
}
if ($('session-day-select')) {
  $('session-day-select').addEventListener('change', () => {
    sessionLogDay = $('session-day-select').value;
    refreshSessionLog(sessionLogDay);
  });
}
if ($('session-history-toggle')) {
  $('session-history-toggle').addEventListener('change', async () => {
    const on = !!$('session-history-toggle').checked;
    await pushSettings({ sessionHistoryEnabled: on });
    refreshSessionLog();
  });
}

bindSessionLogListClicks();
setSelectedSessionMode('pomodoro', { silent: true });
updateIdleCountdownDisplay();


async function boot() {
  if (!api) return;
  try {
    const state = await api.getState();
    if (state) {
      currentPlatform = state.platform || null;
      if (state.profileShortcutRegistered === false && $('profile-shortcut-status')) {
        $('profile-shortcut-status').textContent = 'This shortcut is unavailable on this computer. Choose another.';
        $('profile-shortcut-status').classList.remove('hidden');
      }
      if (state.windowShortcutRegistered === false && $('window-shortcut-status')) {
        $('window-shortcut-status').textContent = 'This shortcut is unavailable on this computer. Choose another.';
        $('window-shortcut-status').classList.remove('hidden');
      }
      if ($('launch-startup-row')) {
        $('launch-startup-row').classList.toggle('hidden', state.platform !== 'win32' && state.platform !== 'darwin');
      }
      if ($('onboarding-startup')) {
        $('onboarding-startup').closest('label').classList.toggle('hidden', state.platform !== 'win32' && state.platform !== 'darwin');
      }
      if (state.stats && state.stats.settings && state.stats.settings.onboardingComplete === false) {
        $('onboarding-screen').classList.remove('hidden');
        document.querySelector('.shell').inert = true;
        $('onboarding-start').focus();
      }
      updateSourcePill(state.now);
      renderLastFocused(state.lastFocused, state.now);
      setLiveStats(state.stats, state.now);
      renderStats(state.stats);
      paintLivePie();
      if (typeof noteWellbeingPayload === 'function') noteWellbeingPayload(state);
      if (state.session) renderActiveSession(state.session);
      else if (api.getActiveSession) {
        const s = await api.getActiveSession().catch(() => null);
        renderActiveSession(s);
      }
    }
  } catch (_) {}
  await loadRulesAndIgnore();
  refreshSessionLog();
  api.onUpdate((payload) => {
    updateSourcePill(payload.now);
    renderLastFocused(payload.lastFocused, payload.now);
    setLiveStats(payload.stats, payload.now);
    renderStats(payload.stats);
    if (!liveTotalsClock.isTracking()) paintLivePie();
    if (typeof noteWellbeingPayload === 'function') noteWellbeingPayload(payload);
    if (payload.session !== undefined) {
      renderActiveSession(payload.session);
    }
    if (payload.sessionCompleted) {
      refreshSessionLog();
    }
  });
  api.onReminder((payload) => {
    showBanner(payload.body || 'Time to refocus.');
  });
}

boot();
if ($('onboarding-start')) {
  $('onboarding-start').addEventListener('click', async () => {
    if (!api) return;
    const button = $('onboarding-start');
    const error = $('onboarding-error');
    const choice = document.querySelector('input[name="onboarding-profile"]:checked');
    button.disabled = true;
    error.classList.add('hidden');
    try {
      await api.activateProfile(choice ? choice.value : 'default');
      const next = await api.updateSettings({
        onboardingComplete: true,
        trackingPaused: false,
        launchAtStartup: $('onboarding-startup').checked,
        pollMs: 3000
      });
      applySettingsInputs(next);
      await loadRulesAndIgnore();
      if (window.sydtrackProfilesUI) await window.sydtrackProfilesUI.reload();
      $('onboarding-screen').classList.add('hidden');
      document.querySelector('.shell').inert = false;
      document.querySelector('.nav-btn[data-tab="home"]').focus();
    } catch (err) {
      error.textContent = 'Could not start tracking. ' + (err && err.message ? err.message : 'Please try again.');
      error.classList.remove('hidden');
    } finally {
      button.disabled = false;
    }
  });
}

const liveTotalsTicker = createLiveTicker({
  interval: 1000,
  now: () => Date.now(),
  schedule: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
  onTick: () => renderLiveTotals()
});
liveTotalsTicker.start();

const focusBoostBtn = $('focusboost-btn');
if (focusBoostBtn) {
  focusBoostBtn.addEventListener('click', toggleFocusBoost);
}

async function quickClassifyLastFocused(category) {
  return window.sydtrackQuickUI?.classify(category);
}

if ($('lf-prod')) {
  $('lf-prod').addEventListener('click', () => quickClassifyLastFocused('productive'));
}
if ($('lf-unprod')) {
  $('lf-unprod').addEventListener('click', () => quickClassifyLastFocused('unproductive'));
}
if ($('lf-other')) {
  $('lf-other').addEventListener('click', () => quickClassifyLastFocused('other'));
}
if ($('lf-ignore')) {
  $('lf-ignore').addEventListener('click', () => ignoreLastFocused());
}

async function ignoreLastFocused() {
  return window.sydtrackQuickUI?.classify('ignored');
}

const pieEl = $('pie-chart');
if (pieEl) {
  pieEl.addEventListener('mousemove', showPieTip);
  pieEl.addEventListener('mouseleave', hidePieTip);
  const openTodayApps = () => {
    hidePieTip();
    setAppsRange('day');
    analyticsSegment = 'apps';
    document.querySelector('.nav-btn[data-tab="analytics"]').click();
    document.querySelector('.main').scrollTop = 0;
    document.querySelector('.analytics-apps-tab')?.focus({ preventScroll: true });
  };
  pieEl.addEventListener('dblclick', event => {
    if (pieHoverState.total <= 0) return;
    const rect = pieEl.getBoundingClientRect();
    const distance = Math.hypot(event.clientX - rect.left - rect.width / 2,
      event.clientY - rect.top - rect.height / 2);
    const radius = Math.min(rect.width, rect.height);
    if (distance < radius * 0.22 || distance > radius / 2) return;
    openTodayApps();
  });
  pieEl.addEventListener('keydown', event => {
    if (pieHoverState.total <= 0 || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    openTodayApps();
  });
}

const dayChartEl = $('day-chart');
if (dayChartEl) {
  dayChartEl.addEventListener('mousemove', showDayChartTip);
  dayChartEl.addEventListener('mouseleave', () => hideChartTip('day-tip'));
}
const weekChartEl = $('week-chart');
if (weekChartEl) {
  weekChartEl.addEventListener('mousemove', showWeekChartTip);
  weekChartEl.addEventListener('mouseleave', () => hideChartTip('week-tip'));
}

document.addEventListener('mousemove', (ev) => {
  if (ev.target && ev.target.closest && ev.target.closest('.app-trunc, .has-tip')) showNameTip(ev);
  else hideNameTip();
});

/** Re-check FocusBoost schedule on window enter/leave (transition-only). */
let focusBoostScheduleTick = null;
function startFocusBoostScheduleWatch() {
  if (focusBoostScheduleTick) return;
  focusBoostScheduleTick = window.setInterval(async () => {
    if (!api) return;
    try {
      const state = await api.getState();
      const settings = (state && state.stats && state.stats.settings) || {};
      await applyFocusBoostSchedule(settings);
      syncFocusBoostScheduleUi(settings);
    } catch (_) {}
  }, 20000);
}
startFocusBoostScheduleWatch();
