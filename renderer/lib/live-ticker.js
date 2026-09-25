'use strict';

// Wall-clock Home totals ticker. The clock is Date.now() / a now() hook,
// never requestAnimationFrame. Each displayed second is emitted; the next
// fire is scheduled from the intended deadline so lag does not pile up.

function createLiveTicker(options) {
  const interval = Number(options && options.interval) > 0 ? Number(options.interval) : 1000;
  const now = (options && options.now) || Date.now;
  const schedule = (options && options.schedule) || setTimeout;
  const clear = (options && options.clear) || clearTimeout;
  const onTick = options && options.onTick;
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
    while (t + 0.0001 >= nextAt && ticks < 3) {
      onTick(nextAt);
      nextAt += interval;
      ticks += 1;
    }
    if (t >= nextAt) {
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createLiveTicker };
}
