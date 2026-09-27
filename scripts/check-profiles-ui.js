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
const { createSessionManager } = require('../src/sessions');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-profile-ui-'));
app.setPath('userData', root); app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const store = createStore(root);
  store.addSeconds('Chrome', 'other', 60, { category: 'other', reason: 'No matching keyword' });
  store.addSeconds('Chrome', 'productive', 30, { category: 'productive', reason: 'github' });
  store.addSeconds('Code', 'other', 20);
  store.addSeconds('Spotify', 'other', 15);
  const profiles = createFocusProfiles({ dataDir: root, rules: { productive: [], unproductive: [] }, ignore: [] });
  const sessions = createSessionManager({ dataDir: root, getSettings: () => store.getSettings() });
  const handlers = {
    'state:get': () => ({ stats: store.snapshot(), now: null, session: null }),
    'profiles:get': () => profiles.snapshot(),
    'profiles:save': (_e, { id, fields }) => profiles.save(id, fields),
    'profiles:activate': (_e, id) => profiles.activate(id),
    'profiles:cycle': () => {
      const current = profiles.snapshot();
      const index = current.profiles.findIndex(profile => profile.id === current.activeId);
      return profiles.activate(current.profiles[(index + 1) % current.profiles.length].id);
    },
    'rules:set': (_e, fields) => { profiles.save(profiles.snapshot().activeId, { productive: fields.productive, unproductive: fields.unproductive,
      other: fields.other === undefined ? profiles.active().other : fields.other }); return { ...profiles.active(), profileId: profiles.snapshot().activeId }; },
    'ignore:set': (_e, fields) => { profiles.save(profiles.snapshot().activeId, { ignore: fields.ignore }); return { ignore: profiles.active().ignore, profileId: profiles.snapshot().activeId }; },
    'profiles:delete': (_e, id) => profiles.remove(id),
    'rules:get': () => ({ ...profiles.active(), profileId: profiles.snapshot().activeId }),
    'ignore:get': () => ({ ignore: profiles.active().ignore, profileId: profiles.snapshot().activeId }),
    'session:start': (_e, options) => sessions.startSession(options),
    'session:stop': () => sessions.stopSession(),
    'session:getActive': () => sessions.getActiveSession(),
    'session:getForDay': (_e, date) => ({ date: date || require('../src/store').todayKey(),
      sessions: sessions.getSessionsForDay(date), recentDays: sessions.getRecentSessionDays(14), historyEnabled: true }),
    'settings:update': (_e, partial) => store.updateSettings(partial),
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
    document.querySelector('.nav-btn[data-tab="tags"]').click();
    check(!document.getElementById('tags-other-card') && document.getElementById('rules-other-edit').value === '', 'Redundant inbox is gone and neutral overrides remain editable');
    document.querySelector('.nav-btn[data-tab="home"]').click();
  })()`);
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
