'use strict';

// Exact-minute schedule controls. The original time inputs and change handlers
// remain the single path to settings; the popover only edits an unsaved draft.
(() => {
  const formatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const hour12 = formatter.resolvedOptions().hour12 === true;
  const controls = [];
  let opened = null, saving = false;
  const pad = value => String(value).padStart(2, '0');
  function parse(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value));
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    return { hour: Number(match[1]), minute: Number(match[2]) };
  }
  function localTime(value) {
    const time = parse(value);
    if (!time) return value;
    return formatter.format(new Date(2000, 0, 1, time.hour, time.minute));
  }
  function periodLabel(period) {
    return formatter.formatToParts(new Date(2000, 0, 1, period ? 12 : 0))
      .find(part => part.type === 'dayPeriod')?.value || (period ? 'PM' : 'AM');
  }
  function draftValue(control) { return pad(control.draft.hour) + ':' + pad(control.draft.minute); }
  function selectedValue(control, unit) {
    if (unit === 'minute') return control.draft.minute;
    if (unit === 'period') return control.draft.hour >= 12 ? 1 : 0;
    return hour12 ? control.draft.hour % 12 || 12 : control.draft.hour;
  }
  function renderControl(control) {
    control.trigger.disabled = saving || control.input.disabled;
    control.trigger.dataset.time = control.confirmed;
    control.value.textContent = localTime(control.confirmed);
    control.status.textContent = control.error || '';
    control.status.hidden = !control.error;
    if (control.error) control.trigger.setAttribute('aria-describedby', control.status.id);
    else control.trigger.removeAttribute('aria-describedby');
    control.root.setAttribute('aria-busy', String(saving));
    control.popover.querySelectorAll('[data-time-action]').forEach(button => { button.disabled = saving; });
  }
  function renderDraft(control, scroll) {
    for (const group of control.groups) {
      const selected = selectedValue(control, group.dataset.timeUnit);
      let active;
      for (const option of group.querySelectorAll('[role="option"]')) {
        const on = Number(option.dataset.timeOption) === selected;
        option.setAttribute('aria-selected', String(on));
        if (on) active = option;
      }
      if (active) {
        group.setAttribute('aria-activedescendant', active.id);
        if (scroll) group.scrollTop = Math.max(0, active.offsetTop - (group.clientHeight - active.offsetHeight) / 2);
      }
    }
  }
  function select(control, unit, value) {
    if (unit === 'minute') control.draft.minute = value;
    else if (unit === 'period') control.draft.hour = control.draft.hour % 12 + value * 12;
    else control.draft.hour = hour12 ? value % 12 + (control.draft.hour >= 12 ? 12 : 0) : value;
    renderDraft(control, true);
  }
  function close(restoreFocus = false) {
    if (!opened) return;
    const control = opened;
    opened = null;
    control.popover.hidden = true;
    control.retryValue = null;
    control.trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && !control.trigger.disabled && control.trigger.getClientRects().length) control.trigger.focus({ preventScroll: true });
  }
  function open(control) {
    if (saving || control.input.disabled || control.trigger.disabled) return;
    if (opened === control) { close(); return; }
    close();
    control.error = '';
    renderControl(control);
    control.draft = parse(control.retryValue) || parse(control.input.value) || parse(control.confirmed);
    if (!control.draft) return;
    opened = control;
    control.openWidth = window.innerWidth;
    control.openHeight = window.innerHeight;
    control.popover.hidden = false;
    control.trigger.setAttribute('aria-expanded', 'true');
    control.popover.style.width = Math.min(hour12 ? 264 : 204, window.innerWidth - 24) + 'px';
    control.popover.style.maxHeight = Math.max(0, window.innerHeight - 24) + 'px';
    const anchor = control.trigger.getBoundingClientRect();
    const height = control.popover.getBoundingClientRect().height;
    const below = window.innerHeight - anchor.bottom - 12;
    const above = anchor.top - 12;
    const top = below < height && above > below ? anchor.top - height - 4 : anchor.bottom + 4;
    control.popover.style.top = Math.max(12, Math.min(top, window.innerHeight - height - 12)) + 'px';
    control.popover.style.left = Math.max(12, Math.min(anchor.right - control.popover.getBoundingClientRect().width, window.innerWidth - control.popover.getBoundingClientRect().width - 12)) + 'px';
    renderDraft(control, true);
    control.groups[0].focus({ preventScroll: true });
  }
  async function commit(control) {
    if (saving || control.input.disabled || opened !== control) return;
    const value = draftValue(control);
    if (!parse(value)) return;
    if (value === control.confirmed) { close(true); return; }
    const restoreFocus = control.popover.contains(document.activeElement);
    close(true);
    saving = true;
    control.error = '';
    controls.forEach(renderControl);
    control.input.value = value;
    try {
      const event = new CustomEvent('change', { bubbles: true, detail: { scheduleTimePicker: true, pending: null } });
      control.input.dispatchEvent(event);
      if (!event.detail.pending || typeof event.detail.pending.then !== 'function') throw new Error('Schedule save is unavailable');
      await event.detail.pending;
      control.confirmed = control.input.value;
    } catch (_) {
      // sync() records authoritative settings, including updates received while
      // this request is pending. Never retain a failed optimistic time value.
      control.input.value = control.confirmed;
      if (control.confirmed !== value) {
        control.error = 'Could not save this time. Try again.';
        control.retryValue = value;
      }
    } finally {
      saving = false;
      controls.forEach(renderControl);
      if (restoreFocus && document.activeElement === document.body && !control.trigger.disabled && control.trigger.getClientRects().length) {
        control.trigger.focus({ preventScroll: true });
      }
    }
  }
  function makeGroup(control, unit, label, values) {
    const column = document.createElement('div');
    column.className = 'schedule-time-column';
    const title = document.createElement('div');
    title.className = 'schedule-time-column-label';
    title.id = control.input.id + '-' + unit + '-label';
    title.textContent = label;
    const group = document.createElement('div');
    group.className = 'schedule-time-list';
    group.dataset.timeUnit = unit;
    group.setAttribute('role', 'listbox');
    group.setAttribute('aria-labelledby', title.id);
    group.tabIndex = 0;
    let scrollbarTimer;
    const revealScrollbar = () => {
      group.classList.add('scroll-active');
      clearTimeout(scrollbarTimer);
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scrollbarTimer = window.setTimeout(() => group.classList.remove('scroll-active'), reduceMotion ? 600 : 1100);
    };
    for (const type of ['scroll', 'pointermove', 'pointerenter', 'keydown']) group.addEventListener(type, revealScrollbar, { passive: type === 'scroll' });
    for (const value of values) {
      const option = document.createElement('button');
      option.type = 'button'; option.tabIndex = -1;
      option.className = 'schedule-time-option';
      option.id = control.input.id + '-' + unit + '-' + value;
      option.dataset.timeOption = String(value);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.textContent = unit === 'period' ? periodLabel(value) : new Intl.NumberFormat(undefined, { minimumIntegerDigits: unit === 'minute' || !hour12 ? 2 : 1 }).format(value);
      option.addEventListener('click', () => { select(control, unit, value); group.focus({ preventScroll: true }); });
      group.append(option);
    }
    group.addEventListener('keydown', event => {
      const index = values.indexOf(selectedValue(control, unit));
      let next;
      if (event.key === 'ArrowDown') next = (index + 1) % values.length;
      else if (event.key === 'ArrowUp') next = (index + values.length - 1) % values.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = values.length - 1;
      if (next != null) {
        event.preventDefault(); select(control, unit, values[next]);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const at = control.groups.indexOf(group);
        const move = event.key === 'ArrowLeft' ? -1 : 1;
        control.groups[(at + move + control.groups.length) % control.groups.length].focus({ preventScroll: true });
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        // Arrow navigation selects the draft; Enter/Space keeps listbox focus.
        select(control, unit, selectedValue(control, unit));
      }
    });
    column.append(title, group);
    control.columns.append(column);
    control.groups.push(group);
  }
  for (const root of document.querySelectorAll('[data-schedule-input]')) {
    const input = document.getElementById(root.dataset.scheduleInput);
    const trigger = root.querySelector('.schedule-time-trigger');
    const popover = root.querySelector('.schedule-time-popover');
    if (!input || !trigger || !popover || !parse(input.value)) continue;
    const control = { root, input, trigger, popover, value: root.querySelector('.schedule-time-value'),
      status: root.querySelector('.schedule-time-status'), confirmed: input.value, error: '', groups: [] };
    const columns = document.createElement('div');
    columns.className = 'schedule-time-columns';
    columns.dataset.hour12 = String(hour12);
    control.columns = columns;
    popover.append(columns);
    makeGroup(control, 'hour', 'Hour', Array.from({ length: hour12 ? 12 : 24 }, (_, index) => index + (hour12 ? 1 : 0)));
    makeGroup(control, 'minute', 'Minute', Array.from({ length: 60 }, (_, index) => index));
    if (hour12) makeGroup(control, 'period', 'AM/PM', [0, 1]);
    const footer = document.createElement('div');
    footer.className = 'schedule-time-footer';
    for (const [action, text] of [['cancel', 'Cancel'], ['save', 'Set time']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.timeAction = action;
      button.className = action === 'save' ? 'btn primary' : 'btn ghost';
      button.textContent = text;
      button.addEventListener('click', () => action === 'save' ? commit(control) : close(true));
      footer.append(button);
    }
    popover.append(footer);
    trigger.addEventListener('click', () => open(control));
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(control); }
    });
    input.hidden = true;
    trigger.hidden = false;
    controls.push(control);
    renderControl(control);
  }
  function sync() {
    for (const control of controls) {
      const changed = control.input.value !== control.confirmed;
      if (opened === control && (control.input.disabled || changed)) {
        close(!control.input.disabled && control.popover.contains(document.activeElement));
      }
      if (parse(control.input.value)) control.confirmed = control.input.value;
      if (changed || control.input.disabled) { control.error = ''; control.retryValue = null; }
      renderControl(control);
    }
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && opened) { event.preventDefault(); close(true); }
  });
  document.addEventListener('pointerdown', event => {
    if (opened && !opened.root.contains(event.target)) close();
  });
  document.addEventListener('focusin', event => {
    if (opened && !opened.root.contains(event.target)) close();
  });
  document.addEventListener('click', event => {
    if (event.target.closest('.nav-btn, [data-settings-tab]')) close();
  });
  window.addEventListener('resize', () => {
    // A queued resize can arrive after opening at its final dimensions. Only a
    // viewport change since placement makes this popover's position stale.
    if (opened && (opened.openWidth !== window.innerWidth || opened.openHeight !== window.innerHeight)) close();
  });
  document.addEventListener('scroll', event => {
    // Ignore delayed scroll notifications from closed picker columns as well.
    if (opened && !event.target.closest?.('.schedule-time-popover, .select-menu-listbox')) close();
  }, { capture: true, passive: true });
  window.sydtrackScheduleTimeUI = { sync, close };
})();
