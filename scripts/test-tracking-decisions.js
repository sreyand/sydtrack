'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { decideSample, assessContinuity, toleranceMs, elapsedSeconds } = require('../src/tracking-decision');
const { reduceSystemPresence } = require('../src/tracking-lifecycle');
const { normalizeMediaReport } = require('../src/media-signal');
const { escapeJsonString } = require('../src/json-escape');
const { classify, appLabel, canonicalAppName } = require('../src/classifier');
const { buildExport, importBackup } = require('../src/backup');
const { deleteAllMyData, backupUserConfig } = require('../src/data-ownership');
const { validateIpcPayload } = require('../src/ipc-validate');
const {
  defaultBrowserKeywords,
  parseBrowserKeywordPack,
  buildBrowserKeywordPack,
  loadBrowserKeywords,
  saveBrowserKeywords
} = require('../src/browser-keywords');
const { createStore } = require('../src/store');
const { createTracker } = require('../src/tracker');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  }
}

function sample(overrides) {
  return Object.assign({
    elapsedSec: 1,
    idleSec: 0,
    idleTimeoutSec: 300,
    demoMode: false,
    paused: false,
    ignored: false,
    hasWindow: true,
    screenOff: false,
    discontinuity: false,
    systemAsleep: false,
    systemLocked: false,
    category: 'productive',
    media: { status: 'none', kind: 'unknown', foreground: false },
    trackMusicWhileIdle: false,
    trackVideoWhileIdle: false
  }, overrides);
}

