'use strict';

// Weekly comparison and per-app drill-down.
// Sentences report measured totals only. They do not assign a cause.

(function (root) {
  const goals = typeof module !== 'undefined' && module.exports
    ? require('./goals')
    : root.sydtrackGoals;

  function appNameFromStorageKey(key) {
    const text = String(key || '');
    if (text.startsWith('@activity:')) {
      try {
        const value = JSON.parse(text.slice(10));
        if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
      } catch (_) {}
    }
    const marker = text.lastIndexOf('::');
    if (marker < 0) return text;
    const suffix = text.slice(marker + 2);
    return suffix === 'productive' || suffix === 'unproductive' ? text.slice(0, marker) : text;
  }

  function addApp(map, app) {
    if (!app || app.category === 'ignored') return;
    const name = String(app.name || '');
    if (!name) return;
    const seconds = Math.max(0, Number(app.seconds) || 0);
    if (!seconds) return;
    const category = app.category === 'productive' || app.category === 'unproductive' ? app.category : 'other';
    const id = name + '\u0000' + category;
    const current = map.get(id) || { name, category, seconds: 0 };
    current.seconds += seconds;
    map.set(id, current);
  }

  function sumDays(days) {
    const totals = { productive: 0, unproductive: 0, other: 0 };
    const apps = new Map();
    for (const day of days || []) {
      const t = goals.totals(day && day.byCategory);
      totals.productive += t.productive;
      totals.unproductive += t.unproductive;
      totals.other += t.other;
      const list = (day && (day.apps || day.topApps)) || [];
      for (const app of list) addApp(apps, app);
    }
    return { totals, apps: Array.from(apps.values()) };
  }

  function topApp(apps, category) {
    return (apps || [])
      .filter((app) => app.category === category)
      .sort((a, b) => b.seconds - a.seconds)[0] || null;
  }

  function compareWeeks(days, options) {
    const opts = options || {};
    const list = Array.isArray(days) ? days.slice() : [];
    const current = list.slice(-7);
    const previous = list.length > 7 ? list.slice(-14, -7) : [];
    const thisSum = sumDays(current);
    const lastSum = sumDays(previous);
    const thisFocus = goals.focusShareStatus(thisSum.totals, opts);
    const lastFocus = goals.focusShareStatus(lastSum.totals, opts);
    const comparable = !thisFocus.thin && !lastFocus.thin && thisFocus.percent != null && lastFocus.percent != null;
    const deltaPoints = comparable ? thisFocus.percent - lastFocus.percent : null;
    const thisTracked = goals.activeTrackedSec(thisSum.totals);
    const lastTracked = goals.activeTrackedSec(lastSum.totals);
    const thisDistraction = topApp(thisSum.apps, 'unproductive');
    const thisFocusApp = topApp(thisSum.apps, 'productive');
    return {
      thisFocus,
      lastFocus,
      deltaPoints,
      comparable,
      thisTracked,
      lastTracked,
      trackedDeltaSec: previous.length ? thisTracked - lastTracked : null,
      thisDistraction,
      thisFocusApp,
      definition: goals.focusDefinition(opts.includeOther),
      sentences: weekSentences({
        thisFocus,
        lastFocus,
        deltaPoints,
        comparable,
        thisTracked,
        lastTracked,
        hasPrevious: previous.length > 0,
        thisDistraction,
        definition: goals.focusDefinition(opts.includeOther)
      })
    };
  }

  function weekSentences(info) {
    const lines = [];
    if (!info.thisFocus || info.thisFocus.percent == null || info.thisFocus.thin) {
      lines.push('Not enough activity to compare yet.');
      return lines;
    }
    if (!info.hasPrevious || !info.comparable) {
      lines.push(info.thisFocus.percent + '% focus this week. Not enough activity last week to compare.');
    } else if (info.deltaPoints === 0) {
      lines.push('Unchanged from last week at ' + info.thisFocus.percent + '%.');
    } else {
      const direction = info.deltaPoints > 0 ? 'Up' : 'Down';
      lines.push(
        direction + ' ' +
        Math.abs(info.deltaPoints) + ' point' + (Math.abs(info.deltaPoints) === 1 ? '' : 's') +
        ' from last week.'
      );
    }
    if (info.thisDistraction) {
      lines.push(info.thisDistraction.name + ' took the most unproductive time.');
    }
    return lines;
  }

  function namesMatch(a, b) {
    return String(a || '').toLowerCase() === String(b || '').toLowerCase();
  }

  function appDrilldown(byHour, appName) {
    const name = String(appName || '');
    const hours = [];
    let total = 0;
    const categories = { productive: 0, unproductive: 0, other: 0 };
    const source = Array.isArray(byHour) ? byHour : [];
    for (let hour = 0; hour < 24; hour += 1) {
      const bucket = source[hour] || {};
      const byApp = bucket.byApp && typeof bucket.byApp === 'object' ? bucket.byApp : {};
      let seconds = 0;
      for (const [key, info] of Object.entries(byApp)) {
        if (!namesMatch(appNameFromStorageKey(key), name)) continue;
        if (info && info.category === 'ignored') continue;
        const sec = Math.max(0, Number(info && info.seconds) || 0);
        if (!sec) continue;
        seconds += sec;
        const category = info && (info.category === 'productive' || info.category === 'unproductive')
          ? info.category
          : 'other';
        categories[category] += sec;
      }
      if (seconds > 0) hours.push({ hour, seconds });
      total += seconds;
    }
    return { name, total, hours, categories };
  }

  function appShare(totalSec, activeSec) {
    const active = Math.max(0, Number(activeSec) || 0);
    const total = Math.max(0, Number(totalSec) || 0);
    if (!active) return null;
    return Math.min(1, total / active);
  }

  const api = {
    appNameFromStorageKey,
    namesMatch,
    sumDays,
    compareWeeks,
    appDrilldown,
    appShare
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.sydtrackInsights = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
