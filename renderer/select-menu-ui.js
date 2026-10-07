'use strict';

// Progressive, single-value select controls. Native selects remain the backing
// values and are only hidden after a usable themed control has been created.
(() => {
  const instances = new Set(), roots = new WeakMap(), owners = new WeakMap();
  let opened = null, pending = null, nextId = 0;
  const enabledOptions = control => control.options.filter(option => !option.disabled && !option.hidden);
  const activeOption = control => enabledOptions(control).find(option => option.value === control.active);
  const popupHasFocus = control => control.list.contains(document.activeElement);

  function close(restoreFocus = false, discardDraft = true) {
    if (!opened) return;
    const control = opened;
    const hadFocus = popupHasFocus(control);
    opened = null;
    control.list.hidden = true;
    control.trigger.setAttribute('aria-expanded', 'false');
    if (discardDraft) control.retry = null;
    if (restoreFocus && !control.trigger.disabled && control.trigger.getClientRects().length) {
      control.trigger.focus({ preventScroll: true });
    } else if (hadFocus) control.list.blur();
  }
  function accessibleName(input) {
    if (input.getAttribute('aria-label')) return input.getAttribute('aria-label');
    const labelled = input.getAttribute('aria-labelledby');
    if (labelled) return labelled.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
    return [...(input.labels || [])].map(label => {
      const copy = label.cloneNode(true);
      copy.querySelectorAll('select, input, button, .hint, .select-menu-status').forEach(element => element.remove());
      return copy.textContent.trim();
    }).filter(Boolean).join(' ') || input.name || 'Choose an option';
  }
  function render(control) {
    const selected = control.options.find(option => option.value === control.confirmed);
    control.value.textContent = selected?.text || '';
    control.trigger.dataset.selectValue = control.confirmed;
    control.root.dataset.selectValue = control.confirmed;
    renderAvailability(control);
    const name = accessibleName(control.input);
    control.trigger.setAttribute('aria-label', name + (selected ? ': ' + selected.text : ''));
    control.list.setAttribute('aria-label', name);
    control.status.textContent = control.error || '';
    control.status.hidden = !control.error;
    const described = [control.input.getAttribute('aria-describedby'), control.error ? control.status.id : ''].filter(Boolean).join(' ');
    if (described) control.trigger.setAttribute('aria-describedby', described);
    else control.trigger.removeAttribute('aria-describedby');
    for (const option of control.options) {
      option.button.setAttribute('aria-selected', String(option.value === control.confirmed));
      option.button.dataset.active = String(option.value === control.active);
    }
    const active = activeOption(control);
    if (active) control.list.setAttribute('aria-activedescendant', active.button.id);
    else control.list.removeAttribute('aria-activedescendant');
  }
  function renderAvailability(control) {
    control.trigger.disabled = !!pending || control.input.disabled || enabledOptions(control).length === 0;
    control.root.setAttribute('aria-busy', String(!!pending));
    for (const option of control.options) option.button.disabled = !!pending || control.input.disabled || option.disabled;
  }
  function renderAll() { for (const instance of instances) instance.controls.forEach(render); }
  function setActive(control, value, scroll = true) {
    control.active = value;
    render(control);
    const active = activeOption(control);
    if (scroll && active) {
      const button = active.button;
      if (button.offsetTop < control.list.scrollTop) control.list.scrollTop = button.offsetTop;
      else if (button.offsetTop + button.offsetHeight > control.list.scrollTop + control.list.clientHeight) {
        control.list.scrollTop = button.offsetTop + button.offsetHeight - control.list.clientHeight;
      }
    }
  }
  function open(control, edge) {
    if (pending || control.trigger.disabled) return;
    if (opened === control) { close(true); return; }
    close();
    const options = enabledOptions(control);
    if (!options.length) return;
    opened = control;
    control.viewport = [innerWidth, innerHeight];
    control.resetSearch();
    control.list.hidden = false;
    control.trigger.setAttribute('aria-expanded', 'true');
    const anchor = control.trigger.getBoundingClientRect();
    const below = Math.max(0, innerHeight - anchor.bottom - 12), above = Math.max(0, anchor.top - 12);
    control.list.style.width = Math.max(0, Math.min(Math.max(anchor.width, 224), innerWidth - 24)) + 'px';
    control.list.style.maxHeight = Math.min(296, Math.max(above, below, 44), Math.max(0, innerHeight - 24)) + 'px';
    const rect = control.list.getBoundingClientRect();
    const top = below < rect.height && above > below ? anchor.top - rect.height - 4 : anchor.bottom + 4;
    control.list.style.top = Math.max(12, Math.min(top, innerHeight - rect.height - 12)) + 'px';
    control.list.style.left = Math.max(12, Math.min(anchor.left, innerWidth - rect.width - 12)) + 'px';
    const preferred = edge === 'first' ? options[0] : edge === 'last' ? options[options.length - 1] :
      options.find(option => option.value === (control.retry ?? control.confirmed)) || options[0];
    setActive(control, preferred.value);
    control.list.focus({ preventScroll: true });
  }
  async function commit(control, value) {
    if (pending || opened !== control || control.input.disabled || !enabledOptions(control).some(option => option.value === value)) return;
    if (value === control.confirmed) { control.error = ''; close(true); render(control); return; }
    const restoreFocus = popupHasFocus(control);
    close(true);
    const action = { control, value };
    pending = action;
    control.error = '';
    renderAll();
    control.input.value = value;
    try {
      const result = control.instance.onCommit(control.input, value);
      if (!result || typeof result.then !== 'function') throw new Error('Select save must return a promise');
      await result;
      if (!control.instance.disposed) control.confirmed = control.input.value;
    } catch (_) {
      if (!control.instance.disposed) {
        control.input.value = control.confirmed;
        if (control.confirmed !== value) {
          control.error = 'Could not save this option. Try again.';
          control.retry = value;
        }
      }
    } finally {
      if (pending === action) pending = null;
      renderAll();
      if (!control.instance.disposed && restoreFocus && document.activeElement === document.body && !control.trigger.disabled && control.trigger.getClientRects().length) {
        control.trigger.focus({ preventScroll: true });
      }
    }
  }
  function updateOptions(control) {
    const options = [...control.input.options].map(option => ({ value: String(option.value), text: option.textContent,
      disabled: option.disabled || (option.parentElement.tagName === 'OPTGROUP' && option.parentElement.disabled), hidden: option.hidden }));
    const signature = JSON.stringify(options);
    if (signature === control.signature) return;
    control.signature = signature;
    control.list.replaceChildren();
    control.options = options.map((option, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.tabIndex = -1;
      button.id = control.list.id + '-option-' + index;
      button.className = 'select-menu-option';
      button.setAttribute('role', 'option');
      button.dataset.selectValue = option.value;
      button.textContent = option.text;
      button.hidden = option.hidden;
      button.addEventListener('click', event => { event.preventDefault(); commit(control, option.value); });
      control.list.append(button);
      return { ...option, button };
    });
    if (!activeOption(control)) control.active = enabledOptions(control).find(option => option.value === control.confirmed)?.value ?? enabledOptions(control)[0]?.value;
  }
  function enhance(instance, input) {
    if (owners.has(input) || input.multiple || input.hidden) return;
    const base = input.id || 'select-menu-' + (++nextId);
    const root = document.createElement('div'); root.className = 'select-menu-control';
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.id = base + '-select-trigger'; trigger.className = 'select-menu-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    const value = document.createElement('span'); value.className = 'select-menu-value';
    const caret = document.createElement('span'); caret.className = 'select-menu-caret'; caret.setAttribute('aria-hidden', 'true');
    trigger.append(value, caret);
    const list = document.createElement('div');
    list.id = base + '-select-listbox'; list.className = 'select-menu-listbox'; list.hidden = true; list.tabIndex = 0;
    list.setAttribute('role', 'listbox'); trigger.setAttribute('aria-controls', list.id);
    const status = document.createElement('p'); status.id = base + '-select-status'; status.className = 'select-menu-status'; status.hidden = true; status.setAttribute('role', 'status');
    const control = { instance, input, root, trigger, value, list, status, confirmed: input.value, active: input.value, options: [], error: '', retry: null, labels: [] };
    updateOptions(control);
    trigger.addEventListener('click', event => { event.preventDefault(); open(control); });
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); open(control, event.key === 'Home' ? 'first' : event.key === 'End' ? 'last' : undefined);
      }
    });
    let search = '', searchedAt = 0, scrollbarTimer;
    control.resetSearch = () => { search = ''; searchedAt = 0; };
    const revealScrollbar = () => {
      list.classList.add('scroll-active'); clearTimeout(scrollbarTimer);
      scrollbarTimer = window.setTimeout(() => list.classList.remove('scroll-active'), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 600 : 1100);
    };
    for (const type of ['scroll', 'pointermove', 'pointerenter', 'keydown']) list.addEventListener(type, revealScrollbar, { passive: type === 'scroll' });
    control.clearTimer = () => clearTimeout(scrollbarTimer);
    list.addEventListener('keydown', event => {
      if (opened !== control || pending) return;
      const options = enabledOptions(control), index = options.indexOf(activeOption(control));
      if (!options.length) { close(true); return; }
      let at;
      if (event.key === 'ArrowDown') at = (index + 1) % options.length;
      else if (event.key === 'ArrowUp') at = (index + options.length - 1) % options.length;
      else if (event.key === 'Home') at = 0;
      else if (event.key === 'End') at = options.length - 1;
      if (at != null) { event.preventDefault(); setActive(control, options[at].value); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); commit(control, control.active); }
      else if (event.key === 'Tab') close(true);
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        search = (Date.now() - searchedAt < 700 ? search : '') + event.key.toLocaleLowerCase(); searchedAt = Date.now();
        const option = options.find(option => option.text.trim().toLocaleLowerCase().startsWith(search));
        if (option) { event.preventDefault(); setActive(control, option.value); }
      }
    });
    for (const label of input.labels || []) {
      const listener = event => {
        if (event.target.closest('button, input, select, a, [role="listbox"]')) return;
        event.preventDefault(); trigger.focus({ preventScroll: true });
      };
      label.addEventListener('click', listener);
      control.labels.push({ label, listener });
    }
    input.before(root); root.append(input, trigger, list, status);
    input.hidden = true; owners.set(input, instance); instance.controls.push(control); render(control);
  }
  function create({ root, onCommit } = {}) {
    if (!root || typeof root.querySelectorAll !== 'function') throw new Error('Select menu root is required');
    if (onCommit != null && typeof onCommit !== 'function') throw new Error('Select commit handler must be a function');
    const existing = roots.get(root);
    if (existing && !existing.disposed) return existing.api;
    const instance = { root, controls: [], disposed: false, onCommit: onCommit || ((input) => {
      const event = new CustomEvent('change', { bubbles: true, detail: { selectMenuPicker: true, pending: null } });
      input.dispatchEvent(event);
      return event.detail.pending;
    }) };
    instance.api = {
      // Busy-only bridge: unlike sync(), never confirm an optimistic backing
      // value. Other settings actions can safely disable a menu before saving.
      refresh() {
        if (instance.disposed) return;
        for (const control of instance.controls) {
          renderAvailability(control);
          if (opened === control && control.trigger.disabled) close(false);
        }
      },
      sync() {
        if (instance.disposed) return;
        root.querySelectorAll('select').forEach(input => enhance(instance, input));
        for (const control of instance.controls) {
          const changed = control.input.value !== control.confirmed;
          if (opened === control && (changed || control.input.disabled)) close(!control.input.disabled && popupHasFocus(control));
          control.confirmed = control.input.value;
          if (changed || control.input.disabled) { control.error = ''; control.retry = null; }
          updateOptions(control); render(control);
          if (opened === control && !enabledOptions(control).length) close(popupHasFocus(control));
        }
      },
      dispose() {
        if (instance.disposed) return;
        instance.disposed = true;
        if (opened?.instance === instance) close(false);
        for (const control of instance.controls) {
          control.clearTimer();
          if (pending?.control === control) control.input.value = control.confirmed;
          for (const { label, listener } of control.labels) label.removeEventListener('click', listener);
          control.input.hidden = false; owners.delete(control.input); control.root.replaceWith(control.input);
        }
        instances.delete(instance); roots.delete(root);
      }
    };
    roots.set(root, instance); instances.add(instance); instance.api.sync();
    return instance.api;
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && opened) { event.preventDefault(); close(true); }
  });
  for (const type of ['pointerdown', 'focusin']) document.addEventListener(type, event => {
    if (opened && !opened.root.contains(event.target)) close();
  });
  document.addEventListener('click', event => { if (event.target.closest('.nav-btn, [data-settings-tab]')) close(); });
  window.addEventListener('resize', () => {
    // A resize notification can arrive after the menu was already positioned
    // at the new size. Dismiss only an actual change since this menu opened.
    if (opened && (innerWidth !== opened.viewport[0] || innerHeight !== opened.viewport[1])) close(popupHasFocus(opened));
  });
  document.addEventListener('scroll', event => {
    // A closed list can deliver its queued scroll after another menu opens.
    // Ignore every internal picker list, not just the currently open one.
    if (opened && !event.target?.closest?.('.select-menu-listbox, .schedule-time-popover')) close(popupHasFocus(opened));
  }, { capture: true, passive: true });
  window.addEventListener('scroll', () => { if (opened) close(popupHasFocus(opened)); }, { passive: true });
  window.sydtrackSelectMenuUI = { create };
})();
