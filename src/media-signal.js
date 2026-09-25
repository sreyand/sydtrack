'use strict';

// Turns local playback facts into one foreground media sample.
// A title or URL is never proof that something is playing.

const MUSIC_APPS = ['spotify', 'itunes', 'applemusic', 'music', 'foobar2000', 'winamp', 'clementine', 'rhythmbox', 'elisa', 'strawberry', 'audacious', 'cmus', 'bandcamp', 'soundcloud', 'pandora'];
const VIDEO_APPS = ['vlc', 'mpv', 'mplayer', 'wmplayer', 'mpc', 'mpchc', 'quicktime', 'quicktimeplayer', 'tv', 'netflix', 'plex', 'kodi'];
const VIDEO_WORDS = ['youtube', 'youtu.be', 'netflix', 'vimeo', 'twitch', 'hulu', 'disney+', 'disneyplus', 'primevideo', 'piped'];
const MUSIC_WORDS = ['spotify', 'soundcloud', 'bandcamp', 'pandora', 'music.youtube', 'youtubemusic', 'youtube music'];
const BROWSER_TOKENS = ['chrome', 'googlechrome', 'msedge', 'microsoftedge', 'firefox', 'mozillafirefox', 'brave', 'bravebrowser', 'opera', 'operabrowser', 'chromium', 'vivaldi', 'safari', 'waterfox', 'librewolf', 'arc', 'browser'];
const APP_GROUPS = [
  ['chrome', 'googlechrome'],
  ['msedge', 'microsoftedge', 'edge'],
  ['firefox', 'mozillafirefox'],
  ['brave', 'bravebrowser'],
  ['opera', 'operabrowser'],
  ['itunes', 'applemusic', 'music']
];

function compact(value) {
  return String(value || '').toLowerCase().replace(/\.exe$/i, '').replace(/[^a-z0-9]+/g, '');
}

function includesToken(haystack, words) {
  const text = String(haystack || '').toLowerCase();
  return words.some((word) => text.includes(word));
}

function normalizeStatus(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 4) return 'playing';
    if (value === 5) return 'paused';
    if (value === 0 || value === 3) return 'stopped';
    return 'unknown';
  }
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (text === '4' || text === 'playing') return 'playing';
  if (text === '5' || text === 'paused') return 'paused';
  if (text === '0' || text === '3' || text === 'stopped' || text === 'closed') return 'stopped';
  return 'unknown';
}

function explicitKind(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return 'music';
    if (value === 2) return 'video';
    return null;
  }
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (text === '1' || text === 'music') return 'music';
  if (text === '2' || text === 'video') return 'video';
  return null;
}

function appHas(app, names) {
  return names.some((name) => {
    if (name.length < 4) return app === name;
    return app.includes(name);
  });
}

function inferKind({ appId, appName, title }) {
  const app = compact(`${appId || ''} ${appName || ''}`);
  const label = `${appId || ''} ${appName || ''} ${title || ''}`.toLowerCase();
  if (appHas(app, MUSIC_APPS)) return 'music';
  if (appHas(app, VIDEO_APPS)) return 'video';
  if (includesToken(label, MUSIC_WORDS)) return 'music';
  if (includesToken(label, VIDEO_WORDS)) return 'video';
  return 'unknown';
}

function isBrowserApp(appId, appName) {
  return [appId, appName].map(compact).some((token) => BROWSER_TOKENS.some((item) => {
    if (item.length < 4) return token === item;
    return token === item || token.includes(item);
  }));
}

function sessionKind(raw, appId, appName, title) {
  const inferred = inferKind({ appId, appName, title });
  // Chromium SMTC reports PlaybackType=Music for ordinary YouTube/video tabs.
  if (isBrowserApp(appId, appName)) {
    return inferred === 'music' ? 'music' : 'video';
  }
  return explicitKind(raw.kind) || inferred;
}

function normalizeSession(session) {
  const raw = session || {};
  const appId = String(raw.appId || raw.appName || '');
  const appName = String(raw.appName || raw.appId || '');
  const title = String(raw.title || '');
  const kind = sessionKind(raw, appId, appName, title);
  return {
    status: normalizeStatus(raw.status),
    kind,
    appId,
    appName,
    title
  };
}

function namesOf(win) {
  const owner = (win && win.owner) || {};
  const base = String(owner.path || '').split(/[/\\]/).pop();
  return [owner.name, base].map(compact).filter(Boolean);
}

function tokensMatch(left, right) {
  if (!left || !right) return false;
  if (left === right && left.length >= 3) return true;
  if (left.length >= 4 && right.includes(left)) return true;
  if (right.length >= 4 && left.includes(right)) return true;
  return APP_GROUPS.some((group) => {
    const leftHit = group.some((item) => left === item || (item.length >= 4 && left.includes(item)));
    const rightHit = group.some((item) => right === item || (item.length >= 4 && right.includes(item)));
    return leftHit && rightHit;
  });
}

function isBrowserToken(token) {
  return BROWSER_TOKENS.some((item) => token === item || (item.length >= 4 && token.includes(item)));
}

function titlesOverlap(windowTitle, mediaTitle) {
  const windowText = String(windowTitle || '').toLowerCase();
  const mediaText = String(mediaTitle || '').trim().toLowerCase();
  if (mediaText.length < 3 || !windowText) return false;
  if (windowText.includes(mediaText)) return true;
  const slice = mediaText.slice(0, Math.min(24, mediaText.length));
  return slice.length >= 8 && windowText.includes(slice);
}

function sessionMatchesForeground(session, win) {
  if (!session || !win) return false;
  const windowNames = namesOf(win);
  const sessionNames = [session.appId, session.appName].map(compact).filter(Boolean);
  const appMatch = windowNames.some((name) => sessionNames.some((other) => tokensMatch(name, other)));
  if (!appMatch) return false;
  const browser = windowNames.some(isBrowserToken) || sessionNames.some(isBrowserToken);
  if (!browser) return true;
  return titlesOverlap(win.title, session.title);
}

function selectForegroundMedia(sessions, win) {
  const list = Array.isArray(sessions) ? sessions : [];
  const playing = list.filter((session) => session.status === 'playing' && sessionMatchesForeground(session, win));
  if (playing.length) {
    const best = playing.slice().sort((a, b) => Number(b.kind !== 'unknown') - Number(a.kind !== 'unknown'))[0];
    return {
      status: 'playing',
      kind: best.kind,
      foreground: true,
      title: best.title,
      appName: best.appName || best.appId
    };
  }
  if (list.some((session) => session.status === 'paused' && sessionMatchesForeground(session, win))) {
    return { status: 'paused', kind: 'unknown', foreground: true, title: '', appName: '' };
  }
  return { status: 'none', kind: 'unknown', foreground: false, title: '', appName: '' };
}

function normalizeMediaReport(raw, win) {
  if (!raw || raw.available === false) {
    return {
      available: false,
      source: (raw && raw.source) || 'none',
      status: 'none',
      kind: 'unknown',
      foreground: false,
      title: '',
      appName: ''
    };
  }
  const sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).map(normalizeSession);
  return {
    available: true,
    source: raw.source || 'unknown',
    ...selectForegroundMedia(sessions, win)
  };
}

module.exports = {
  normalizeStatus,
  normalizeSession,
  normalizeMediaReport,
  selectForegroundMedia,
  sessionMatchesForeground,
  inferKind,
  sessionKind,
  isBrowserApp
};
