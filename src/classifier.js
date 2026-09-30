'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('./json-file');
const { browserNames, isBrowserName, exactKeyword, browserMatch } = require('./browser-rules');

const DEFAULT_RULES_PATH = path.join(__dirname, 'rules.json');
const DEFAULT_IGNORE_PATH = path.join(__dirname, 'ignore.json');
const DEFAULT_APP_IDENTITIES_PATH = path.join(__dirname, 'app-identities.json');

/** Shared app identities, independent of browser engine or address-bar layout. */
const BROWSER_PROCESSES = browserNames;

/**
 * Normalize keyword arrays: trimmed, lowercase, unique, non-empty.
 */
function normalizeKeywords(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (typeof item !== 'string') continue;
    const s = String(item).trim().toLowerCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeRules(parsed) {
  return {
    productive: normalizeKeywords(parsed && parsed.productive),
    unproductive: normalizeKeywords(parsed && parsed.unproductive),
    other: normalizeKeywords(parsed && parsed.other)
  };
}

function normalizeIgnore(parsed) {
  if (Array.isArray(parsed)) return normalizeKeywords(parsed);
  return normalizeKeywords(parsed && parsed.ignore);
}

function normalizeAppIdentities(parsed) {
  return {
    productiveApps: normalizeKeywords(parsed && parsed.productiveApps),
    ignoredApps: normalizeKeywords(parsed && parsed.ignoredApps),
    browserApps: normalizeKeywords(parsed && parsed.browserApps)
  };
}

/**
 * Load and normalize rules from a JSON file path.
 */
function loadRulesFrom(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return normalizeRules(JSON.parse(raw));
}

/**
 * Load rules (defaults to src/rules.json when path omitted).
 */
function loadRules(filePath) {
  return loadRulesFrom(filePath || DEFAULT_RULES_PATH);
}

/**
 * Persist normalized rules to path (creates parent dirs as needed).
 */
function saveRules(filePath, rules) {
  const normalized = normalizeRules(rules || {});
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  return normalized;
}

function loadIgnoreFrom(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return normalizeIgnore(JSON.parse(raw));
}

function loadIgnore(filePath) {
  return loadIgnoreFrom(filePath || DEFAULT_IGNORE_PATH);
}

function loadAppIdentitiesFrom(filePath) {
  return normalizeAppIdentities(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function loadAppIdentities(filePath) {
  return loadAppIdentitiesFrom(filePath || DEFAULT_APP_IDENTITIES_PATH);
}

function saveAppIdentities(filePath, identities) {
  const normalized = normalizeAppIdentities(identities || {});
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJson(filePath, normalized);
  return normalized;
}

function saveIgnore(filePath, ignoreList) {
  const ignore = normalizeKeywords(ignoreList || []);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ ignore }, null, 2) + '\n', 'utf8');
  return ignore;
}

/**
 * Build lowercase haystack from app name + window title + url. The install
 * path is not activity and must not accidentally classify a window.
 * Browsers (Chrome/Edge/Firefox) use available title keywords and remain
 * Other when no rule matches.
 */
function haystack(win) {
  if (!win) return '';
  const owner = appLabel(win);
  const title = win.title || '';
  const url = win.url || '';
  return `${owner} ${title} ${url}`.toLowerCase();
}

function processNameParts(win) {
  const owner = ((win && win.owner && win.owner.name) || '').toLowerCase();
  const procPath = ((win && win.owner && win.owner.path) || '').toLowerCase();
  const base = procPath.split(/[/\\]/).pop() || '';
  const baseNoExt = base.replace(/\.exe$/i, '');
  const label = appLabel(win).toLowerCase();
  return { owner, base, baseNoExt, label };
}

function isBrowserProcess(win, identities) {
  const { owner, base } = processNameParts(win);
  return isBrowserName(owner, identities && identities.browserApps) || isBrowserName(base, identities && identities.browserApps);
}

function matchesProcess(win, identities) {
  const { owner, baseNoExt } = processNameParts(win);
  const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\.exe$/, '');
  const values = [owner, baseNoExt].map(normalize).filter(Boolean);
  return normalizeKeywords(identities).some((identity) => values.includes(normalize(identity)));
}

/** Match process/app fields only, never window titles or URLs. */
function appMatchesIdentity(win, identities) {
  if (!win || !identities) return null;
  const matches = (list) => matchesProcess(win, list);
  if (matches(identities.ignoredApps)) return 'ignored';
  if (matches(identities.productiveApps)) return 'productive';
  return null;
}

/**
 * True if process name / app label matches an ignore keyword (case-insensitive).
 * Also: electron process with sydtrack in the title → ignored (self).
 * Match against owner.name, path basename, and app label — not arbitrary title text
 * (except the sydtrack self-exclusion rule).
 */
