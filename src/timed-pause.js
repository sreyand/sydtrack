'use strict';

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
    const until = Number(settings && settings.trackingPauseUntil) || 0;
    if (!settings || !settings.trackingPaused || until <= 0) return;
    const remaining = until - now();
    if (remaining <= 0) {
      onExpire();
      return;
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
