'use strict';

// Presentation only: visibility, selection, focus and actions remain immediate.
(() => {
  const instances = new WeakMap();
  const panels = '.view, .analytics-panel, .settings-panel';
  const popups = '.select-menu-listbox, .schedule-time-popover, .pause-settings-menu, .profile-menu, .quick-rule-picker';
  const groups = '.segment-control, .apps-range';
  const easing = 'cubic-bezier(.22,1,.36,1)';
  let sweepSupported = false;
  try {
    if (window.CSS?.registerProperty) {
      CSS.registerProperty({ name: '--ui-motion-sweep', syntax: '<angle>', initialValue: '360deg', inherits: false });
      sweepSupported = true;
    }
  } catch (_) {} // A missing animation capability never prevents using the app.

  function create({ root = document } = {}) {
    if (instances.has(root)) return instances.get(root);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animations = new Map(), indicators = new Map(), waitingCharts = new Set();
    let requested = false, enabled = false, disposed = false;
    const visible = element => element.isConnected && !element.closest('.hidden, [hidden]') && element.getClientRects().length > 0;
    function cancel(element) {
      const running = animations.get(element);
      if (!running) return;
      animations.delete(element);
      running.animation.cancel();
      running.cleanup?.();
    }
    function animate(element, frames, duration, cleanup) {
      cancel(element);
      if (!enabled || typeof element.animate !== 'function') { cleanup?.(); return; }
      const animation = element.animate(frames, { duration, easing });
      animation.id = 'sydtrack-ui-motion';
      animations.set(element, { animation, cleanup });
      animation.onfinish = () => {
        if (animations.get(element)?.animation !== animation) return;
        animations.delete(element);
        cleanup?.();
      };
    }
    function cancelWithin(element) {
      for (const target of [...animations.keys()]) if (target === element || element.contains(target)) cancel(target);
      for (const chart of waitingCharts) if (element.contains(chart)) waitingCharts.delete(chart);
    }
    function reveal(element) {
      const popup = element.matches(popups);
      // A later-loading child should not fade again inside a moving page.
      if (!popup && [...animations.keys()].some(parent =>
        parent !== element && parent.matches(panels) && parent.contains(element))) return;
      // Panel transforms would change the coordinate system of fixed menus.
      animate(element, popup
        ? [{ opacity: .9, transform: 'translateY(-2px)' }, { opacity: 1, transform: 'none' }]
        : [{ opacity: .94 }, { opacity: 1 }], popup ? 120 : 110);
    }
    function drawPie(chart) {
      if (chart.querySelector('.ui-motion-pie-cover')) return true;
      if (!visible(chart) ||
          !getComputedStyle(chart).backgroundImage.includes('conic-gradient') ||
          (chart.id === 'pie-chart' && !chart.classList.contains('has-data'))) return false;
      const bounds = chart.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return false;
      if (!sweepSupported) {
        animate(chart, [{ opacity: .94, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }], 180);
        return true;
      }
      const cover = document.createElement('span');
      cover.className = 'ui-motion-pie-cover';
      cover.setAttribute('aria-hidden', 'true');
      cover.style.backgroundColor = getComputedStyle(chart.closest('.card') || chart.parentElement).backgroundColor;
      chart.classList.add('ui-motion-chart');
      chart.append(cover);
      animate(cover, [{ '--ui-motion-sweep': '0deg' }, { '--ui-motion-sweep': '360deg' }], 280, () => {
        cover.remove(); chart.classList.remove('ui-motion-chart');
      });
      return true;
    }
    function enterPie(chart) {
      if (visible(chart) && !drawPie(chart)) waitingCharts.add(chart);
      else waitingCharts.delete(chart);
    }
    function updateGroup(group, moving, refresh = false) {
      const buttons = [...group.children].filter(child => child.matches('.segment-btn'));
      if (buttons.length < 2) {
        const state = indicators.get(group);
        if (state) {
          cancel(state.pill); state.pill.remove(); indicators.delete(group);
          group.classList.remove('ui-motion-segment'); group.removeAttribute('data-motion-pill');
        }
        return;
      }
      const active = buttons.find(button => button.classList.contains('active'));
      let state = indicators.get(group);
      // Polls and unrelated menus must not restart a highlight already in flight.
      if (state && state.active === active && state.rect && !refresh) return;
      if (!active || !visible(group)) {
        if (state) {
          if (!active && visible(group) && !state.pill.hidden) {
            const pill = state.pill.getBoundingClientRect(), parent = group.getBoundingClientRect();
            state.parkedRect = { left: pill.left - parent.left, top: pill.top - parent.top, width: pill.width, height: pill.height };
          } else if (!visible(group)) { state.rect = null; state.parkedRect = null; }
          cancel(state.pill); state.pill.hidden = true; state.active = null;
        }
        group.removeAttribute('data-motion-pill');
        return;
      }
      if (!state) {
        const pill = document.createElement('span');
        pill.className = 'ui-motion-indicator'; pill.setAttribute('aria-hidden', 'true');
        group.classList.add('ui-motion-segment'); group.prepend(pill);
        state = { pill, rect: null, active: null }; indicators.set(group, state);
      }
      const parent = state.parkedRect && group.getBoundingClientRect();
      const old = state.parkedRect ? { ...state.parkedRect, left: parent.left + state.parkedRect.left,
        top: parent.top + state.parkedRect.top } : state.rect && state.pill.getBoundingClientRect();
      state.parkedRect = null;
      cancel(state.pill);
      group.removeAttribute('data-motion-pill');
      const appearance = getComputedStyle(active);
      Object.assign(state.pill.style, { background: appearance.backgroundColor, border: appearance.border,
        borderRadius: appearance.borderRadius, boxShadow: appearance.boxShadow });
      const next = { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
      state.pill.hidden = false;
      Object.assign(state.pill.style, { left: next.left + 'px', top: next.top + 'px', width: next.width + 'px', height: next.height + 'px' });
      group.setAttribute('data-motion-pill', 'ready');
      const target = state.pill.getBoundingClientRect();
      if (moving && old && state.rect && ['left', 'top', 'width', 'height'].some(key => Math.abs(old[key] - target[key]) > .25)) {
        animate(state.pill, [{ transform: `translate(${old.left - target.left}px,${old.top - target.top}px) scale(${old.width / target.width},${old.height / target.height})` },
          { transform: 'none' }], 150);
      }
      state.rect = next; state.active = active;
    }
    const syncGroups = (moving, refresh = false) => root.querySelectorAll(groups).forEach(group => updateGroup(group, moving, refresh));
    const observer = new MutationObserver(records => {
      if (!enabled) return;
      for (const chart of waitingCharts) if (!chart.isConnected) waitingCharts.delete(chart);
      for (const target of [...animations.keys()]) if (!target.isConnected) cancel(target);
      for (const [group, state] of indicators) if (!group.isConnected) {
        cancel(state.pill); state.pill.remove(); indicators.delete(group);
      }
      const revealed = new Set(), insertedCharts = new Set(), dirtyGroups = new Map();
      const queueGroup = (group, moving, refresh = false) => {
        if (!group) return;
        const queued = dirtyGroups.get(group);
        dirtyGroups.set(group, { moving: moving || queued?.moving, refresh: refresh || queued?.refresh });
      };
      const queueWithin = element => {
        if (element.matches(groups)) queueGroup(element, false, true);
        element.querySelectorAll(groups).forEach(group => queueGroup(group, false, true));
      };
      let themeChanged = false;
      for (const record of records) {
        const element = record.target;
        if (record.type === 'childList') {
          if (element.matches?.(groups) && [...record.removedNodes].some(node => node.nodeType === 1 && node.matches('.segment-btn'))) {
            queueGroup(element, false, true);
          }
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches('.pie-chart')) insertedCharts.add(node);
            node.querySelectorAll('.pie-chart').forEach(chart => insertedCharts.add(chart));
            if (node.matches(groups)) queueGroup(node, false, true);
            node.querySelectorAll(groups).forEach(group => queueGroup(group, false, true));
            if (node.matches('.segment-btn')) queueGroup(node.closest(groups), true, true);
          }
          continue;
        }
        if (record.oldValue === element.getAttribute(record.attributeName)) continue;
        if (waitingCharts.has(element) && drawPie(element)) waitingCharts.delete(element);
        if (record.attributeName === 'style') continue;
        if (record.attributeName === 'data-theme') { themeChanged = true; continue; }
        if (element.matches('.segment-btn')) {
          const wasActive = (record.oldValue || '').split(/\s+/).includes('active');
          if (wasActive !== element.classList.contains('active')) queueGroup(element.closest(groups), true);
          continue;
        }
        if (element.matches(groups)) {
          const wasHidden = record.attributeName === 'hidden' ? record.oldValue !== null
            : (record.oldValue || '').split(/\s+/).includes('hidden');
          if (record.attributeName === 'hidden' || wasHidden !== element.classList.contains('hidden')) queueGroup(element, false, true);
        }
        if (!element.matches(panels + ', ' + popups)) continue;
        if (!visible(element)) { cancelWithin(element); queueWithin(element); continue; }
        const wasHidden = record.attributeName === 'hidden' ? record.oldValue !== null
          : (record.oldValue || '').split(/\s+/).includes('hidden');
        if (wasHidden) { revealed.add(element); queueWithin(element); }
      }
      for (const element of revealed) {
        if (![...revealed].some(parent => parent !== element && parent.contains(element))) reveal(element);
        element.querySelectorAll('.pie-chart').forEach(enterPie);
      }
      insertedCharts.forEach(enterPie);
      if (themeChanged) {
        for (const target of [...animations.keys()]) cancel(target);
        syncGroups(false, true);
      } else for (const [group, options] of dirtyGroups) updateGroup(group, options.moving, options.refresh);
    });
    function stop() {
      observer.disconnect();
      for (const target of [...animations.keys()]) cancel(target);
      for (const [group, state] of indicators) {
        state.pill.remove(); group.classList.remove('ui-motion-segment'); group.removeAttribute('data-motion-pill');
      }
      indicators.clear();
      waitingCharts.clear();
    }
    function sync() {
      const next = requested && !media.matches && !disposed;
      if (next === enabled) return;
      enabled = next;
      document.documentElement.setAttribute('data-ui-motion', enabled ? 'on' : 'off');
      if (!enabled) { stop(); return; }
      syncGroups(false);
      observer.observe(root, { subtree: true, childList: true, attributes: true,
        attributeFilter: ['class', 'hidden', 'style', 'data-theme'], attributeOldValue: true });
    }
    function resize() {
      if (!enabled) return;
      for (const target of [...animations.keys()]) cancel(target);
      syncGroups(false, true);
    }
    media.addEventListener('change', sync);
    window.addEventListener('resize', resize);
    document.fonts?.addEventListener('loadingdone', resize);
    const api = {
      setEnabled(value) { if (disposed) return; requested = value === true; sync(); },
      get enabled() { return enabled; },
      dispose() {
        if (disposed) return;
        disposed = true; sync(); stop();
        media.removeEventListener('change', sync); window.removeEventListener('resize', resize); instances.delete(root);
        document.fonts?.removeEventListener('loadingdone', resize);
      }
    };
    document.documentElement.setAttribute('data-ui-motion', 'off');
    instances.set(root, api);
    return api;
  }
  window.sydtrackUIMotion = { create };
})();
