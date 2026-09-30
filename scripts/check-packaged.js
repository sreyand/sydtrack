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
  const sourceFiles = ['src', 'renderer'].flatMap(folder => filesIn(path.join(workspace, folder)));
  for (const file of sourceFiles) {
    const relative = path.relative(workspace, file);
    assert(asar.extractFile(archive, relative).equals(fs.readFileSync(file)), `Packaged source matches: ${relative}`);
  }
  assert(fs.existsSync(path.join(dir, 'resources', 'app.asar.unpacked', 'node_modules', 'active-win',
    'lib', 'binding', 'napi-6-win32-unknown-x64', 'node-active-win.node')), 'Windows native binding included');
  assert(fs.readFileSync(path.join(dir, 'resources', 'get-foreground.ps1')).equals(
    fs.readFileSync(path.join(workspace, 'scripts', 'get-foreground.ps1'))), 'Foreground probe included');
  return { version: packaged.version, sourceFiles: sourceFiles.length,
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
    assert.equal(state.stats.settings.onboardingComplete, existing, 'Fresh/returning onboarding state');
    assert.equal(state.stats.settings.updateChecksEnabled, false, 'Network checks default off');
    const updates = await renderer(`window.sydtrack.getUpdates()`);
    assert.equal(updates.currentVersion, version);
    const themes = await renderer(`[...document.querySelectorAll('[data-theme-id]')].map(b => b.dataset.themeId)`);
    assert.equal(themes.length, 8);
    const security = await evaluate(`globalThis.__packagedElectron.BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()`);
    assert.equal(security.contextIsolation, true); assert.equal(security.sandbox, true); assert.equal(security.nodeIntegration, false);
    if (!existing) {
      await renderer(`window.sydtrack.updateSettings({onboardingComplete: true, trackingPaused: true, launchAtStartup: false, theme: 'linen'})`);
      const correction = await renderer(`window.sydtrack.quickSetRule({profileId: 'default', app: 'Chrome', title: 'Release smoke example - Google Chrome', keyword: 'release smoke example', category: 'productive', toggle: false})`);
      assert(correction.undoToken);
      assert((await renderer(`window.sydtrack.getRules()`)).productive.includes('release smoke example'));
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
