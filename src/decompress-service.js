'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('./json-file');
const goals = require('../renderer/lib/goals');
const decompress = require('../renderer/lib/decompress');

const SESSION_KEEP = 40;

function sanitizeSession(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const startedAtMs = Number(entry.startedAtMs) || 0;
  const durationSec = Math.max(1, Math.round(Number(entry.durationSec) || 0));
  if (startedAtMs <= 0 || durationSec <= 0) return null;
  const endedAtMs = Number(entry.endedAtMs) || 0;
  const status = entry.status === 'done' || entry.status === 'ended' || entry.status === 'open'
    ? entry.status
    : (endedAtMs > 0 ? 'ended' : 'open');
  return {
    id: String(entry.id || startedAtMs),
    date: String(entry.date || ''),
    startedAtMs,
    durationSec,
    endedAtMs: endedAtMs > 0 ? endedAtMs : null,
    status
  };
}

function sanitizeSessions(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const next = sanitizeSession(item);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next);
  }
  return out.slice(-SESSION_KEEP);
}

function sessionFromActive(state) {
  if (!state || !state.active) return null;
  return sanitizeSession({
    id: String(state.active.startedAtMs),
    date: state.date || '',
    startedAtMs: state.active.startedAtMs,
    durationSec: state.active.durationSec,
    status: 'open'
  });
}

