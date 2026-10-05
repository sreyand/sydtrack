'use strict';

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');
const { pauseForMinutes } = require('./timed-pause');
const { resolveTrayState } = require('./tray-state');
const { toleranceMs } = require('./tracking-decision');

const LOGO_PATH = path.join(__dirname, '..', 'renderer', 'assets', 'sydtrack.ico');
const TRAY_ASSETS = path.join(__dirname, '..', 'renderer', 'assets', 'tray');

function loadTrayImage(filePath) {
  try {
    const source = nativeImage.createFromPath(filePath);
    if (source.isEmpty()) return null;
    const size = process.platform === 'linux' ? 24 : 16;
    const image = source.resize({ width: size, height: size, quality: 'best' });
    // Keep the supplied colors and provide sharp images at 200% and 300% DPI.
    for (const scaleFactor of [2, 3]) {
      image.addRepresentation({ scaleFactor,
        buffer: source.resize({ width: size * scaleFactor, height: size * scaleFactor, quality: 'best' }).toPNG() });
    }
    return image;
  } catch (err) {
    console.warn('[tray] could not load ' + path.basename(filePath), err && err.message);
    return null;
  }
}

function formatRemaining(sec) {
  const s = Math.max(0, Math.ceil(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + String(r).padStart(2, '0');
}

/**
 * Quiet live-category tray. No additional tracking or renderer permissions.
 * @param {object} deps
 * @param {() => import('electron').BrowserWindow|null} deps.getMainWindow
 * @param {() => object|null} deps.getStore
 * @param {(partial: object) => object} [deps.updateSettings]
 * @param {() => object|null} deps.getSessionManager
 * @param {() => object|null} [deps.getLastPayload]
 * @param {(payload: object) => void} [deps.sendTrackerUpdate]
 * @param {() => void} deps.onQuit
 */
function createAppTray(deps) {
  const getMainWindow = deps.getMainWindow;
  const getStore = deps.getStore;
  const getSessionManager = deps.getSessionManager;
  const getLastPayload = deps.getLastPayload || (() => null);
  const sendTrackerUpdate = deps.sendTrackerUpdate || (() => {});
  const onQuit = deps.onQuit;

  const standard = loadTrayImage(path.join(TRAY_ASSETS, 'standard.png')) ||
    loadTrayImage(LOGO_PATH) || nativeImage.createEmpty();
  const images = { standard };
  for (const category of ['other', 'productive', 'unproductive']) {
    images[category] = loadTrayImage(path.join(TRAY_ASSETS, category + '.png')) || standard;
  }
  const tray = new Tray(standard);
  let currentImage = standard;
  let currentTooltip = '';
  let pendingReason = null;
  let staleTimer = null;
  let destroyed = false;

  function clearStaleTimer() {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = null;
  }

  function settings() {
    const store = getStore();
    return (store && store.getSettings && store.getSettings()) || {};
  }

  function activeSession() {
    const sm = getSessionManager();
    if (sm && typeof sm.getActiveSession === 'function') {
      return sm.getActiveSession();
    }
    const last = getLastPayload();
    return (last && last.session) || null;
  }

  function showWindow() {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  function pushSettings(partial) {
    if (typeof deps.updateSettings === 'function') return deps.updateSettings(partial || {});
    const store = getStore();
    if (!store || typeof store.updateSettings !== 'function') return null;
    return store.updateSettings(partial || {});
  }

  function pushFreshSnapshot() {
    const store = getStore();
    const last = getLastPayload() || {};
    const snapshot = {
      now: last.now || null,
      lastFocused: last.lastFocused || null,
      stats: store && store.snapshot ? store.snapshot() : last.stats || null,
      session: activeSession(),
      settings: settings()
    };
    // Prefer full last payload shape when present
    const payload = Object.assign({}, last, {
      stats: snapshot.stats || last.stats,
      session: snapshot.session,
      // Completion is a one-time event, not part of a settings refresh.
      sessionCompleted: null,
      settings: snapshot.settings
    });
    // Ensure renderer sees updated settings via stats.settings when possible
    if (payload.stats && typeof payload.stats === 'object') {
      payload.stats = Object.assign({}, payload.stats, { settings: snapshot.settings });
    }
    sendTrackerUpdate(payload);
  }

  function togglePause() {
    const s = settings();
    pushSettings({ trackingPaused: !s.trackingPaused, trackingPauseUntil: 0 });
    refresh();
    pushFreshSnapshot();
  }

  function startTimedPause(minutes) {
    pushSettings(pauseForMinutes(minutes));
    refresh();
    pushFreshSnapshot();
  }

  function toggleAlerts() {
    const s = settings();
    const enabled = s.notificationsEnabled !== false;
    pushSettings({ notificationsEnabled: !enabled });
    refresh();
    pushFreshSnapshot();
  }

  function buildTooltip(state) {
    const parts = [state.label];
    const session = activeSession();
    if (session && (session.status === 'running' || session.active)) {
      const rem =
        session.remainingSec != null
          ? session.remainingSec
          : session.tray && session.tray.remainingSec;
      if (rem != null && rem !== '' && Number.isFinite(Number(rem))) {
        parts.push('Session ' + formatRemaining(rem));
      }
    }
    return 'sydtrack — ' + parts.join(' · ');
  }

  function buildMenu() {
    const s = settings();
    const alertsOn = s.notificationsEnabled !== false;
    const ready = s.onboardingComplete !== false;
    return Menu.buildFromTemplate([
      {
        label: 'Open sydtrack',
        click: () => showWindow()
      },
      { type: 'separator' },
      {
        label: s.trackingPaused ? 'Resume tracking' : 'Pause tracking',
        enabled: ready,
        click: () => togglePause()
      },
      {
        label: 'Pause for',
        enabled: ready,
        submenu: [
          { label: '15 minutes', click: () => startTimedPause(15) },
          { label: '30 minutes', click: () => startTimedPause(30) },
          { label: '1 hour', click: () => startTimedPause(60) }
        ]
      },
      {
        label: 'Notifications',
        type: 'checkbox',
        checked: alertsOn,
        click: () => toggleAlerts()
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          if (typeof onQuit === 'function') onQuit();
        }
      }
    ]);
  }

  function refresh({ freshSample = false } = {}) {
    if (destroyed) return;
    try {
      const prefs = settings();
      if (freshSample) {
        pendingReason = null;
        clearStaleTimer();
      } else if (prefs.trackingPaused || prefs.onboardingComplete === false) {
        // Resuming must wait for a new decision, even if the previous payload
        // predates the pause. A settings-only refresh is not a foreground sample.
        pendingReason = 'waiting';
      }
      const state = resolveTrayState(prefs, getLastPayload(), pendingReason);
      if (state.icon === 'standard') clearStaleTimer();
      else if (freshSample) {
        // A stalled probe must not leave a stale category displayed indefinitely.
        staleTimer = setTimeout(() => invalidate('unavailable'), toleranceMs(prefs.pollMs));
        if (staleTimer.unref) staleTimer.unref();
      }
      const image = images[state.icon] || standard;
      if (image !== currentImage) {
        tray.setImage(image);
        currentImage = image;
      }
      const tooltip = buildTooltip(state);
      if (tooltip !== currentTooltip) {
        tray.setToolTip(tooltip);
        currentTooltip = tooltip;
      }
      tray.setContextMenu(buildMenu());
    } catch (err) {
      console.warn('[tray] refresh failed', err && err.message);
    }
  }

  function invalidate(reason = 'waiting') {
    if (destroyed) return;
    pendingReason = reason;
    clearStaleTimer();
    refresh();
  }

  tray.on('double-click', () => showWindow());
  // Windows: single click often opens context menu; double-click opens app.
  if (process.platform === 'darwin') {
    tray.on('click', () => showWindow());
  }

  refresh();

  return {
    tray,
    refresh,
    invalidate,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearStaleTimer();
      try {
        tray.destroy();
      } catch (_) {
        /* ignore */
      }
    }
  };
}

module.exports = { createAppTray };
