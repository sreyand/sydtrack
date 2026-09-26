'use strict';

(function (root) {
  const KINDS = new Set(['productive', 'unproductive', 'other', 'idle']);

  function rowsForDate(date) {
    const [y, m, d] = date.split('-').map(Number);
    return [0, 6, 12, 18].map(hour => ({
      label: String(hour).padStart(2, '0') + ':00–' + String(hour + 6).padStart(2, '0') + ':00',
      start: new Date(y, m - 1, d, hour).getTime(),
      end: new Date(y, m - 1, d, hour + 6).getTime()
    }));
  }

  function longestProductiveBlock(segments) {
    let best = null;
    let current = null;
    for (const segment of segments) {
      if (segment.kind !== 'productive') {
        current = null;
        continue;
      }
      if (current && segment.start <= current.end) current.end = Math.max(current.end, segment.end);
      else current = { start: segment.start, end: segment.end };
      if (!best || current.end - current.start > best.end - best.start) best = { ...current };
    }
    return best;
  }

  function model(day, category = 'all', profile = 'all') {
    const rows = rowsForDate(day.date);
    const segments = (Array.isArray(day.timeline) ? day.timeline : [])
      .filter(s => s && KINDS.has(s.kind) && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
      .sort((a, b) => a.start - b.start);
    const visible = segments.filter(s =>
      (category === 'all' || s.kind === category) &&
      (profile === 'all' || (s.kind !== 'idle' && s.profileId === profile)));
    const pieces = rows.map(row => visible.flatMap(segment => {
      const start = Math.max(row.start, segment.start);
      const end = Math.min(row.end, segment.end);
      return end > start ? [{ kind: segment.kind, profileId: segment.profileId || null,
        start, end, left: (start - row.start) / (row.end - row.start) * 100,
        width: (end - start) / (row.end - row.start) * 100 }] : [];
    }));
    const total = (day.byHour || []).reduce((sum, hour) => sum +
      ['productive', 'unproductive', 'other'].reduce((n, kind) => n + (Number(hour && hour[kind]) || 0), 0), 0);
    const dailyTotal = ['productive', 'unproductive', 'other'].reduce((sum, kind) =>
      sum + (Number(day.byCategory && day.byCategory[kind]) || 0), 0);
    const recorded = segments.filter(s => s.kind !== 'idle').reduce((sum, s) => sum + (s.end - s.start) / 1000, 0);
    return { rows, segments, visible, pieces, total, recorded,
      longestProductive: longestProductiveBlock(visible),
      precision: segments.length ? (Math.max(total, dailyTotal) - recorded > 30 ? 'partial' : 'segments')
        : total ? 'hourly' : dailyTotal ? 'daily' : 'empty' };
  }

  const api = { model, rowsForDate, longestProductiveBlock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.sydtrackDayTimeline = api;
})(typeof window === 'undefined' ? globalThis : window);
