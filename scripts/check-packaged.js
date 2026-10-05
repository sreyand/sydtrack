'use strict';

// Release diagnostic: inspect and launch the actual packaged executable.
// Pause BEFORE app code runs to isolate data and intercept OS startup writes.
// No installer is run and no personal foreground titles are captured.
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const asar = require('@electron/asar');
const version = require('../package.json').version;
const workspace = path.resolve(__dirname, '..');
const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-packaged-'));
const sevenZip = path.join(workspace, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const has25Features = releaseVersion => {
  const [major, minor] = String(releaseVersion).split('.').map(Number);
  return major > 2 || (major === 2 && minor >= 5);
};
const sha256 = content => crypto.createHash('sha256').update(content).digest('hex');

function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}

function verifyPayload(dir) {
  const archive = path.join(dir, 'resources', 'app.asar');
  const packaged = JSON.parse(asar.extractFile(archive, 'package.json'));
  assert.equal(packaged.version, version);
  assert.equal(packaged.main, 'src/main.js');
  const entries = asar.listPackage(archive).map(entry => entry.replace(/\\/g, '/'));
  assert(!entries.some(entry => /^\/(data|docs|scripts|\.git)\//.test(entry)), 'No development or personal data in archive');
  assert(!entries.some(entry => /\.DELETE\./.test(entry)), 'No stale native-build backups');
  const releaseFiles = ['src/classification-explanation.js', 'src/tray.js', 'src/tray-state.js',
    'renderer/category-explanation-ui.js', 'renderer/quick-corrections-ui.js',
    ...['standard', 'productive', 'unproductive', 'other'].map(name => `renderer/assets/tray/${name}.png`)];
  // Feature requirements follow the archive version, not a hardcoded current
  // palette or a blanket assertion against frozen pre-2.5 release payloads.
  if (has25Features(packaged.version)) releaseFiles.push('renderer/schedule-time-ui.js', 'renderer/schedule-time.css',
    'renderer/wellbeing-ui.js', 'renderer/lib/goals.js', 'renderer/lib/day-timeline.js', 'src/timed-pause.js');
  for (const file of releaseFiles) assert(entries.includes('/' + file), `Release feature included: ${file}`);
  const html = asar.extractFile(archive, 'renderer/index.html').toString('utf8');
  assert(html.includes('<script src="../src/classification-explanation.js"></script>'), 'Shared explanation formatter loaded');
  assert(html.includes('<script src="category-explanation-ui.js"></script>'), 'Category explanation UI loaded');
  if (has25Features(packaged.version)) {
    assert(html.includes('<script src="schedule-time-ui.js"></script>'), 'Exact-minute schedule picker loaded');
    assert(html.includes('<link rel="stylesheet" href="schedule-time.css" />'), 'Schedule picker stylesheet loaded');
  }
  const sourceFiles = ['src', 'renderer'].flatMap(folder => filesIn(path.join(workspace, folder)));
  for (const file of sourceFiles) {
    const relative = path.relative(workspace, file);
    assert(asar.extractFile(archive, relative).equals(fs.readFileSync(file)), `Packaged source matches: ${relative}`);
  }
  assert(fs.existsSync(path.join(dir, 'resources', 'app.asar.unpacked', 'node_modules', 'active-win',
    'lib', 'binding', 'napi-6-win32-unknown-x64', 'node-active-win.node')), 'Windows native binding included');
  assert(fs.readFileSync(path.join(dir, 'resources', 'get-foreground.ps1')).equals(
    fs.readFileSync(path.join(workspace, 'scripts', 'get-foreground.ps1'))), 'Foreground probe included');
  assert(fs.readFileSync(path.join(dir, 'resources', 'get-browser-address.ps1')).equals(
    fs.readFileSync(path.join(workspace, 'scripts', 'get-browser-address.ps1'))), 'Browser address probe included');
  assert(fs.readFileSync(path.join(dir, 'resources', 'sydtrack.ico')).equals(
    fs.readFileSync(path.join(workspace, 'renderer', 'assets', 'sydtrack.ico'))), 'Windows shell icon included');
  return { version: packaged.version, sourceFiles: sourceFiles.length,
    releaseFiles: releaseFiles.length,
    archiveFiles: entries.filter(entry => !asar.statFile(archive, path.join(...entry.slice(1).split('/'))).files).length,
    featureSha256: Object.fromEntries(releaseFiles.filter(file => /\.(js|css)$/.test(file))
      .map(file => [file, sha256(asar.extractFile(archive, path.join(...file.split('/'))))])),
    archiveSha256: sha256(fs.readFileSync(archive)) };
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let next = 0;
  const requests = new Map(), events = new Map();
  socket.addEventListener('message', message => {
    const data = JSON.parse(message.data);
    if (data.id) {
      const request = requests.get(data.id);
      if (request) {
        clearTimeout(request.timer); requests.delete(data.id);
        data.error ? request.reject(new Error(`${request.method}: ${data.error.message}`)) : request.resolve(data.result);
      }
    } else if (events.has(data.method)) {
      const event = events.get(data.method); events.delete(data.method);
      clearTimeout(event.timer); event.resolve(data.params);
    }
  });
  return {
    request(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { requests.delete(id); reject(new Error(`Inspector timeout: ${method}`)); }, 15000);
        requests.set(id, { resolve, reject, timer, method });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    event(method) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { events.delete(method); reject(new Error(`Inspector event timeout: ${method}`)); }, 15000);
        events.set(method, { resolve, timer });
      });
    },
    close() { socket.close(); }
  };
}

