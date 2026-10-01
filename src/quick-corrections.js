'use strict';

const { randomUUID } = require('crypto');
const { isBrowserProcess, classifyWithReason, isIgnored, appLabel } = require('./classifier');
const { contentTitle, exactKeyword, isBrowserName, quickKeyword } = require('./browser-rules');
const { createExplanation } = require('./classification-explanation');

const TYPES = ['productive', 'unproductive', 'other'];
const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const processName = value => normalize(value).replace(/\.exe$/, '');
const has = (list, key) => (list || []).some(value => normalize(value) === key);
const without = (list, key) => (list || []).filter(value => normalize(value) !== key);

// Tokens are opaque, short-lived, main-process-only and never contain a title.
// Restore just the affected memberships, preserving every unrelated edit.
function createQuickCorrections({ profiles, store, getIdentities = () => null, getRules = () => ({}), now = Date.now }) {
  const changes = new Map();
  function remember(change) {
    for (const [token, item] of changes) if (item.expires <= now()) changes.delete(token);
    if (changes.size >= 20) changes.delete(changes.keys().next().value);
    const undoToken = randomUUID();
    changes.set(undoToken, { ...change, expires: now() + 120000 });
    return { kind: change.kind, undoToken };
  }
  function active(id) {
    const profile = profiles.active();
    if (profile.id !== id) throw new Error('Focus profile changed. Try again in the active profile.');
    return profile;
  }
  function membership(profile, keyword, app) {
    return { ...Object.fromEntries(TYPES.map(type => [type, has(profile[type], keyword)])), ignored: has(profile.ignore, app) };
  }
  function preview(entry) {
    const win = { owner: { name: entry.app }, title: entry.title || '' };
    const profile = profiles.active();
    const rules = { ...getRules(), ...profile, identities: getIdentities() };
    const activity = classifyWithReason(win, rules);
    const correction = store.getActivityCorrection(appLabel(win), activity) || store.getAppCorrection(appLabel(win));
    const selfIgnored = isIgnored(win, [], {});
    const ignored = selfIgnored || (correction ? correction === 'ignored' : isIgnored(win, profile.ignore, rules.identities));
    const category = ignored ? 'ignored' : correction || activity.category;
    return { previewCategory: category, previewExplanation: createExplanation({ activity, category,
      correction: selfIgnored ? null : correction, correctionDate: store.getState && store.getState().date,
      ignored, rules: { ...rules, profileId: profile.id, profileName: profile.name } }) };
  }
  function quickSet({ profileId, app, title, keyword, category, toggle = true }) {
    const profile = active(profileId);
    const appKey = processName(app);
    if (!appKey || ![...TYPES, 'ignored'].includes(category)) throw new Error('Invalid quick correction.');
    const key = category === 'ignored' ? '' : normalize(keyword);
    if (category !== 'ignored') {
      if (!key || key.length > 200 || /[\x00-\x1f\x7f]/.test(key)) throw new Error('Choose a title phrase of 1–200 characters.');
      if (isBrowserProcess({ owner: { name: app } }, getIdentities())) {
        const extraNames = getIdentities()?.browserApps;
        const text = contentTitle(title, extraNames);
        const known = quickKeyword({ app, title }, { ...profile, identities: getIdentities() });
        if (isBrowserName(key, extraNames) || key.startsWith('site:') ||
            (key !== known && (!exactKeyword(text, key) || !normalize(text).includes(key)))) {
          throw new Error('Choose words from the page title, not the browser name.');
        }
      } else if (key !== appKey) throw new Error('Native app corrections must use the app name.');
    }
    const before = membership(profile, key, appKey);
    const fields = {};
    if (category === 'ignored') {
      fields.ignore = without(profile.ignore, appKey);
      if (!toggle || !before.ignored) fields.ignore.push(appKey);
    } else {
      for (const type of TYPES) fields[type] = without(profile[type], key);
      if (!toggle || !before[category]) fields[category].push(key);
      fields.ignore = without(profile.ignore, appKey);
    }
    profiles.save(profileId, fields); // One atomic save, including whole-app Ignore.
    const after = membership(profiles.active(), key, appKey);
    let effective = { previewCategory: null, previewExplanation: null };
    // The rule is committed. A read/rollover failure in its preview must never
    // misreport a successful save as a failure or invite an accidental toggle.
    try { effective = preview({ app, title }); } catch (_) {}
    return { ...remember({ kind: 'rule', profileId, keyword: key, app: appKey, before, after, ignoreOnly: category === 'ignored' }),
      profileName: profile.name, ...effective };
  }
  function correctActivity(id, category) {
    const previous = store.activityUndoState(id);
    const stats = store.correctActivityToday(id, category, getIdentities());
    return { ...remember({ kind: 'activity', ...previous, expectedCategory: category }), stats };
  }
  function undo(token) {
    const change = changes.get(token);
    if (!change || change.expires <= now()) {
      changes.delete(token);
      throw new Error('Undo expired. You can change the category again.');
    }
    let result;
    if (change.kind === 'activity') {
      result = { kind: 'activity', stats: store.restoreActivityCorrection(change) };
    } else {
      const profile = active(change.profileId);
      const current = membership(profile, change.keyword, change.app);
      const fields = change.ignoreOnly ? ['ignored'] : [...TYPES, 'ignored'];
      if (fields.some(type => current[type] !== change.after[type])) {
        throw new Error('This rule changed again. Undo is no longer available.');
      }
      const next = {};
      for (const type of fields) {
        const field = type === 'ignored' ? 'ignore' : type;
        const key = type === 'ignored' ? change.app : change.keyword;
        next[field] = without(profile[field], key);
        if (change.before[type]) next[field].push(key);
      }
      profiles.save(change.profileId, next);
      result = { kind: 'rule' };
    }
    changes.delete(token); // Failed disk writes may be retried; successful Undo is one-use.
    return result;
  }
  return { quickSet, correctActivity, undo, clear: () => changes.clear() };
}

module.exports = { createQuickCorrections };
