'use strict';

const { execFile } = require('child_process');
const { parseMprisNames, parseMprisPlayer, parsePlaybackLines, parseMacDisplayPower, parseXsetMonitor } = require('./media-signal');

const PROBE_MS = 900;

function runCommand(run, command, args, timeout) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    try {
      run(command, args, { windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 256 * 1024 }, (err, stdout) => {
        finish({ ok: !err, stdout: String(stdout || '') });
      });
    } catch (_) {
      finish({ ok: false, stdout: '' });
    }
  });
}

const MAC_SCRIPT = [
  'set out to ""',
  'try',
  'tell application "System Events" to set spotifyOn to (name of processes) contains "Spotify"',
  'if spotifyOn then',
  'tell application "Spotify"',
  'set trackName to ""',
  'try',
  'set trackName to name of current track',
  'end try',
  'set out to out & "Spotify" & tab & (player state as string) & tab & trackName & tab & "music" & linefeed',
  'end tell',
  'end if',
  'end try',
  'try',
  'tell application "System Events" to set musicOn to (name of processes) contains "Music"',
  'if musicOn then',
  'tell application "Music"',
  'set trackName to ""',
  'try',
  'set trackName to name of current track',
  'end try',
  'set out to out & "Music" & tab & (player state as string) & tab & trackName & tab & "music" & linefeed',
  'end tell',
  'end if',
  'end try',
  'try',
  'tell application "System Events" to set vlcOn to (name of processes) contains "VLC"',
  'if vlcOn then',
  'tell application "VLC"',
  'set mediaName to ""',
  'try',
  'set mediaName to name of current item',
  'end try',
  'if playing then',
  'set mediaState to "playing"',
  'else',
  'set mediaState to "paused"',
  'end if',
  'set out to out & "VLC" & tab & mediaState & tab & mediaName & tab & "video" & linefeed',
  'end tell',
  'end if',
  'end try',
  'try',
  'tell application "System Events" to set tvOn to (name of processes) contains "TV"',
  'if tvOn then',
  'tell application "TV"',
  'set trackName to ""',
  'try',
  'set trackName to name of current track',
  'end try',
  'set out to out & "TV" & tab & (player state as string) & tab & trackName & tab & "video" & linefeed',
  'end tell',
  'end if',
  'end try',
  'return out'
].join('\n');

async function probeDarwinMedia(run) {
  const args = MAC_SCRIPT.split('\n').flatMap((line) => ['-e', line]);
  const result = await runCommand(run, 'osascript', args, PROBE_MS);
  if (!result.ok && !result.stdout.trim()) return { available: false, source: 'now-playing', sessions: [] };
  const sessions = parsePlaybackLines(result.stdout);
  return { available: sessions.length > 0 || result.ok, source: 'now-playing', sessions };
}

async function probeLinuxMedia(run) {
  const listed = await runCommand(run, 'dbus-send', [
    '--session', '--dest=org.freedesktop.DBus', '--type=method_call', '--print-reply',
    '/org/freedesktop/DBus', 'org.freedesktop.DBus.ListNames'
  ], PROBE_MS);
  if (!listed.ok) return { available: false, source: 'mpris', sessions: [] };
  const names = parseMprisNames(listed.stdout).slice(0, 6);
  const sessions = [];
  for (const name of names) {
    const player = await runCommand(run, 'dbus-send', [
      '--session', '--print-reply', `--dest=${name}`,
      '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties.GetAll',
      'string:org.mpris.MediaPlayer2.Player'
    ], PROBE_MS);
    if (player.ok || player.stdout) sessions.push(parseMprisPlayer(player.stdout, name));
  }
  return { available: true, source: 'mpris', sessions };
}

async function probeDarwinScreen(run) {
  const result = await runCommand(run, 'ioreg', ['-n', 'IODisplayWrangler', '-r', '-d', '4'], PROBE_MS);
  if (!result.ok && !result.stdout) return null;
  return parseMacDisplayPower(result.stdout);
}

async function probeLinuxScreen(run) {
  const result = await runCommand(run, 'xset', ['q'], PROBE_MS);
  if (!result.ok && !result.stdout) return null;
  return parseXsetMonitor(result.stdout);
}

async function readPlatformSignals({ platform = process.platform, run = execFile } = {}) {
  if (platform === 'darwin') {
    const [media, screenOff] = await Promise.all([probeDarwinMedia(run), probeDarwinScreen(run)]);
    return { media, screenOff };
  }
  if (platform === 'linux') {
    const [media, screenOff] = await Promise.all([probeLinuxMedia(run), probeLinuxScreen(run)]);
    return { media, screenOff };
  }
  return { media: { available: false, source: 'none', sessions: [] }, screenOff: null };
}

function createSignalAttacher() {
  let cached = null;
  let at = -Infinity;
  return async function attachPlatformSignals(result, options = {}) {
    const sample = result || {};
    if (sample.media && sample.screenOff != null) return sample;
    const now = typeof options.now === 'function' ? options.now() : Date.now();
    if (!cached || now - at > 2000) {
      try {
        cached = await readPlatformSignals(options);
      } catch (_) {
        cached = { media: { available: false, source: 'none', sessions: [] }, screenOff: null };
      }
      at = now;
    }
    return {
      ...sample,
      media: sample.media || cached.media,
      screenOff: sample.screenOff != null ? sample.screenOff : cached.screenOff
    };
  };
}

const attachPlatformSignals = createSignalAttacher();

module.exports = {
  readPlatformSignals,
  attachPlatformSignals,
  createSignalAttacher,
  probeDarwinMedia,
  probeLinuxMedia
};
