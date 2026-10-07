'use strict';

const WINDOW_SHORTCUTS = Object.freeze([
  '',
  'CommandOrControl+Alt+S',
  'CommandOrControl+Shift+S',
  'Alt+S'
]);

function createWindowShortcut(globalShortcut, onToggle) {
  let active = '';
  return {
    active: () => active,
    set(next) {
      if (!WINDOW_SHORTCUTS.includes(next)) throw new Error('Unsupported window shortcut.');
      if (next === active) return { ok: true, shortcut: active };
      if (next) {
        let registered = false;
        try { registered = globalShortcut.register(next, onToggle); }
        catch (_) { /* Another app or the operating system may reserve it. */ }
        if (!registered) return { ok: false, shortcut: active };
      }
      if (active) globalShortcut.unregister(active);
      active = next;
      return { ok: true, shortcut: active };
    },
    dispose() {
      if (active) globalShortcut.unregister(active);
      active = '';
    }
  };
}

function toggleWindowVisibility(window) {
  if (!window || typeof window.isDestroyed !== 'function') return false;
  try {
    if (window.isDestroyed()) return false;
    const methods = ['isVisible', 'isMinimized', 'isFocused', 'restore', 'show', 'focus', 'hide'];
    if (methods.some(method => typeof window[method] !== 'function')) return false;
    const visible = window.isVisible();
    const minimized = window.isMinimized();
    const focused = window.isFocused();
    if (visible && !minimized && focused) window.hide();
    else {
      if (minimized) window.restore();
      window.show();
      window.focus();
    }
    return true;
  } catch (_) {
    // The window can be destroyed between checking its state and acting on it.
    return false;
  }
}

module.exports = { WINDOW_SHORTCUTS, createWindowShortcut, toggleWindowVisibility };
