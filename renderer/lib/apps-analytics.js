'use strict';

// Pure presentation model shared by the renderer and its Node regression test.
(function (root) {
  function buildAppSlices(entries, limit = 6) {
    const grouped = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || entry.category === 'ignored') continue;
      const name = String(entry.name || '').trim();
      const seconds = Number(entry.seconds);
      if (!name || !Number.isFinite(seconds) || seconds <= 0) continue;
      const key = name.toLocaleLowerCase();
      if (!grouped.has(key)) grouped.set(key, { name, seconds: 0, byCategory: { productive: 0, unproductive: 0, other: 0 } });
      const app = grouped.get(key);
      app.seconds += seconds;
      if (Object.hasOwn(app.byCategory, entry.category)) app.byCategory[entry.category] += seconds;
    }
    const apps = [...grouped.values()].sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
    const total = apps.reduce((sum, app) => sum + app.seconds, 0);
    const shown = apps.slice(0, Math.max(1, Math.floor(limit)));
    const hidden = apps.slice(shown.length);
    const slices = shown.map(app => ({ ...app, remaining: false }));
    if (hidden.length) slices.push({ name: 'Remaining apps', seconds: hidden.reduce((sum, app) => sum + app.seconds, 0), remaining: true });
    return { total, slices, apps, appCount: apps.length };
  }

  function periodEntries(days, today) {
    const result = [];
    for (const day of Array.isArray(days) ? days : []) {
      if (!day) continue;
      const entries = today && day.date === today.date && Array.isArray(today.appBreakdown) ? today.appBreakdown : day.apps;
      if (Array.isArray(entries)) result.push(...entries);
    }
    return result;
  }

  function conicStops(slices, total) {
    if (!total || !slices.length) return '';
    let elapsed = 0;
    return slices.map((slice, index) => {
      const start = elapsed / total * 100;
      elapsed += slice.seconds;
      const end = index === slices.length - 1 ? 100 : elapsed / total * 100;
      return `var(--apps-slice-${Math.min(index + 1, 7)}) ${start.toFixed(3)}% ${end.toFixed(3)}%`;
    }).join(', ');
  }

  const api = { buildAppSlices, periodEntries, conicStops };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.sydtrackAppsAnalytics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
