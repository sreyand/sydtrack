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
const { DEFAULT_THEME, normalizeTheme } = require('../src/theme');
const { defaultSettings } = require('../src/store');

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
assert(WINDOW_BACKGROUND_DARK === '#0E1116', 'dark window fill is Midnight canvas');
assert(WINDOW_BACKGROUND_LIGHT === '#F4F5F7', 'light window fill is Graphite canvas');
assert(windowBackgroundColor(true) === WINDOW_BACKGROUND_DARK, 'boolean dark uses Midnight canvas');
assert(windowBackgroundColor(false) === WINDOW_BACKGROUND_LIGHT, 'boolean light uses Graphite canvas');
assert(windowBackgroundColor('graphite') === '#F4F5F7', 'graphite theme uses its canvas');
assert(windowBackgroundColor('midnight') === '#0E1116', 'midnight theme uses its canvas');
assert(windowBackgroundColor('dusk') === '#2B2A33', 'dusk theme uses its canvas');
assert(buildBrowserWindowOptions({
  preloadPath: preload,
  backgroundColor: windowBackgroundColor('graphite')
}).backgroundColor === '#F4F5F7', 'BrowserWindow options accept the active theme canvas');

assert(CONTENT_SECURITY_POLICY.includes("default-src 'self'"), 'CSP default-src is self');
assert(!/https?:/.test(CONTENT_SECURITY_POLICY), 'CSP has no remote origins');
assert(!CONTENT_SECURITY_POLICY.includes('unsafe-eval'), 'CSP has no unsafe-eval');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
assert(/http-equiv="Content-Security-Policy"/i.test(html), 'renderer HTML declares a CSP');
assert(/default-src 'self'/.test(html), 'renderer CSP defaults to self');
assert(/font-src 'self'/.test(html), 'renderer CSP keeps fonts on self');
assert(!/<(?:script|link|img|iframe)\b[^>]+\b(?:src|href)=['"]https?:/i.test(html), 'renderer HTML has no remote script/style/img URLs');
assert(!/fonts\.googleapis|fontshare\.com|cdn\./i.test(html), 'renderer HTML has no font CDN');
assert(DEFAULT_THEME === 'midnight', 'unset theme preference is Midnight');
assert(normalizeTheme(undefined) === 'midnight' && normalizeTheme(null) === 'midnight', 'missing theme normalizes to Midnight');
assert(defaultSettings().theme === 'midnight', 'new installs default to Midnight');
assert(/data-theme="midnight"/.test(html), 'renderer first paint uses Midnight');
assert(!/Graphite is the default/i.test(html), 'Appearance copy does not call Graphite the default');
assert(/Midnight is the default/.test(html), 'Appearance helper names Midnight as the default');
assert(html.includes('appearance-card'), 'Appearance picker is scoped for the theme chips');
const homeCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
assert(homeCss.includes('#view-home .page-head > .mood-pill'), 'Home status pill is scoped so the accent dot stays in the chip');
assert(homeCss.includes('#view-home .last-focused .lf-app'), 'Home last-focused app name is scoped to stay readable');
assert(/#view-home \.home-layout[\s\S]{0,800}justify-content:\s*center/.test(homeCss), 'Home donut + rail cluster is centered in the content pane');
assert(/#view-home \.home-layout[\s\S]{0,800}padding-left:\s*clamp/.test(homeCss), 'Home cluster is padded toward center-right, not left-floated');
assert(/\.home-focus-actions \.profile-menu[\s\S]{0,80}top:\s*calc\(100% \+ 4px\)/.test(homeCss), 'Home focus-profile menu opens downward by default');
assert(homeCss.includes('profile-menu-up'), 'Home focus-profile menu can flip only when there is room above');
assert(/#view-home \.pie-total[\s\S]{0,200}font-weight:\s*500/.test(homeCss), 'Home donut time is a secondary Satoshi 500 readout');
assert(!/#view-home \.pie-total[^{]*\{[^}]*--display-1/.test(homeCss), 'Home donut time is not the display-1 billboard');
assert(/#view-home \.pie-legend strong[\s\S]{0,40}display:\s*none/.test(homeCss), 'Home pie legend hides the giant duration numbers');
assert(!/>Actual</.test(html), 'Daily focus share card does not show an Actual label');
assert(!/>Other excluded</.test(html) && !html.includes('id="roundup-goal-scope"'), 'Daily focus share card does not show Other excluded');
assert(/id="roundup-goal-card"[^>]*class="[^"]*has-tip/.test(html) || /class="[^"]*has-tip[^"]*"[^>]*id="roundup-goal-card"/.test(html), 'Daily focus share card uses the existing hover tip pattern');
assert(/data-full="[^"]*Other is excluded/.test(html), 'Daily focus share tip explains the default Other-excluded metric');
assert(!html.includes('id="app-drill"') && !html.includes('app-hours-btn'), 'app hour-breakdown detail is not in the UI');
const wellbeingUi = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'wellbeing-ui.js'), 'utf8');
assert(!wellbeingUi.includes('of active tracked time today'), 'app hour-breakdown copy is not rendered');
const rendererJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
assert(rendererJs.includes('fmtPieDuration(total)'), 'Home donut uses the natural duration format');
assert(/return m \+ ' min'/.test(rendererJs), 'sub-hour donut time reads as min, not abrupt m');
assert(rendererJs.includes(".app-trunc, .has-tip"), 'existing name-tip also opens for has-tip cards');
assert(html.includes('theme.css'), 'renderer loads the local theme sheet');
assert(html.includes('settings-block-title'), 'Goals settings-block-title is preserved');
const satoshiDir = path.join(__dirname, '..', 'renderer', 'fonts', 'satoshi');
for (const cut of ['Light', 'Regular', 'Medium', 'Bold', 'Black']) {
  assert(fs.existsSync(path.join(satoshiDir, 'Satoshi-' + cut + '.woff2')), 'Satoshi ' + cut + ' woff2 is bundled');
}
assert(fs.existsSync(path.join(satoshiDir, 'FFL.txt')), 'Satoshi FFL attribution is bundled');
const themeCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'theme.css'), 'utf8');
assert(!/IBM Plex|Inter/.test(themeCss), 'theme sheet does not load IBM Plex or Inter');
const rendererCss = ['theme.css', 'styles.css', 'wellbeing.css'].map((name) =>
  fs.readFileSync(path.join(__dirname, '..', 'renderer', name), 'utf8')
).join('\n');
const weightHits = rendererCss.match(/font-weight\s*:\s*[^;]+/gi) || [];
const allowedWeights = new Set(['300', '400', '500', '700', '900']);
const badWeights = weightHits.filter((decl) => {
  const num = String(decl).match(/(\d+)/);
  return num && !allowedWeights.has(num[1]);
});
assert(badWeights.length === 0, 'renderer CSS font-weight values stay on 300/400/500/700/900' + (badWeights.length ? ' (off: ' + badWeights.join(', ') + ')' : ''));
const radiusHits = rendererCss.match(/border-radius\s*:\s*[^;]+/gi) || [];
const allowedRadius = /^(?:0|50%|inherit|var\(--radius-(?:sm|md)\))(?:\s+(?:0|var\(--radius-(?:sm|md)\)))*$/;
const badRadii = radiusHits.filter((decl) => {
  const value = String(decl).split(':')[1].replace(/\s+/g, ' ').trim();
  return !allowedRadius.test(value);
});
assert(badRadii.length === 0, 'renderer radii stay on 6/10 tokens (or 0/50%/inherit)' + (badRadii.length ? ' (off: ' + badRadii.join(', ') + ')' : ''));
assert(!/rgba\(\s*129\s*,\s*140\s*,\s*248/i.test(rendererCss), 'no hardcoded lavender accent bypass');
assert(!/#818cf8|#c7d2fe|#949dff/i.test(rendererCss), 'no hardcoded lavender hex accent bypass');
assert(!/rgba\(\s*52\s*,\s*211\s*,\s*153|#34d399|#86efac|#22d3ee/i.test(rendererCss), 'no neon green tracking chrome');
assert(!/\.btn\.danger[^{]*\{[^}]*#fecdd3/i.test(rendererCss), 'danger buttons do not use light-pink label color');
assert(!/\.privacy-warning p[^{]*\{[^}]*#fef3c7/i.test(rendererCss), 'privacy warning body is not yellow-on-yellow');
assert(!/\.danger-zone[^{]*\{[^}]*dashed/i.test(rendererCss), 'danger zone uses a flat 1px divider, not a dashed leftover');
assert(/\.btn\.danger[^{]*\{[^}]*var\(--color-data-unproductive\)/i.test(rendererCss), 'danger fill uses the unproductive token');
assert(/font-weight:\s*300/.test(rendererCss), 'Satoshi 300 remains on the faint-secondary allowlist');
const fontDir = path.join(__dirname, '..', 'renderer', 'fonts');
const leftoverInter = fs.readdirSync(fontDir).filter((name) => /^inter/i.test(name));
assert(leftoverInter.length === 0, 'unused Inter woff2 files are not bundled' + (leftoverInter.length ? ' (left: ' + leftoverInter.join(', ') + ')' : ''));

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
assert(validateIpcPayload('settings:update', { screenTimeLimitEnabled: false, duckEnabled: false, focusShareIncludeOther: false }).duckEnabled === false, 'settings:update accepts remaining wellbeing keys');
throws(() => validateIpcPayload('settings:update', { onboardingComplete: true }), 'settings:update rejects orphan onboardingComplete');
throws(() => validateIpcPayload('settings:update', { demoMode: true }), 'settings:update rejects unknown keys');
throws(() => validateIpcPayload('settings:update', { thresholdSec: 0 }), 'settings:update rejects a 0 threshold');
throws(() => validateIpcPayload('settings:update', { reminderMessage: 'x'.repeat(2001) }), 'settings:update rejects oversized text');
assert(validateIpcPayload('settings:update', { focusBoostScheduleStart: '09:00' }).focusBoostScheduleStart === '09:00', 'settings:update accepts HH:MM');
throws(() => validateIpcPayload('settings:update', { focusBoostScheduleStart: '9:00' }), 'settings:update rejects loose times');
assert(validateIpcPayload('settings:update', { theme: 'midnight' }).theme === 'midnight', 'settings:update accepts a theme');
throws(() => validateIpcPayload('settings:update', { theme: 'neon' }), 'settings:update rejects an unknown theme');
assert(validateIpcPayload('keywords:set', { productive: ['github'], unproductive: ['youtube'] }).productive[0] === 'github', 'keywords:set accepts lists');
throws(() => validateIpcPayload('keywords:set', { productive: [1], unproductive: [] }), 'keywords:set rejects non-strings');

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
