'use strict';

const { createDemoBackend } = require('./demo-windows');
const { classify, classifyWithReason, appLabel, isIgnored, isBrowserProcess } = require('./classifier');
const { decideSample, assessContinuity, toleranceMs } = require('./tracking-decision');
const { normalizeMediaReport } = require('./media-signal');

function createActiveWinBackend() {
  let impl = null;
  let failed = false;
  let lastError = null;

  async function load() {
    if (impl || failed) return impl;
    try {
      const mod = await import('active-win');
      impl = mod.default || mod;
      return impl;
    } catch (err) {
      lastError = err.message || String(err);
      console.warn('[tracker] active-win unavailable:', lastError);
      failed = true;
      return null;
    }
  }

  async function getActiveWindow() {
    const fn = await load();
    if (!fn) return { window: null, error: lastError || 'active-win not loaded' };
    try {
      const win = await fn({
        accessibilityPermission: false,
        screenRecordingPermission: false
      });
      return { window: win || null, error: null };
    } catch (err) {
      lastError = err.message || String(err);
      console.warn('[tracker] active-win getActiveWindow failed:', lastError);
      return { window: null, error: lastError };
    }
  }

  return { getActiveWindow };
}

function createRecoveringWindowsBackend(windows, createFallback = createActiveWinBackend, fallbackTimeoutMs = 4000) {
  let activeWin = null;
  let fallbackPending = null;

  async function getFallbackWindow() {
    if (!activeWin) activeWin = createFallback();
    if (!fallbackPending) {
      const pending = Promise.resolve().then(() => activeWin.getActiveWindow())
        .catch((err) => ({ window: null, error: err.message || String(err) }));
      fallbackPending = pending;
      pending.finally(() => { if (fallbackPending === pending) fallbackPending = null; });
    }
    let timeout;
    try {
      return await Promise.race([
        fallbackPending,
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve({ window: null, error: 'active-win timed out' }), fallbackTimeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async getActiveWindow() {
      let result;
      try {
        result = await windows.getActiveWindow();
      } catch (err) {
        result = { window: null, error: err.message || String(err) };
      }
      if (result && (result.window || !result.error)) return result;
      if (!result) result = { window: null, error: 'windows-backend returned no result' };
      console.warn('[tracker] windows-backend error, trying active-win for this sample:', result.error);
      const fallback = await getFallbackWindow();
      return fallback.window ? fallback : { window: null, error: `${result.error}; ${fallback.error || 'active-win found no foreground window'}` };
    }
  };
}

/**
 * win32: PowerShell/user32 windows-backend is PRIMARY.
 * active-win only on non-Windows, or if windows-backend fails to load / errors at runtime.
 * Never silently switch to demo when demoMode is false.
 */
function createRealBackend(options = {}) {
  if (process.platform === 'win32') {
    let windows = null;

    try {
      windows = require('./windows-backend').createWindowsBackend({ includeMedia: options.includeMedia });
    } catch (err) {
      console.warn(
        '[tracker] windows-backend load failed, falling back to active-win:',
        err.message || err
      );
      return createActiveWinBackend();
    }

    return createRecoveringWindowsBackend(windows);
  }

  return createActiveWinBackend();
}

/**
 * rulesHolder = { rules }; ignoreHolder = { ignore }
 * Mutable so IPC can hot-reload without restarting tracker.
 * Also accepts legacy `rules` / `ignore` plain values for smoke/tests.
 */
function createTracker({ store, rulesHolder, rules, ignoreHolder, ignore, sessionManager, onTick, onReminder, backend, now: clock = Date.now, readIdleTime }) {
  const breakReminder = require('./break-reminder').createBreakReminder();
  const rHolder = rulesHolder || { rules: rules };
  const iHolder = ignoreHolder || { ignore: ignore || [] };
  const real = backend || createRealBackend({
    includeMedia: () => {
      const settings = store.getSettings();
      return settings.trackMusicWhileIdle === true || settings.trackVideoWhileIdle === true;
    }
  });
  const demo = createDemoBackend();
  let timer = null;
  let pollInFlight = false;
  let generation = 0;
  let stopped = false;
  let sleeping = false;
  let locked = false;
  let pendingDiscontinuity = false;
  let lastTick = clock();
  let lastHeartbeat = lastTick;
  let idleTimelineEnd = null;
  let current = {
    window: null,
    app: '—',
    title: 'Waiting…',
    category: 'other',
    since: Date.now(),
    source: 'idle'
  };
  /** Last non-ignored, non-sydtrack window — survives while user looks at sydtrack. */
  let lastFocused = null;

  function resetStreakSafely() {
    try { if (store.resetStreak) store.resetStreak(); }
    catch (err) { console.error('[tracker] could not persist streak reset:', err.message); }
  }

  function checkContinuity() {
    const at = clock();
    const result = assessContinuity({
      previousAt: lastHeartbeat,
      now: at,
      toleranceMs: toleranceMs(store.getSettings().pollMs)
    });
    lastHeartbeat = at;
    if (result.discontinuity) {
      idleTimelineEnd = null;
      breakReminder.reset();
      pendingDiscontinuity = true;
      generation += 1;
      lastTick = at;
      current.since = at;
      resetStreakSafely();
    }
    return result;
  }

  async function pollOnce() {
    if (stopped) return;
    const pollGeneration = generation;
    const now = clock();
    const intervalStart = lastTick;
    let elapsed = Math.max(0, (now - intervalStart) / 1000);
    lastTick = now;

    let settings = store.getSettings();
    const startedPaused = !!settings.trackingPaused;
    const startedDemo = !!settings.demoMode;
    let win = null;
    let source = 'idle';
    let trackingError = null;
    let idleSec = 0;
    let sample = null;
    // A pause is a privacy boundary: do not even read the foreground title.
    const skipProbe = sleeping || locked || startedPaused;

    if (!skipProbe && settings.demoMode) {
      win = demo.getActiveWindow();
      source = 'demo';
      trackingError = null;
    } else if (!skipProbe) {
      // Real mode only — do not silently fall back to demo
      sample = await real.getActiveWindow();
      win = sample.window;
      if (sample.idleSec != null && sample.idleSec !== '' && Number.isFinite(Number(sample.idleSec))) {
        idleSec = Math.max(0, Number(sample.idleSec));
      } else if (typeof readIdleTime === 'function') {
        try {
          const reported = Number(readIdleTime());
          if (Number.isFinite(reported)) idleSec = Math.max(0, reported);
        } catch (_) {}
      }
      trackingError = sample.error || null;
      source = win ? 'real' : 'idle';
    }

    if (stopped) return;
    const continuity = checkContinuity();
    const discontinuous = continuity.discontinuity || pendingDiscontinuity;
    pendingDiscontinuity = false;
    if (pollGeneration !== generation && !discontinuous && !sleeping && !locked) return;
    settings = store.getSettings();
    if (!skipProbe && !!settings.demoMode !== startedDemo) return;
    if (startedPaused || discontinuous) elapsed = 0;
    const activity = win ? classifyWithReason(win, rHolder.rules) : null;
    const rowCorrection = win && store.getActivityCorrection ? store.getActivityCorrection(appLabel(win), activity) : null;
    const correction = rowCorrection || (win && store.getAppCorrection ? store.getAppCorrection(appLabel(win)) : null);
    const selfIgnored = win && isIgnored(win, [], {});
    const ignored = selfIgnored || (correction ? correction === 'ignored' : win ? isIgnored(win, iHolder.ignore || [], rHolder.rules && rHolder.rules.identities) : false);
    const idleTimeoutSec = Math.max(0, Number(settings.idleTimeoutSec) || 0);
    // Pause at the timeout. Never subtract accumulated idle time from earned history.
    // Show in Now viewing; do not log time or affect streaks when ignored
    const category = !win ? 'other' : ignored ? 'ignored' : correction || classify(win, rHolder.rules);
    const mediaEnabled = settings.trackMusicWhileIdle === true || settings.trackVideoWhileIdle === true;
    const media = !settings.demoMode && mediaEnabled ? normalizeMediaReport(sample && sample.media, win) : null;
    const decision = decideSample({
      elapsedSec: elapsed,
      idleSec,
      idleTimeoutSec,
      demoMode: !!settings.demoMode,
      paused: !!settings.trackingPaused,
      ignored,
      hasWindow: !!win,
      screenOff: !!(sample && sample.screenOff === true),
      discontinuity: discontinuous,
      systemAsleep: sleeping,
      systemLocked: locked,
      category,
      media,
      trackMusicWhileIdle: settings.trackMusicWhileIdle === true,
      trackVideoWhileIdle: settings.trackVideoWhileIdle === true
    });
    const idle = decision.idle;
    const app = win
      ? appLabel(win)
      : trackingError
        ? 'Tracking unavailable'
        : 'No active window';
    const title =
      (win && win.title) ||
      (trackingError
        ? trackingError
        : settings.trackingPaused
          ? 'Tracking paused'
          : settings.demoMode
            ? ''
            : 'Switch apps to start tracking');
    const browser = !!(win && isBrowserProcess(win, rHolder.rules && rHolder.rules.identities));

    const same =
      current.app === app &&
      current.title === title &&
      current.category === category;

    if (!same) {
      current = { window: win, app, title, category, since: now, source };
    } else {
      current.window = win;
      current.source = source;
    }

    const paused = !!settings.trackingPaused;
    if (paused) {
      source = 'paused';
      current.source = 'paused';
    } else if (idle) {
      source = 'idle';
      current.source = 'idle';
    }

    // One foreground sample per tick. Sessions and reminders use this same decision.
    if (decision.reason === 'idle' && !discontinuous && !startedPaused) {
      const from = idleTimelineEnd === null ? intervalStart : idleTimelineEnd;
      if (store.addTimelineGap && (idleTimelineEnd === null || now - from >= 60000)) {
        store.addTimelineGap(from, now);
        idleTimelineEnd = now;
      }
    } else {
      if (idleTimelineEnd !== null && !discontinuous && !startedPaused &&
          decision.count && intervalStart > idleTimelineEnd && store.addTimelineGap) {
        store.addTimelineGap(idleTimelineEnd, intervalStart);
      }
      idleTimelineEnd = null;
    }
    if (decision.count && decision.elapsedSec > 0) {
      if (store.addInterval) store.addInterval(app, category, intervalStart, now, activity, rHolder.rules && rHolder.rules.profileId);
      else store.addSeconds(app, category, decision.elapsedSec, activity);
    } else if (store.resetStreak) {
      store.resetStreak();
    }

    if (breakReminder.update({
      enabled: settings.breakReminderEnabled === true && settings.notificationsEnabled !== false,
      minutes: settings.breakReminderMinutes,
      counted: decision.count && idleSec < 300,
      elapsedSec: decision.elapsedSec
    }) && onReminder) {
      onReminder({ kind: 'break', minutes: settings.breakReminderMinutes });
    }

    // Focus session: accumulate byApp + distraction edges while active
    let sessionInfo = null;
    if (sessionManager && typeof sessionManager.onTrackerTick === 'function') {
      sessionInfo = sessionManager.onTrackerTick({
        app,
        category,
        elapsedSec: decision.count ? decision.elapsedSec : 0
      });
    }

    // Remember last real focused app (not ignored / not self) for Home "Last focused"
    // Freeze lastFocused while paused so the Home bar stays put
    if (decision.count && win && decision.elapsedSec > 0) {
      lastFocused = {
        app,
        title,
        url: win.url || '',
        category,
        browser,
        source,
        at: now
      };
    }

    if (
      decision.count &&
      decision.elapsedSec > 0 &&
      settings.notificationsEnabled !== false &&
      store.shouldRemind() &&
      category === 'unproductive'
    ) {
      store.markReminder();
      if (onReminder) {
        onReminder({
          streak: store.snapshot([], { includeWeek: false }).unproductiveStreak,
          threshold: settings.thresholdSec,
          app,
          title
        });
      }
    }

    if (onTick) {
      const activeSession =
        (sessionInfo && sessionInfo.active) ||
        (sessionManager && sessionManager.getActiveSession && sessionManager.getActiveSession()) ||
        null;
      onTick({
        now: {
          app,
          title,
          category,
          browser,
          source,
          ignored,
          idle,
          idleReason: decision.reason,
          idleSec,
          url: (win && win.url) || '',
          elapsedSec: Math.round((now - current.since) / 1000),
          trackingError
        },
        lastFocused,
        stats: store.snapshot([], { includeWeek: false }),
        session: activeSession,
        sessionCompleted: (sessionInfo && sessionInfo.completed) || null
      });
    }
  }

  async function poll() {
    // Keep observing timer continuity even while a slow backend request is pending.
    checkContinuity();
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      await pollOnce();
    } finally {
      pollInFlight = false;
    }
  }

  const runPoll = () => poll().catch((err) => console.error('[tracker] poll failed:', err.message));

  function schedulePolls() {
    if (timer) clearInterval(timer);
    const ms = store.getSettings().pollMs || 3000;
    timer = setInterval(runPoll, ms);
    if (timer.unref) timer.unref();
  }

  function start() {
    if (timer) return; // idempotent
    stopped = false;
    resetStreakSafely();
    lastTick = clock();
    lastHeartbeat = lastTick;
    runPoll();
    schedulePolls();
  }

  function refreshCadence() {
    if (!timer || stopped) return;
    schedulePolls();
  }

  function stop() {
    stopped = true;
    idleTimelineEnd = null;
    breakReminder.reset();
    generation += 1;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function getLastFocused() {
    return lastFocused;
  }

  function setSystemPresence({ sleeping: nextSleep, locked: nextLock } = {}) {
    const nextSleeping = !!nextSleep;
    const nextLocked = !!nextLock;
    if (sleeping === nextSleeping && locked === nextLocked) return;
    sleeping = nextSleeping;
    idleTimelineEnd = null;
    breakReminder.reset();
    locked = nextLocked;
    generation += 1;
    lastTick = clock();
    lastHeartbeat = lastTick;
    current.since = lastTick;
    resetStreakSafely();
  }

  function setSystemInactive(inactive) {
    if (inactive) setSystemPresence({ sleeping: true, locked: true });
    else setSystemPresence({ sleeping: false, locked: false });
  }

  function invalidateClassification() {
    idleTimelineEnd = null;
    generation++;
    lastTick = clock();
    lastHeartbeat = lastTick;
    current.since = lastTick;
    lastFocused = null;
    resetStreakSafely();
  }

  function markPauseBoundary() {
    idleTimelineEnd = null;
    breakReminder.reset();
    generation++;
    lastTick = clock();
    lastHeartbeat = lastTick;
    current.since = lastTick;
    resetStreakSafely();
  }

  return { start, stop, poll, refreshCadence, getLastFocused, setSystemInactive, setSystemPresence, invalidateClassification, markPauseBoundary };
}

module.exports = { createTracker, createRealBackend, createRecoveringWindowsBackend };
