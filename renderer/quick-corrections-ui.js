'use strict';

(() => {
  const picker = $('quick-rule-picker');
  const toast = $('correction-undo');
  const titleText = entry => window.sydtrackBrowserRules.contentTitle(entry.title, cachedBrowserApps);
  const sameEntry = (a, b) => !!a && !!b && a.app === b.app && a.title === b.title;
  const canonical = values => JSON.stringify((values || []).map(value => value.trim().toLowerCase()).filter(Boolean).sort());
  const tagsDirty = () => {
    const current = currentTagLists();
    return ['productive', 'unproductive', 'other'].some(type => canonical(current[type]) !== canonical(cachedRules[type])) ||
      canonical(current.ignore) !== canonical(cachedIgnore);
  };
  let draft = null, recent = null, dismissTimer = null, undoBusy = false;
  function homeStatus(message) { $('home-profile-status').textContent = message; }
  function focusTarget(target) {
    if (target?.buttonId) $(target.buttonId)?.focus({ preventScroll: true });
    else if (target?.rowId) {
      $('app-list').querySelector('.app-activity[data-row-id="' + encodeURIComponent(target.rowId) + '"] .app-activity-actions')?.focus({ preventScroll: true });
    }
  }
  function closePicker(restoreFocus = false) {
    const target = draft?.target;
    draft = null;
    picker.classList.add('hidden');
    $('quick-rule-title').textContent = '';
    $('quick-rule-keyword').value = '';
    $('quick-rule-status').textContent = '';
    if (restoreFocus) focusTarget(target);
  }
  function focusChanged() {
    if (draft && !lfClassifySaving && (!sameEntry(draft.entry, lastFocusedCache) || draft.profileId !== cachedRules.profileId)) {
      const focused = picker.contains(document.activeElement);
      closePicker(focused);
    }
  }
  function setDraftCategory(category) {
    if (!draft) return;
    draft.category = category;
    picker.querySelectorAll('[data-quick-category]').forEach(button => {
      const selected = button.dataset.quickCategory === category;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }
  function openPicker(entry, profileId, category, target) {
    draft = { entry, profileId, category, target };
    $('quick-rule-title').textContent = titleText(entry);
    $('quick-rule-keyword').value = '';
    $('quick-rule-status').textContent = '';
    setDraftCategory(category);
    picker.classList.remove('hidden');
    $('quick-rule-keyword').focus({ preventScroll: true });
    picker.scrollIntoView({ block: 'nearest' });
  }
  function updateFocusedRule(result, entry) {
    if (result.rules?.profileId !== cachedRules.profileId) return;
    fillRulesEditors(result.rules);
    fillIgnoreEditor(result.ignoreList);
    // Derive the actual result. A higher-priority source rule can still win;
    // never promise a different category just because a new keyword was saved.
    if (!sameEntry(entry, lastFocusedCache)) return;
    const focused = sameEntry(result.lastFocused, entry) ? result.lastFocused : null;
    const category = focused?.category || result.previewCategory ||
      defaultCategoryFromRules(entry, cachedRules, cachedIgnore);
    // Never pin a future-rule preview indefinitely over a today's correction.
    // The next tracker sample remains authoritative, including after Undo.
    lastFocusedCache.category = category;
    const explanation = focused ? focused.explanation : result.previewExplanation;
    lastFocusedCache.explanation = explanation?.category === category ? explanation : null;
    applyCategoryChip($('lf-cat'), category, entry.app, entry.browser);
    applyLfButtonOutlines(category);
    window.sydtrackCategoryUI?.update(lastFocusedCache);
  }
  function armDismiss() {
    clearTimeout(dismissTimer);
    if (undoBusy || toast.matches(':hover') || toast.contains(document.activeElement)) return;
    dismissTimer = setTimeout(() => hideUndo(), 15000);
  }
  function hideUndo(restoreFocus = false) {
    clearTimeout(dismissTimer);
    const target = recent?.target;
    recent = null;
    toast.classList.add('hidden');
    if (restoreFocus) focusTarget(target);
  }
  function showUndo(result, message, target = {}) {
    if (!result?.undoToken || !api?.undoCorrection) return;
    recent = { ...result, target };
    $('correction-undo-message').textContent = message;
    $('correction-undo-action').disabled = false;
    $('correction-undo-dismiss').disabled = false;
    toast.classList.remove('hidden');
    armDismiss();
  }
  async function save(entry, profileId, keyword, category, toggle, target) {
    if (lfClassifySaving || tagsQuickSaving || undoBusy) return false;
    if (tagsDirty()) { homeStatus('Save your Focus Tags edits before changing a rule here.'); return false; }
    lfClassifySaving = true;
    applyLfButtonOutlines(lastFocusedCache?.category);
    picker.querySelectorAll('button, input').forEach(element => { element.disabled = true; });
    try {
      const result = await api.quickSetRule({ profileId, app: entry.app, title: entry.title || '', keyword: keyword || '', category, toggle });
      updateFocusedRule(result, entry);
      homeStatus('');
      closePicker();
      const name = profileId === 'default' && result.profileName === 'Default' ? 'default' : result.profileName;
      const profileNote = typeof name === 'string' && name.trim() ? ' (' + name + ' profile)' : '';
      showUndo(result, (category === 'ignored' ? 'App rule changed.' : 'Rule saved for future tracking.') + profileNote, target);
      return true;
    } catch (error) {
      const message = 'Could not save this rule. ' + String(error.message || 'Try again.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
      if (draft) $('quick-rule-status').textContent = message;
      else homeStatus(message);
      return false;
    } finally {
      lfClassifySaving = false;
      picker.querySelectorAll('button, input').forEach(element => { element.disabled = false; });
      applyLfButtonOutlines(lastFocusedCache?.category);
      focusChanged();
    }
  }
  async function classify(category) {
    if (!api?.quickSetRule || !lastFocusedCache || lfClassifySaving || tagsQuickSaving || undoBusy) return;
    if (tagsDirty()) { homeStatus('Save your Focus Tags edits before changing a rule here.'); return; }
    homeStatus('');
    const entry = { ...lastFocusedCache }, profileId = cachedRules.profileId;
    const target = { buttonId: { productive: 'lf-prod', unproductive: 'lf-unprod', other: 'lf-other', ignored: 'lf-ignore' }[category] };
    const keyword = category === 'ignored' ? '' : keywordForQuickClassify(entry);
    if (!keyword && category !== 'ignored') {
      if (isBrowserApp(entry.app) && titleText(entry)) openPicker(entry, profileId, category, target);
      return;
    }
    return save(entry, profileId, keyword, category, true, target);
  }
  picker.addEventListener('submit', async event => {
    event.preventDefault();
    if (!draft || lfClassifySaving) return;
    const keyword = $('quick-rule-keyword').value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const text = titleText(draft.entry);
    if (!keyword || window.sydtrackBrowserRules.isBrowserName(keyword, cachedBrowserApps) || keyword.toLowerCase().startsWith('site:') ||
        !text.toLowerCase().includes(keyword.toLowerCase()) || !window.sydtrackBrowserRules.exactKeyword(text, keyword)) {
      $('quick-rule-status').textContent = 'Choose whole words from the page title, not the browser name.';
      $('quick-rule-keyword').focus();
      return;
    }
    const selected = draft;
    if (await save(selected.entry, selected.profileId, keyword, selected.category, false, selected.target)) focusTarget(selected.target);
  });
  picker.querySelectorAll('[data-quick-category]').forEach(button => button.addEventListener('click', () => setDraftCategory(button.dataset.quickCategory)));
  $('quick-rule-cancel').addEventListener('click', () => closePicker(true));
  picker.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !lfClassifySaving) { event.preventDefault(); closePicker(true); }
  });
  const pickSelection = () => {
    const selection = window.getSelection();
    const preview = $('quick-rule-title');
    if (draft && selection && preview.contains(selection.anchorNode) && preview.contains(selection.focusNode)) {
      const phrase = selection.toString().trim();
      if (phrase && phrase.length <= 200) $('quick-rule-keyword').value = phrase;
    }
  };
  $('quick-rule-title').addEventListener('mouseup', pickSelection);
  $('quick-rule-title').addEventListener('keyup', pickSelection);
  document.querySelectorAll('.nav-btn').forEach(button => button.addEventListener('click', () => { if (!lfClassifySaving) closePicker(); }));
  toast.addEventListener('mouseenter', () => clearTimeout(dismissTimer));
  toast.addEventListener('mouseleave', armDismiss);
  toast.addEventListener('focusin', () => clearTimeout(dismissTimer));
  toast.addEventListener('focusout', () => setTimeout(armDismiss, 0));
  $('correction-undo-dismiss').addEventListener('click', () => hideUndo(toast.contains(document.activeElement)));
  $('correction-undo-action').addEventListener('click', async () => {
    if (!recent || undoBusy || lfClassifySaving || tagsQuickSaving || appCorrectionBusy) return;
    if (recent.kind === 'rule' && tagsDirty()) {
      $('correction-undo-message').textContent = 'Save your Focus Tags edits before Undo.';
      return;
    }
    const pending = recent;
    undoBusy = lfClassifySaving = appCorrectionBusy = true;
    clearTimeout(dismissTimer);
    $('correction-undo-action').disabled = true;
    $('correction-undo-dismiss').disabled = true;
    applyLfButtonOutlines(lastFocusedCache?.category);
    try {
      const result = await api.undoCorrection(pending.undoToken);
      if (result.kind === 'rule') updateFocusedRule(result, lastFocusedCache);
      else {
        historicalWeek = null; historyRequest++;
        setLiveStats(result.stats, lastFocusedCache);
        renderStats(result.stats); paintLivePie();
        $('apps-correction-status').textContent = 'Change undone. Future tracking is unchanged.';
      }
      hideUndo();
      focusTarget(pending.target);
    } catch (error) {
      $('correction-undo-message').textContent = String(error.message || 'Could not undo this change.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
      $('correction-undo-action').disabled = false;
    } finally {
      undoBusy = lfClassifySaving = appCorrectionBusy = false;
      $('correction-undo-dismiss').disabled = false;
      applyLfButtonOutlines(lastFocusedCache?.category);
      armDismiss();
    }
  });
  window.sydtrackQuickUI = { classify, showUndo, focusChanged };
})();
