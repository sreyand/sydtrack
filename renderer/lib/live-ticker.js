'use strict';

// Wall-clock Home totals ticker.
// The clock is Date.now() / performance.now() / a now() hook — never rAF.
// Each displayed second is one tick. The next fire is scheduled from the
// intended deadline so a late callback does not pile up lag.

function createLiveTicker(options) {
  const interval = Number(options && options.interval) > 0 ? Number(options.interval) : 1000;
  const now = (options && options.now) || Date.now;
  const schedule = (options && options.schedule) || setTimeout;
  const clear = (options && options.clear) || clearTimeout;
  const onTick = options && options.onTick;
  const maxCatchUp = Number(options && options.maxCatchUp) > 0 ? Number(options.maxCatchUp) : 3;
  if (typeof onTick !== 'function') throw new Error('createLiveTicker requires onTick');

  let nextAt = 0;
  let handle = null;
  let stopped = true;

  function arm() {
    if (stopped) return;
    const delay = Math.max(0, nextAt - now());
    handle = schedule(fire, delay);
  }

  function fire() {
    handle = null;
    if (stopped) return;
    const t = now();
    let ticks = 0;
    while (t + 0.0001 >= nextAt && ticks < maxCatchUp) {
      onTick(nextAt);
      nextAt += interval;
      ticks += 1;
    }
    if (t >= nextAt) {
      // Too far behind (sleep / background): drop the backlog and
      // realign to one interval from now so lag cannot pile up.
      nextAt = t + interval;
      onTick(t);
    }
    arm();
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      nextAt = now() + interval;
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
      return nextAt;
    }
  };
}

// Displayed Home totals. Tracker samples ingest a baseline; only tick()
// advances a displayed second, so paint cadence is independent of pollMs.
function createLiveTotalsClock() {
  let shown = { productive: 0, unproductive: 0, other: 0 };
  let category = null;
  let primed = false;

  function snapshot() {
    return {
      productive: shown.productive,
      unproductive: shown.unproductive,
      other: shown.other
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
    if (!primed) {
      shown = incoming;
      primed = true;
      return snapshot();
    }
    const incomingSum = incoming.productive + incoming.unproductive + incoming.other;
    const shownSum = shown.productive + shown.unproductive + shown.other;
    if (incomingSum + 5 < shownSum) {
      shown = incoming;
      return snapshot();
    }
    for (const key of ['productive', 'unproductive', 'other']) {
      shown[key] = Math.max(shown[key], incoming[key]);
    }
    return snapshot();
  }

  function tick() {
    if (category === 'productive' || category === 'unproductive') {
      shown[category] += 1;
    }
    return snapshot();
  }

  function isTracking() {
    return category === 'productive' || category === 'unproductive';
  }

  function currentCategory() {
    return category;
  }

  return { ingest, tick, snapshot, isTracking, currentCategory };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createLiveTicker, createLiveTotalsClock };
}
