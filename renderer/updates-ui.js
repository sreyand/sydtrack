'use strict';

(() => {
  let checking = false, saving = false;
  const auto = $('updates-auto');
  const check = $('updates-check');
  const open = $('updates-open');
  const status = $('updates-status');
  function applySettings(settings) {
    if (!saving) auto.checked = settings.updateChecksEnabled === true;
  }
  function render(state) {
    if (!state) return;
    $('updates-version').textContent = 'v' + state.currentVersion;
    check.disabled = checking || state.phase === 'checking';
    open.classList.toggle('hidden', !state.available);
    const nav = document.querySelector('.nav-btn[data-tab="settings"]');
    nav.classList.toggle('update-available', state.available);
    nav.title = state.available ? 'Settings · v' + state.latestVersion + ' available' : 'Settings';
    if (state.phase === 'checking') status.textContent = 'Checking GitHub…';
    else if (state.phase === 'unavailable') status.textContent = state.available
      ? 'Could not check. Last seen: v' + state.latestVersion + '.' : 'Could not reach GitHub. Try again later.';
    else if (state.available) status.textContent = 'v' + state.latestVersion + ' is available. Install it when you’re ready.';
    else if (state.phase === 'current') status.textContent = 'You’re up to date.';
    else if (state.phase === 'cached') status.textContent = 'Last check: no newer version found.';
    else status.textContent = 'Check GitHub for a newer release.';
    status.title = state.checkedAt ? 'Last successful check: ' + new Date(state.checkedAt).toLocaleString() : '';
  }
  if (!api?.getUpdates) { check.disabled = auto.disabled = true; return; }
  api.onUpdates(render);
  api.getUpdates().then(render).catch(() => { status.textContent = 'Update checks are unavailable.'; });
  api.getState().then(state => applySettings(state.stats?.settings || {})).catch(() => {});
  auto.addEventListener('change', async () => {
    if (saving) return;
    const previous = !auto.checked;
    saving = true; auto.disabled = true;
    try {
      const settings = await api.updateSettings({ updateChecksEnabled: auto.checked });
      auto.checked = settings.updateChecksEnabled === true;
    } catch (_) {
      auto.checked = previous;
      status.textContent = 'Could not save this preference. Try again.';
    } finally { saving = false; auto.disabled = false; }
  });
  check.addEventListener('click', async () => {
    if (checking) return;
    checking = true; check.disabled = true; status.textContent = 'Checking GitHub…';
    try { const state = await api.checkUpdates(); checking = false; render(state); }
    catch (_) { status.textContent = 'Could not check for updates. Try again later.'; }
    finally { checking = false; check.disabled = false; }
  });
  open.addEventListener('click', async () => {
    open.disabled = true;
    try { await api.openUpdateRelease(); }
    catch (_) { status.textContent = 'Could not open the release. Try again.'; }
    finally { open.disabled = false; }
  });
  window.sydtrackUpdatesUI = { applySettings, render };
})();