async function run() {
  const t0 = 1_700_000_000_000;
  const steady = assessContinuity({ previousAt: t0, now: t0 + 1000, toleranceMs: toleranceMs(750) });
  assert(steady.discontinuity === false && steady.gapMs === 1000, 'fake clock: a one-second poll gap is continuous');
  const jumped = assessContinuity({ previousAt: t0, now: t0 + 10000, toleranceMs: 5000 });
  assert(jumped.discontinuity && jumped.reason === 'clock', 'fake clock: a forward jump beyond tolerance is discarded');
  const backward = assessContinuity({ previousAt: t0, now: t0 - 20, toleranceMs: 5000 });
  assert(backward.discontinuity && backward.gapMs === -20, 'fake clock: a backward jump is discarded');
  assert(elapsedSeconds(t0, t0 + 1500) === 1.5 && elapsedSeconds(t0, t0) === 0, 'elapsed time is clamped at zero');

  const active = decideSample(sample({ idleSec: 10 }));
  assert(active.count && active.reason === 'active' && active.category === 'productive', 'input inside the timeout counts and keeps its tag');
  const ordinaryIdle = decideSample(sample({ idleSec: 300, category: 'unproductive' }));
  assert(!ordinaryIdle.count && ordinaryIdle.idle && ordinaryIdle.reason === 'idle' && ordinaryIdle.category === 'unproductive', 'default idle timeout still drops unattended time');
  const playingVideo = {
    status: 'playing', kind: 'video', foreground: true
  };
  const videoOff = decideSample(sample({ idleSec: 400, category: 'unproductive', media: playingVideo, trackVideoWhileIdle: false }));
  assert(!videoOff.count && videoOff.reason === 'idle', 'playing video stays idle when the video setting is off');
  const videoOn = decideSample(sample({ idleSec: 400, category: 'unproductive', media: playingVideo, trackVideoWhileIdle: true }));
  assert(videoOn.count && videoOn.reason === 'media-video' && videoOn.category === 'unproductive', 'opted-in video counts and unproductive tags still win');
  const taggedLecture = decideSample(sample({ idleSec: 400, category: 'productive', media: playingVideo, trackVideoWhileIdle: true }));
  assert(taggedLecture.count && taggedLecture.category === 'productive', 'a productive tag stays productive while video playback keeps the sample');
  const paused = decideSample(sample({ idleSec: 400, media: { status: 'paused', kind: 'video', foreground: true }, trackVideoWhileIdle: true }));
  assert(!paused.count && paused.reason === 'idle', 'paused media never counts');
  const musicOff = decideSample(sample({ idleSec: 400, media: { status: 'playing', kind: 'music', foreground: true } }));
  assert(!musicOff.count, 'music stays idle unless its own setting is on');
  const musicOn = decideSample(sample({ idleSec: 400, category: 'other', media: { status: 'playing', kind: 'music', foreground: true }, trackMusicWhileIdle: true }));
  assert(musicOn.count && musicOn.reason === 'media-music' && musicOn.category === 'other', 'opted-in foreground music counts without reclassifying');
  const background = decideSample(sample({ idleSec: 400, media: { status: 'playing', kind: 'music', foreground: false }, trackMusicWhileIdle: true }));
  assert(!background.count && background.reason === 'idle', 'background playback does not keep the focused app active');
  const unknown = decideSample(sample({ idleSec: 400, media: { status: 'playing', kind: 'unknown', foreground: true }, trackMusicWhileIdle: true, trackVideoWhileIdle: true }));
  assert(!unknown.count, 'unknown playback type does not extend idle');
  const asleep = decideSample(sample({ systemAsleep: true, media: playingVideo, trackVideoWhileIdle: true }));
  assert(!asleep.count && asleep.reason === 'sleep', 'sleep beats media playback');
  const locked = decideSample(sample({ systemLocked: true, idleSec: 5, media: { status: 'playing', kind: 'music', foreground: true }, trackMusicWhileIdle: true }));
  assert(!locked.count && locked.reason === 'lock', 'the lock screen beats media playback');
  const jumpedClock = decideSample(sample({ discontinuity: true, elapsedSec: 40 }));
  assert(jumpedClock.dropInterval && !jumpedClock.count && jumpedClock.elapsedSec === 0, 'a clock jump contributes no seconds');
  const screen = decideSample(sample({ screenOff: true, idleSec: 0, category: 'productive' }));
  assert(!screen.count && screen.reason === 'screen-off', 'a confirmed screen-off drops the focused app');
  const screenVideo = decideSample(sample({ screenOff: true, media: playingVideo, trackVideoWhileIdle: true }));
  assert(!screenVideo.count && screenVideo.reason === 'screen-off', 'video does not count while the screen is off');
  const screenMusic = decideSample(sample({ screenOff: true, media: { status: 'playing', kind: 'music', foreground: true }, trackMusicWhileIdle: true, category: 'unproductive' }));
  assert(screenMusic.count && screenMusic.category === 'unproductive', 'opted-in foreground music can count with the screen off');
  const disabledTimeout = decideSample(sample({ idleTimeoutSec: 0, idleSec: 9999 }));
  assert(disabledTimeout.count && disabledTimeout.reason === 'active', 'an idle timeout of zero keeps the previous behavior');

  let presence = reduceSystemPresence({ sleeping: false, locked: false }, 'suspend');
  presence = reduceSystemPresence(presence, 'unlock-screen');
  assert(presence.inactive && presence.sleeping && !presence.locked, 'unlock during sleep does not resume tracking');
  presence = reduceSystemPresence(presence, 'resume', 'locked');
  assert(presence.inactive && presence.locked && !presence.sleeping, 'resume while locked stays suspended');
  presence = reduceSystemPresence(presence, 'resume', 'unknown');
  assert(presence.locked && presence.inactive, 'unknown resume state keeps the lock bit');
  presence = reduceSystemPresence(presence, 'resume', 'active');
  assert(!presence.inactive && !presence.locked, 'resume while active clears the lock');

  const githubWhileVideo = normalizeMediaReport({
    available: true, source: 'smtc',
    sessions: [{ status: 4, kind: 2, appId: 'chrome.exe', title: 'Lecture' }]
  }, { owner: { name: 'Google Chrome' }, title: 'GitHub' });
  assert(githubWhileVideo.foreground === false && githubWhileVideo.status === 'none', 'a browser media session must match the focused title');
  const playingLecture = normalizeMediaReport({
    available: true, source: 'smtc',
    sessions: [{ status: 4, kind: 2, appId: 'MSEdge', title: 'Calculus lecture' }]
  }, { owner: { name: 'msedge' }, title: 'Calculus lecture - YouTube' });
  assert(playingLecture.foreground && playingLecture.status === 'playing' && playingLecture.kind === 'video', 'SMTC playing video on the focused page is foreground video');
  const pausedEdge = normalizeMediaReport({
    available: true, source: 'smtc',
    sessions: [{ status: 5, kind: 2, appId: 'msedge', title: 'Calculus lecture' }]
  }, { owner: { name: 'msedge' }, title: 'Calculus lecture - YouTube' });
  assert(pausedEdge.status === 'paused', 'SMTC paused is not playing');
  const backgroundMusic = normalizeMediaReport({
    available: true, source: 'smtc',
    sessions: [{ status: 4, kind: 1, appId: 'Spotify.exe', title: 'Song' }]
  }, { owner: { name: 'Code' }, title: 'main.js' });
  assert(!backgroundMusic.foreground, 'Spotify does not attach to an unrelated foreground app');
  // Real Chrome SMTC: PlaybackStatus=4 (Playing), PlaybackType=1 (Music).
  // Chromium reports ordinary YouTube/video tabs as Music; the title often
  // has no "YouTube" token. Trusting kind:1 would count this as music.
  const chromeVideoPayload = {
    available: true,
    source: 'smtc',
    sessions: [{ status: 4, kind: 1, appId: 'Chrome', title: 'Never Gonna Give You Up' }]
  };
  const chromeVideo = normalizeMediaReport(chromeVideoPayload, {
    owner: { name: 'chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    title: 'Never Gonna Give You Up - YouTube'
  });
  assert(chromeVideo.status === 'playing' && chromeVideo.kind === 'video' && chromeVideo.foreground === true, 'a real Chrome SMTC Music-type video session is video, not music');
  assert(decideSample(sample({
    idleSec: 400, category: 'unproductive', media: chromeVideo, trackMusicWhileIdle: true, trackVideoWhileIdle: false
  })).count === false, 'Chromium video does not use the music-while-idle setting');
  assert(decideSample(sample({
    idleSec: 400, category: 'unproductive', media: chromeVideo, trackVideoWhileIdle: true
  })).count === true, 'Chromium video uses the video-while-idle setting');
  const chromeMusic = normalizeMediaReport({
    available: true, source: 'smtc',
    sessions: [{ status: 4, kind: 1, appId: 'Chrome', title: 'Night Drive - YouTube Music' }]
  }, { owner: { name: 'chrome' }, title: 'Night Drive - YouTube Music' });
  assert(chromeMusic.kind === 'music', 'YouTube Music in Chrome stays music');
  const missing = normalizeMediaReport(null, { owner: { name: 'chrome' }, title: 'YouTube' });
  assert(missing.available === false && missing.status === 'none', 'a missing media probe falls back to no playback');

  const browserList = defaultBrowserKeywords();
  const emptyProfile = { productive: [], unproductive: [], browserKeywords: browserList };
  assert(classify({ owner: { name: 'chrome' }, title: 'Netflix' }, emptyProfile) === 'unproductive', 'an empty Focus profile still uses the default browser list');
  assert(classify({ owner: { name: 'firefox' }, title: 'Khan Academy' }, emptyProfile) === 'productive', 'default browser keywords can mark a learning page productive');
  assert(classify({ owner: { name: 'chrome' }, title: 'YouTube' }, {
    productive: ['youtube'], unproductive: [], browserKeywords: browserList
  }) === 'productive', 'Focus profile tags take precedence over the browser list');
  assert(classify({ owner: { name: 'Code' }, title: 'YouTube project' }, {
    productive: [], unproductive: [], identities: { productiveApps: ['code'] }, browserKeywords: browserList
  }) === 'productive', 'browser keywords do not reclassify a native app');
  assert(classify({ owner: { name: 'Notepad' }, title: 'youtube notes' }, emptyProfile) === 'other', 'browser keywords ignore non-browser windows');
  assert(classify({ owner: { name: 'chrome' }, title: 'myyoutube clone' }, {
    productive: [], unproductive: [], browserKeywords: { productive: [], unproductive: ['youtube'] }
  }) === 'productive', 'browser keywords require an exact token, not a substring');
  assert(classify({ owner: { name: 'chrome' }, title: 'Watch YouTube now' }, {
    productive: [], unproductive: [], browserKeywords: { productive: [], unproductive: ['youtube'] }
  }) === 'unproductive', 'an exact youtube token still matches');
  const historyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-kw-history-'));
  const historyStore = createStore(historyRoot);
  historyStore.addSeconds('chrome', 'unproductive', 40, { category: 'unproductive', reason: 'youtube' });
  const beforeDefaults = historyStore.snapshot().byCategory.unproductive;
  classify({ owner: { name: 'chrome' }, title: 'YouTube' }, {
    productive: ['youtube'], unproductive: [], browserKeywords: { productive: ['youtube'], unproductive: [] }
  });
  historyStore.reclassifyStoredApps({
    productive: ['youtube'],
    unproductive: [],
    browserKeywords: { productive: ['youtube'], unproductive: [] }
  });
  assert(historyStore.snapshot().byCategory.unproductive === beforeDefaults, 'changing bundled browser defaults does not rewrite stored history');
  assert(historyStore.snapshot().topApps.some((row) => row.name === 'chrome' && row.category === 'unproductive'), 'reclassifyStoredApps leaves browser history on its recorded category');
  fs.rmSync(historyRoot, { recursive: true, force: true });
  const pack = buildBrowserKeywordPack({ productive: [' Docs.Example '], unproductive: ['youtube', 'youtube'] });
  assert(parseBrowserKeywordPack(JSON.stringify(pack)).productive[0] === 'docs.example' && parseBrowserKeywordPack(pack).unproductive.length === 1, 'browser keyword files normalize and round-trip locally');
  let rejected = false;
  try { parseBrowserKeywordPack({ format: 'sydtrack-browser-keywords', schemaVersion: 1, productive: [42], unproductive: [] }); }
  catch (_) { rejected = true; }
  assert(rejected, 'invalid browser keyword files are rejected');
  const keywordDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-browser-kw-'));
  const keywordPath = path.join(keywordDir, 'browser-keywords.json');
  fs.writeFileSync(keywordPath, '{');
  assert(loadBrowserKeywords(keywordPath).unproductive.includes('youtube') && fs.readFileSync(keywordPath, 'utf8') === '{', 'a damaged browser keyword file is preserved and defaults are used');
  saveBrowserKeywords(keywordPath, { productive: ['github'], unproductive: [] });
  assert(loadBrowserKeywords(keywordPath).productive[0] === 'github' && loadBrowserKeywords(keywordPath).unproductive.length === 0, 'clearing the browser list is saved');
  const kept = JSON.parse(fs.readFileSync(keywordPath, 'utf8'));
  loadBrowserKeywords(keywordPath);
  assert(JSON.stringify(JSON.parse(fs.readFileSync(keywordPath, 'utf8'))) === JSON.stringify(kept), 'loading does not overwrite an existing user keyword file with new defaults');

  assert(appLabel({ owner: { name: 'Google Chrome' } }) === 'chrome', 'Chrome display names share the process label');
  assert(appLabel({ owner: { name: 'chrome.exe' } }) === 'chrome', 'executable suffixes do not split an app');
  assert(appLabel({ owner: { name: '', path: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' }, title: 'New Tab - different every time' }) === 'firefox', 'a missing process name uses the executable, not the changing title');
  assert(appLabel({ owner: { name: 'Code' }, title: 'renamed window' }) === 'Code', 'an unaliased process name stays stable when the title changes');
  assert(canonicalAppName('Google Chrome') === 'chrome' && canonicalAppName('chrome.exe') === 'chrome', 'old Chrome display names canonicalize');
  const migrateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-app-migrate-'));
  const migrateStore = createStore(migrateRoot);
  const { todayKey } = require('../src/store');
  const previous = new Date();
  previous.setDate(previous.getDate() - 1);
  const migrateDate = todayKey(previous.getTime());
  migrateStore.writeHistoryDay({
    date: migrateDate,
    byApp: { 'Google Chrome::unproductive': { seconds: 9, category: 'unproductive' }, 'chrome.exe::unproductive': { seconds: 1, category: 'unproductive' } },
    byCategory: { productive: 0, unproductive: 10, other: 0 }
  });
  const migrated = migrateStore.loadHistoryDay(migrateDate);
  assert(migrated.byApp['chrome::unproductive'].seconds === 10 && !migrated.byApp['Google Chrome::unproductive'], 'old Chrome names merge into one stored app');
  fs.rmSync(migrateRoot, { recursive: true, force: true });

  const controls = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('');
  const escaped = escapeJsonString(`a"${controls}\\z`);
  assert(!/[\u0000-\u001f]/.test(escaped), 'JSON escape contains no raw control characters');
  assert(JSON.parse(`"${escaped}"`) === `a"${controls}\\z`, 'JSON escape round-trips every control character');

  assert(validateIpcPayload('settings:update', { trackMusicWhileIdle: true, trackVideoWhileIdle: false }).trackMusicWhileIdle === true, 'settings allowlist accepts media-while-idle keys');
  let settingsRejected = false;
  try { validateIpcPayload('settings:update', { browserKeywords: [] }); } catch (_) { settingsRejected = true; }
  assert(settingsRejected, 'settings allowlist still rejects unknown keys');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-decision-tracker-'));
  const store = createStore(root);
  assert(store.getSettings().trackMusicWhileIdle === false && store.getSettings().trackVideoWhileIdle === false, 'media-while-idle settings default off');
  store.updateSettings({ demoMode: false, idleTimeoutSec: 30, thresholdSec: 1, reminderCooldownSec: 0, notificationsEnabled: true });
  let clock = Date.now();
  let windowName = 'Code';
  let title = 'main.js';
  let idleSec = 0;
  let media = { available: false, source: 'none', sessions: [] };
  let screenOff = false;
  let sessionTicks = [];
  let reminders = 0;
  const rules = {
    productive: ['github'],
    unproductive: ['youtube'],
    identities: { productiveApps: ['code'] },
    browserKeywords: { productive: ['docs'], unproductive: ['netflix'] }
  };
  const tracker = createTracker({
    store,
    rules,
    ignore: [],
    now: () => clock,
    sessionManager: { onTrackerTick(tick) { sessionTicks.push(tick); return {}; } },
    onReminder: () => { reminders += 1; },
    backend: { getActiveWindow: async () => ({ window: { owner: { name: windowName }, title }, idleSec, media, screenOff }) }
  });
  const poll = async (ms = 1000) => { clock += ms; await tracker.poll(); };
  await poll();
  await poll();
  windowName = 'chrome';
  title = 'Lecture - YouTube';
  media = { available: true, source: 'smtc', sessions: [{ status: 4, kind: 2, appId: 'chrome', title: 'Lecture' }] };
  idleSec = 40;
  await poll();
  assert(store.snapshot().byCategory.productive === 2 && store.snapshot().byCategory.unproductive === 0, 'default settings do not count idle video');
  assert(sessionTicks[sessionTicks.length - 1].elapsedSec === 0 && reminders === 0, 'sessions and reminders follow the idle decision');
  store.updateSettings({ trackVideoWhileIdle: true });
  sessionTicks = [];
  await poll();
  assert(store.snapshot().byCategory.unproductive === 1 && sessionTicks[0].elapsedSec === 1 && sessionTicks[0].category === 'unproductive', 'sessions and totals share opted-in video time and its tag');
  media = { available: true, source: 'smtc', sessions: [{ status: 5, kind: 2, appId: 'chrome', title: 'Lecture' }] };
  const beforePause = store.snapshot().byCategory.unproductive;
  await poll();
  assert(store.snapshot().byCategory.unproductive === beforePause, 'paused video adds no time');
  windowName = 'Code';
  title = 'main.js';
  idleSec = 0;
  screenOff = false;
  media = { available: true, source: 'smtc', sessions: [{ status: 4, kind: 1, appId: 'Spotify.exe', title: 'Song' }] };
  store.updateSettings({ trackMusicWhileIdle: true, trackVideoWhileIdle: false });
  await poll();
  const beforeBackground = store.snapshot().byCategory.productive;
  idleSec = 90;
  await poll();
  assert(store.snapshot().byCategory.productive === beforeBackground, 'background music does not keep Code active after the timeout');
  windowName = 'chrome';
  title = 'Netflix';
  idleSec = 0;
  media = { available: false, sessions: [] };
  await poll();
  assert(store.snapshot().byCategory.unproductive > 1, 'browser keywords classify a focused browser when the profile has no matching tag');
  const earned = store.snapshot().byCategory.productive + store.snapshot().byCategory.unproductive;
  windowName = 'chrome';
  title = 'GitHub';
  await poll(500);
  await poll(700);
  const afterSwitch = store.snapshot().byCategory.productive + store.snapshot().byCategory.unproductive;
  assert(Math.abs(afterSwitch - earned - 1.2) < 0.001, 'switching foreground windows records each interval once');
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const priorToday = store.snapshot().byCategory.productive;
  store.addInterval('Code', 'productive', midnight.getTime() - 500, midnight.getTime() + 500);
  const yesterday = new Date(midnight.getTime() - 1);
  const y = yesterday.getFullYear();
  const m = String(yesterday.getMonth() + 1).padStart(2, '0');
  const d = String(yesterday.getDate()).padStart(2, '0');
  const archived = JSON.parse(fs.readFileSync(path.join(root, 'history', `${y}-${m}-${d}.json`), 'utf8'));
  assert(archived.byCategory.productive === 0.5, 'a midnight-crossing interval keeps the first half on the previous day');
  assert(Math.abs(store.snapshot().byCategory.productive - (priorToday + 0.5)) < 0.001, 'a midnight-crossing interval keeps the second half on today');
  store.updateSettings({ trackVideoWhileIdle: true, thresholdSec: 1 });
  windowName = 'chrome';
  title = 'Lecture - YouTube';
  idleSec = 100;
  media = { available: true, source: 'smtc', sessions: [{ status: 4, kind: 2, appId: 'chrome', title: 'Lecture' }] };
  await poll();
  await poll();
  assert(reminders >= 1, 'reminders use the same media decision as tracked time');
  const reasons = [];
  const presenceStore = createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-presence-')));
  presenceStore.updateSettings({ demoMode: false, idleTimeoutSec: 0, trackVideoWhileIdle: true });
  let presenceClock = Date.now();
  const presenceTracker = createTracker({
    store: presenceStore,
    rules,
    ignore: [],
    now: () => presenceClock,
    backend: { getActiveWindow: async () => ({
      window: { owner: { name: 'chrome' }, title: 'Lecture - YouTube' },
      idleSec: 0,
      media: { available: true, source: 'smtc', sessions: [{ status: 4, kind: 1, appId: 'Chrome', title: 'Lecture - YouTube' }] }
    }) },
    onTick: (tick) => { reasons.push(tick.now.idleReason); }
  });
  presenceClock += 1000; await presenceTracker.poll();
  const beforeLock = presenceStore.snapshot().byCategory.unproductive || 0;
  presenceTracker.setSystemPresence({ sleeping: false, locked: true });
  presenceClock += 1000; await presenceTracker.poll();
  assert(reasons.includes('lock') && (presenceStore.snapshot().byCategory.unproductive || 0) === beforeLock, 'lock reaches decideSample and adds no time');
  presenceTracker.setSystemPresence({ sleeping: true, locked: false });
  presenceClock += 1000; await presenceTracker.poll();
  assert(reasons.includes('sleep'), 'sleep reaches decideSample');
  const { EventEmitter } = require('events');
  const { bindTrackingLifecycle } = require('../src/tracking-lifecycle');
  const power = new EventEmitter();
  power.getSystemIdleState = () => 'active';
  const unbindPresence = bindTrackingLifecycle(power, presenceTracker);
  power.emit('unlock-screen');
  power.emit('resume');
  presenceClock += 1000; await presenceTracker.poll();
  power.emit('lock-screen');
  presenceClock += 1000; await presenceTracker.poll();
  assert(reasons.filter((reason) => reason === 'lock').length >= 2, 'lock-screen from powerMonitor reaches decideSample');
  power.emit('unlock-screen');
  power.emit('suspend');
  presenceClock += 1000; await presenceTracker.poll();
  assert(reasons.filter((reason) => reason === 'sleep').length >= 2, 'suspend from powerMonitor reaches decideSample');
  unbindPresence();
  presenceTracker.setSystemPresence({ sleeping: false, locked: false });
  presenceClock += 60000; await presenceTracker.poll();
  assert(reasons.includes('clock'), 'a clock jump reaches decideSample');
  presenceTracker.stop();

  const { createWindowsBackend } = require('../src/windows-backend');
  let seenArgs = [];
  const gated = createWindowsBackend({
    includeMedia: false,
    run(_exe, args, _opts, cb) {
      seenArgs = args;
      cb(null, JSON.stringify({ window: { owner: { name: 'Chrome' }, title: 'YouTube' }, idleSec: 0 }));
    }
  });
  await gated.getActiveWindow();
  assert(!seenArgs.includes('-IncludeMedia'), 'the Windows media probe stays off when no media setting is enabled');
  const ungated = createWindowsBackend({
    includeMedia: true,
    run(_exe, args, _opts, cb) {
      seenArgs = args;
      cb(null, JSON.stringify({ window: { owner: { name: 'Chrome' }, title: 'YouTube' }, idleSec: 0 }));
    }
  });
  await ungated.getActiveWindow();
  assert(seenArgs.includes('-IncludeMedia'), 'the Windows media probe runs only when a media setting is on');

  const backup = buildExport(store, { includeSettings: true, browserKeywords: { productive: ['docs'], unproductive: ['netflix'] } });
  assert(backup.browserKeywords.unproductive[0] === 'netflix', 'full backups include browser-keywords.json');
  const dest = createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-kw-import-')));
  let importedKeywords;
  importBackup(dest, backup, { onBrowserKeywords: (value) => { importedKeywords = value; } });
  assert(importedKeywords.unproductive[0] === 'netflix', 'backup import restores browser keywords');
  const eraseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-kw-erase-'));
  const erasePath = path.join(eraseDir, 'browser-keywords.json');
  saveBrowserKeywords(erasePath, { productive: ['docs'], unproductive: ['netflix'] });
  const preImport = backupUserConfig(eraseDir);
  assert(preImport && fs.existsSync(path.join(preImport, 'browser-keywords.json')), 'pre-import backup copies browser-keywords.json');
  const erased = deleteAllMyData({ dataDir: eraseDir });
  assert(erased.ok && !fs.existsSync(erasePath), 'delete-all removes browser-keywords.json');

  tracker.stop();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(keywordDir, { recursive: true, force: true });

  if (failed) throw new Error(`${failed} tracking decision checks failed`);
}

module.exports = { run };
if (require.main === module) {
  run().then(() => {
    console.log('tracking decision checks passed');
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
