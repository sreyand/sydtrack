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
  let nativeTray = null, controller = null, selected = null, tooltip = '';
  let prefs = { onboardingComplete: true, trackingPaused: false, demoMode: false, pollMs: 3000 };
  let payload = null;
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
            setContextMenu(menu) { nativeTray.setContextMenu(menu); },
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
      getStore: () => ({ getSettings: () => prefs }), getSessionManager: () => null,
      getActiveProfile: () => ({ name: 'Synthetic test profile' }), getLastPayload: () => payload });
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
    prefs = { ...prefs, trackingPaused: true }; controller.refresh(); expectImage('standard');
    assert.ok(tooltip.includes('Paused'));
    prefs = { ...prefs, trackingPaused: false }; controller.refresh(); expectImage('standard');
    controller.refresh({ freshSample: true }); expectImage('other');
    controller.invalidate('lock'); expectImage('standard'); assert.ok(tooltip.includes('Screen locked'));
    controller.refresh({ freshSample: true }); expectImage('other');
    controller.destroy(); assert.equal(nativeTray.isDestroyed(), true); controller = null;
    console.log('Native tray passed: all four supplied logos, 1x/2x/3x images, color changes, pause/resume, lock, and cleanup.');
    app.quit();
  } finally {
    Module._load = originalLoad;
    if (controller) controller.destroy();
    if (nativeTray && !nativeTray.isDestroyed()) nativeTray.destroy();
  }
}).catch(error => { console.error(error); app.exit(1); });
