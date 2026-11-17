'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createWindowState, restoreWindowState } = require('../src/window-state');
const { deleteAllMyData } = require('../src/data-ownership');

const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const left = { id: 2, workArea: { x: -1600, y: -200, width: 1600, height: 900 } };
const saved = (bounds, maximized = false) => ({ bounds, maximized });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-window-state-'));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function fixture(name, initial, screenInfo = { displays: [primary, left], primary }) {
  const dir = path.join(root, name);
  const filePath = path.join(dir, 'window-state.json');
  fs.mkdirSync(dir, { recursive: true });
  if (initial !== undefined) fs.writeFileSync(filePath, JSON.stringify(initial));
  const timers = new Map(), errors = [];
  const screen = new EventEmitter();
  screen.getAllDisplays = () => screenInfo.displays;
  screen.getPrimaryDisplay = () => screenInfo.primary;
  let nextTimer = 0;
  const memory = createWindowState({ filePath, screenApi: screen, onError: error => errors.push(error),
    setTimer: fn => { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimer: id => timers.delete(id) });
  const options = memory.restore();
  const win = new EventEmitter();
  Object.assign(win, {
    bounds: { x: options.x, y: options.y, width: options.width, height: options.height },
    destroyed: false, minimized: false, maximized: false, fullscreen: false, visible: false, maximizeCalls: 0,
    boundsCalls: 0, minimumCalls: 0, minimum: [options.minWidth, options.minHeight],
    isDestroyed() { return this.destroyed; }, isMinimized() { return this.minimized; },
    isMaximized() { return this.maximized; }, isFullScreen() { return this.fullscreen; },
    getNormalBounds() { return { ...this.bounds }; },
    setBounds(bounds) { this.boundsCalls++; this.bounds = { ...bounds }; this.emit('resize'); },
    setMinimumSize(width, height) { this.minimumCalls++; this.minimum = [width, height]; },
    maximize() { this.maximizeCalls++; this.maximized = true; this.visible = true; this.emit('maximize'); },
    show() { this.visible = true; this.emit('show'); }
  });
  memory.attach(win);
  return { dir, filePath, memory, win, timers, errors, screen, screenInfo, runTimers() {
    for (const [id, callback] of timers) { timers.delete(id); callback(); }
  } };
}

