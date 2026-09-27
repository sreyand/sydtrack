'use strict';

const PROFILE_SHORTCUTS = Object.freeze([
  '',
  'Alt+B',
  'CommandOrControl+Alt+B',
  'CommandOrControl+Shift+B'
]);

function createProfileShortcut(globalShortcut, onCycle) {
  let active = '';
  return {
    active: () => active,
    set(next) {
      if (!PROFILE_SHORTCUTS.includes(next)) throw new Error('Unsupported profile shortcut.');
      if (next === active) return { ok: true, shortcut: active };
      if (next) {
        let registered = false;
        try { registered = globalShortcut.register(next, onCycle); }
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

module.exports = { PROFILE_SHORTCUTS, createProfileShortcut };
