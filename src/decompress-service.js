'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('./json-file');
const goals = require('../renderer/lib/goals');
const decompress = require('../renderer/lib/decompress');

function createDecompressService({ dataDir, getSettings, getHourlyHistory, now = () => Date.now() }) {
  const filePath = path.join(dataDir, 'decompress.json');
  let state = decompress.createBreakState('');
  let previous = null;
  let patternCache = { key: '', pattern: null };
  let lastPersisted = '';

  function load() {
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      state = decompress.cloneState(raw);
      lastPersisted = JSON.stringify(decompress.cloneState(state));
    } catch (err) {
      console.error('[decompress] read failed', err.message);
    }
  }

  function persist() {
    const serialized = JSON.stringify(decompress.cloneState(state));
    if (serialized === lastPersisted) return false;
    try {
      writeJson(filePath, decompress.cloneState(state));
      lastPersisted = serialized;
      return true;
    } catch (err) {
      console.error('[decompress] persist failed', err.message);
      return false;
    }
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
      pattern: due.state.date ? patternFor(due.state.date) : null
    };
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
    state = decompress.rollState(settled.state, todayKey(clock));
    const started = decompress.startBreak(state, {
      nowMs: clock,
      breaksPerDay: prefs.decompressBreaksPerDay,
      breakMinutes: prefs.decompressBreakMinutes
    });
    state = started.state;
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
    state = ended.state;
    persist();
    return { ended: ended.ended, publicState: publicState() };
  }

  function reset() {
    state = decompress.createBreakState('');
    previous = null;
    patternCache = { key: '', pattern: null };
    lastPersisted = '';
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    return { publicState: publicState() };
  }

  load();
  return { observe, startBreak, endBreak, reset, publicState, filePath };
}

module.exports = { createDecompressService };
