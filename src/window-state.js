'use strict';

const fs = require('fs');
const { writeJson } = require('./json-file');

const DEFAULT_BOUNDS = Object.freeze({ width: 1040, height: 760, minWidth: 800, minHeight: 600 });
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function validBounds(value) {
  if (!value || typeof value !== 'object') return null;
  const bounds = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(value[key]) || Math.abs(value[key]) > 10000000) return null;
    bounds[key] = Math.round(value[key]);
  }
  return bounds.width > 0 && bounds.height > 0 ? bounds : null;
}

function intersectionArea(a, b) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

// Coordinates are in Electron's device-independent pixels, including negative
// positions on monitors to the left or above the primary display.
function restoreWindowState(saved, displays, primaryDisplay, defaults = DEFAULT_BOUNDS) {
  const available = (Array.isArray(displays) ? displays : []).map(display => ({
    id: display.id, area: validBounds(display.workArea)
  })).filter(display => display.area);
  const original = validBounds(saved && saved.bounds);
  const primary = available.find(display => display.id === primaryDisplay?.id) || available[0];
  if (!primary) return { bounds: {}, maximized: false };
  let target = primary, overlap = 0;
  if (original) for (const display of available) {
    const area = intersectionArea(original, display.area);
    if (area > overlap) { target = display; overlap = area; }
  }
  const area = target.area;
  const minWidth = Math.min(defaults.minWidth || DEFAULT_BOUNDS.minWidth, area.width);
  const minHeight = Math.min(defaults.minHeight || DEFAULT_BOUNDS.minHeight, area.height);
  const width = clamp(original?.width || defaults.width || DEFAULT_BOUNDS.width, minWidth, area.width);
  const height = clamp(original?.height || defaults.height || DEFAULT_BOUNDS.height, minHeight, area.height);
  const centered = !original || overlap === 0;
  const x = centered ? area.x + Math.floor((area.width - width) / 2) : clamp(original.x, area.x, area.x + area.width - width);
  const y = centered ? area.y + Math.floor((area.height - height) / 2) : clamp(original.y, area.y, area.y + area.height - height);
  return { bounds: { x, y, width, height, minWidth, minHeight }, maximized: !!original && saved.maximized === true };
}

function createWindowState({ filePath, screenApi, onError = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') onError(error); }
  let window = null, state = null, timer = null, displayTimer = null, disposed = false, forgotten = false, repairing = false;
  let pendingMaximize = false, lastSaved = JSON.stringify(saved);
  let defaults = DEFAULT_BOUNDS, appliedMinimum = null;
  const listeners = [];

  function displaysNow() {
    let displays = [], primary;
    try { displays = screenApi?.getAllDisplays() || []; primary = screenApi?.getPrimaryDisplay(); }
    catch (error) { onError(error); }
    return { displays, primary };
  }

  function validated(value) {
    const { displays, primary } = displaysNow();
    return restoreWindowState(value, displays, primary, defaults);
  }

  function restore(options) {
    defaults = { ...DEFAULT_BOUNDS, ...options };
    const result = validated(saved);
    const bounds = validBounds(result.bounds);
    state = bounds ? { bounds, maximized: result.maximized } : null;
    appliedMinimum = bounds ? [result.bounds.minWidth, result.bounds.minHeight] : null;
    pendingMaximize = result.maximized;
    return result.bounds;
  }

  function capture() {
    if (forgotten || !window || window.isDestroyed() || window.isMinimized?.() || window.isFullScreen?.()) return;
    const bounds = validBounds(window.getNormalBounds?.());
    if (!bounds) return;
    const maximized = pendingMaximize || window.isMaximized?.() === true;
    const safe = validBounds(validated({ bounds, maximized }).bounds);
    state = { bounds: safe || bounds, maximized };
  }

  function revalidate() {
    if (disposed || !window || window.isDestroyed()) return;
    const minimized = window.isMinimized?.() === true;
    const maximized = window.isMaximized?.() === true;
    const fullscreen = window.isFullScreen?.() === true;
    const bounds = minimized || fullscreen ? state?.bounds : validBounds(window.getNormalBounds?.());
    if (!bounds) return;
    const result = validated({ bounds, maximized: pendingMaximize || maximized || ((minimized || fullscreen) && state?.maximized) });
    const safe = validBounds(result.bounds);
    if (!safe) return;
    state = { bounds: safe, maximized: result.maximized };
    // setBounds may restore a maximized/minimized native window. Keep those
    // states untouched; validate again when its normal window is shown/restored.
    if (minimized || maximized || fullscreen) return;
    repairing = true;
    try {
      const minimum = [result.bounds.minWidth, result.bounds.minHeight];
      if (typeof window.setMinimumSize === 'function' && (!appliedMinimum ||
          minimum.some((value, index) => value !== appliedMinimum[index]))) {
        window.setMinimumSize(...minimum);
        appliedMinimum = minimum;
      }
      if (typeof window.setBounds === 'function' && Object.keys(safe).some(key => safe[key] !== bounds[key])) {
        window.setBounds(safe);
      }
    } catch (error) {
      onError(error);
    } finally { repairing = false; }
  }

  function cancelTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function flush() {
    cancelTimer();
    if (disposed || forgotten) return;
    capture();
    if (!state) return;
    const next = JSON.stringify(state);
    if (next === lastSaved) return;
    try { writeJson(filePath, state); lastSaved = next; }
    catch (error) { onError(error); }
  }

  function changed() {
    if (disposed) return;
    if (!repairing) forgotten = false;
    capture();
    cancelTimer();
    timer = setTimer(flush, 250);
    timer?.unref?.();
  }

  function attach(win) {
    window = win;
    const listenTo = (target, event, handler) => {
      if (typeof target?.on !== 'function') return;
      target.on(event, handler); listeners.push([target, event, handler]);
    };
    const listen = (event, handler) => listenTo(win, event, handler);
    for (const event of ['move', 'resize', 'maximize', 'unmaximize']) listen(event, changed);
    for (const event of ['hide', 'minimize']) listen(event, flush);
    for (const event of ['restore', 'unmaximize', 'leave-full-screen']) listen(event, revalidate);
    listen('show', () => {
      revalidate();
      // Maximizing a hidden Electron window also shows it. Defer until the user
      // actually opens the app, preserving hidden login/tray startup.
      if (!pendingMaximize) return;
      pendingMaximize = false;
      if (typeof win.maximize === 'function') win.maximize();
    });
    const displayChanged = () => {
      if (disposed) return;
      if (displayTimer !== null) clearTimer(displayTimer);
      displayTimer = setTimer(() => {
        displayTimer = null;
        revalidate();
        flush();
      }, 250);
      displayTimer?.unref?.();
    };
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) listenTo(screenApi, event, displayChanged);
  }

  function forget() {
    cancelTimer();
    if (displayTimer !== null) clearTimer(displayTimer);
    displayTimer = null;
    forgotten = true;
    pendingMaximize = false;
    saved = state = null;
    lastSaved = 'null';
  }

  function dispose() {
    if (disposed) return;
    flush();
    disposed = true;
    if (displayTimer !== null) clearTimer(displayTimer);
    displayTimer = null;
    for (const [target, event, handler] of listeners) target.removeListener(event, handler);
    listeners.length = 0;
    window = null;
  }

  return { restore, attach, flush, forget, dispose };
}

module.exports = { createWindowState, restoreWindowState };
