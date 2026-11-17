'use strict';

(() => {
  const trigger = $('source-pill'), panel = $('tracking-status-popover');
  const action = $('tracking-status-action');
  let model = null, busy = false;
  const isOpen = () => !panel.classList.contains('hidden');
  function place() {
    if (!isOpen()) return;
    const anchor = trigger.getBoundingClientRect(), rect = panel.getBoundingClientRect(), pad = 12;
    const right = anchor.right + 10;
    const beside = right + rect.width <= innerWidth - pad;
    panel.style.left = Math.max(pad, Math.min(beside ? right : anchor.right - rect.width, innerWidth - rect.width - pad)) + 'px';
    panel.style.top = Math.max(pad, Math.min(beside ? anchor.bottom - rect.height : anchor.top - rect.height - 10, innerHeight - rect.height - pad)) + 'px';
  }
  function hide(restoreFocus = false) {
    if (!isOpen()) return;
    panel.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  function update(next) {
    model = next;
    $('tracking-status-heading').textContent = model.heading;
    $('tracking-status-description').textContent = model.description;
    const reading = $('tracking-status-last-reading');
    const at = Number(model.lastSuccessfulSampleAt);
    const showReading = at > 0 && ['unavailable', 'waiting', 'no-window'].includes(model.key);
    reading.classList.toggle('hidden', !showReading);
    if (showReading) {
      const date = new Date(at), today = new Date();
      const sameDay = date.toDateString() === today.toDateString();
      reading.textContent = 'Last successful reading: ' + (sameDay ? '' : date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ') +
        date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    const focusedAction = document.activeElement === action;
    action.classList.toggle('hidden', !model.action);
    action.textContent = model.action?.label || '';
    action.disabled = busy || pauseActionBusy;
    const error = $('tracking-status-error');
    error.textContent = pauseActionError;
    error.classList.toggle('hidden', !pauseActionError);
    if (!model.action && focusedAction && isOpen()) trigger.focus({ preventScroll: true });
    place();
  }
  function show() {
    if (!model) refreshTrackingStatus();
    if (!model) return;
    closePauseMenu();
    panel.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    place();
  }
  trigger.addEventListener('click', () => { if (isOpen()) hide(); else show(); });
  $('tracking-status-close').addEventListener('click', () => hide(true));
  action.addEventListener('click', async () => {
    if (busy || !model?.action) return;
    if (model.action.kind === 'settings') {
      hide();
      document.querySelector('.nav-btn[data-tab="settings"]').click();
      const trackingTab = document.querySelector('[data-settings-tab="tracking"]');
      trackingTab.click();
      trackingTab.focus({ preventScroll: true });
      return;
    }
    if (model.action.kind !== 'resume') return;
    busy = true;
    action.disabled = true;
    try { await performPauseAction(null, action); }
    finally { busy = false; refreshTrackingStatus(); }
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Tab') {
      const controls = [...panel.querySelectorAll('button:not(.hidden):not(:disabled)')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); trigger.focus({ preventScroll: true }); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); hide(true); }
    }
  });
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowUp' || (event.key === 'Tab' && !event.shiftKey && isOpen())) {
      event.preventDefault(); show(); $('tracking-status-close').focus({ preventScroll: true });
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) { event.preventDefault(); hide(true); }
  });
  document.addEventListener('pointerdown', event => {
    if (!trigger.contains(event.target) && !panel.contains(event.target)) hide();
  });
  document.addEventListener('focusin', event => {
    if (isOpen() && !trigger.contains(event.target) && !panel.contains(event.target)) hide();
  });
  document.querySelectorAll('.nav-btn').forEach(button => button.addEventListener('click', () => hide()));
  window.addEventListener('blur', () => hide());
  window.addEventListener('resize', place);
  document.addEventListener('scroll', event => { if (!panel.contains(event.target)) hide(); }, true);
  document.addEventListener('sydtrack:sidebar-settled', place);
  window.sydtrackTrackingStatusUI = { update, hide };
  refreshTrackingStatus();
})();
