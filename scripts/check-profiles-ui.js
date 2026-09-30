'use strict';

if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('error', err => { console.error(err); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code == null ? 1 : code; });
  return;
}
// Real preload + profile persistence, isolated from the live app and foreground tracking.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const { createFocusProfiles } = require('../src/focus-profiles');
const { createStore } = require('../src/store');
const { createQuickCorrections } = require('../src/quick-corrections');
const { createUpdateChecker } = require('../src/updates');
const { createSessionManager } = require('../src/sessions');
const { validateIpcPayload } = require('../src/ipc-validate');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-profile-ui-'));
app.setPath('userData', root); app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const store = createStore(root);
  store.addSeconds('Chrome', 'other', 60, { category: 'other', reason: 'No matching keyword' });
  store.addSeconds('Chrome', 'productive', 30, { category: 'productive', reason: 'github' });
  store.addSeconds('Code', 'other', 20);
  store.addSeconds('Spotify', 'other', 15);
  const profiles = createFocusProfiles({ dataDir: root, rules: { productive: [], unproductive: [] }, ignore: [] });
  const assertActiveProfile = id => {
    if (id != null && id !== profiles.snapshot().activeId) throw new Error('Focus profile changed. Reload tags before saving.');
  };
  const sessions = createSessionManager({ dataDir: root, getSettings: () => store.getSettings() });
  const corrections = createQuickCorrections({ store, profiles });
  const profilePayload = result => ({ ...result, rules: { ...profiles.active(), profileId: profiles.snapshot().activeId },
    ignoreList: { ignore: profiles.active().ignore, profileId: profiles.snapshot().activeId } });
  const updates = createUpdateChecker({ currentVersion: require('../package.json').version, dataDir: root,
    getSettings: () => store.getSettings(), fetch: async () => [{ tag_name: 'v99.0.0', draft: false, prerelease: false }] });
  const handlers = {
    'state:get': () => ({ stats: store.snapshot(), settings: store.getSettings(), now: null, session: null }),
    'profiles:get': () => profiles.snapshot(),
    'profiles:save': (_e, { id, fields }) => profiles.save(id, fields),
    'profiles:activate': (_e, id) => profiles.activate(id),
    'profiles:cycle': () => {
      const current = profiles.snapshot();
      const index = current.profiles.findIndex(profile => profile.id === current.activeId);
      return profiles.activate(current.profiles[(index + 1) % current.profiles.length].id);
    },
    'rules:set': (_e, fields) => { assertActiveProfile(fields.profileId); profiles.save(profiles.snapshot().activeId, { productive: fields.productive, unproductive: fields.unproductive,
      other: fields.other === undefined ? profiles.active().other : fields.other,
      ...(fields.ignore === undefined ? {} : { ignore: fields.ignore }) }); return { ...profiles.active(), profileId: profiles.snapshot().activeId }; },
    'ignore:set': (_e, fields) => { assertActiveProfile(fields.profileId); profiles.save(profiles.snapshot().activeId, { ignore: fields.ignore }); return { ignore: profiles.active().ignore, profileId: profiles.snapshot().activeId }; },
    'rules:quickSet': (_e, payload) => profilePayload(corrections.quickSet(validateIpcPayload('rules:quickSet', payload))),
    'corrections:undo': (_e, payload) => {
      const result = corrections.undo(validateIpcPayload('corrections:undo', payload));
      return result.kind === 'rule' ? profilePayload(result) : result;
    },
    'apps:correctWithUndo': (_e, payload) => {
      const { id, category } = validateIpcPayload('apps:correctWithUndo', payload);
      return corrections.correctActivity(id, category);
    },
    'updates:get': () => updates.snapshot(),
    'updates:check': () => updates.check(),
    'updates:openRelease': () => ({ ok: true, url: updates.availableUrl() }),
    'profiles:delete': (_e, id) => profiles.remove(id),
    'rules:get': () => ({ ...profiles.active(), profileId: profiles.snapshot().activeId }),
    'ignore:get': () => ({ ignore: profiles.active().ignore, profileId: profiles.snapshot().activeId }),
    'session:start': (_e, options) => sessions.startSession(options),
    'session:stop': () => sessions.stopSession(),
    'session:getActive': () => sessions.getActiveSession(),
    'session:getForDay': (_e, date) => ({ date: date || require('../src/store').todayKey(),
      sessions: sessions.getSessionsForDay(date), recentDays: sessions.getRecentSessionDays(14), historyEnabled: true }),
    'settings:update': (_e, partial) => store.updateSettings(validateIpcPayload('settings:update', partial)),
    'keywords:get': () => ({ productive: [], unproductive: [] }),
    'keywords:set': (_e, keywords) => keywords,
    'keywords:reset': () => ({ productive: [], unproductive: [] }),
    'history:summary': () => [],
    'history:timelineDay': (_e, date) => store.timelineDay(date)
    ,'apps:correctOtherToday': (_e, payload) => store.correctOtherAppToday(payload.name, payload.category)
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  const win = new BrowserWindow({ show: false, width: 1040, height: 900,
    webPreferences: { preload: path.join(__dirname, '../src/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  await win.webContents.executeJavaScript(`(async () => {
    await window.sydtrackProfilesUI.reload();
    await loadRulesAndIgnore();
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const wait = async predicate => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('UI wait timed out'); };
    for (const theme of ['tide', 'linen', 'plum']) {
      document.querySelector('[data-theme-id="' + theme + '"]').click();
      await wait(async () => (await window.sydtrack.getState()).settings.theme === theme);
      check(document.documentElement.dataset.theme === theme, 'Theme click updates the renderer');
      check(document.querySelector('[data-theme-id="' + theme + '"]').getAttribute('aria-pressed') === 'true', 'Theme click updates selection');
    }
    document.getElementById('focus-profile-btn').click();
    await wait(() => !document.getElementById('focus-profile-menu').classList.contains('hidden'));
    check(document.querySelectorAll('.profile-choice').length === 5, 'Expected five Home options');
    document.querySelectorAll('.profile-choice')[1].click();
    await window.sydtrackProfilesUI.reload();
    check(document.getElementById('profile-name').value === '', 'Empty slot should not contain generated tags');
    document.getElementById('profile-name').value = 'Coding';
    document.getElementById('profile-save-named').click();
    await wait(() => document.getElementById('focus-profile-label').textContent === 'Coding');
    check(!document.getElementById('view-tags').classList.contains('hidden'), 'New slot opens Focus Tags');
    check(!document.querySelector('#view-settings #profile-settings'), 'No duplicate Settings editor');
    document.getElementById('tags-quick-input').value = 'code';
    await tagsQuickAdd('productive');
    check((await window.sydtrack.getProfiles()).profiles.find(p => p.name === 'Coding').productive.includes('code'), 'Quick Add saves active profile');
    document.getElementById('rules-prod-edit').value = 'unsaved';
    window.confirm = () => false;
    const selector = document.getElementById('profile-editor-select');
    selector.value = 'default'; selector.dispatchEvent(new Event('change'));
    check(document.getElementById('rules-prod-edit').value === 'unsaved' && selector.value !== 'default', 'Canceled switch preserves draft and selection');
    await window.sydtrackProfilesUI.cycleProfile();
    check(document.getElementById('focus-profile-label').textContent === 'Coding' && document.getElementById('rules-prod-edit').value === 'unsaved', 'Shortcut does not discard unsaved tags');
    document.getElementById('profile-rename-named').click();
    document.getElementById('profile-name').value = 'Default';
    document.getElementById('profile-save-named').click();
    await wait(() => document.getElementById('profiles-status').textContent.includes('already exists'));
    check(document.getElementById('rules-prod-edit').value === 'unsaved', 'Failed rename preserves tags');
    document.getElementById('profile-name').value = 'Development';
    document.getElementById('profile-save-named').click();
    await wait(() => document.getElementById('focus-profile-label').textContent === 'Development');
    check(document.getElementById('rules-prod-edit').value === 'unsaved', 'Rename preserves unsaved tags');
    check((await window.sydtrack.getProfiles()).profiles.find(p => p.name === 'Development').productive.includes('code'), 'Rename does not save tag draft');
    window.confirm = () => true;
    selector.value = 'default'; selector.dispatchEvent(new Event('change'));
    await wait(() => document.getElementById('focus-profile-label').textContent === 'default');
    check(document.getElementById('rules-prod-edit').value === '', 'Switch loads selected profile tags');
    document.querySelector('.nav-btn[data-tab="home"]').click();
    document.getElementById('focus-profile-btn').click();
    await wait(() => !document.getElementById('focus-profile-menu').classList.contains('hidden'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    check(document.getElementById('focus-profile-btn').getAttribute('aria-expanded') === 'false', 'Escape must close the chooser');
    await window.sydtrackProfilesUI.cycleProfile();
    await wait(() => document.getElementById('focus-profile-label').textContent === 'Development');
    check(document.getElementById('home-profile-status').textContent.includes('Development'), 'Shortcut cycle confirms the active profile');
    await window.sydtrackProfilesUI.cycleProfile();
    await wait(() => document.getElementById('focus-profile-label').textContent === 'default');
    fillRulesEditors(await window.sydtrack.setRules({ productive: ['code'], unproductive: [], other: [] }));
    renderLastFocused({ app: 'Code', title: 'Project', category: 'productive' }, null);
    document.getElementById('lf-other').click();
    await wait(async () => (await window.sydtrack.getProfiles()).profiles.find(p => p.id === 'default').other.includes('code'));
    check(lastFocusedCache.category === 'other' && document.getElementById('lf-other').classList.contains('selected'), 'Home O saves and displays the neutral rule');
    document.getElementById('lf-prod').click();
    await wait(async () => { const p = (await window.sydtrack.getProfiles()).profiles.find(p => p.id === 'default'); return p.productive.includes('code') && !p.other.includes('code'); });
    check(lastFocusedCache.category === 'productive', 'Home P replaces an Other override');
    fillRulesEditors(await window.sydtrack.setRules({ productive: ['jhu'], unproductive: ['r/'], other: [] }));
    renderLastFocused({ app: 'chrome', title: 'Discussion - r/jhu', category: 'unproductive' });
    const saveSource = quickClassifyLastFocused('productive');
    check(document.getElementById('lf-prod').disabled && document.getElementById('lf-ignore').disabled, 'Quick rules lock during a save');
    await quickClassifyLastFocused('unproductive');
    renderLastFocused({ app: 'chrome', title: 'Another page - r/gaming', category: 'unproductive' });
    await saveSource;
    const saved = (await window.sydtrack.getProfiles()).profiles.find(p => p.id === 'default');
    check(saved.productive.includes('r/jhu') && saved.unproductive.includes('r/'), 'Home saves a precise subreddit exception, not a topic rule');
    check(lastFocusedCache.title.includes('r/gaming') && lastFocusedCache.category === 'unproductive', 'A late save must not relabel a newly focused page');
    check(!document.getElementById('lf-prod').disabled, 'Quick rules unlock after saving');
    await ignoreLastFocused();
    check(lastFocusedCache.category === 'ignored', 'Home I saves a whole-browser Ignore rule');
    await quickClassifyLastFocused('productive');
    const restored = (await window.sydtrack.getProfiles()).profiles.find(p => p.id === 'default');
    check(restored.productive.includes('r/gaming') && !restored.ignore.includes('chrome'), 'Moving from Ignore to P saves both changes atomically');
    renderLastFocused({ app: 'chrome', title: 'Google - Google Chrome', category: 'other' });
    check(!document.getElementById('lf-prod').disabled && document.getElementById('lf-cat').textContent === 'other', 'Unknown browser pages stay Other until a specific phrase is confirmed');
    document.getElementById('lf-prod').click();
    check(!document.getElementById('quick-rule-picker').classList.contains('hidden') && document.getElementById('quick-rule-keyword').value === '', 'Unrecognized page opens a blank phrase picker, never a guessed rule');
    document.getElementById('quick-rule-keyword').value = 'Google Chrome';
    document.getElementById('quick-rule-picker').requestSubmit();
    check(document.getElementById('quick-rule-status').textContent.includes('whole words'), 'Browser suffix is not offered as a blanket rule');
    document.getElementById('quick-rule-keyword').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check(document.getElementById('quick-rule-picker').classList.contains('hidden') && document.activeElement.id === 'lf-prod', 'Escape closes the phrase picker and restores focus');
    renderLastFocused({ app: 'chrome', title: 'A guide to linear algebra - Google Chrome', category: 'other' });
    document.getElementById('lf-prod').click();
    const preview = document.getElementById('quick-rule-title');
    check(preview.textContent === 'A guide to linear algebra', 'Picker removes the browser suffix');
    const range = document.createRange(); range.setStart(preview.firstChild, 11); range.setEnd(preview.firstChild, 25);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    preview.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    check(document.getElementById('quick-rule-keyword').value === 'linear algebra', 'Selecting literal title words fills the phrase field');
    selection.removeAllRanges();
    document.getElementById('quick-rule-picker').requestSubmit();
    await wait(() => !lfClassifySaving && document.getElementById('quick-rule-picker').classList.contains('hidden'));
    check(cachedRules.productive.includes('linear algebra') && lastFocusedCache.category === 'productive', 'Confirmed phrase saves a future rule and updates the actual outline');
    check(!document.getElementById('correction-undo').classList.contains('hidden'), 'Rule change exposes a transient Undo');
    document.getElementById('correction-undo-action').click();
    await wait(() => !lfClassifySaving && document.getElementById('correction-undo').classList.contains('hidden'));
    check(!cachedRules.productive.includes('linear algebra') && lastFocusedCache.category === 'other', 'Home Undo removes only the newly saved phrase');
    document.getElementById('lf-prod').click();
    renderLastFocused({ app: 'chrome', title: 'Another unknown page - Google Chrome', category: 'other' });
    check(document.getElementById('quick-rule-picker').classList.contains('hidden'), 'A new page cancels an unconfirmed phrase draft');
    document.getElementById('rules-prod-edit').value += '\\nunsaved';
    document.getElementById('lf-prod').click();
    check(document.getElementById('quick-rule-picker').classList.contains('hidden') && document.getElementById('home-profile-status').textContent.includes('Save your Focus Tags'), 'Home corrections do not overwrite unsaved tags');
    await loadRulesAndIgnore();

    document.querySelector('.nav-btn[data-tab="analytics"]').click();
    document.querySelector('.analytics-apps-tab').click();
    setAppsRange('day');
    const initialStats = (await window.sydtrack.getState()).stats;
    renderStats(initialStats);
    const github = initialStats.activityRows.find(row => row.reason === 'github');
    const rowSelector = '.app-activity[data-row-id="' + encodeURIComponent(github.id) + '"]';
    document.querySelector('.app-group[data-group-name="Chrome"] summary').click();
    const choice = document.querySelector(rowSelector + ' [data-category="unproductive"]');
    check(!!choice && !choice.disabled, 'A recognized match remains correctable');
    choice.click();
    await wait(() => !appCorrectionBusy);
    check((await window.sydtrack.getState()).stats.byCategory.unproductive === 30, 'Analytics button changes only the match for today');
    document.getElementById('correction-undo-action').click();
    await wait(() => !appCorrectionBusy && document.getElementById('correction-undo').classList.contains('hidden'));
    check((await window.sydtrack.getState()).stats.byCategory.productive === initialStats.byCategory.productive, 'Analytics Undo restores today’s totals');

    document.querySelector('.nav-btn[data-tab="settings"]').click();
    check(!document.getElementById('updates-auto').checked, 'Automatic network checks start off');
    document.getElementById('updates-check').click();
    await wait(() => document.getElementById('updates-status').textContent.includes('v99.0.0'));
    check(!document.getElementById('updates-open').classList.contains('hidden') && document.querySelector('.nav-btn[data-tab="settings"]').classList.contains('update-available'), 'Available version gets a release action and quiet Settings marker');
    check(!document.getElementById('updates-auto').checked, 'Manual check does not silently opt in');
    document.getElementById('updates-auto').checked = true;
    document.getElementById('updates-auto').dispatchEvent(new Event('change'));
    await wait(async () => (await window.sydtrack.getState()).settings.updateChecksEnabled === true);
    document.getElementById('updates-auto').checked = false;
    document.getElementById('updates-auto').dispatchEvent(new Event('change'));
    await wait(async () => (await window.sydtrack.getState()).settings.updateChecksEnabled === false);
    fillRulesEditors(await window.sydtrack.setRules({ productive: ['code'], unproductive: [], other: [] }));
    document.querySelector('.nav-btn[data-tab="tags"]').click();
    check(!document.getElementById('tags-other-card') && document.getElementById('rules-other-edit').value === '', 'Redundant inbox is gone and neutral overrides remain editable');
    document.querySelector('.nav-btn[data-tab="home"]').click();
  })()`);
  if (createStore(root).getSettings().theme !== 'plum') throw new Error('New theme did not survive a settings reload');
  for (const width of [800, 1040, 1600]) {
    win.setSize(width, 850);
    const pickerLayout = await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('.nav-btn[data-tab="home"]').click();
      applyTheme('midnight');
      renderLastFocused({ app: 'chrome', title: 'A guide to linear algebra - Google Chrome', category: 'other' });
      document.getElementById('lf-prod').click();
      document.getElementById('quick-rule-keyword').value = 'linear algebra';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const picker = document.getElementById('quick-rule-picker');
      const card = document.getElementById('last-focused').getBoundingClientRect();
      const save = document.getElementById('quick-rule-save').getBoundingClientRect();
      const input = document.getElementById('quick-rule-keyword').getBoundingClientRect();
      return { shown: !picker.classList.contains('hidden'), inputInside: input.left >= card.left && input.right <= card.right,
        saveInside: save.left >= card.left && save.right <= card.right && save.bottom <= innerHeight,
        noPageOverflow: document.querySelector('.main').scrollWidth <= document.querySelector('.main').clientWidth };
    })()`);
    if (!Object.values(pickerLayout).every(Boolean)) throw new Error('Quick picker layout failed: ' + JSON.stringify({ width, ...pickerLayout }));
    console.log('Quick picker layout', width, pickerLayout);
    if (width === 1040) fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-quick-rule-picker.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.getElementById('quick-rule-cancel').click()`);
  }
  win.setSize(1040, 900);
  await win.webContents.executeJavaScript(`(async () => {
    renderLastFocused({ app: 'Code', title: 'Project', category: 'productive' });
    await quickClassifyLastFocused('other');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-correction-undo.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('correction-undo-action').click();
    for (let i = 0; i < 100 && lfClassifySaving; i++) await new Promise(resolve => setTimeout(resolve, 20));
    document.querySelector('.nav-btn[data-tab="settings"]').click();
    document.getElementById('settings-updates-card').scrollIntoView({ block: 'center' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-update-checker.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.nav-btn[data-tab="home"]').click();`);
  console.log('Theme persistence UI checks passed: three new picker choices, validated preload saves, settings reload.');
  console.log('Correction and update UI checks passed: literal selection, explicit confirmation, cancellation, unsaved edits, Home/Analytics Undo and opt-in checks.');
  win.webContents.send('profiles:cycle-requested');
  await win.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 100 && document.getElementById('focus-profile-label').textContent !== 'Development'; i++)
      await new Promise(resolve => setTimeout(resolve, 20));
    if (document.getElementById('focus-profile-label').textContent !== 'Development') throw new Error('Preload shortcut event did not cycle profiles');
    await window.sydtrackProfilesUI.cycleProfile();
  })()`);
  for (const width of [800, 1040, 1600]) {
    win.setSize(width, 800);
    const layout = await win.webContents.executeJavaScript(`(async () => {
      document.getElementById('focus-profile-btn').click();
      await window.sydtrackProfilesUI.reload(false);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const boost = document.getElementById('focusboost-btn').getBoundingClientRect();
      const trigger = document.getElementById('focus-profile-btn').getBoundingClientRect();
      const menu = document.getElementById('focus-profile-menu').getBoundingClientRect();
      const last = document.querySelector('.profile-choice:last-child').getBoundingClientRect();
      const hit = document.elementFromPoint(last.x + last.width / 2, last.y + last.height / 2);
      const total = document.getElementById('pie-total');
      total.textContent = '23h 59m';
      const totalBox = total.getBoundingClientRect();
      const centerBox = document.querySelector('.pie-center').getBoundingClientRect();
      return { below: trigger.top >= boost.bottom, menuInside: menu.right <= innerWidth && menu.left >= 0,
        clickable: !!hit && !!hit.closest('.profile-choice'),
        totalInside: totalBox.left >= centerBox.left && totalBox.right <= centerBox.right,
        lastFocusedDirection: getComputedStyle(document.querySelector('.last-focused .lf-row')).flexDirection };
    })()`);
    console.log('Profile chooser layout', width, layout);
    if (!layout.below || !layout.menuInside || !layout.clickable || !layout.totalInside) throw new Error('Profile chooser or Home total layout failed');
    if (width === 1040 && layout.lastFocusedDirection !== 'column') throw new Error('Compact Last focused card did not stack');
    if (width === 1600 && layout.lastFocusedDirection !== 'row') throw new Error('Wide Last focused card should stay inline');
    if (width === 1040) fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-profiles-home.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  }
  await win.webContents.executeJavaScript(`(async () => { document.querySelector('.nav-btn[data-tab="tags"]').click(); await window.sydtrackProfilesUI.reload(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); })()`);
  await new Promise(resolve => setTimeout(resolve, 300));
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-profiles-settings.png'), (await win.webContents.capturePage()).toPNG());
  console.log('Profile UI checks passed: create, activate, failed save, draft cancellation, five slots, keyboard dismissal.');
  await win.webContents.executeJavaScript(`(async () => {
    const check = (value, message) => { if (!value) throw new Error(message); };
    const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Historical intention check timed out'); };
    document.querySelector('.nav-btn[data-tab="sessions"]').click();
    check(!document.getElementById('session-intention'), 'Intention input is absent from the simplified timer');
    const session = await window.sydtrack.startSession({ mode: 'pomodoro', intention: 'Draft <milestone>' });
    renderActiveSession(session);
    refreshSessionLog();
    check((await window.sydtrack.getActiveSession()).intention === 'Draft <milestone>', 'Existing intention data remains supported');
    await wait(() => document.getElementById('session-log-list').textContent.includes('Draft <milestone>'));
    check(!document.querySelector('#session-log-list milestone'), 'Session label is escaped');
    await stopFocusSession();
    await wait(() => !!document.querySelector('#session-log-list .session-log-item[data-status="stopped"]'));
    check(document.getElementById('session-log-list').textContent.includes('Draft <milestone>'), 'Completed log keeps intention');
    document.querySelector('#session-log-list .session-log-summary').click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-session-intention.png'), (await win.webContents.capturePage()).toPNG());
  console.log('Historical intention UI checks passed: simplified timer, escaped history, completion.');
  await win.webContents.executeJavaScript(`document.getElementById('profile-rename-named').click(); document.getElementById('profile-name-form').scrollIntoView({ block: 'end' });`);
  await new Promise(resolve => setTimeout(resolve, 300));
  fs.writeFileSync(path.join(os.tmpdir(), 'sydtrack-profile-name-editor.png'), (await win.webContents.capturePage()).toPNG());
  app.exit(0);
}).catch(err => { console.error(err); app.exit(1); });
setTimeout(() => { console.error('Profile UI checks timed out'); app.exit(1); }, 45000).unref();
