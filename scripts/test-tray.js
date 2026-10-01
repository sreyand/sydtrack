'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { resolveTrayState } = require('../src/tray-state');
const { createTracker } = require('../src/tracker');
const { toleranceMs } = require('../src/tracking-decision');

const sourceRoot = path.join(__dirname, '..', 'src');
const activeSettings = { trackingPaused: false, onboardingComplete: true, demoMode: false, pollMs: 3000 };
function activity(category = 'productive', extra = {}) {
  return { now: { app: 'Code', category, source: 'real', idle: false, ignored: false, ...extra },
    lastFocused: { app: 'Previous app', category: 'productive', source: 'real' } };
}

function makeHarness({ platform = 'win32', missing = [], broken = [] } = {}) {
  let prefs = { ...activeSettings };
  let payload = null;
  let session = null;
  const reads = [], changes = [], tooltips = [], warnings = [];
  const timers = new Map();
  let timerId = 0;
  const tray = { image: null, menu: [], handlers: {}, destroyed: false,
    setImage(image) { changes.push(image.name); this.image = image; },
    setToolTip(text) { tooltips.push(text); this.tooltip = text; },
    setContextMenu(menu) { this.menu = menu; },
    on(event, fn) { this.handlers[event] = fn; },
    destroy() { this.destroyed = true; } };
  function image(name, size = 2000, empty = false) {
    return { name, size, reps: [], isEmpty: () => empty,
      resize(options) { return image(name, options.width, empty); },
      toPNG() { return Buffer.from(String(this.size)); },
      addRepresentation(rep) { this.reps.push({ scaleFactor: rep.scaleFactor, size: Number(rep.buffer.toString()) }); } };
  }
  const electron = {
    Tray: function (initial) { tray.image = initial; return tray; },
    Menu: { buildFromTemplate: menu => menu },
    nativeImage: {
      createFromPath(file) {
        const name = path.basename(file, path.extname(file)); reads.push(name);
        if (broken.includes(name)) throw new Error('Synthetic image decode failure');
        return image(name, 2000, missing.includes(name));
      },
      createEmpty: () => image('empty', 0, true)
    }
  };
  const store = { getSettings: () => prefs,
    updateSettings: partial => (prefs = { ...prefs, ...partial }), snapshot: () => ({ settings: prefs }) };
  const context = vm.createContext({ module: { exports: {} }, __dirname: sourceRoot,
    require: name => name === 'electron' ? electron : name.startsWith('./') ? require(path.join(sourceRoot, name)) : require(name),
    process: { platform }, console: { warn: (...args) => warnings.push(args), log() {} },
    setTimeout: (fn, ms) => {
      const handle = { id: ++timerId, ms, fn, unref() {} };
      timers.set(handle.id, handle); return handle;
    },
    clearTimeout: handle => { if (handle) timers.delete(handle.id); }
  });
  vm.runInContext(fs.readFileSync(path.join(sourceRoot, 'tray.js'), 'utf8'), context);
  let shown = 0;
  const api = context.module.exports.createAppTray({
    getStore: () => store, getLastPayload: () => payload,
    getSessionManager: () => ({ getActiveSession: () => session }),
    getMainWindow: () => ({ isDestroyed: () => false, isMinimized: () => true,
      restore() {}, show() { shown++; }, focus() {} }),
    sendTrackerUpdate: next => { payload = next; }
  });
  return { ...api, store, reads, changes, tooltips, warnings, timers,
    setPayload(next) { payload = next; },
    setSession(next) { session = next; },
    setPrefs(partial) { return store.updateSettings(partial); },
    sample(next) { payload = next; api.refresh({ freshSample: true }); },
    expire() {
      const handle = [...timers.values()][0]; assert.ok(handle, 'a category has one expiry timer');
      timers.delete(handle.id); handle.fn();
    },
    get shown() { return shown; }
  };
}