function createDecompressService({ dataDir, getSettings, getHourlyHistory, now = () => Date.now() }) {
  const filePath = path.join(dataDir, 'decompress.json');
  let state = decompress.createBreakState('');
  let sessions = [];
  let previous = null;
  let patternCache = { key: '', pattern: null };
  let lastPersisted = '';

  function load() {
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      state = decompress.cloneState(raw);
      sessions = sanitizeSessions(raw.sessions);
      const open = sessionFromActive(state);
      const missingOpen = !!(open && !sessions.some((item) => item.id === open.id && item.status === 'open'));
      if (missingOpen) sessions = sanitizeSessions(sessions.concat([open]));
      lastPersisted = durableKey(state);
      if (missingOpen) persist(true);
    } catch (err) {
      console.error('[decompress] read failed', err.message);
    }
  }

  function durableKey(next) {
    const cloned = decompress.cloneState(next);
    return JSON.stringify({
      date: cloned.date,
      breaksUsed: cloned.breaksUsed,
      active: cloned.active,
      suggested: cloned.suggested,
      sessions: sessions.map((item) => [item.id, item.status, item.endedAtMs])
    });
  }

  function persist(force) {
    const serialized = durableKey(state);
    if (!force && serialized === lastPersisted) return false;
    try {
      writeJson(filePath, Object.assign(decompress.cloneState(state), { sessions: sessions.slice() }));
      lastPersisted = serialized;
      return true;
    } catch (err) {
      console.error('[decompress] persist failed', err.message);
      return false;
    }
  }

  function closeOpenSession(endedAtMs, status) {
    for (let i = sessions.length - 1; i >= 0; i -= 1) {
      if (sessions[i].status !== 'open') continue;
      sessions[i] = Object.assign({}, sessions[i], {
        endedAtMs: Number(endedAtMs) || null,
        status: status === 'done' ? 'done' : 'ended'
      });
      return;
    }
  }

  function recordStarted(nextState) {
    const open = sessionFromActive(nextState);
    if (!open) return;
    sessions = sanitizeSessions(sessions.filter((item) => item.id !== open.id).concat([open]));
  }

  function flush() {
    return persist(true);
  }

  function settings() {
    return goals.sanitizeGoalSettings((getSettings && getSettings()) || {});
  }

  function todayKey(at) {
    const d = new Date(at);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function patternFor(date) {
    const prefs = settings();
    const hour = new Date(now()).getHours();
    const key = date + ':' + hour + ':' + (prefs.focusShareIncludeOther ? '1' : '0');
    if (patternCache.key === key) return patternCache.pattern;
    let days = [];
    try {
      days = (getHourlyHistory && getHourlyHistory(14)) || [];
    } catch (err) {
      console.error('[decompress] history failed', err.message);
    }
    const pattern = decompress.suggestDecompressHour(days, {
      includeOther: prefs.focusShareIncludeOther,
      nowHour: hour,
      excludeDate: date
    });
    patternCache = { key, pattern };
    return pattern;
  }

  function publicState() {
    const prefs = settings();
    const due = decompress.completeBreakIfDue(state, now());
    const active = due.completed || !due.state.active
      ? null
      : {
          startedAtMs: due.state.active.startedAtMs,
          durationSec: due.state.active.durationSec,
          remainingSec: due.remainingSec
        };
    return {
      date: due.state.date,
      breaksUsed: due.state.breaksUsed,
      breaksPerDay: prefs.decompressBreaksPerDay,
      breakMinutes: prefs.decompressBreakMinutes,
      active,
      onTrackSec: decompress.onTrackSec(due.state.stretch, prefs.focusShareIncludeOther, prefs.focusShareGoalPct),
      onTrackGoalSec: decompress.ON_TRACK_SEC,
      suggested: due.state.suggested,
      pattern: due.state.date ? patternFor(due.state.date) : null,
      sessions: publicSessions(due)
    };
  }

  function publicSessions(due) {
    const list = sessions.map((item) => Object.assign({}, item));
    if (due && due.completed) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].status !== 'open') continue;
        list[i].status = 'done';
        list[i].endedAtMs = now();
        break;
      }
    }
    return list.reverse();
  }

  function observe(stats) {
    const prefs = settings();
    const date = stats && stats.date ? String(stats.date) : '';
    const cats = goals.totals(stats && stats.byCategory);
    const current = { date, ...cats };
    let suggest = false;
    if (!previous || previous.date !== date) {
      state = decompress.rollState(state, date);
      previous = current;
    } else {
      const diff = decompress.trackedDeltas(previous, current);
      previous = current;
      if (!diff.correction) {
        for (const sample of diff.samples) {
          const applied = decompress.applyTrackedTime(state, sample, {
            includeOther: prefs.focusShareIncludeOther,
            goalPct: prefs.focusShareGoalPct,
            breaksPerDay: prefs.decompressBreaksPerDay
          });
          state = applied.state;
          suggest = suggest || applied.suggest;
        }
      }
    }
    const ended = decompress.completeBreakIfDue(state, now());
    if (ended.completed) closeOpenSession(now(), 'done');
    state = ended.state;
    persist();
    const pattern = suggest ? patternFor(date) : null;
    return {
      suggest,
      breakEnded: ended.completed,
      message: suggest
        ? decompress.suggestionMessage({
            breakMinutes: prefs.decompressBreakMinutes,
            breaksUsed: state.breaksUsed,
            breaksPerDay: prefs.decompressBreaksPerDay,
            pattern
          })
        : '',
      publicState: publicState()
    };
  }

  function startBreak() {
    const prefs = settings();
    const clock = now();
    const settled = decompress.completeBreakIfDue(state, clock);
    if (settled.completed) closeOpenSession(clock, 'done');
    state = decompress.rollState(settled.state, todayKey(clock));
    const started = decompress.startBreak(state, {
      nowMs: clock,
      breaksPerDay: prefs.decompressBreaksPerDay,
      breakMinutes: prefs.decompressBreakMinutes
    });
    state = started.state;
    if (started.started) recordStarted(state);
    persist();
    return {
      started: started.started,
      reason: started.reason,
      overBudget: started.overBudget,
      breakEnded: settled.completed,
      publicState: publicState()
    };
  }

  function endBreak() {
    const ended = decompress.endBreak(state);
    if (ended.ended) closeOpenSession(now(), 'ended');
    state = ended.state;
    persist();
    return { ended: ended.ended, publicState: publicState() };
  }

  function reset() {
    state = decompress.createBreakState('');
    sessions = [];
    previous = null;
    patternCache = { key: '', pattern: null };
    lastPersisted = '';
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    return { publicState: publicState() };
  }

  load();
  return { observe, startBreak, endBreak, reset, flush, publicState, filePath };
}

module.exports = { createDecompressService };
