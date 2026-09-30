'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { writeJson } = require('./json-file');

const API_URL = 'https://api.github.com/repos/sreyand/sydtrack/releases?per_page=100';
const RELEASE_BASE = 'https://github.com/sreyand/sydtrack/releases/tag/';
const DAY = 24 * 60 * 60 * 1000;

function versionParts(value) {
  const match = typeof value === 'string' && /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  if (!left || !right) throw new Error('Invalid release version');
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
function latestStable(releases) {
  if (!Array.isArray(releases) || releases.length > 100) throw new Error('Invalid release response');
  let latest = null;
  for (const release of releases) {
    if (!release || release.draft !== false || release.prerelease !== false || !versionParts(release.tag_name)) continue;
    if (!latest || compareVersions(release.tag_name, latest.tag) > 0) {
      latest = { tag: release.tag_name, version: release.tag_name.replace(/^v/, '') };
    }
  }
  if (!latest) throw new Error('No stable releases found');
  return latest;
}
function releaseUrl(tag) {
  if (!versionParts(tag)) throw new Error('Invalid release version');
  return RELEASE_BASE + tag;
}

// Main-process HTTPS only: fixed destination, no credentials, cookies, activity,
// titles or profile data. Never follow redirects or fetch release assets.
function fetchReleases(signal, { get = https.get, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let request;
    let timer;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => request?.destroy(new Error('Update check canceled'));
    if (signal?.aborted) { reject(new Error('Update check canceled')); return; }
    request = get(API_URL, { headers: {
      'User-Agent': 'sydtrack-update-check',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    } }, response => {
      if (response.statusCode !== 200) {
        const error = new Error('GitHub update check unavailable');
        if (response.statusCode === 403 || response.statusCode === 429) {
          const retry = Number(response.headers['retry-after']);
          const reset = Number(response.headers['x-ratelimit-reset']);
          error.retryAt = Math.min(Date.now() + DAY, Math.max(Date.now() + 60000,
            Number.isFinite(retry) ? Date.now() + retry * 1000 : (Number.isFinite(reset) ? reset * 1000 : Date.now() + 3600000)));
        }
        response.resume();
        finish(error);
        request.destroy();
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { request.destroy(new Error('Release response too large')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { finish(error); }
      });
      response.on('error', error => finish(error));
      response.on('aborted', () => finish(new Error('Release response interrupted')));
    });
    request.on('error', error => finish(error));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => request.destroy(new Error('Update check timed out')), timeoutMs);
    timer.unref?.();
  });
}

function createUpdateChecker({ currentVersion, dataDir, getSettings, onStatus = () => {},
  fetch = fetchReleases, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  if (!versionParts(currentVersion)) throw new Error('Invalid app version');
  const cachePath = dataDir && path.join(dataDir, 'update-check.json');
  let cache = { lastAttemptAt: null, checkedAt: null, latest: null, retryAt: 0 };
  if (cachePath) {
    try {
      if (fs.statSync(cachePath).size <= 4096) {
        const saved = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        for (const key of ['lastAttemptAt', 'checkedAt', 'retryAt']) {
          if (Number.isFinite(saved[key]) && saved[key] >= 0 && saved[key] <= now() + DAY) cache[key] = saved[key];
        }
        if (saved.latest && versionParts(saved.latest.tag)) cache.latest = {
          tag: saved.latest.tag, version: saved.latest.tag.replace(/^v/, '')
        };
      }
    } catch (_) { /* Missing/invalid metadata never blocks startup. */ }
  }
  let phase = cache.latest ? 'cached' : 'idle';
  let inFlight = null, timer = null, controller = null, disposed = false, generation = 0;
  const enabled = () => getSettings().updateChecksEnabled === true && getSettings().onboardingComplete !== false;
  const snapshot = () => ({ currentVersion, phase, checkedAt: cache.checkedAt,
    latestVersion: cache.latest?.version || null,
    available: !!cache.latest && compareVersions(cache.latest.version, currentVersion) > 0 });
  const notify = () => onStatus(snapshot());
  function persist() {
    if (!cachePath) return;
    try { writeJson(cachePath, cache); }
    catch (_) { /* Update metadata is expendable; activity/settings are untouched. */ }
  }
  function sync() {
    if (timer !== null) cancel(timer);
    timer = null;
    if (disposed || !enabled()) return;
    const due = Math.max(cache.lastAttemptAt === null ? 0 : cache.lastAttemptAt + DAY, cache.retryAt);
    timer = schedule(() => { timer = null; if (enabled()) check().catch(() => {}); }, Math.max(5000, due - now()));
    timer?.unref?.();
  }
  function check() {
    if (disposed) return Promise.reject(new Error('Update checker is closed'));
    if (inFlight) return inFlight;
    // Manual clicks share the request and respect offline/rate-limit backoff.
    if (now() < cache.retryAt || (cache.lastAttemptAt !== null && now() - cache.lastAttemptAt < 60000)) {
      return Promise.resolve(snapshot());
    }
    cache.lastAttemptAt = now();
    persist();
    phase = 'checking';
    notify();
    controller = new AbortController();
    const run = generation;
    inFlight = Promise.resolve().then(() => fetch(controller.signal)).then(releases => {
      if (disposed || run !== generation) return snapshot();
      cache.latest = latestStable(releases);
      cache.checkedAt = now();
      cache.retryAt = 0;
      phase = compareVersions(cache.latest.version, currentVersion) > 0 ? 'available' : 'current';
      return snapshot();
    }).catch(error => {
      if (!disposed && run === generation) {
        cache.retryAt = Math.min(now() + DAY, Math.max(now() + 60000, Number(error.retryAt) || 0));
        phase = 'unavailable'; // Failure must never claim the installed version is current.
      }
      return snapshot();
    }).finally(() => {
      inFlight = null;
      controller = null;
      if (!disposed && run === generation) { persist(); notify(); sync(); }
    });
    return inFlight;
  }
  return {
    snapshot, check, sync,
    availableUrl() {
      if (!snapshot().available) throw new Error('No newer release is available.');
      return releaseUrl(cache.latest.tag);
    },
    reset() {
      generation++;
      controller?.abort();
      cache = { lastAttemptAt: null, checkedAt: null, latest: null, retryAt: 0 };
      phase = 'idle'; notify(); sync();
    },
    dispose() { disposed = true; if (timer !== null) cancel(timer); controller?.abort(); }
  };
}

module.exports = { createUpdateChecker, fetchReleases, compareVersions, latestStable, releaseUrl, API_URL, DAY };
