'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createUpdateChecker, fetchReleases, compareVersions, latestStable, releaseUrl, DAY, API_URL } = require('../src/updates');
const { defaultSettings } = require('../src/store');
const { validateIpcPayload } = require('../src/ipc-validate');

const release = (tag, extra = {}) => ({ tag_name: tag, prerelease: false, draft: false, ...extra });
const releases = [release('v2.2.0'), release('v2.10.0'), release('v2.3.0'), release('v99.0.0', { draft: true }),
  release('v3.0.0', { prerelease: true }), release('v3.0.0-beta.1'), release('javascript:alert(1)'), release('v2.10.0', { html_url: 'https://evil.example' })];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-updates-'));

async function run() {
  // Exercise the actual bounded HTTPS reader without contacting the network.
  const transport = (statusCode, body, headers = {}) => ({ get(url, options, callback) {
    assert.equal(url, API_URL);
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'User-Agent', 'X-GitHub-Api-Version'].sort(), 'request headers contain no activity, settings, token or cookie');
    const request = new EventEmitter();
    request.destroy = error => { if (error) request.emit('error', error); };
    queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = statusCode; response.headers = headers; response.resume = () => {};
      callback(response);
      if (body === 'aborted') response.emit('aborted');
      else if (body != null) { response.emit('data', Buffer.from(body)); response.emit('end'); }
    });
    return request;
  } });
  const transportSignal = new AbortController();
  assert.deepEqual(await fetchReleases(transportSignal.signal, transport(200, JSON.stringify([release('v2.3.0')]))), [release('v2.3.0')]);
  await assert.rejects(fetchReleases(transportSignal.signal, transport(302, '', { location: 'https://evil.example' })), /unavailable/, 'redirects are not followed');
  await assert.rejects(fetchReleases(transportSignal.signal, transport(200, '{')), /JSON|Unexpected/);
  await assert.rejects(fetchReleases(transportSignal.signal, transport(200, 'x'.repeat(1024 * 1024 + 1))), /too large/);
  await assert.rejects(fetchReleases(transportSignal.signal, transport(200, 'aborted')), /interrupted/);
  await assert.rejects(fetchReleases(transportSignal.signal, transport(429, '', { 'retry-after': '120' })), error => error.retryAt > Date.now() + 110000);
  // Keep a referenced timer so the timeout fixture cannot exit early due to unref().
  const keepAlive = setTimeout(() => {}, 100);
  await assert.rejects(fetchReleases(transportSignal.signal, { ...transport(200, null), timeoutMs: 5 }), /timed out/);
  clearTimeout(keepAlive);
  transportSignal.abort();
  await assert.rejects(fetchReleases(transportSignal.signal, transport(200, '[]')), /canceled/);

  assert.equal(defaultSettings().updateChecksEnabled, false, 'automatic checks are opt-in');
  assert.equal(compareVersions('v2.10.0', '2.3.0'), 1, 'semantic versions, not lexical dates');
  assert.equal(compareVersions('2.2.1', 'v2.2.1'), 0);
  assert.equal(compareVersions('2.2.1', '2.2.2'), -1);
  for (const value of ['02.2.0', '2.3', 'v3.0.0-beta', 'v99999999999999999.0.0', '../v2.3.0', '2.3.0\n']) {
    assert.throws(() => compareVersions(value, '2.2.1'));
    assert.throws(() => releaseUrl(value));
  }
  assert.deepEqual(latestStable(releases), { tag: 'v2.10.0', version: '2.10.0' });
  assert.throws(() => latestStable({ tag_name: 'v2.3.0' }));
  assert.throws(() => latestStable([release('v2.3.0', { prerelease: true })]));
  for (const channel of ['updates:get', 'updates:check', 'updates:openRelease']) {
    assert.equal(validateIpcPayload(channel, undefined), undefined);
    assert.throws(() => validateIpcPayload(channel, 'https://evil.example'));
  }
  assert.equal(validateIpcPayload('settings:update', { updateChecksEnabled: true }).updateChecksEnabled, true);
  assert.throws(() => validateIpcPayload('settings:update', { updateChecksEnabled: 'yes' }));

  let clock = 1790000000000, requests = 0, enabled = false, onboarded = true, next = releases, signal = null;
  let scheduled = [], canceled = [], notifications = [];
  const options = { currentVersion: '2.2.1', dataDir: root, now: () => clock,
    getSettings: () => ({ updateChecksEnabled: enabled, onboardingComplete: onboarded }),
    schedule: (fn, delay) => { const timer = { fn, delay }; scheduled.push(timer); return timer; },
    cancel: timer => canceled.push(timer), onStatus: status => notifications.push(status),
    fetch: async abortSignal => { signal = abortSignal; requests++; if (next instanceof Error) throw next; return next; } };
  const checker = createUpdateChecker(options);
  checker.sync();
  assert.equal(scheduled.length, 0);
  assert.equal(requests, 0, 'startup with checks off makes no network request');
  assert.equal(fs.existsSync(path.join(root, 'update-check.json')), false);
  assert.throws(() => checker.availableUrl(), /No newer/);
  const a = checker.check(), b = checker.check();
  assert.equal(a, b, 'concurrent manual checks share one request');
  const available = await a;
  assert.equal(requests, 1);
  assert.equal(available.available, true);
  assert.equal(available.latestVersion, '2.10.0');
  assert.equal(checker.availableUrl(), 'https://github.com/sreyand/sydtrack/releases/tag/v2.10.0');
  assert.equal(signal.aborted, false);
  assert.equal(scheduled.length, 0, 'manual checks do not enable automatic checks');
  await checker.check();
  assert.equal(requests, 1, 'repeated clicks respect a cooldown');
  const cached = createUpdateChecker(options);
  assert.equal(cached.snapshot().available, true, 'release metadata survives restart');
  await cached.check();
  assert.equal(requests, 1, 'restart respects the saved last-attempt time');
  cached.dispose();

  enabled = true;
  checker.sync();
  assert.equal(scheduled.at(-1).delay, DAY, 'opt-in waits until the next daily check');
  enabled = false; checker.sync();
  assert(canceled.length > 0, 'disabling checks cancels the timer');
  onboarded = false; enabled = true; checker.sync();
  const count = scheduled.length;
  assert.equal(count, 1, 'onboarding does not trigger an automatic check');
  onboarded = true;
  clock += DAY;
  checker.sync();
  assert.equal(scheduled.at(-1).delay, 5000);
  next = new Error('offline');
  scheduled.at(-1).fn();
  await checker.check();
  assert.equal(checker.snapshot().phase, 'unavailable', 'offline never claims up-to-date');
  assert.equal(checker.snapshot().available, true, 'last-known release remains available but is labeled stale');
  assert.equal(checker.snapshot().checkedAt, 1790000000000, 'failed checks do not advance successful-check time');
  const cachedFailure = createUpdateChecker(options);
  await cachedFailure.check();
  assert.equal(requests, 2, 'restarts do not hammer GitHub while offline');
  cachedFailure.dispose();

  clock += 60001; next = Object.assign(new Error('rate limited'), { retryAt: clock + 3600000 });
  await checker.check();
  clock += 120000;
  await checker.check();
  assert.equal(requests, 3, 'GitHub rate-limit backoff is honored for manual checks');
  clock += 3600000; next = [release('v2.1.0')];
  await checker.check();
  assert.equal(checker.snapshot().phase, 'current');
  assert.equal(checker.snapshot().available, false, 'never offers a downgrade');
  assert.throws(() => checker.availableUrl());
  checker.dispose();
  await assert.rejects(checker.check(), /closed/);
  assert(notifications.some(item => item.phase === 'checking'));

  let finish;
  const pendingChecker = createUpdateChecker({ ...options, dataDir: null, fetch: abortSignal => {
    signal = abortSignal; return new Promise(resolve => { finish = resolve; });
  } });
  const pending = pendingChecker.check();
  await Promise.resolve();
  pendingChecker.reset();
  assert(signal.aborted, 'reset aborts in-flight traffic');
  finish(releases); await pending;
  assert.equal(pendingChecker.snapshot().latestVersion, null, 'an old response cannot repopulate erased metadata');
  pendingChecker.dispose();
  assert.equal(API_URL, 'https://api.github.com/repos/sreyand/sydtrack/releases?per_page=100');
  console.log('Update checks passed: opt-in, semantic ordering, stable-only releases, safe URLs, cached daily checks, offline/rate-limit backoff and cancellation.');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
