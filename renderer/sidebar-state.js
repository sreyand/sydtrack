'use strict';

// Apply before the rail is painted. This is a device preference, not activity data.
(() => {
  const key = 'sydtrack.sidebarCollapsed';
  const state = {
    set(collapsed) {
      try { localStorage.setItem(key, String(collapsed === true)); } catch (_) {}
    },
    clear() {
      try { localStorage.removeItem(key); } catch (_) {}
      document.body.classList.remove('nav-collapsed');
    }
  };
  try { document.body.classList.toggle('nav-collapsed', localStorage.getItem(key) === 'true'); } catch (_) {}
  window.sydtrackSidebarState = state;
})();
