'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateIpcPayload, channels } = require('../src/ipc-validate');
const {
  APP_PAGE_URL,
  CONTENT_SECURITY_POLICY,
  WINDOW_BACKGROUND_DARK,
  WINDOW_BACKGROUND_LIGHT,
  assertIpcSender,
  buildBrowserWindowOptions,
  hardenedWebPreferences,
  isAllowedNavigation,
  resolveAppFile,
  windowBackgroundColor
} = require('../src/window-security');
const { electronLaunchArgs } = require('./launch-args');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok  ', msg);
  }
}

function throws(fn, msg) {
  try {
    fn();
    assert(false, msg);
  } catch (_) {
    assert(true, msg);
  }
}

const preload = path.join(__dirname, '..', 'src', 'preload.js');
const prefs = hardenedWebPreferences(preload);
assert(prefs.contextIsolation === true, 'contextIsolation is on');
assert(prefs.nodeIntegration === false, 'nodeIntegration is off');
assert(prefs.sandbox === true, 'sandbox is on');
assert(prefs.webSecurity === true, 'webSecurity is on');
assert(prefs.webviewTag === false, 'webviewTag is off');
assert(prefs.allowRunningInsecureContent === false, 'insecure content is blocked');
throws(() => hardenedWebPreferences('preload.js'), 'relative preload path is rejected');

const win = buildBrowserWindowOptions({
  preloadPath: preload,
  iconPath: path.join(__dirname, '..', 'renderer', 'assets', 'logo-wordmark.png'),
  platform: 'linux'
});
assert(win.webPreferences === prefs || (
  win.webPreferences.contextIsolation &&
  !win.webPreferences.nodeIntegration &&
  win.webPreferences.sandbox &&
  win.webPreferences.webSecurity
), 'BrowserWindow options stay hardened');
assert(win.show === false, 'window stays hidden until ready');
assert(WINDOW_BACKGROUND_DARK === '#121418', 'dark window fill is #121418');
assert(WINDOW_BACKGROUND_LIGHT === '#f3f4f6', 'light window fill is #f3f4f6');
assert(windowBackgroundColor(true) === WINDOW_BACKGROUND_DARK, 'dark theme uses the dark window fill');
assert(windowBackgroundColor(false) === WINDOW_BACKGROUND_LIGHT, 'light theme uses the light window fill');
assert(buildBrowserWindowOptions({
  preloadPath: preload,
  backgroundColor: windowBackgroundColor(false)
}).backgroundColor === '#f3f4f6', 'BrowserWindow options accept the light fill');