function isIgnored(win, ignoreList, identities) {
  if (!win) return false;
  if (appMatchesIdentity(win, identities) === 'ignored') return true;

  const title = (win.title || '').toLowerCase();
  const { owner, base, baseNoExt, label } = processNameParts(win);
  const nameHay = `${owner} ${base} ${baseNoExt} ${label}`;

  // Self: Electron shell running this app
  if (/electron/i.test(nameHay) && /\b(sydtrack|focusflow)\b/i.test(title)) {
    return true;
  }
  // Self: packaged sydtrack, including the previous focusflow process name.
  if (/\b(sydtrack|focusflow)\b/i.test(owner) || /\b(sydtrack|focusflow)\b/i.test(baseNoExt) || /\b(sydtrack|focusflow)\b/i.test(label)) {
    return true;
  }

  if (!ignoreList || !ignoreList.length) return false;
  for (const keyword of ignoreList) {
    if (!keyword) continue;
    const k = String(keyword).toLowerCase();
    if (exactKeyword(owner, k) || exactKeyword(base, k) || exactKeyword(baseNoExt, k) || exactKeyword(label, k)) {
      return true;
    }
  }
  return false;
}

/**
 * Explicit Other wins over broader P/U title matches. Otherwise unproductive
 * wins on overlap (e.g. Chrome title "YouTube"). Profile
 * keywords use whole-term matching. Browsers without a match remain Other.
 */
function classify(win, rules) {
  return classifyWithReason(win, rules).category;
}

function classifyWithReason(win, rules = {}) {
  rules = rules || {};
  if (isBrowserProcess(win, rules.identities)) return browserMatch(win, rules);
  const hay = haystack(win);
  const titleMatch = tags => normalizeKeywords(tags).find(tag => !tag.startsWith('site:') && exactKeyword(hay, tag));
  const neutralTag = titleMatch(rules.other);
  if (neutralTag) return { category: 'other', reason: neutralTag, source: 'profile keyword' };
  const processTag = normalizeKeywords(rules.unproductive).find(tag => matchesProcess(win, [tag]));
  if (processTag) return { category: 'unproductive', reason: processTag, source: 'app identity' };
  if (appMatchesIdentity(win, rules.identities) === 'productive') return { category: 'productive', reason: 'App identity', source: 'app identity' };
  const unproductiveTag = titleMatch(rules.unproductive);
  if (unproductiveTag) return { category: 'unproductive', reason: unproductiveTag, source: 'profile keyword' };
  const productiveProcessTag = normalizeKeywords(rules.productive).find(tag => matchesProcess(win, [tag]));
  if (productiveProcessTag) return { category: 'productive', reason: productiveProcessTag, source: 'app identity' };
  const productiveTag = titleMatch(rules.productive);
  return productiveTag ? { category: 'productive', reason: productiveTag, source: 'profile keyword' }
    : { category: 'other', reason: 'No matching rule', source: 'none' };
}

const APP_NAME_ALIASES = {
  googlechrome: 'chrome',
  microsoftedge: 'msedge',
  mozillafirefox: 'firefox',
  bravebrowser: 'brave',
  operabrowser: 'opera',
  visualstudiocode: 'Code',
  windowsterminal: 'WindowsTerminal'
};

function compactAppName(value) {
  return String(value || '').toLowerCase().replace(/\.exe$/i, '').replace(/[^a-z0-9]+/g, '');
}

function rawAppName(win) {
  const owner = (win && win.owner) || {};
  const base = String(owner.path || '').split(/[/\\]/).pop();
  return String(owner.name || base || '').trim();
}

/** Stable label for process renames and backend display-name differences. */
function canonicalAppName(name) {
  const trimmed = String(name || '').trim().replace(/\.exe$/i, '');
  if (!trimmed) return '';
  return APP_NAME_ALIASES[compactAppName(trimmed)] || trimmed;
}

function appLabel(win) {
  if (!win) return 'Unknown';
  return canonicalAppName(rawAppName(win)) || win.title || 'Unknown';
}

/** Case-insensitive: does app name match any ignore keyword? */
function appMatchesIgnore(appName, ignoreList) {
  if (!appName || !ignoreList || !ignoreList.length) return false;
  const name = String(appName).toLowerCase();
  for (const keyword of ignoreList) {
    if (keyword && exactKeyword(name, String(keyword).toLowerCase())) return true;
  }
  if (/\b(sydtrack|focusflow)\b/i.test(name)) return true;
  return false;
}

module.exports = {
  loadRules,
  loadRulesFrom,
  saveRules,
  loadIgnore,
  loadIgnoreFrom,
  saveIgnore,
  loadAppIdentities,
  loadAppIdentitiesFrom,
  saveAppIdentities,
  normalizeKeywords,
  normalizeRules,
  normalizeIgnore,
  normalizeAppIdentities,
  classify,
  classifyWithReason,
  isIgnored,
  appLabel,
  canonicalAppName,
  haystack,
  appMatchesIgnore,
  isBrowserProcess,
  appMatchesIdentity,
  BROWSER_PROCESSES,
  DEFAULT_RULES_PATH,
  DEFAULT_IGNORE_PATH,
  DEFAULT_APP_IDENTITIES_PATH
};
