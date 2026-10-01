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
  for (const file of releaseFiles) assert(entries.includes('/' + file), `Release feature included: ${file}`);
  const html = asar.extractFile(archive, 'renderer/index.html').toString('utf8');
  assert(html.includes('<script src="../src/classification-explanation.js"></script>'), 'Shared explanation formatter loaded');
  assert(html.includes('<script src="category-explanation-ui.js"></script>'), 'Category explanation UI loaded');
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
    archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') };
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

async function launch(executable, userData, label, existing = false, expectedTotals = null) {
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
        const w = globalThis.__packagedElectron.BrowserWindow.getAllWindows()[0];
        return !!w && !w.webContents.isLoading() && w.webContents.getURL().startsWith('sydtrack://');
      })()`);
      if (ready) break;
      await pause(100);
      if (i === 99) throw new Error('Packaged renderer did not become ready');
    }
    const state = await renderer(`window.sydtrack.getState()`);
    console.log(`${label}: production preload and state IPC responded`);
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
    assert.equal(state.stats.settings.onboardingComplete, existing, 'Fresh/returning onboarding state');
    assert.equal(state.stats.settings.updateChecksEnabled, false, 'Network checks default off');
    const updates = await renderer(`window.sydtrack.getUpdates()`);
    assert.equal(updates.currentVersion, version);
    const themes = await renderer(`[...document.querySelectorAll('[data-theme-id]')].map(b => b.dataset.themeId)`);
    assert.equal(themes.length, 8);
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
      const network = await renderer(`window.sydtrack.checkUpdates()`);
      assert.equal(network.currentVersion, version);
      assert(['current', 'available', 'unavailable'].includes(network.phase));
      console.log(`${label}: manual update check:`, JSON.stringify(network));
    } else {
      assert.equal(state.stats.settings.theme, 'linen', 'Theme survives packaged restart');
      assert.equal(state.stats.settings.trackingPaused, true, 'Pause survives packaged restart');
      assert(!(await renderer(`window.sydtrack.getRules()`)).productive.includes('release smoke example'), 'Undo persists');
      assert.deepEqual(state.stats.byCategory, expectedTotals, 'Existing fixture history is preserved');
      const row = state.stats.activityRows.find(entry => entry.reason === 'release smoke page');
      assert(row && row.seconds === 90);
      const corrected = await renderer(`window.sydtrack.correctWithUndo(${JSON.stringify(row.id)}, 'unproductive')`);
      assert.equal(corrected.stats.byCategory.productive, expectedTotals.productive - 90);
      assert.equal(corrected.stats.byCategory.other, expectedTotals.other, 'Unrelated browser time is unchanged');
      const undone = await renderer(`window.sydtrack.undoCorrection(${JSON.stringify(corrected.undoToken)})`);
      assert.deepEqual(undone.stats.byCategory, expectedTotals, 'Analytics Undo restores fixture totals');
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
    await launch(executable, userData, kind, true, fixture.snapshot().byCategory);
  }
  console.log('Packaged checks passed. Extracted payloads were launched; installer/portable wrappers were not executed.');
  console.log('Temporary diagnostic artifacts:', releaseRoot);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
