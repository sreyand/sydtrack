'use strict';

const KINDS = new Set(['productive', 'unproductive', 'other', 'idle']);
const PROFILE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_SEGMENTS = 50000;

function dayBounds(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const [year, month, day] = date.split('-').map(Number);
  const start = new Date(year, month - 1, day).getTime();
  const end = new Date(year, month - 1, day + 1).getTime();
  const check = new Date(start);
  return check.getFullYear() === year && check.getMonth() === month - 1 && check.getDate() === day && end > start ? { start, end } : null;
}

function normalizeSegment(value, date) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !KINDS.has(value.kind)) return null;
  const bounds = dayBounds(date);
  const start = Number(value.start), end = Number(value.end);
  if (!bounds || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < bounds.start || end > bounds.end) return null;
  const profileId = value.kind === 'idle' ? null : PROFILE_ID.test(value.profileId || '') ? value.profileId : null;
  return { start, end, kind: value.kind, profileId };
}

function normalizeTimeline(value, date) {
  if (!Array.isArray(value)) return [];
  const sorted = value.slice(0, MAX_SEGMENTS).map(segment => normalizeSegment(segment, date)).filter(Boolean)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const segment of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.kind === segment.kind && last.profileId === segment.profileId && segment.start <= last.end) {
      last.end = Math.max(last.end, segment.end);
    } else merged.push(segment);
  }
  return merged;
}

function appendSegment(day, start, end, kind, profileId = null) {
  if (!day || !KINDS.has(kind)) return false;
  const segment = normalizeSegment({ start, end, kind, profileId }, day.date);
  if (!segment) return false;
  if (!Array.isArray(day.timeline)) day.timeline = [];
  const last = day.timeline[day.timeline.length - 1];
  if (last && last.kind === segment.kind && last.profileId === segment.profileId && segment.start <= last.end && segment.start >= last.start) {
    last.end = Math.max(last.end, segment.end);
    return true;
  }
  if (day.timeline.length >= MAX_SEGMENTS) return false;
  if (last && segment.start < last.start) {
    day.timeline = normalizeTimeline([...day.timeline, segment], day.date);
  } else day.timeline.push(segment);
  return true;
}

module.exports = { KINDS, MAX_SEGMENTS, dayBounds, normalizeTimeline, appendSegment };
