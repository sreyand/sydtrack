'use strict';

const CATEGORY_LABELS = Object.freeze({
  productive: 'Productive',
  unproductive: 'Unproductive',
  other: 'Other'
});
const INACTIVE_LABELS = Object.freeze({
  waiting: 'Waiting for activity',
  unavailable: 'Tracking unavailable',
  stopped: 'Tracking stopped',
  sleep: 'Sleeping',
  lock: 'Screen locked',
  'screen-off': 'Screen off',
  'no-window': 'No active window',
  clock: 'Waiting for activity'
});

function inactive(reason) {
  return { icon: 'standard', label: Object.hasOwn(INACTIVE_LABELS, reason) ? INACTIVE_LABELS[reason] : 'Idle' };
}

// Never infer current activity from lastFocused: that context intentionally
// survives pauses and ignored windows. Colors describe a fresh tracking decision.
function resolveTrayState(settings, payload, pendingReason) {
  const prefs = settings || {};
  if (prefs.onboardingComplete === false) return { icon: 'standard', label: 'Ready to start' };
  if (prefs.trackingPaused) return { icon: 'standard', label: 'Paused' };
  if (pendingReason) return inactive(pendingReason);
  const now = payload && payload.now;
  if (!now) return inactive('waiting');
  if (now.trackingError) return inactive('unavailable');
  if (now.idleReason === 'sleep' || now.idleReason === 'lock') return inactive(now.idleReason);
  if (now.ignored || now.category === 'ignored') return { icon: 'standard', label: 'Ignored app' };
  if (now.source === 'paused') return inactive('waiting');
  if (now.idle || now.source === 'idle') return inactive(now.idleReason);
  if (now.source !== 'real' && now.source !== 'demo') return inactive('waiting');
  if ((now.source === 'demo') !== !!prefs.demoMode) return inactive('waiting');
  if (!now.app || now.app === '—') return inactive('waiting');
  if (!Object.hasOwn(CATEGORY_LABELS, now.category)) return inactive('waiting');
  const label = CATEGORY_LABELS[now.category];
  return { icon: now.category, label: now.source === 'demo' ? 'Demo: ' + label : label };
}

module.exports = { resolveTrayState };