assert(CONTENT_SECURITY_POLICY.includes("default-src 'self'"), 'CSP default-src is self');
assert(!/https?:/.test(CONTENT_SECURITY_POLICY), 'CSP has no remote origins');
assert(!CONTENT_SECURITY_POLICY.includes('unsafe-eval'), 'CSP has no unsafe-eval');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
assert(/http-equiv="Content-Security-Policy"/i.test(html), 'renderer HTML declares a CSP');
assert(/default-src 'self'/.test(html), 'renderer CSP defaults to self');
assert(!/<(?:script|link|img|iframe)\b[^>]+\b(?:src|href)=['"]https?:/i.test(html), 'renderer HTML has no remote script/style/img URLs');

assert(isAllowedNavigation(APP_PAGE_URL), 'app page URL is allowed');
assert(!isAllowedNavigation('https://example.com'), 'https navigation is blocked');
assert(!isAllowedNavigation('file:///etc/passwd'), 'file navigation is blocked');
assert(!isAllowedNavigation('sydtrack://app/renderer/index.html?x=1'), 'query strings are blocked');
assert(!isAllowedNavigation('sydtrack://evil/renderer/index.html'), 'other hosts are blocked');

const root = path.join(__dirname, '..');
assert(resolveAppFile(APP_PAGE_URL, root).endsWith(path.join('renderer', 'index.html')), 'app page maps to renderer HTML');
assert(resolveAppFile('sydtrack://app/src/browser-rules.js', root).endsWith(path.join('src', 'browser-rules.js')), 'shared browser-rules script is served');
assert(resolveAppFile('sydtrack://app/src/main.js', root) == null, 'main process files are not served');
assert(resolveAppFile('sydtrack://app/package.json', root) == null, 'package.json is not served');
assert(resolveAppFile('sydtrack://app/renderer/../src/main.js', root) == null, 'path traversal is rejected');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-sec-'));
const outside = path.join(os.tmpdir(), `sydtrack-outside-${process.pid}.txt`);
fs.writeFileSync(outside, 'nope');
fs.symlinkSync(outside, path.join(tmp, 'renderer'));
assert(resolveAppFile('sydtrack://app/renderer/index.html', tmp) == null, 'symlink escape is rejected');

throws(() => assertIpcSender({}, { webContents: true }), 'IPC without a matching sender is rejected');
throws(() => assertIpcSender({ sender: {} }, { webContents: true }), 'IPC from a different contents is rejected');
assertIpcSender({ sender: 'same', senderFrame: { url: APP_PAGE_URL } }, 'same');
assert(true, 'IPC from the app origin is accepted');

throws(() => validateIpcPayload('unknown', {}), 'unknown IPC channel is rejected');
assert(channels.includes('state:get'), 'state:get is a known channel');
assert(validateIpcPayload('state:get', undefined) === undefined, 'state:get takes no payload');
throws(() => validateIpcPayload('state:get', {}), 'state:get rejects extra payload');

const activityId = JSON.stringify(['Chrome', 'unproductive', 'youtube']);
assert(validateIpcPayload('apps:correctActivityToday', { id: activityId, category: 'productive' }).category === 'productive', 'activity correction accepts a valid shape');
throws(() => validateIpcPayload('apps:correctActivityToday', { id: activityId, category: 'evil' }), 'activity correction rejects unknown categories');
throws(() => validateIpcPayload('apps:correctActivityToday', { id: 'Chrome', category: 'productive' }), 'activity correction rejects a bare name');
assert(validateIpcPayload('apps:correctToday', { name: 'Chrome', category: 'ignored' }).name === 'Chrome', 'app correction accepts a valid shape');
throws(() => validateIpcPayload('apps:correctToday', { name: '', category: 'other' }), 'app correction rejects an empty name');

assert(validateIpcPayload('history:summary', 7) === 7, 'history summary accepts a day count');
throws(() => validateIpcPayload('history:summary', 0), 'history summary rejects 0');
throws(() => validateIpcPayload('history:summary', 91), 'history summary rejects >90');
throws(() => validateIpcPayload('history:summary', 7.5), 'history summary rejects floats');

assert(validateIpcPayload('rules:set', { productive: ['github'], unproductive: ['youtube'] }).productive[0] === 'github', 'rules:set accepts lists');
throws(() => validateIpcPayload('rules:set', { productive: ['x'], unproductive: ['y'], extra: true }), 'rules:set rejects extra keys');
throws(() => validateIpcPayload('rules:set', { productive: [1], unproductive: [] }), 'rules:set rejects non-strings');
assert(validateIpcPayload('ignore:set', { ignore: ['explorer'] }).ignore[0] === 'explorer', 'ignore:set accepts a list');
throws(() => validateIpcPayload('ignore:set', ['explorer']), 'ignore:set rejects a bare array');

assert(validateIpcPayload('profiles:save', { id: null, fields: { name: 'Coding' } }).id === null, 'profiles:save accepts a new profile');
throws(() => validateIpcPayload('profiles:save', { id: '../x', fields: { name: 'x' } }), 'profiles:save rejects a bad id');
throws(() => validateIpcPayload('profiles:activate', ''), 'profiles:activate rejects an empty id');
assert(validateIpcPayload('profiles:activate', 'default') === 'default', 'profiles:activate accepts default');

assert(validateIpcPayload('settings:update', { trackingPaused: true, thresholdSec: 600 }).thresholdSec === 600, 'settings:update accepts known keys');
assert(validateIpcPayload('settings:update', { trackMusicWhileIdle: false, trackVideoWhileIdle: true }).trackVideoWhileIdle === true, 'settings:update accepts media-while-idle keys');
assert(channels.includes('wellbeing'), 'wellbeing is a known channel');
assert(validateIpcPayload('wellbeing', { action: 'startBreak' }).action === 'startBreak', 'wellbeing accepts startBreak');
assert(validateIpcPayload('settings:update', { focusShareGoalPct: 80, gamificationEnabled: false, decompressBreaksPerDay: 0 }).decompressBreaksPerDay === 0, 'settings:update accepts goal keys');
throws(() => validateIpcPayload('settings:update', { demoMode: true }), 'settings:update rejects unknown keys');
throws(() => validateIpcPayload('settings:update', { thresholdSec: 0 }), 'settings:update rejects a 0 threshold');
throws(() => validateIpcPayload('settings:update', { reminderMessage: 'x'.repeat(2001) }), 'settings:update rejects oversized text');
assert(validateIpcPayload('settings:update', { focusBoostScheduleStart: '09:00' }).focusBoostScheduleStart === '09:00', 'settings:update accepts HH:MM');
throws(() => validateIpcPayload('settings:update', { focusBoostScheduleStart: '9:00' }), 'settings:update rejects loose times');

assert(validateIpcPayload('data:export', { includeSettings: true }).includeSettings === true, 'data:export accepts flags');
throws(() => validateIpcPayload('data:export', { includeSettings: 1 }), 'data:export rejects non-booleans');
assert(validateIpcPayload('data:import', { mode: 'merge' }).mode === 'merge', 'data:import accepts merge');
throws(() => validateIpcPayload('data:import', { mode: 'wipe' }), 'data:import rejects unknown modes');
assert(validateIpcPayload('profile:export', { id: 'default' }).id === 'default', 'profile:export accepts an id');

assert(validateIpcPayload('session:start', { mode: 'custom', customMin: 45 }).customMin === 45, 'session:start accepts custom minutes');
throws(() => validateIpcPayload('session:start', { mode: 'nap' }), 'session:start rejects unknown modes');
assert(validateIpcPayload('session:getForDay', '2026-09-24') === '2026-09-24', 'session:getForDay accepts a date');
throws(() => validateIpcPayload('session:getForDay', '09/24/2026'), 'session:getForDay rejects a loose date');
assert(validateIpcPayload('session:delete', { id: 's_abc123_def456' }).id === 's_abc123_def456', 'session:delete accepts an id');
throws(() => validateIpcPayload('session:delete', { id: '../../etc' }), 'session:delete rejects a path-like id');

const desktop = electronLaunchArgs({ platform: 'win32', env: {}, appPath: '.', extra: [] });
assert(!desktop.args.includes('--no-sandbox'), 'desktop launch keeps the Chromium sandbox');
const headless = electronLaunchArgs({ platform: 'linux', env: {}, appPath: '.', extra: [] });
assert(headless.headless && headless.args.includes('--no-sandbox'), 'headless Linux may disable the Chromium sandbox');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert(pkg.build.publish === null, 'electron-builder publish is disabled');
assert(pkg.build.linux.maintainer === 'SydTrack <noreply@sydtrack.app>', 'Linux deb maintainer is set');
assert(pkg.build.win.signAndEditExecutable === false, 'Windows signing is off by default');
assert(pkg.build.mac && pkg.build.linux, 'macOS and Linux package targets exist');
const builder = require('../build/electron-builder.config.js');
assert(builder.publish === null, 'builder config publish is null');
assert(builder.linux.maintainer === pkg.build.linux.maintainer, 'builder config keeps the Linux maintainer');
const preloadSrc = fs.readFileSync(preload, 'utf8');
assert(!preloadSrc.includes('correctAppToday'), 'preload no longer exposes unused correctAppToday');
assert(!preloadSrc.includes('importProfilePack'), 'preload no longer exposes unused importProfilePack');
assert(preloadSrc.includes('contextBridge.exposeInMainWorld'), 'preload uses contextBridge');

if (failed) {
  console.error(failed + ' hardening check(s) failed');
  process.exitCode = 1;
} else {
  console.log('hardening checks passed');
}