async function main() {
  for (const category of ['productive', 'unproductive', 'other']) {
    assert.equal(resolveTrayState(activeSettings, activity(category)).icon, category);
  }
  assert.equal(resolveTrayState(activeSettings, { lastFocused: activity().now }).icon, 'standard');
  assert.equal(resolveTrayState({ ...activeSettings, trackingPaused: true }, activity()).label, 'Paused');
  assert.equal(resolveTrayState({ ...activeSettings, onboardingComplete: false }, activity()).label, 'Ready to start');
  for (const reason of ['sleep', 'lock', 'screen-off', 'no-window', 'clock', 'idle']) {
    assert.equal(resolveTrayState(activeSettings, activity('productive', { idle: true, source: 'idle', idleReason: reason })).icon, 'standard');
  }
  assert.equal(resolveTrayState(activeSettings, activity('ignored')).label, 'Ignored app');
  assert.equal(resolveTrayState(activeSettings, activity('productive', { ignored: true })).icon, 'standard');
  assert.equal(resolveTrayState(activeSettings, activity('productive', { trackingError: 'Probe failed' })).label, 'Tracking unavailable');
  assert.equal(resolveTrayState(activeSettings, activity('productive', { source: 'paused' })).icon, 'standard');
  assert.equal(resolveTrayState(activeSettings, activity('productive', { source: 'unexpected' })).icon, 'standard');
  for (const category of ['unknown', '__proto__', 'constructor', 'toString']) {
    assert.equal(resolveTrayState(activeSettings, activity(category)).icon, 'standard');
  }
  assert.equal(resolveTrayState(activeSettings, activity('productive', { app: '—' })).icon, 'standard');
  assert.equal(resolveTrayState(activeSettings, activity(), 'waiting').icon, 'standard');
  assert.equal(resolveTrayState(activeSettings, activity('productive', { idleReason: 'media-music' })).icon, 'productive');
  assert.equal(resolveTrayState(activeSettings, activity('productive', { source: 'demo' })).icon, 'standard');
  assert.equal(resolveTrayState({ ...activeSettings, demoMode: true }, activity()).icon, 'standard');
  assert.equal(resolveTrayState({ ...activeSettings, demoMode: true }, activity('unproductive', { source: 'demo' })).label, 'Demo: Unproductive');
  console.log('ok   category, inactive, media, demo, and missing-state resolution');

  const h = makeHarness();
  assert.equal(h.tray.image.name, 'standard');
  assert.equal(h.tray.image.size, 16);
  assert.deepEqual(h.reads, ['standard', 'other', 'productive', 'unproductive']);
  assert.equal(h.tray.image.reps.map(rep => rep.scaleFactor + ':' + rep.size).join(','), '2:32,3:48');
  h.sample(activity());
  assert.equal(h.tray.image.name, 'productive');
  assert.equal(h.tray.tooltip, 'sydtrack — Productive');
  assert.equal(h.tray.menu.filter(item => item.type !== 'separator').map(item => item.label).join('|'),
    'Open sydtrack|Pause tracking|Pause for 15 minutes|Notifications|Quit');
  const count = h.changes.length, tipCount = h.tooltips.length;
  for (let i = 0; i < 25; i++) h.sample(activity());
  assert.equal(h.changes.length, count, 'same category never swaps its image again');
  assert.equal(h.tooltips.length, tipCount, 'unchanged tooltip is not resent');
  assert.equal(h.reads.length, 4, 'refresh never reloads images');
  assert.equal(h.timers.size, 1, 'sample expiry uses one bounded timer');
  assert.equal([...h.timers.values()][0].ms, toleranceMs(3000));
  h.sample(activity('unproductive')); assert.equal(h.tray.image.name, 'unproductive');
  h.sample(activity('other')); assert.equal(h.tray.image.name, 'other');
  h.setPrefs({ notificationsEnabled: false }); h.refresh();
  assert.equal(h.tray.tooltip, 'sydtrack — Other'); assert.equal(h.tray.image.name, 'other');
  assert.equal(h.tray.menu.find(item => item.label === 'Notifications').checked, false);
  h.tray.menu.find(item => item.label === 'Notifications').click();
  assert.equal(h.store.getSettings().notificationsEnabled, true);
  assert.equal(h.tray.menu.find(item => item.label === 'Notifications').checked, true);
  h.setPrefs({ focusBoost: true }); h.refresh();
  assert.equal(h.tray.tooltip, 'sydtrack — Other');
  h.setSession({ status: 'running', modeLabel: 'An unnecessarily long mode label', remainingSec: 125 }); h.refresh();
  assert.equal(h.tray.tooltip, 'sydtrack — Other · Session 2:05');
  h.setSession({ status: 'completed', remainingSec: 0 }); h.refresh();
  assert.equal(h.tray.tooltip, 'sydtrack — Other');
  h.setSession({ status: 'running', remainingSec: Infinity }); h.refresh();
  assert.equal(h.tray.tooltip, 'sydtrack — Other');
  h.setSession({ active: true, tray: { remainingSec: 61 } }); h.refresh();
  assert.equal(h.tray.tooltip, 'sydtrack — Other · Session 1:01');
  h.setSession(null); h.refresh();
  h.tray.handlers['double-click'](); assert.equal(h.shown, 1);
  console.log('ok   cached images, high-DPI representations, existing menu and window controls');

  h.sample(activity());
  h.tray.menu.find(item => item.label === 'Pause tracking').click();
  assert.equal(h.tray.image.name, 'standard'); assert.ok(h.tray.tooltip.includes('Paused'));
  assert.equal(h.timers.size, 0);
  h.tray.menu.find(item => item.label === 'Resume tracking').click();
  assert.equal(h.tray.image.name, 'standard', 'resume does not reuse the pre-pause sample');
  h.tray.menu.find(item => item.label === 'Pause for 15 minutes').click();
  assert.ok(h.store.getSettings().trackingPauseUntil > Date.now());
  h.tray.menu.find(item => item.label === 'Resume tracking').click();
  assert.equal(h.store.getSettings().trackingPauseUntil, 0, 'manual resume cancels the timed-pause deadline');
  h.refresh(); assert.equal(h.tray.image.name, 'standard');
  h.sample(activity('unproductive')); assert.equal(h.tray.image.name, 'unproductive');
  h.invalidate('lock'); assert.ok(h.tray.tooltip.includes('Screen locked'));
  h.refresh(); assert.equal(h.tray.image.name, 'standard');
  h.invalidate('waiting'); h.refresh(); assert.equal(h.tray.image.name, 'standard');
  h.sample(activity()); assert.equal(h.tray.image.name, 'productive');
  h.expire(); assert.equal(h.tray.image.name, 'standard'); assert.ok(h.tray.tooltip.includes('Tracking unavailable'));
  h.setPrefs({ focusBoost: true }); h.refresh(); assert.equal(h.tray.image.name, 'standard', 'settings do not revive an expired sample');
  h.sample(activity('other')); assert.equal(h.tray.image.name, 'other');
  h.setPrefs({ pollMs: 5000 }); h.sample(activity());
  assert.equal([...h.timers.values()][0].ms, toleranceMs(5000));
  h.sample(activity('productive', { idle: true, source: 'idle', idleReason: 'idle' }));
  assert.equal(h.tray.image.name, 'standard'); assert.equal(h.timers.size, 0);
  h.sample(activity()); h.destroy();
  assert.equal(h.timers.size, 0); assert.equal(h.tray.destroyed, true);
  const destroyedChanges = h.changes.length;
  h.sample(activity('unproductive')); h.invalidate(); assert.equal(h.changes.length, destroyedChanges);
  console.log('ok   pause/resume, invalidation, stale-probe recovery, cadence, and disposal');

  const fallback = makeHarness({ missing: ['productive'] });
  fallback.sample(activity()); assert.equal(fallback.tray.image.name, 'standard');
  assert.ok(fallback.tray.tooltip.includes('Productive'), 'text remains meaningful when a color asset is missing');
  fallback.sample(activity('unproductive')); assert.equal(fallback.tray.image.name, 'unproductive'); fallback.destroy();
  const broken = makeHarness({ broken: ['standard', 'other', 'productive', 'unproductive'] });
  assert.equal(broken.tray.image.name, 'sydtrack'); assert.equal(broken.warnings.length, 4); broken.destroy();
  const empty = makeHarness({ missing: ['standard', 'other', 'productive', 'unproductive', 'sydtrack'] });
  assert.equal(empty.tray.image.name, 'empty'); empty.destroy();
  const linux = makeHarness({ platform: 'linux' }); assert.equal(linux.tray.image.size, 24); linux.destroy();
  const mac = makeHarness({ platform: 'darwin' }); assert.ok(mac.tray.handlers.click); mac.destroy();
  const onboarding = makeHarness(); onboarding.setPrefs({ onboardingComplete: false }); onboarding.refresh();
  assert.equal(onboarding.tray.menu.find(item => item.label === 'Pause tracking').enabled, false);
  assert.equal(onboarding.tray.menu.find(item => item.label === 'Pause for 15 minutes').enabled, false);
  assert.equal(onboarding.tray.tooltip, 'sydtrack — Ready to start'); onboarding.destroy();
  for (const name of ['standard', 'other', 'productive', 'unproductive']) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'assets', 'tray', name + '.png'));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), 2000); assert.equal(bytes.readUInt32BE(20), 2000);
  }
  console.log('ok   missing/corrupt-asset fallbacks, platform sizes, and bundled source PNGs');

  const live = makeHarness();
  const rulesHolder = { rules: { productive: ['code'], unproductive: [], other: [] } };
  let time = Date.now(), probes = 0, idleSec = 0, fail = false, pending = false, resolveProbe;
  const sample = { window: { owner: { name: 'Code' }, title: 'main.js' }, error: null };
  const stored = [];
  const store = { getSettings: () => ({ ...live.store.getSettings(), idleTimeoutSec: 5, notificationsEnabled: false }),
    snapshot: () => ({}), resetStreak() {}, shouldRemind: () => false,
    addSeconds: (app, category, seconds) => stored.push({ app, category, seconds }) };
  const tracker = createTracker({ store, rulesHolder, now: () => time,
    backend: { getActiveWindow: () => {
      probes++;
      if (fail) return Promise.reject(new Error('Synthetic probe failure'));
      if (pending) return new Promise(resolve => { resolveProbe = resolve; });
      return Promise.resolve({ ...sample, idleSec });
    } },
    onTick: next => live.sample(next), onStateInvalidated: reason => live.invalidate(reason) });
  time += 1000; await tracker.poll(); assert.equal(live.tray.image.name, 'productive');
  tracker.setSystemPresence({ locked: true }); assert.equal(live.tray.image.name, 'standard');
  assert.ok(live.tray.tooltip.includes('Screen locked'));
  const beforeLock = probes;
  time += 1000; await tracker.poll(); assert.equal(probes, beforeLock);
  tracker.setSystemPresence({ sleeping: true, locked: true }); assert.ok(live.tray.tooltip.includes('Sleeping'));
  tracker.setSystemPresence({ sleeping: false, locked: true }); assert.ok(live.tray.tooltip.includes('Screen locked'));
  tracker.setSystemPresence({ sleeping: false, locked: false }); assert.equal(live.tray.image.name, 'standard');
  time += 1000; await tracker.poll(); assert.equal(live.tray.image.name, 'productive');
  rulesHolder.rules = { productive: [], unproductive: ['code'], other: [] };
  tracker.invalidateClassification({ preserveLastFocused: true });
  assert.equal(live.tray.image.name, 'standard');
  assert.equal(tracker.getLastFocused().category, 'unproductive');
  time += 1000; await tracker.poll(); assert.equal(live.tray.image.name, 'unproductive');
  idleSec = 6; time += 1000; await tracker.poll(); assert.equal(live.tray.image.name, 'standard');
  assert.equal(tracker.getLastFocused().category, 'unproductive', 'neutral tray does not erase Last focused');
  idleSec = 0; live.setPrefs({ trackingPaused: true }); tracker.markPauseBoundary();
  const beforePause = probes;
  time += 1000; await tracker.poll(); assert.equal(probes, beforePause); assert.ok(live.tray.tooltip.includes('Paused'));
  live.setPrefs({ trackingPaused: false }); tracker.markPauseBoundary(); assert.equal(live.tray.image.name, 'standard');
  time += 1000; await tracker.poll(); assert.equal(live.tray.image.name, 'unproductive');
  pending = true; time += 1000;
  const inFlight = tracker.poll();
  tracker.invalidateClassification(); assert.equal(live.tray.image.name, 'standard');
  resolveProbe({ ...sample, idleSec: 0 }); await inFlight;
  assert.equal(live.tray.image.name, 'standard', 'an invalidated in-flight probe cannot recolor the tray');
  pending = false; time += 1000; await tracker.poll(); assert.equal(live.tray.image.name, 'unproductive');
  fail = true; time += 1000; await assert.rejects(tracker.poll(), /Synthetic probe failure/);
  assert.equal(live.tray.image.name, 'standard'); assert.ok(live.tray.tooltip.includes('Tracking unavailable'));
  fail = false; time += 1000; await tracker.poll(); assert.equal(live.tray.image.name, 'unproductive');
  assert.ok(stored.length > 0 && stored.every(row => row.seconds === 1), 'tray changes do not backfill activity');
  tracker.stop(); assert.equal(live.tray.image.name, 'standard'); assert.ok(live.tray.tooltip.includes('Tracking stopped'));
  live.destroy();
  console.log('ok   real tracker integration: lock/sleep, profile change, idle, privacy pause, delayed probes, and errors');
  console.log('tray tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
