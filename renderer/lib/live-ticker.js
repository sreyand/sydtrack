'use strict';

// Wall-clock Home totals ticker.
// Next fire is always origin + n * interval from Date.now() (or a now() hook).
// A late setTimeout shortens the next delay so slop does not accumulate.
// One callback paints at most once — never a burst of catch-up timeouts.

function createLiveTicker(options) {
  const interval = Number(options && options.interval) > 0 ? Number(options.interval) : 1000;
  const now = (options && options.now) || Date.now;
  const schedule = (options && options.schedule) || setTimeout;
  const clear = (options && options.clear) || clearTimeout;
  const onTick = options && options.onTick;
  if (typeof onTick !== 'function') throw new Error('createLiveTicker requires onTick');

  let origin = 0;
  let nextN = 0;
  let handle = null;
  let stopped = true;

  function targetOf(n) {
    return origin + n * interval;
  }

  function arm() {
    if (stopped) return;
    const delay = Math.max(0, targetOf(nextN) - now());
    handle = schedule(fire, delay);
  }

  function fire() {
    handle = null;
    if (stopped) return;
    const t = now();
    const intended = targetOf(nextN);
    onTick(intended);
    // Re-anchor n from wall time so a late callback does not schedule
    // lastFire+interval (that is the setInterval drift). Skip a backlog of
    // zero-delay timeouts after sleep; the display reads wall elapsed.
    const due = Math.max(nextN, Math.floor((t - origin) / interval));
    nextN = due + 1;
    arm();
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      origin = now();
      nextN = 1;
      arm();
    },
    stop() {
      stopped = true;
      if (handle != null) {
        clear(handle);
        handle = null;
      }
    },
    getNextAt() {
      return targetOf(nextN);
    },
    getOrigin() {
      return origin;
    }
  };
}

// Displayed Home totals follow wall elapsed from the first ingest, not
// tracker pollMs and not the number of timeout callbacks.
function createLiveTotalsClock(options) {
  const now = (options && options.now) || Date.now;
  let shownBase = { productive: 0, unproductive: 0, other: 0 };
  let origin = 0;
  let category = null;
  let primed = false;

  function extraAt(at) {
    if (!primed || (category !== 'productive' && category !== 'unproductive')) return 0;
    return Math.max(0, Math.floor((at - origin) / 1000));
  }

  function snapshot(at) {
    const when = at == null ? now() : at;
    const extra = extraAt(when);
    return {
      productive: shownBase.productive + (category === 'productive' ? extra : 0),
      unproductive: shownBase.unproductive + (category === 'unproductive' ? extra : 0),
      other: shownBase.other
    };
  }

  function ingest(byCategory, nextCategory) {
    const incoming = {
      productive: Number(byCategory && byCategory.productive) || 0,
      unproductive: Number(byCategory && byCategory.unproductive) || 0,
      other: Number(byCategory && byCategory.other) || 0
    };
    category =
      nextCategory === 'productive' || nextCategory === 'unproductive'
        ? nextCategory
        : null;
    const at = now();
    if (!primed) {
      shownBase = incoming;
      origin = at;
      primed = true;
      return snapshot(at);
    }
    const incomingSum = incoming.productive + incoming.unproductive + incoming.other;
    const shown = snapshot(at);
    const shownSum = shown.productive + shown.unproductive + shown.other;
    if (incomingSum + 5 < shownSum) {
      shownBase = incoming;
      origin = at;
      return snapshot(at);
    }
    const extra = extraAt(at);
    for (const key of ['productive', 'unproductive', 'other']) {
      const live = shownBase[key] + (category === key ? extra : 0);
      if (incoming[key] > live) {
        shownBase[key] = incoming[key];
        if (category === key) origin = at;
      }
    }
    return snapshot(at);
  }

  function isTracking() {
    return category === 'productive' || category === 'unproductive';
  }

  function currentCategory() {
    return category;
  }

  function getOrigin() {
    return origin;
  }

  return { ingest, snapshot, isTracking, currentCategory, getOrigin };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createLiveTicker, createLiveTotalsClock };
}