try {
  const normal = { x: 120, y: 140, width: 1200, height: 820 };
  assert.deepEqual(restoreWindowState(saved(normal), [primary], primary).bounds,
    { ...normal, minWidth: 800, minHeight: 600 }, 'normal size and position are retained');
  const secondary = { x: -1500, y: -150, width: 1300, height: 800 };
  assert.deepEqual(restoreWindowState(saved(secondary, true), [primary, left], primary),
    { bounds: { ...secondary, minWidth: 800, minHeight: 600 }, maximized: true },
    'negative coordinates and maximization on an available secondary monitor are retained');
  const relocated = restoreWindowState(saved(secondary, true), [primary], primary);
  assert.equal(relocated.bounds.x, 310);
  assert.equal(relocated.bounds.y, 120);
  assert.equal(relocated.maximized, true, 'missing monitor centers the normal rectangle on the primary display');
  assert.deepEqual(restoreWindowState(saved({ x: 1850, y: 900, width: 1200, height: 900 }), [primary], primary).bounds,
    { x: 720, y: 140, width: 1200, height: 900, minWidth: 800, minHeight: 600 },
    'partially visible windows are moved wholly into the available work area');
  const tiny = { id: 3, workArea: { x: 40, y: 20, width: 640, height: 460 } };
  assert.deepEqual(restoreWindowState(saved({ x: 0, y: 0, width: 4000, height: 2000 }), [tiny], tiny).bounds,
    { x: 40, y: 20, width: 640, height: 460, minWidth: 640, minHeight: 460 },
    'the size and minimum size fit even a work area smaller than the default minimum');
  for (const invalid of [null, [], {}, { bounds: {} }, saved({ x: '0', y: 0, width: 1000, height: 700 }, true),
    saved({ x: Infinity, y: 0, width: 1000, height: 700 }, true), saved({ x: 0, y: 0, width: -1, height: 700 }, true)]) {
    const restored = restoreWindowState(invalid, [primary], primary);
    assert.equal(restored.bounds.width, 1040);
    assert.equal(restored.bounds.height, 760);
    assert.equal(restored.maximized, false, 'invalid geometry safely falls back to the centered default');
  }
  assert.equal(restoreWindowState(saved(normal, 'true'), [primary], primary).maximized, false,
    'only a genuine boolean restores maximization');
  assert.deepEqual(restoreWindowState(saved(normal), [], null), { bounds: {}, maximized: false },
    'unavailable display information leaves Electron defaults intact');

  const h = fixture('debounce');
  h.win.bounds = { ...normal };
  h.win.emit('move'); h.win.emit('resize'); h.win.emit('move');
  assert.equal(h.timers.size, 1, 'a move/resize burst schedules one write');
  assert.equal(fs.existsSync(h.filePath), false, 'geometry writes wait for the debounce');
  h.runTimers();
  assert.deepEqual(read(h.filePath), saved(normal));
  const restarted = fixture('debounce');
  assert.deepEqual(restarted.win.bounds, normal, 'a restart restores the last saved normal size and position');
  restarted.memory.dispose();

  h.win.maximized = true;
  h.win.emit('maximize');
  h.memory.flush();
  assert.deepEqual(read(h.filePath), saved(normal, true), 'maximization records the normal restore rectangle');
  h.win.minimized = true;
  h.win.bounds = { x: -32000, y: -32000, width: 160, height: 30 };
  h.win.emit('minimize'); h.memory.dispose();
  assert.deepEqual(read(h.filePath), saved(normal, true), 'minimized quit cannot replace the saved restore rectangle');
  assert.equal(h.timers.size, 0);
  assert.equal(h.win.listenerCount('move'), 0, 'disposal removes geometry listeners and pending work');

  const hidden = fixture('hidden-maximized', saved(normal, true));
  assert.equal(hidden.win.visible, false);
  assert.equal(hidden.win.maximizeCalls, 0, 'a hidden login window is not maximized or shown early');
  hidden.memory.flush();
  assert.equal(read(hidden.filePath).maximized, true, 'quitting before first show retains the saved maximized preference');
  hidden.win.show();
  assert.equal(hidden.win.maximizeCalls, 1);
  assert.equal(hidden.win.maximized, true);
  hidden.win.show();
  assert.equal(hidden.win.maximizeCalls, 1, 'subsequent tray openings do not force maximization again');
  hidden.win.maximized = false;
  hidden.win.bounds = { x: 140, y: 160, width: 1100, height: 730 };
  hidden.win.emit('unmaximize'); hidden.win.visible = false; hidden.win.emit('hide');
  assert.deepEqual(read(hidden.filePath), saved(hidden.win.bounds), 'hide-to-tray flushes the current normal state');
  hidden.memory.dispose();

  const removed = fixture('live-monitor-removed', saved(secondary));
  removed.screenInfo.displays = [primary];
  removed.screen.emit('display-removed', {}, left);
  removed.screen.emit('display-metrics-changed', {}, primary, ['workArea', 'scaleFactor']);
  assert.equal(removed.timers.size, 1, 'a display-change burst schedules one revalidation');
  removed.runTimers();
  assert.deepEqual(removed.win.bounds, { x: 310, y: 120, width: 1300, height: 800 });
  assert.equal(removed.win.visible, false, 'a hidden window can be moved safely without being shown');
  assert.equal(removed.win.maximizeCalls, 0);
  assert.deepEqual(read(removed.filePath).bounds, removed.win.bounds, 'repaired live geometry reaches the durable state');
  removed.memory.dispose();
  assert.equal(removed.screen.listenerCount('display-removed'), 0);
  assert.equal(removed.screen.listenerCount('display-metrics-changed'), 0);
  assert.equal(removed.screen.listenerCount('display-added'), 0, 'disposal removes every display listener');

  const smallerArea = { id: 1, workArea: { x: 0, y: 0, width: 1024, height: 700 } };
  const opened = fixture('monitor-show', saved(normal));
  opened.screenInfo.displays = [smallerArea];
  opened.screenInfo.primary = smallerArea;
  opened.win.show();
  assert.deepEqual(opened.win.bounds, { x: 0, y: 0, width: 1024, height: 700 },
    'opening from the tray revalidates geometry even without a display event');
  opened.memory.dispose();

  const small = fixture('minimum-recovery', saved(normal), { displays: [tiny], primary: tiny });
  assert.deepEqual(small.win.minimum, [640, 460]);
  small.screenInfo.displays = [primary]; small.screenInfo.primary = primary;
  small.win.show();
  assert.deepEqual(small.win.minimum, [800, 600], 'the default minimums recover when a larger work area is available');
  assert.deepEqual(small.win.bounds, { x: 40, y: 20, width: 800, height: 600 });
  small.memory.dispose();

  const minimized = fixture('minimized-monitor-change', saved(secondary));
  minimized.win.minimized = true;
  minimized.win.bounds = { x: -32000, y: -32000, width: 160, height: 30 };
  minimized.screenInfo.displays = [primary];
  minimized.screen.emit('display-removed', {}, left);
  minimized.runTimers();
  assert.equal(minimized.win.minimized, true);
  assert.equal(minimized.win.visible, false);
  assert.equal(minimized.win.boundsCalls, 0, 'display changes never restore a minimized native window');
  assert.equal(minimized.win.minimumCalls, 0);
  assert.deepEqual(read(minimized.filePath).bounds, { x: 310, y: 120, width: 1300, height: 800 },
    'minimized temporary coordinates cannot overwrite the repaired normal rectangle');
  minimized.win.minimized = false; minimized.win.bounds = { ...secondary };
  minimized.win.emit('restore');
  assert.deepEqual(minimized.win.bounds, { x: 310, y: 120, width: 1300, height: 800 },
    'normal restore applies the deferred repair');
  minimized.memory.dispose();

  const maximized = fixture('maximized-monitor-change', saved(secondary, true));
  maximized.win.show();
  maximized.win.visible = false; maximized.win.emit('hide');
  maximized.screenInfo.displays = [primary];
  maximized.screen.emit('display-removed', {}, left);
  maximized.runTimers();
  assert.equal(maximized.win.maximized, true);
  assert.equal(maximized.win.visible, false);
  assert.equal(maximized.win.boundsCalls, 0, 'display changes never unmaximize a native window');
  assert.equal(read(maximized.filePath).maximized, true);
  assert.deepEqual(read(maximized.filePath).bounds, { x: 310, y: 120, width: 1300, height: 800 });
  maximized.win.maximized = false; maximized.win.emit('unmaximize');
  assert.deepEqual(maximized.win.bounds, { x: 310, y: 120, width: 1300, height: 800 });
  maximized.screen.emit('display-metrics-changed', {}, primary, ['workArea']);
  maximized.memory.dispose();
  assert.equal(maximized.timers.size, 0, 'shutdown clears both pending display and geometry timers');

  const quitting = fixture('quit');
  quitting.win.bounds = { ...normal }; quitting.win.emit('resize');
  quitting.memory.dispose();
  assert.deepEqual(read(quitting.filePath), saved(normal), 'quit flushes a pending geometry update');
  quitting.win.emit('move');
  assert.equal(quitting.timers.size, 0, 'late events do not recreate writes after shutdown');

  const failure = fixture('write-failure');
  failure.win.bounds = { ...normal };
  const originalRename = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error('Synthetic layout write failure'); };
    failure.memory.flush();
  } finally { fs.renameSync = originalRename; }
  assert.equal(failure.errors.length, 1, 'optional window-memory write failures do not stop the app');
  failure.memory.flush();
  assert.deepEqual(read(failure.filePath), saved(normal), 'a later save retries a failed atomic write');
  failure.memory.forget();
  assert.equal(deleteAllMyData({ dataDir: failure.dir }).ok, true);
  assert.equal(fs.existsSync(failure.filePath), false, 'Delete all my data removes window memory too');
  failure.memory.flush();
  assert.equal(fs.existsSync(failure.filePath), false, 'a pending flush cannot resurrect deleted window memory');
  failure.win.emit('move'); failure.runTimers();
  assert.equal(fs.existsSync(failure.filePath), true, 'a subsequent deliberate layout change can be remembered again');
  failure.memory.dispose();

  const malformed = fixture('malformed');
  malformed.memory.dispose();
  fs.writeFileSync(malformed.filePath, '{malformed');
  const recovered = fixture('malformed');
  assert.equal(recovered.errors.length, 1);
  assert.equal(recovered.win.bounds.width, 1040, 'malformed preference files do not prevent opening the app');
  recovered.memory.dispose();
  console.log('window-state checks passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
