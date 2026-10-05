'use strict';

// Exercise real Electron NativeImages and Tray methods with synthetic activity.
// No production main process, foreground probes, startup writes, or personal data.
if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('child_process').spawn(require('electron'), [__filename], {
    env, stdio: 'inherit', windowsHide: true
  });
  const timeout = setTimeout(() => { console.error('Native tray check timed out'); child.kill(); }, 45000);
  child.on('error', error => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { clearTimeout(timeout); process.exitCode = code == null ? 1 : code; });
  return;
}

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const electron = require('electron');
const { app, nativeImage } = electron;
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-tray-check-')));
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  let nativeTray = null, nativeMenu = null, controller = null, selected = null, tooltip = '';
  let prefs = { onboardingComplete: true, trackingPaused: false, demoMode: false, pollMs: 3000 };
  let payload = null;
  const settingsChanges = [], settingsSnapshots = [];
  const store = { getSettings: () => prefs, snapshot: () => ({ settings: { ...prefs } }) };
  const trayModule = path.join(__dirname, '..', 'src', 'tray.js');
  const originalLoad = Module._load;
  try {
    // Forward every operation to a real Tray, retaining only the image argument
    // to verify the source mapping. Do not subclass Electron's native classes.
    Module._load = function (request, parent, isMain) {
      if (request === 'electron' && parent && parent.filename === trayModule) {
        return { ...electron, Tray: function (image) {
          selected = image;
          nativeTray = new electron.Tray(image);
          return {
            setImage(next) { nativeTray.setImage(next); selected = next; },
            setToolTip(text) { nativeTray.setToolTip(text); tooltip = text; },
            setContextMenu(menu) { nativeTray.setContextMenu(menu); nativeMenu = menu; },
            on(event, handler) { nativeTray.on(event, handler); },
            destroy() { nativeTray.destroy(); }
          };
        } };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    const { createAppTray } = require(trayModule);
    Module._load = originalLoad;
    controller = createAppTray({ getMainWindow: () => null,
      getStore: () => store, getSessionManager: () => null,
      getLastPayload: () => payload,
      updateSettings: partial => { settingsChanges.push(partial); prefs = { ...prefs, ...partial }; return prefs; },
      sendTrackerUpdate: next => { payload = next; settingsSnapshots.push(next); } });
    const size = process.platform === 'linux' ? 24 : 16;
    function expectImage(name) {
      assert.equal(selected.isEmpty(), false);
      assert.deepEqual(selected.getSize(), { width: size, height: size });
      assert.deepEqual(selected.getScaleFactors().sort(), [1, 2, 3]);
      for (const scaleFactor of [1, 2, 3]) {
        const actual = nativeImage.createFromBuffer(selected.toPNG({ scaleFactor }));
        assert.deepEqual(actual.getSize(), { width: size * scaleFactor, height: size * scaleFactor });
        const expected = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'assets', 'tray', name + '.png'))
          .resize({ width: size * scaleFactor, height: size * scaleFactor, quality: 'best' });
        assert.ok(actual.toBitmap().equals(expected.toBitmap()), name + ' preserves the supplied artwork at ' + scaleFactor + 'x');
      }
    }
    expectImage('standard');
    for (const category of ['productive', 'unproductive', 'other']) {
      payload = { now: { app: 'Synthetic app', source: 'real', category, idle: false, ignored: false },
        lastFocused: { app: 'Stale context', category: 'productive' } };
      controller.refresh({ freshSample: true });
      expectImage(category);
      assert.ok(tooltip.includes(category[0].toUpperCase() + category.slice(1)));
    }
    assert.ok(nativeMenu instanceof electron.Menu, 'the tray uses a real Electron Menu');
    const pauseMenu = nativeMenu.items.find(item => item.label === 'Pause for');
    assert.ok(pauseMenu.submenu instanceof electron.Menu, 'Pause for builds a real submenu');
    assert.deepEqual(pauseMenu.submenu.items.map(item => item.label), ['15 minutes', '30 minutes', '1 hour']);
    const realNow = Date.now;
    let pauseStartedAt = realNow();
    try {
      Date.now = () => pauseStartedAt;
      for (const [label, minutes] of [['15 minutes', 15], ['30 minutes', 30], ['1 hour', 60], ['15 minutes', 15]]) {
        const parent = nativeMenu.items.find(item => item.label === 'Pause for');
        assert.equal(parent.enabled, true, 'timed pauses can be rescheduled while paused');
        const choice = parent.submenu.items.find(item => item.label === label);
        const snapshotsBefore = settingsSnapshots.length;
        choice.click(choice, null, {});
        assert.deepEqual(settingsChanges[settingsChanges.length - 1], {
          trackingPaused: true, trackingPauseUntil: pauseStartedAt + minutes * 60 * 1000
        }, 'native submenu callback applies exactly the chosen pause deadline');
        assert.equal(settingsSnapshots.length, snapshotsBefore + 1, 'each native callback refreshes synthetic window settings');
        assert.equal(payload.stats.settings.trackingPauseUntil, prefs.trackingPauseUntil);
        assert.equal(payload.sessionCompleted, null, 'settings refresh never replays session completion');
        expectImage('standard');
        assert.ok(tooltip.includes('Paused'));
        pauseStartedAt += 60000;
      }
      const resume = nativeMenu.items.find(item => item.label === 'Resume tracking');
      resume.click(resume, null, {});
      assert.equal(prefs.trackingPaused, false);
      assert.equal(prefs.trackingPauseUntil, 0, 'native Resume cancels the selected timed pause');
      expectImage('standard');
    } finally { Date.now = realNow; }
    prefs = { ...prefs, onboardingComplete: false }; controller.refresh();
    assert.equal(nativeMenu.items.find(item => item.label === 'Pause for').enabled, false,
      'native timed-pause submenu is disabled before onboarding');
    assert.equal(nativeMenu.items.find(item => item.label === 'Pause tracking').enabled, false);
    prefs = { ...prefs, onboardingComplete: true }; controller.refresh();
    prefs = { ...prefs, trackingPaused: true }; controller.refresh(); expectImage('standard');
    assert.ok(tooltip.includes('Paused'));
    prefs = { ...prefs, trackingPaused: false }; controller.refresh(); expectImage('standard');
    controller.refresh({ freshSample: true }); expectImage('other');
    controller.invalidate('lock'); expectImage('standard'); assert.ok(tooltip.includes('Screen locked'));
    controller.refresh({ freshSample: true }); expectImage('other');
    controller.destroy(); assert.equal(nativeTray.isDestroyed(), true); controller = null;
    console.log('Native tray passed: all four supplied logos, 1x/2x/3x images, real pause submenu/callbacks, onboarding guard, color changes, pause/resume, lock, and cleanup.');
    app.quit();
  } finally {
    Module._load = originalLoad;
    if (controller) controller.destroy();
    if (nativeTray && !nativeTray.isDestroyed()) nativeTray.destroy();
  }
}).catch(error => { console.error(error); app.exit(1); });
