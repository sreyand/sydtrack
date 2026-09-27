'use strict';

const path = require('path');
const fs = require('fs');
const { randomUUID, createHash } = require('crypto');
const { writeJson, readRecoverableJson } = require('./json-file');
const { validateSiteTags } = require('./browser-rules');

// Fingerprints of the original bundled keyword arrays. Only untouched stock
// profiles are updated; a single user edit makes the fingerprint differ.
const LEGACY_PRESET_HASHES = Object.freeze({
  default: 'c9b03d38b42265d467fe6cc912b89593c3f122e0b477a9dd8a0fea0dcaa7192d',
  coding: '42047fbe98fe6d7573bbd1dec425635a13577ebea537b42a29fdd5aa90658294',
  writing: '77f8643eb0388d9c7170d9961d8208a53c4d9ce2d8fdd09d1d920c657148614c',
  study: 'cbb78d0bab438a7246ee3a5f210de1c799b92ed1fdba63df97f2d644d6162731',
  creative: '493632df48de6ffa3a876005abf48e59b43f9dc688591a73b6aa67d00db08f41'
});

function presetFingerprint(profile) {
  return createHash('sha256').update(JSON.stringify(
    [profile.productive, profile.unproductive, profile.ignore]
  )).digest('hex');
}

function refreshUntouchedPresets(state, defaults, fingerprints = LEGACY_PRESET_HASHES) {
  const next = structuredClone(state);
  let changed = false;
  for (const profile of next.profiles) {
    const bundled = defaults.profiles.find(candidate => candidate.id === profile.id);
    if (!bundled || (profile.other && profile.other.length) || presetFingerprint(profile) !== fingerprints[profile.id]) continue;
    profile.productive = bundled.productive;
    profile.unproductive = bundled.unproductive;
    profile.ignore = bundled.ignore;
    changed = true;
  }
  return { state: next, changed };
}

function validateProfiles(value) {
  const fail = () => { throw new Error('Invalid Focus profiles: expected Default and up to five uniquely named profiles.'); };
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.profiles) || value.profiles.length < 1 || value.profiles.length > 5) fail();
  const ids = new Set(), names = new Set();
  const profiles = value.profiles.map(profile => {
    if (!profile || typeof profile.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(profile.id) || ids.has(profile.id)) fail();
    if (typeof profile.name !== 'string' || !profile.name.trim() || profile.name.trim().length > 40) throw new Error('Profile names must contain 1–40 characters.');
    if (names.has(profile.name.trim().toLowerCase())) throw new Error('A profile with this name already exists. Choose a different name.');
    ids.add(profile.id); names.add(profile.name.trim().toLowerCase());
    const out = { id: profile.id, name: profile.name.trim() };
    for (const field of ['productive', 'unproductive', 'ignore']) {
      if (!Array.isArray(profile[field]) || profile[field].length > 1000 || profile[field].some(tag => typeof tag !== 'string' || tag.length > 200)) fail();
      out[field] = [...new Set(profile[field].map(tag => tag.trim().toLowerCase()).filter(Boolean))];
    }
    if (profile.other != null && (!Array.isArray(profile.other) || profile.other.length > 1000 ||
      profile.other.some(tag => typeof tag !== 'string' || tag.length > 200))) fail();
    out.other = [...new Set((profile.other || []).map(tag => tag.trim().toLowerCase()).filter(Boolean))];
    validateSiteTags(out);
    if (out.ignore.some(tag => tag.startsWith('site:'))) throw new Error('Ignore tags apply to entire apps, not site: domains.');
    return out;
  });
  if (!ids.has('default') || !ids.has(value.activeId)) fail();
  return { schemaVersion: 1, activeId: value.activeId, profiles };
}

function createFocusProfiles({ dataDir, rules, ignore, onChange = () => {}, onRecovery, defaults }) {
  const filePath = path.join(dataDir, 'focus-profiles.json');
  const valid = value => { try { validateProfiles(value); return true; } catch (_) { return false; } };
  let state = readRecoverableJson(filePath, valid, onRecovery);
  if (!state) {
    state = validateProfiles({ schemaVersion: 1, activeId: 'default', profiles: [
      { id: 'default', name: 'Default', productive: rules.productive || [], unproductive: rules.unproductive || [],
        other: rules.other || [], ignore: ignore || [] }
    ] });
    if (defaults && !fs.existsSync(path.join(dataDir, 'rules.json')) && !fs.existsSync(path.join(dataDir, 'ignore.json'))) {
      const bundled = validateProfiles(defaults);
      state.profiles[0] = bundled.profiles.find(profile => profile.id === 'default');
    }
    writeJson(filePath, state); // Leave the legacy files untouched for recovery/downgrades.
  } else state = validateProfiles(state);
  // Install bundled profiles once. Deleted slots stay empty on later launches.
  const seedMarker = path.join(dataDir, 'focus-profiles-seeded-v1.json');
  if (defaults && !fs.existsSync(seedMarker)) {
    const bundled = validateProfiles(defaults);
    const next = structuredClone(state);
    for (const profile of bundled.profiles) {
      if (next.profiles.length >= 5) break;
      if (next.profiles.some(existing => existing.id === profile.id || existing.name.toLowerCase() === profile.name.toLowerCase())) continue;
      next.profiles.push(profile);
    }
    state = validateProfiles(next);
    writeJson(filePath, state);
    writeJson(seedMarker, { version: 1 });
  }
  const precisionMarker = path.join(dataDir, 'focus-profiles-precision-v2.json');
  if (defaults && !fs.existsSync(precisionMarker)) {
    const refreshed = refreshUntouchedPresets(state, validateProfiles(defaults));
    if (refreshed.changed) {
      state = validateProfiles(refreshed.state);
      writeJson(filePath, state);
    }
    writeJson(precisionMarker, { version: 2 });
  }
  const snapshot = () => structuredClone(state);
  const active = () => structuredClone(state.profiles.find(profile => profile.id === state.activeId));
  function commit(next) {
    const normalized = validateProfiles(next);
    writeJson(filePath, normalized);
    state = normalized;
    onChange(active());
    return snapshot();
  }
  return {
    filePath, snapshot, active,
    save: (id, fields) => {
      const next = snapshot();
      if (id == null) {
        next.profiles.push({ ...fields, id: randomUUID() });
      } else {
        const index = next.profiles.findIndex(profile => profile.id === id);
        if (index < 0) throw new Error('Focus profile not found.');
        next.profiles[index] = { ...next.profiles[index], ...fields, id };
      }
      return commit(next);
    },
    activate: id => {
      if (id === state.activeId) return snapshot();
      return commit({ ...snapshot(), activeId: id });
    },
    resetBundled(defaults) {
      const bundled = validateProfiles(defaults);
      writeJson(seedMarker, { version: 1 });
      return commit(bundled);
    },
    remove: id => {
      if (id === 'default') throw new Error('Default cannot be deleted.');
      if (!state.profiles.some(profile => profile.id === id)) throw new Error('Focus profile not found.');
      return commit({ ...snapshot(), activeId: state.activeId === id ? 'default' : state.activeId,
        profiles: state.profiles.filter(profile => profile.id !== id) });
    },
    restore: commit
  };
}

module.exports = { createFocusProfiles, validateProfiles, presetFingerprint, refreshUntouchedPresets };