async function launch(executable, userData, label, existing = false, expectedTotals = null, historicalDate = null) {
  const env = { ...process.env, SYDTRACK_DEMO: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, ['--inspect-brk=127.0.0.1:0', '--hidden'], {
    env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let inspector, output = '';
  const exited = new Promise(resolve => child.once('exit', resolve));
  const inspectorUrl = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No inspector started: ${label}\n${output}`)), 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      output = (output + chunk).slice(-16000);
      const match = output.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  async function evaluate(expression) {
    // Electron's Node inspector can collect its own awaitPromise wrapper.
    // Keep the promise in the main context and poll its settled value instead.
    const started = await inspector.request('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const record = { done: false };
      globalThis.__packagedPending = record;
      try {
        record.pending = (${expression});
        if (record.pending && typeof record.pending.then === 'function') {
          record.pending.then(value => { record.value = value; record.done = true; },
            error => { record.error = String(error.stack || error); record.done = true; });
        } else { record.value = record.pending; record.done = true; }
      } catch (error) { record.error = String(error.stack || error); record.done = true; }
    })()` });
    if (started.exceptionDetails) throw new Error(started.exceptionDetails.exception?.description || started.exceptionDetails.text);
    for (let i = 0; i < 500; i++) {
      const result = await inspector.request('Runtime.evaluate', { returnByValue: true, expression:
        'globalThis.__packagedPending.done ? {done: true, value: globalThis.__packagedPending.value, error: globalThis.__packagedPending.error} : null' });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      const settled = result.result?.value;
      if (settled?.done) {
        if (settled.error) throw new Error(settled.error);
        return settled.value;
      }
      await pause(20);
    }
    throw new Error(`Packaged evaluation timed out: ${expression.slice(0, 200)}`);
  }
  async function renderer(expression) {
    return evaluate(`globalThis.__packagedElectron.BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(${JSON.stringify(expression)})`);
  }
  async function waitFor(expression, message) {
    // Poll from the diagnostic process: hidden production windows may throttle
    // renderer timers, but should never need to become visible for this check.
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await renderer(`Boolean(${expression})`)) return;
      await pause(30);
    }
    throw new Error(`${label}: ${message}`);
  }
  async function verify25Settings() {
    await renderer(`document.querySelector('.nav-btn[data-tab="settings"]').click();
      document.querySelector('[data-settings-tab="notifications"]').click()`);
    await renderer(`pushSettings({ focusBoostScheduleEnabled: true, focusBoostScheduleStart: '09:07', focusBoostScheduleEnd: '23:59' })`);
    const scheduleStructure = await renderer(`(() => ({
      module: typeof window.sydtrackScheduleTimeUI?.sync,
      stylesheet: [...document.styleSheets].some(sheet => sheet.href === 'sydtrack://app/renderer/schedule-time.css' && sheet.cssRules.length > 0),
      controls: ['start', 'end'].map(which => {
        const input = document.getElementById('fb-schedule-' + which);
        const trigger = document.getElementById(input.id + '-trigger');
        const popover = document.getElementById(input.id + '-popover');
        return { native: input.type, hidden: input.hidden && input.getClientRects().length === 0,
          active: !trigger.hidden && !trigger.disabled, display: getComputedStyle(trigger).display,
          linked: trigger.tagName === 'BUTTON' && trigger.type === 'button' && trigger.getAttribute('aria-haspopup') === 'dialog' &&
            trigger.getAttribute('aria-controls') === popover.id && popover.getAttribute('role') === 'dialog',
          minutes: [...popover.querySelectorAll('[data-time-unit="minute"] [data-time-option]')].map(option => Number(option.dataset.timeOption)) };
      })
    }))()`);
    assert.equal(scheduleStructure.module, 'function', 'Schedule picker actually instantiated through production protocol');
    assert.equal(scheduleStructure.stylesheet, true, 'Schedule stylesheet actually parsed through production protocol');
    for (const control of scheduleStructure.controls) {
      assert.equal(control.native, 'time'); assert.equal(control.hidden, true); assert.equal(control.active, true);
      assert.equal(control.linked, true); assert.notEqual(control.display, 'none');
      assert.deepEqual(control.minutes, Array.from({ length: 60 }, (_, minute) => minute), 'All exact minutes are available');
    }
    for (const [which, time] of [['start', '23:47'], ['end', '00:03']]) {
      const selected = await renderer(`(() => {
        const id = 'fb-schedule-${which}';
        const input = document.getElementById(id), trigger = document.getElementById(id + '-trigger');
        trigger.click();
        const popover = document.getElementById(id + '-popover');
        if (popover.hidden || trigger.getAttribute('aria-expanded') !== 'true') throw Error('Packaged time picker did not open');
        const period = popover.querySelector('[data-time-unit="period"]');
        const [hour, minute] = ${JSON.stringify(time)}.split(':').map(Number);
        const units = { hour: period ? hour % 12 || 12 : hour, minute, period: hour >= 12 ? 1 : 0 };
        const before = input.value;
        for (const [unit, value] of Object.entries(units)) {
          const group = popover.querySelector('[data-time-unit="' + unit + '"]');
          group?.querySelector('[data-time-option="' + value + '"]').click();
        }
        const draftOnly = input.value === before;
        popover.querySelector('[data-time-action="save"]').click();
        return draftOnly;
      })()`);
      assert.equal(selected, true, 'Schedule draft does not replace confirmed time before save');
      await waitFor(`document.getElementById('fb-schedule-${which}-trigger').dataset.time === ${JSON.stringify(time)} &&
        !document.getElementById('fb-schedule-${which}-trigger').disabled`, 'Exact-minute schedule commit did not settle');
      const settings = (await renderer('window.sydtrack.getState()')).stats.settings;
      assert.equal(settings[which === 'start' ? 'focusBoostScheduleStart' : 'focusBoostScheduleEnd'], time, 'Exact minute saved through production preload/IPC');
      assert.equal(await renderer(`(() => {
        const [hour, minute] = ${JSON.stringify(time)}.split(':').map(Number);
        return document.getElementById('fb-schedule-${which}-value').textContent ===
          new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hour, minute));
      })()`), true, 'Trigger localizes the exact saved time');
    }
    await renderer('pushSettings({ focusBoostScheduleEnabled: false })');
    assert.equal(await renderer(`['start', 'end'].every(which => document.getElementById('fb-schedule-' + which).disabled &&
      document.getElementById('fb-schedule-' + which + '-trigger').disabled)`), true, 'Schedule off disables both backing inputs and custom controls');

    await renderer(`document.querySelector('[data-settings-tab="wellbeing"]').click(); pushSettings({ breakReminderEnabled: false })`);
    const breaks = await renderer(`(() => {
      const field = document.getElementById('break-reminder-field'), minutes = document.getElementById('break-reminder-minutes');
      return { inline: field.contains(minutes) && field.contains(document.getElementById('break-reminder-label')) &&
        field.contains(document.getElementById('break-reminder-unit')) && getComputedStyle(field).display === 'flex',
        regular: getComputedStyle(document.getElementById('break-reminder-label')).fontWeight === '400',
        noHint: !document.getElementById('settings-breaks').querySelector('.hint'), disabled: minutes.disabled };
    })()`);
    for (const [name, passed] of Object.entries(breaks)) assert.equal(passed, true, `Inline Breaks ${name}`);
    await renderer(`document.getElementById('break-reminder-toggle').click()`);
    await waitFor(`!document.getElementById('break-reminder-minutes').disabled && latestGoalSettings.breakReminderEnabled === true`, 'Break minute input did not enable');
    await renderer(`(() => { const input = document.getElementById('break-reminder-minutes'); input.value = '75'; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor('latestGoalSettings.breakReminderMinutes === 75', 'Break minutes did not save');
    assert.equal((await renderer('window.sydtrack.getState()')).stats.settings.breakReminderMinutes, 75);
    await renderer(`document.getElementById('break-reminder-toggle').click()`);
    await waitFor(`document.getElementById('break-reminder-minutes').disabled && latestGoalSettings.breakReminderEnabled === false`, 'Break minute input did not disable');

    await renderer(`document.querySelector('[data-settings-tab="tracking"]').click()`);
    assert.equal(await renderer(`!document.getElementById('pause-15-btn') && !document.querySelector('#pause-settings-btn.power-btn')`), true, 'Old redundant pause controls are absent');
    const choices = await renderer(`[...document.querySelectorAll('#pause-settings-menu button')].map(button => ({ minutes: Number(button.dataset.pauseMinutes), role: button.getAttribute('role'), type: button.type }))`);
    assert.deepEqual(choices.map(choice => choice.minutes), [15, 30, 60, 0]);
    assert(choices.every(choice => choice.role === 'menuitem' && choice.type === 'button'), 'Pause choices are native accessible menu buttons');
    for (const minutes of [15, 30, 60]) {
      // Main tracking remains paused throughout. Only synthesize the live UI
      // state needed to select another duration; never resume or probe a window.
      assert.equal((await renderer('window.sydtrack.getState()')).stats.settings.trackingPaused, true);
      await renderer(`applySettingsInputs({ ...latestGoalSettings, trackingPaused: false, trackingPauseUntil: 0 });
        document.getElementById('pause-settings-btn').click()`);
      assert.equal(await renderer(`!document.getElementById('pause-settings-menu').classList.contains('hidden') &&
        document.getElementById('pause-settings-btn').getAttribute('aria-expanded') === 'true'`), true, 'Production pause menu opens');
      const startedAt = Date.now();
      await renderer(`document.querySelector('#pause-settings-menu [data-pause-minutes="${minutes}"]').click()`);
      await waitFor(`!pauseActionBusy && latestGoalSettings.trackingPaused === true &&
        Math.abs(latestGoalSettings.trackingPauseUntil - ${startedAt + minutes * 60000}) < 10000`, 'Timed pause choice did not reach production settings');
      const pausedSettings = (await renderer('window.sydtrack.getState()')).stats.settings;
      assert.equal(pausedSettings.trackingPaused, true);
      assert(Math.abs(pausedSettings.trackingPauseUntil - (startedAt + minutes * 60000)) < 10000, 'Timed pause duration is exact');
      assert.equal(await renderer(`document.getElementById('pause-settings-label').textContent === 'Resume tracking' &&
        !document.getElementById('pause-settings-btn').hasAttribute('aria-haspopup') &&
        document.getElementById('pause-settings-menu').classList.contains('hidden') &&
        document.getElementById('pause-until-status').textContent.includes('Resumes at') &&
        document.getElementById('pause-btn').dataset.paused === 'on'`), true, 'Timed pause synchronizes Settings and sidebar without a paused menu');
    }
    const legacy = await renderer('window.sydtrack.pauseFor15Minutes()');
    assert.equal(legacy.trackingPaused, true);
    assert(Math.abs(legacy.trackingPauseUntil - (Date.now() + 15 * 60000)) < 10000, 'Legacy 15-minute preload bridge remains functional');
    await renderer(`applySettingsInputs({ ...latestGoalSettings, trackingPaused: false, trackingPauseUntil: 0 });
      document.getElementById('pause-settings-btn').click();
      document.querySelector('#pause-settings-menu [data-pause-minutes="0"]').click()`);
    await waitFor('!pauseActionBusy && latestGoalSettings.trackingPaused === true && latestGoalSettings.trackingPauseUntil === 0', 'Indefinite pause did not clear the deadline');
    await renderer(`document.querySelector('[data-theme-id="forest"]').click()`);
    await waitFor(`latestGoalSettings.theme === 'forest' && document.documentElement.dataset.theme === 'forest'`, 'Forest theme did not save');
    const persisted = (await renderer('window.sydtrack.getState()')).stats.settings;
    assert.equal(persisted.theme, 'forest'); assert.equal(persisted.trackingPaused, true); assert.equal(persisted.trackingPauseUntil, 0);
    assert.equal(persisted.focusBoostScheduleStart, '23:47'); assert.equal(persisted.focusBoostScheduleEnd, '00:03');
    console.log(`${label}: packaged 2.5 Settings passed: precise overnight schedule, inline Breaks, timed/legacy pause, and Forest save`);
  }
  async function verify25ScoreNavigation(date) {
    const timeline = await renderer(`window.sydtrack.getTimelineDay(${JSON.stringify(date)})`);
    assert.equal(timeline.date, date);
    assert.deepEqual(timeline.byCategory, { productive: 3600, unproductive: 1200, other: 600 }, 'Historical fixture loads through real production preload');
    for (const period of ['week', 'month']) {
      const selector = `[data-score-date="${date}"][data-score-period="${period}"]`;
      await renderer(`document.querySelector('.nav-btn[data-tab="analytics"]').click(); setAnalyticsSegment(${JSON.stringify(period)})`);
      await waitFor(`document.querySelector(${JSON.stringify(selector)})`, `${period} historical score tile did not load`);
      assert.equal(await renderer(`(() => {
        const tile = document.querySelector(${JSON.stringify(selector)});
        return tile.tagName === 'BUTTON' && tile.type === 'button' && !tile.disabled && tile.textContent.includes('75%') &&
          tile.getAttribute('aria-label').includes(${JSON.stringify(date)});
      })()`), true, 'Historical focusscore tile is accessible and uses actual stored totals');
      await renderer(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await waitFor(`analyticsSegment === 'day' && timelineDayData?.date === ${JSON.stringify(date)} &&
        timelineDayData.byCategory.productive === 3600 && timelineDayData.byCategory.unproductive === 1200 &&
        timelineDayData.byCategory.other === 600 && !document.getElementById('timeline-precision').textContent.includes('Loading')`,
      'Score click did not finish loading historical Day Analytics');
      assert.equal(await renderer(`document.getElementById('timeline-date').value === ${JSON.stringify(date)} &&
        document.getElementById('day-total').textContent === '1 hour 30 minutes' &&
        document.getElementById('day-focus-share').textContent === '75%' &&
        !document.getElementById('focus-score-back').classList.contains('hidden') && timelineFollowsToday === false`), true, 'Drill-down retains selected date and metrics');
      await renderer(`document.getElementById('focus-score-back').click()`);
      await waitFor(`analyticsSegment === ${JSON.stringify(period)} &&
        document.activeElement?.matches(${JSON.stringify(selector)}) && document.activeElement.dataset.selected === 'true'`, 'Back did not restore selected source tile and keyboard focus');
      assert.equal(await renderer(`document.getElementById('focus-score-back').classList.contains('hidden')`), true);
    }
    assert.equal(await renderer(`openFocusScoreDay('2000-02-30', 'month')`), false, 'Invalid historical date is rejected');
    console.log(`${label}: packaged focusscore Week/Month → stored historical Day → selected source tile passed`);
  }
  async function verifyReleaseUI(correction, grouped, activeProfile) {
    // Render only known synthetic metadata, with tracking already paused. The
    // production formatter, category UI, and quick-rule save path run unchanged.
    const displayName = activeProfile.id === 'default' && activeProfile.name === 'Default' ? 'default' : activeProfile.name;
    const expectedRuleCopy = 'Matched “reddit” in the ' + displayName + ' profile.';
    const checks = await renderer(`(() => {
      const checks = {};
      const chip = document.getElementById('lf-cat');
      const tip = document.getElementById('lf-explanation');
      const text = document.getElementById('lf-explanation-text');
      const entry = { app: 'Chrome', title: 'Release packaged thread - r/sydtrackpackaged - Reddit',
        category: ${JSON.stringify(grouped.previewCategory)}, explanation: ${JSON.stringify(grouped.previewExplanation)}, browser: true };
      document.getElementById('onboarding-screen').classList.add('hidden');
      document.querySelector('.shell').inert = false;
      renderLastFocused(entry, null);
      checks.categoryButton = chip.tagName === 'BUTTON' && chip.type === 'button' && !chip.disabled &&
        chip.getAttribute('aria-controls') === 'lf-explanation' &&
        chip.getAttribute('aria-label') === 'unproductive. Why this category?';
      checks.disclosedOnDemand = tip.classList.contains('hidden') && chip.getAttribute('aria-expanded') === 'false';
      chip.dispatchEvent(new MouseEvent('mouseenter'));
      checks.trueWinningRule = !tip.classList.contains('hidden') && text.textContent ===
        ${JSON.stringify(expectedRuleCopy)} && !text.textContent.includes('r/sydtrackpackaged');
      checks.tooltipAccessibility = tip.getAttribute('role') === 'tooltip' &&
        chip.getAttribute('aria-expanded') === 'true' && chip.getAttribute('aria-describedby') === 'lf-explanation-text';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      checks.escapeCloses = tip.classList.contains('hidden') && chip.getAttribute('aria-expanded') === 'false';
      // This diagnostic deliberately keeps the native window hidden. Chromium
      // can update DOM focus without delivering focus events to an inactive
      // document; exercise that listener explicitly while retaining the DOM
      // focus assertion. Prevent scrolling, which intentionally dismisses tips.
      chip.focus({ preventScroll: true });
      if (!document.hasFocus()) chip.dispatchEvent(new FocusEvent('focus'));
      checks.keyboardFocusShows = document.activeElement === chip && !tip.classList.contains('hidden');
      window.sydtrackCategoryUI.hide();
      chip.click();
      checks.clickShows = !tip.classList.contains('hidden');
      chip.click();
      checks.secondClickCloses = tip.classList.contains('hidden');
      const now = new Date();
      const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      renderLastFocused({ ...entry, category: 'productive', explanation: { category: 'productive', kind: 'today', correctionDate: today } }, null);
      chip.dispatchEvent(new MouseEvent('mouseenter'));
      checks.todayScope = text.textContent === 'Changed to Productive for today only. Future profile rules are unchanged.';
      renderLastFocused({ ...entry, category: 'productive', explanation: { category: 'productive', kind: 'today', correctionDate: '2000-01-01' } }, null);
      chip.dispatchEvent(new MouseEvent('mouseenter'));
      checks.retainedCorrectionDate = text.textContent === 'Changed to Productive for 2000-01-01 only. Future profile rules are unchanged.';
      renderLastFocused({ ...entry, category: 'other', explanation: { category: 'other', kind: 'none' } }, null);
      chip.dispatchEvent(new MouseEvent('mouseenter'));
      checks.unmatchedOther = text.textContent === 'No matching rule. Kept as Other.';
      renderLastFocused({ ...entry, category: 'ignored', explanation: { category: 'ignored', kind: 'ignore' } }, null);
      chip.dispatchEvent(new MouseEvent('mouseenter'));
      checks.ignoreScope = text.textContent === 'This app is on the Ignore list. No time is recorded.';
      renderLastFocused({ ...entry, explanation: { category: 'productive', kind: 'rule', rule: 'stale' } }, null);
      checks.staleMetadataDisabled = chip.disabled && tip.classList.contains('hidden');
      const picker = document.getElementById('quick-rule-picker');
      const input = document.getElementById('quick-rule-keyword');
      const pickerWasHidden = picker.classList.contains('hidden');
      picker.classList.remove('hidden');
      checks.createRuleHeading = document.getElementById('quick-rule-heading').textContent.trim() === 'Create a rule';
      checks.cleanPickerCopy = !picker.querySelector('label, .quick-rule-label, .quick-rule-note');
      checks.roomyAccessibleInput = input.getBoundingClientRect().height >= 44 && input.getAttribute('aria-label') === 'Rule phrase' &&
        picker.getAttribute('role') === 'dialog' && picker.getAttribute('aria-labelledby') === 'quick-rule-heading';
      picker.classList.toggle('hidden', pickerWasHidden);
      window.sydtrackCategoryUI.hide();
      return checks;
    })()`);
    for (const [name, passed] of Object.entries(checks)) assert.equal(passed, true, `${label}: packaged category UI ${name}`);
    const confirmation = await renderer(`(async () => {
      const result = ${JSON.stringify(correction)};
      fillRulesEditors(result.rules);
      fillIgnoreEditor(result.ignoreList);
      renderLastFocused({ app: 'Chrome', title: 'Release smoke example - Google Chrome',
        category: result.previewCategory, explanation: result.previewExplanation, browser: true }, null);
      const saved = await window.sydtrackQuickUI.classify('unproductive');
      return { saved, visible: !document.getElementById('correction-undo').classList.contains('hidden'),
        message: document.getElementById('correction-undo-message').textContent };
    })()`);
    assert.equal(confirmation.saved, true, 'Production quick-rule UI saves through preload');
    assert.equal(confirmation.visible, true, 'Rule confirmation is shown');
    assert.equal(confirmation.message, 'Rule saved for future tracking. (' + displayName + ' profile)', 'Confirmation identifies the active profile');
    const uiUndo = await renderer(`(async () => {
      document.getElementById('correction-undo-action').click();
      for (let i = 0; i < 100; i++) {
        if (document.getElementById('correction-undo').classList.contains('hidden')) {
          const rules = await window.sydtrack.getRules();
          return rules.productive.includes('release smoke example') && !rules.unproductive.includes('release smoke example');
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return false;
    })()`);
    assert.equal(uiUndo, true, 'Production quick-rule Undo restores synthetic rule');
    console.log(`${label}: packaged 2.4 features passed: winning rule, accessible disclosure, today/date scope, profile confirmation, and clean Home copy`);
  }
  try {
    inspector = await connect(await inspectorUrl);
    await inspector.request('Debugger.enable');
    const paused = inspector.event('Debugger.paused');
    await inspector.request('Runtime.runIfWaitingForDebugger');
    const frame = (await paused).callFrames[0];
    const isolated = await inspector.request('Debugger.evaluateOnCallFrame', {
      callFrameId: frame.callFrameId, returnByValue: true,
      expression: `(() => {
        const e = require('electron');
        e.app.setPath('appData', ${JSON.stringify(releaseRoot)});
        e.app.setPath('userData', ${JSON.stringify(userData)});
        const noStartupWrites = () => {};
        e.app.setLoginItemSettings = noStartupWrites;
        if (e.app.setLoginItemSettings !== noStartupWrites) throw Error('Cannot isolate startup writes');
        globalThis.__packagedElectron = e;
        return e.app.getPath('userData');
      })()`
    });
    assert(!isolated.exceptionDetails, JSON.stringify(isolated.exceptionDetails));
    assert.equal(isolated.result.value, userData, 'Data isolation confirmed before app starts');
    console.log(`${label}: data and startup writes isolated before execution`);
    await inspector.request('Debugger.resume');
    for (let i = 0; i < 100; i++) {
      const ready = await evaluate(`(() => {
        const windows = globalThis.__packagedElectron.BrowserWindow;
        // Inspector evaluation can interrupt Electron while this lazy export
        // is still initializing. Wait for the public method before calling it.
        if (typeof windows?.getAllWindows !== 'function') return false;
        const w = windows.getAllWindows()[0];
        return !!w && !w.webContents.isLoading() && w.webContents.getURL().startsWith('sydtrack://');
      })()`);
      if (ready) break;
      await pause(100);
      if (i === 99) throw new Error('Packaged renderer did not become ready');
    }
    const state = await renderer(`window.sydtrack.getState()`);
    console.log(`${label}: production preload and state IPC responded`);
    const packagedVersion = await evaluate(`process.mainModule.require(globalThis.__packagedElectron.app.getAppPath() + '/package.json').version`);
    const features25 = has25Features(packagedVersion);
    assert.equal(state.stats.settings.trackingPaused, true, 'Actual tracking stays paused before feature checks');
    const rendererModules = await renderer(`(() => ({
      page: location.href,
      formatter: typeof window.sydtrackClassificationExplanation?.formatExplanation,
      categoryUI: typeof window.sydtrackCategoryUI?.update,
      quickUI: typeof window.sydtrackQuickUI?.classify,
      scripts: Array.from(document.scripts, script => script.src)
    }))()`);
    assert.equal(rendererModules.page, 'sydtrack://app/renderer/index.html', 'Renderer uses the production app protocol');
    assert.equal(rendererModules.formatter, 'function', 'Explanation formatter actually executed through production protocol');
    assert.equal(rendererModules.categoryUI, 'function', 'Category disclosure module actually executed through production protocol');
    assert.equal(rendererModules.quickUI, 'function', 'Quick-rule UI actually executed through production protocol');
    for (const file of ['src/classification-explanation.js', 'renderer/category-explanation-ui.js', 'renderer/quick-corrections-ui.js']) {
      assert(rendererModules.scripts.includes('sydtrack://app/' + file), `Renderer script uses production protocol: ${file}`);
    }
    if (features25) {
      for (const file of ['renderer/schedule-time-ui.js', 'renderer/wellbeing-ui.js', 'renderer/lib/goals.js', 'renderer/lib/day-timeline.js']) {
        assert(rendererModules.scripts.includes('sydtrack://app/' + file), `2.5 renderer script uses production protocol: ${file}`);
      }
      assert.equal(await renderer(`typeof window.sydtrackScheduleTimeUI?.sync === 'function' &&
        typeof openFocusScoreDay === 'function' && typeof renderMonthFocusScores === 'function'`), true, '2.5 modules actually execute through production protocol');
    }
    assert.equal(state.stats.settings.onboardingComplete, existing, 'Fresh/returning onboarding state');
    assert.equal(state.stats.settings.updateChecksEnabled, false, 'Network checks default off');
    const updates = await renderer(`window.sydtrack.getUpdates()`);
    assert.equal(updates.currentVersion, version);
    const themes = await renderer(`[...document.querySelectorAll('[data-theme-id]')].map(b => b.dataset.themeId)`);
    // The archive owns its supported palette, including frozen releases whose
    // theme set differs from current source. Detect omissions and duplicates.
    const packagedThemeIds = await evaluate(`process.mainModule.require(globalThis.__packagedElectron.app.getAppPath() + '/src/theme.js').THEME_IDS`);
    assert(Array.isArray(packagedThemeIds) && packagedThemeIds.length > 0, 'Packaged theme list exists');
    assert.deepEqual([...themes].sort(), [...packagedThemeIds].sort(), 'Appearance exposes each packaged theme exactly once');
    if (features25) {
      assert.equal(packagedThemeIds.length, 9, '2.5 includes nine built-in appearances');
      assert(packagedThemeIds.includes('forest'), '2.5 includes Forest');
    }
    const security = await evaluate(`globalThis.__packagedElectron.BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()`);
    assert.equal(security.contextIsolation, true); assert.equal(security.sandbox, true); assert.equal(security.nodeIntegration, false);
    const trayImages = await evaluate(`(() => {
      const e = globalThis.__packagedElectron;
      return ['standard', 'productive', 'unproductive', 'other'].map(name => {
        const image = e.nativeImage.createFromPath(e.app.getAppPath() + '/renderer/assets/tray/' + name + '.png');
        return { name, empty: image.isEmpty(), size: image.getSize() };
      });
    })()`);
    for (const image of trayImages) {
      assert.equal(image.empty, false, `Packaged native tray artwork decodes: ${image.name}`);
      assert(image.size.width > 0 && image.size.height > 0, `Packaged tray artwork has dimensions: ${image.name}`);
    }
    if (!existing) {
      await renderer(`window.sydtrack.updateSettings({onboardingComplete: true, trackingPaused: true, launchAtStartup: false, theme: 'linen'})`);
      assert.equal((await renderer(`window.sydtrack.getState()`)).stats.settings.trackingPaused, true, 'Feature checks remain paused');
      const profileSnapshot = await renderer(`window.sydtrack.getProfiles()`);
      const activeProfile = profileSnapshot.profiles.find(profile => profile.id === profileSnapshot.activeId);
      assert(activeProfile && typeof activeProfile.name === 'string' && activeProfile.name.trim(), 'Active production profile is named');
      const correction = await renderer(`window.sydtrack.quickSetRule(${JSON.stringify({ profileId: activeProfile.id,
        app: 'Chrome', title: 'Release smoke example - Google Chrome', keyword: 'release smoke example', category: 'productive', toggle: false })})`);
      assert(correction.undoToken);
      assert.equal(correction.profileName, activeProfile.name, 'Quick-rule IPC includes actual active profile name');
      assert.equal(correction.previewCategory, 'productive');
      assert.deepEqual(correction.previewExplanation, { category: 'productive', kind: 'rule', rule: 'release smoke example',
        origin: 'profile', profileId: activeProfile.id, profileName: activeProfile.name }, 'Production quick-rule IPC returns authoritative explanation');
      assert((await renderer(`window.sydtrack.getRules()`)).productive.includes('release smoke example'));
      const grouped = await renderer(`window.sydtrack.quickSetRule(${JSON.stringify({ profileId: activeProfile.id,
        app: 'Chrome', title: 'Release packaged thread - r/sydtrackpackaged - Reddit', keyword: 'reddit', category: 'unproductive', toggle: false })})`);
      assert.equal(grouped.previewCategory, 'unproductive');
      assert.equal(grouped.previewExplanation.rule, 'reddit', 'Winning tag differs from grouped subreddit identity');
      assert.equal(grouped.previewExplanation.profileName, activeProfile.name, 'Grouped preview names actual active profile');
      await verifyReleaseUI(correction, grouped, activeProfile);
      await renderer(`window.sydtrack.undoCorrection(${JSON.stringify(grouped.undoToken)})`);
      await renderer(`window.sydtrack.undoCorrection(${JSON.stringify(correction.undoToken)})`);
      assert(!(await renderer(`window.sydtrack.getRules()`)).productive.includes('release smoke example'));
      if (features25) await verify25Settings();
      const network = await renderer(`window.sydtrack.checkUpdates()`);
      assert.equal(network.currentVersion, version);
      assert(['current', 'available', 'unavailable'].includes(network.phase));
      console.log(`${label}: manual update check:`, JSON.stringify(network));
    } else {
      assert.equal(state.stats.settings.theme, features25 ? 'forest' : 'linen', 'Theme survives packaged restart');
      assert.equal(state.stats.settings.trackingPaused, true, 'Pause survives packaged restart');
      if (features25) {
        assert.equal(state.stats.settings.trackingPauseUntil, 0, 'Indefinite pause survives packaged restart');
        assert.equal(state.stats.settings.focusBoostScheduleStart, '23:47', 'Exact overnight start survives packaged restart');
        assert.equal(state.stats.settings.focusBoostScheduleEnd, '00:03', 'Exact overnight end survives packaged restart');
        assert.equal(state.stats.settings.focusBoostScheduleEnabled, false, 'Schedule disabled state survives packaged restart');
        assert.equal(state.stats.settings.breakReminderMinutes, 75, 'Break minutes survive packaged restart');
        assert.equal(state.stats.settings.breakReminderEnabled, false, 'Break disabled state survives packaged restart');
        assert.equal(await renderer(`document.documentElement.dataset.theme === 'forest' &&
          ['start', 'end'].every(which => document.getElementById('fb-schedule-' + which).hidden &&
            !document.getElementById('fb-schedule-' + which + '-trigger').hidden &&
            document.getElementById('fb-schedule-' + which + '-trigger').disabled &&
            document.getElementById('fb-schedule-' + which + '-trigger').dataset.time === (which === 'start' ? '23:47' : '00:03'))`), true, 'Restart initializes themed custom controls from confirmed archived settings');
      }
      assert(!(await renderer(`window.sydtrack.getRules()`)).productive.includes('release smoke example'), 'Undo persists');
      assert.deepEqual(state.stats.byCategory, expectedTotals, 'Existing fixture history is preserved');
      const row = state.stats.activityRows.find(entry => entry.reason === 'release smoke page');
      assert(row && row.seconds === 90);
      const corrected = await renderer(`window.sydtrack.correctWithUndo(${JSON.stringify(row.id)}, 'unproductive')`);
      assert.equal(corrected.stats.byCategory.productive, expectedTotals.productive - 90);
      assert.equal(corrected.stats.byCategory.other, expectedTotals.other, 'Unrelated browser time is unchanged');
      const undone = await renderer(`window.sydtrack.undoCorrection(${JSON.stringify(corrected.undoToken)})`);
      assert.deepEqual(undone.stats.byCategory, expectedTotals, 'Analytics Undo restores fixture totals');
      if (features25) await verify25ScoreNavigation(historicalDate);
    }
    console.log(`${label}: ${existing ? 'restart persistence' : 'fresh onboarding, sandbox, preload IPC, rules, Undo'} passed`);
    await evaluate('globalThis.__packagedElectron.app.quit()').catch(() => {});
    inspector.close(); inspector = null;
    await Promise.race([exited, pause(4000)]);
  } finally {
    inspector?.close();
    if (child.exitCode === null) child.kill();
    await Promise.race([exited, pause(2000)]);
  }
}

async function run() {
  if (process.platform !== 'win32') throw new Error('Windows release check only');
  if (typeof WebSocket !== 'function') throw new Error('This optional diagnostic requires Node.js 22+');
  let archiveHash;
  for (const kind of ['setup', 'portable']) {
    const destination = path.join(releaseRoot, kind);
    fs.mkdirSync(destination);
    const artifact = path.join(workspace, 'dist', `sydtrack-${version}-${kind}.exe`);
    assert(fs.existsSync(sevenZip), 'Bundled 7-Zip extractor is available');
    assert(fs.existsSync(artifact), `Release artifact exists: ${artifact}`);
    console.log(`${kind} artifact:`, JSON.stringify({ name: path.basename(artifact), bytes: fs.statSync(artifact).size,
      sha256: sha256(fs.readFileSync(artifact)) }));
    const extracted = spawnSync(sevenZip, ['x', artifact, `-o${destination}`, '-y'], { windowsHide: true, encoding: 'utf8' });
    assert.equal(extracted.status, 0, extracted.stderr || extracted.stdout);
    const payload = verifyPayload(destination);
    if (archiveHash) assert.equal(payload.archiveSha256, archiveHash, 'Setup and portable contain identical app archives');
    archiveHash = payload.archiveSha256;
    console.log(`${kind} payload:`, JSON.stringify(payload));
    const userData = path.join(releaseRoot, `${kind}-data`); fs.mkdirSync(userData);
    const executable = path.join(destination, 'sydtrack.exe');
    await launch(executable, userData, kind);
    const fixture = require('../src/store').createStore(userData);
    fixture.addSeconds('Chrome', 'productive', 90, { category: 'productive', reason: 'release smoke page' });
    fixture.addSeconds('Chrome', 'other', 45, { category: 'other', reason: 'No matching keyword' });
    fixture.addSeconds('Code', 'unproductive', 30, { category: 'unproductive', reason: 'release smoke native' });
    let historicalDate = null;
    if (has25Features(payload.version)) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 9).getTime();
      historicalDate = require('../src/store').todayKey(start);
      let at = start;
      for (const [category, seconds] of Object.entries({ productive: 3600, unproductive: 1200, other: 600 })) {
        fixture.addInterval('Synthetic historical app', category, at, at + seconds * 1000,
          { category, reason: 'release historical fixture' }, 'default');
        at += seconds * 1000;
      }
      fixture.updateSettings({ focusShareIncludeOther: false });
    }
    await launch(executable, userData, kind, true, fixture.snapshot().byCategory, historicalDate);
  }
  console.log('Packaged checks passed. Extracted payloads were launched; installer/portable wrappers were not executed.');
  console.log('Temporary diagnostic artifacts:', releaseRoot);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
