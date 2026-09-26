'use strict';

// Ephemeral continuous-use reminder. No title, app, or daily history is stored.
function createBreakReminder() {
  let activeSeconds = 0;
  let notified = false;

  function reset() {
    activeSeconds = 0;
    notified = false;
  }

  function update({ enabled, minutes, counted, elapsedSec }) {
    if (!enabled || !counted) { reset(); return false; }
    const elapsed = Number(elapsedSec);
    if (!Number.isFinite(elapsed) || elapsed <= 0) return false;
    activeSeconds += elapsed;
    const threshold = Math.max(10, Math.min(240, Number(minutes) || 60)) * 60;
    if (notified || activeSeconds < threshold) return false;
    notified = true;
    return true;
  }

  return { update, reset };
}

module.exports = { createBreakReminder };
