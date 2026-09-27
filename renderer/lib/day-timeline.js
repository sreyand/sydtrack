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

  function activityWindow(rows, segments) {
    const dayStart = rows[0].start;
    const dayEnd = rows[rows.length - 1].end;
    const activity = segments.filter(segment => segment.kind !== 'idle');
    const visible = activity.length ? activity : segments;
    if (!visible.length) return { start: dayStart, end: dayEnd };
    const first = Math.max(dayStart, Math.min(...visible.map(segment => segment.start)));
    const last = Math.min(dayEnd, Math.max(...visible.map(segment => segment.end)));
    const hour = 60 * 60 * 1000;
    const desired = Math.min(dayEnd - dayStart, Math.max(3 * hour, last - first + hour));
    let start = Math.max(dayStart, Math.min(dayEnd - desired, (first + last - desired) / 2));
    let end = start + desired;
    const roundedStart = new Date(start);
    roundedStart.setMinutes(0, 0, 0);
    start = Math.max(dayStart, roundedStart.getTime());
    const roundedEnd = new Date(end);
    if (roundedEnd.getMinutes() || roundedEnd.getSeconds() || roundedEnd.getMilliseconds()) roundedEnd.setHours(roundedEnd.getHours() + 1, 0, 0, 0);
    end = Math.min(dayEnd, roundedEnd.getTime());
    return { start, end };
  }

  function zoomWindow(viewport, dayStart, dayEnd, scale, anchorFraction) {
    const daySpan = dayEnd - dayStart;
    const span = Math.min(daySpan, Math.max(15 * 60 * 1000, (viewport.end - viewport.start) * scale));
    const fraction = Math.max(0, Math.min(1, anchorFraction));
    const anchor = viewport.start + (viewport.end - viewport.start) * fraction;
    const start = Math.max(dayStart, Math.min(dayEnd - span, anchor - span * fraction));
    return { start, end: start + span };
  }

  function overviewBuckets(segments, start, end, dayStart, bucketMs) {
    const buckets = [];
    for (let boundary = dayStart + Math.floor((start - dayStart) / bucketMs) * bucketMs;
      boundary < end; boundary += bucketMs) {
      const from = Math.max(start, boundary);
      const to = Math.min(end, boundary + bucketMs);
      const durations = { productive: 0, unproductive: 0, other: 0, idle: 0, untracked: to - from };
      for (const segment of segments) {
        const overlap = Math.max(0, Math.min(to, segment.end) - Math.max(from, segment.start));
        if (overlap && Object.hasOwn(durations, segment.kind)) {
          durations[segment.kind] += overlap;
          durations.untracked -= overlap;
        }
      }
      durations.untracked = Math.max(0, durations.untracked);
      const ranked = Object.entries(durations).sort((a, b) => b[1] - a[1]);
      const tracked = ['productive', 'unproductive', 'other'].map(kind => durations[kind]);
      const trackedTotal = tracked.reduce((sum, ms) => sum + ms, 0);
      const kind = ranked[0][0] !== 'untracked' && ranked[0][0] !== 'idle' &&
        ranked[1][1] >= trackedTotal * 0.25 &&
        ranked[0][1] - ranked[1][1] <= trackedTotal * 0.15 &&
        ['productive', 'unproductive', 'other'].includes(ranked[1][0])
        ? 'mixed' : ranked[0][0];
      buckets.push({ start: from, end: to, kind, durations });
    }
    return buckets;
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

  const api = { model, rowsForDate, longestProductiveBlock, activityWindow, zoomWindow, overviewBuckets };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.sydtrackDayTimeline = api;
})(typeof window === 'undefined' ? globalThis : window);
