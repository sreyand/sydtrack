'use strict';

// Sleep and lock overlap: waking must not resume tracking on the lock screen.
// Unknown idle state on resume keeps the previous lock bit instead of guessing.
function reduceSystemPresence(state, event, idleState) {
  const next = { sleeping: !!(state && state.sleeping), locked: !!(state && state.locked) };
  if (event === 'suspend') next.sleeping = true;
  if (event === 'resume') {
    next.sleeping = false;
    if (idleState === 'locked') next.locked = true;
    else if (idleState === 'active' || idleState === 'idle') next.locked = false;
  }
  if (event === 'lock-screen') next.locked = true;
  if (event === 'unlock-screen') next.locked = false;
  next.inactive = next.sleeping || next.locked;
  return next;
}

function readIdleState(powerMonitor) {
  try {
    return powerMonitor.getSystemIdleState(1);
  } catch (_) {
    return 'unknown';
  }
}

function bindTrackingLifecycle(powerMonitor, tracker) {
  let presence = reduceSystemPresence({ sleeping: false, locked: false }, 'resume', readIdleState(powerMonitor));
  const update = () => {
    if (typeof tracker.setSystemPresence === 'function') {
      tracker.setSystemPresence({ sleeping: presence.sleeping, locked: presence.locked });
    } else {
      tracker.setSystemInactive(presence.inactive);
    }
  };
  const apply = (event) => {
    const idleState = event === 'resume' ? readIdleState(powerMonitor) : undefined;
    presence = reduceSystemPresence(presence, event, idleState);
    update();
  };
  const handlers = {
    suspend: () => apply('suspend'),
    resume: () => apply('resume'),
    'lock-screen': () => apply('lock-screen'),
    'unlock-screen': () => apply('unlock-screen')
  };
  for (const [event, handler] of Object.entries(handlers)) powerMonitor.on(event, handler);
  update();
  return () => {
    for (const [event, handler] of Object.entries(handlers)) powerMonitor.removeListener(event, handler);
  };
}

module.exports = { bindTrackingLifecycle, reduceSystemPresence };
