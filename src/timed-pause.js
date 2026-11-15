'use strict';

const { validDateKey } = require('./json-file');
const { todayKey } = require('./store');

const RECHECK_MS = 60 * 1000;

function pauseForMinutes(minutes, now = Date.now()) {
  if (![15, 30, 60].includes(minutes)) throw new Error('Pause duration must be 15, 30, or 60 minutes.');
  return { trackingPaused: true, trackingPauseUntil: now + minutes * 60 * 1000 };
}

function pauseFor15Minutes(now = Date.now()) {
  return pauseForMinutes(15, now);
}

function createTimedPause({ getSettings, onExpire, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;

  function sync() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    const settings = getSettings();
    if (!settings || settings.trackingPaused !== true || settings.onboardingComplete === false) return;
    const until = settings.trackingPauseUntil ?? 0;
    const at = now();
    let remaining;
    if (until > 0) {
      remaining = until - at;
    } else if (until === 0 && settings.resumeTrackingNextDay === true && validDateKey(settings.trackingPauseDate)) {
      // Compare local dates, not elapsed hours, so DST and sleep don't extend the pause.
      const nextMidnight = new Date(at);
      nextMidnight.setHours(24, 0, 0, 0);
      remaining = todayKey(at) > settings.trackingPauseDate ? 0 : nextMidnight.getTime() - at;
    } else return;
    if (remaining <= 0) {
      if (onExpire() !== false) return;
      remaining = RECHECK_MS; // A failed settings write must not unpause or spin.
    }
    timer = setTimer(sync, Math.min(remaining, RECHECK_MS));
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function dispose() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  return { sync, dispose };
}

module.exports = { pauseForMinutes, pauseFor15Minutes, createTimedPause };
