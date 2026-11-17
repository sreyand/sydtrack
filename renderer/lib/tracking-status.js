'use strict';

// Presentation only: this model never probes a window or exposes its title.
(function (root) {
  function nextDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    date.setDate(date.getDate() + 1);
    return date;
  }

  function describe(now, settings, at = Date.now()) {
    const prefs = settings || {};
    const sample = now || {};
    const successfulAt = sample.lastSuccessfulSampleAt;
    const lastSuccessfulSampleAt = typeof successfulAt === 'number' && Number.isFinite(successfulAt) &&
      successfulAt > 0 && successfulAt <= at ? successfulAt : null;
    const status = (key, label, tone, description, action = null) => ({
      key, label, tone, heading: label, description, lastSuccessfulSampleAt, action
    });
    const settingsAction = { kind: 'settings', label: 'Tracking settings' };
    if (prefs.onboardingComplete === false) {
      return status('onboarding', 'Ready to start', 'idle', 'Finish setup to start tracking.', settingsAction);
    }
    if (prefs.trackingPaused) {
      const until = Number(prefs.trackingPauseUntil) || 0;
      let description = 'Tracking is paused until you resume it.';
      if (until > 0) {
        description = until > at
          ? 'Tracking will resume at ' + new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.'
          : 'The pause has ended. Waiting for tracking to resume.';
      } else if (prefs.resumeTrackingNextDay === true) {
        const next = nextDate(prefs.trackingPauseDate);
        if (next) {
          description = next.getTime() > at
            ? 'Tracking will resume at the start of ' + next.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) + '.'
            : 'A new day has started. Waiting for tracking to resume.';
        }
      }
      return status('paused', 'Paused', 'paused', description, { kind: 'resume', label: 'Resume tracking' });
    }
    const reason = sample.idleReason;
    if (sample.trackingError || reason === 'unavailable' || sample.source === 'unavailable') {
      return status('unavailable', 'Tracking unavailable', 'unavailable',
        'The active app could not be read. Tracking retries automatically; time is not recorded while it is unavailable.', settingsAction);
    }
    if (reason === 'sleep') return status('sleep', 'Sleeping', 'idle', 'No time is recorded while your computer is asleep.');
    if (reason === 'lock') return status('lock', 'Screen locked', 'idle', 'Tracking resumes when you unlock your computer.');
    if (sample.source === 'paused') {
      return status('waiting', 'Waiting', 'idle', 'Waiting for the next tracking update.');
    }
    if ((sample.source === 'demo' && !prefs.demoMode) || (sample.source === 'real' && prefs.demoMode)) {
      return status('waiting', 'Waiting', 'idle', 'Waiting for the next tracking update.');
    }
    if (sample.ignored || sample.category === 'ignored') {
      return status('ignored', 'Ignored app', 'idle', 'The current app is ignored. No time is being recorded for it.');
    }
    if (reason === 'screen-off') return status('screen-off', 'Screen off', 'idle', 'Tracking resumes when your screen is on and you return.');
    if (reason === 'stopped') return status('stopped', 'Tracking stopped', 'idle', 'Tracking is stopped.', settingsAction);
    if (reason === 'clock') return status('waiting', 'Waiting', 'idle', 'Waiting for a fresh reading after a change to the system clock.');
    if (reason === 'no-window') {
      return status('no-window', 'No active window', 'idle', 'Switch to an app to start tracking.');
    }
    if (sample.idle || sample.source === 'idle') {
      return reason === 'idle'
        ? status('idle', 'Idle', 'idle', 'No time is being recorded while you are away. Tracking resumes when you return.')
        : status('waiting', 'Waiting', 'idle', 'Waiting for an active app.');
    }
    if (!sample.app || sample.app === '—') return status('waiting', 'Waiting', 'idle', 'Waiting for an active app.');
    if (sample.source === 'demo' && prefs.demoMode) {
      return status('demo', 'Demo mode', 'demo', 'Showing simulated activity. Your real app activity is not being tracked.', settingsAction);
    }
    if (sample.source === 'real') {
      return status('live', 'Live tracking', 'real', 'Your active app is being tracked.');
    }
    return status('waiting', 'Waiting', 'idle', 'Waiting for an active app.');
  }

  const api = { describe };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.sydtrackTrackingStatus = api;
})(typeof window !== 'undefined' ? window : globalThis);
