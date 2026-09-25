'use strict';

// Shared idle / media / presence decision for tracking, focus sessions, and reminders.
// Platform probes only supply facts. This module decides whether a sample counts.

function toleranceMs(pollMs) {
  return Math.max(5000, (Number(pollMs) || 3000) * 3);
}

/**
 * A backward clock or a gap larger than the poll tolerance means the process was
 * suspended, the clock jumped, or samples were missed. That interval is not tracked.
 */
function assessContinuity({ previousAt, now, toleranceMs: limit }) {
  const prev = Number(previousAt);
  const at = Number(now);
  if (!Number.isFinite(prev) || !Number.isFinite(at)) {
    return { gapMs: null, discontinuity: true, reason: 'clock' };
  }
  const gapMs = at - prev;
  const allowed = Number(limit);
  const discontinuity = gapMs < 0 || !Number.isFinite(allowed) || gapMs > allowed;
  return { gapMs, discontinuity, reason: discontinuity ? 'clock' : null };
}

function elapsedSeconds(startedAt, endedAt) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) return 0;
  return (endedAt - startedAt) / 1000;
}

function playbackOverride(input) {
  const media = input.media || {};
  if (media.status !== 'playing' || media.foreground !== true) return null;
  if (media.kind === 'music' && input.trackMusicWhileIdle === true) {
    return { kind: 'music', reason: 'media-music' };
  }
  if (media.kind === 'video' && input.trackVideoWhileIdle === true) {
    return { kind: 'video', reason: 'media-video' };
  }
  return null;
}

/**
 * Decide whether one foreground sample adds tracked time.
 *
 * Precedence:
 * 1. Clock discontinuity — drop the interval.
 * 2. Sleep or lock — never count, including media.
 * 3. Manual pause, ignored apps, and a missing window — do not count.
 * 4. Demo mode — count the foreground sample and ignore idle.
 * 5. Confirmed screen-off — do not count, except opted-in foreground music that is playing.
 * 6. Input still inside the idle timeout — count. Tags choose the category.
 * 7. Input idle:
 *    - paused, stopped, or unknown playback does not count
 *    - playback in a different app does not count
 *    - foreground music counts only when trackMusicWhileIdle is on
 *    - foreground video counts only when trackVideoWhileIdle is on
 *    - otherwise the sample is idle
 * Media never changes the category. Productive and unproductive tags already won.
 */
function decideSample(input) {
  const source = input || {};
  const elapsedSec = Math.max(0, Number(source.elapsedSec) || 0);
  const category = source.category || 'other';
  const withheld = { category, elapsedSec: 0, count: false, dropInterval: false, idle: false };

  if (source.discontinuity) {
    return { ...withheld, dropInterval: true, idle: true, reason: 'clock' };
  }
  if (source.systemAsleep) return { ...withheld, idle: true, reason: 'sleep' };
  if (source.systemLocked) return { ...withheld, idle: true, reason: 'lock' };
  if (source.paused) return { ...withheld, reason: 'paused' };
  if (!source.hasWindow) return { ...withheld, idle: true, reason: 'no-window' };
  if (source.ignored || category === 'ignored') return { ...withheld, reason: 'ignored' };
  if (source.demoMode) return { ...withheld, count: true, elapsedSec, reason: 'demo' };

  const timeout = Math.max(0, Number(source.idleTimeoutSec) || 0);
  const idleSec = Math.max(0, Number(source.idleSec) || 0);
  const inputIdle = timeout > 0 && idleSec >= timeout;
  const screenOff = source.screenOff === true;
  const playback = playbackOverride(source);

  if (screenOff) {
    if (playback && playback.kind === 'music') {
      return { ...withheld, count: true, elapsedSec, reason: playback.reason };
    }
    return { ...withheld, idle: true, reason: 'screen-off' };
  }
  if (!inputIdle) return { ...withheld, count: true, elapsedSec, reason: 'active' };
  if (playback) return { ...withheld, count: true, elapsedSec, reason: playback.reason };
  return { ...withheld, idle: true, reason: 'idle' };
}

module.exports = {
  toleranceMs,
  assessContinuity,
  elapsedSeconds,
  decideSample
};
