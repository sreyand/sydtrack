'use strict';

// Editor UI (edit / import / export) is lane 1 / issue #22.
// This module is the local classification file only. Changing bundled defaults
// must not rewrite stored history.

const fs = require('fs');
const path = require('path');
const { writeJson } = require('./json-file');
const { normalizeKeywords } = require('./classifier');

const FORMAT_ID = 'sydtrack-browser-keywords';
const SCHEMA_VERSION = 1;
const DEFAULTS = require('./default-browser-keywords.json');

function defaultBrowserKeywords() {
  return normalizeBrowserKeywords(DEFAULTS);
}

function normalizeBrowserKeywords(parsed) {
  return {
    productive: normalizeKeywords(parsed && parsed.productive),
    unproductive: normalizeKeywords(parsed && parsed.unproductive)
  };
}

function sameKeywords(left, right) {
  const a = normalizeBrowserKeywords(left);
  const b = normalizeBrowserKeywords(right);
  return a.productive.join('\n') === b.productive.join('\n') && a.unproductive.join('\n') === b.unproductive.join('\n');
}

function loadBrowserKeywords(filePath) {
  if (!fs.existsSync(filePath)) {
    const defaults = defaultBrowserKeywords();
    saveBrowserKeywords(filePath, defaults);
    return defaults;
  }
  try {
    return normalizeBrowserKeywords(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (err) {
    console.warn('[browser-keywords] invalid file; using defaults and leaving it in place:', err.message);
    return defaultBrowserKeywords();
  }
}

function saveBrowserKeywords(filePath, keywords) {
  const normalized = normalizeBrowserKeywords(keywords);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJson(filePath, normalized);
  return normalized;
}

function buildBrowserKeywordPack(keywords) {
  const normalized = normalizeBrowserKeywords(keywords);
  return {
    format: FORMAT_ID,
    schemaVersion: SCHEMA_VERSION,
    productive: normalized.productive,
    unproductive: normalized.unproductive
  };
}

function parseBrowserKeywordPack(objOrString) {
  let obj = objOrString;
  if (typeof objOrString === 'string') {
    try {
      obj = JSON.parse(objOrString);
    } catch (_) {
      throw new Error('Invalid browser keyword file: not valid JSON');
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Invalid browser keyword file: expected an object');
  }
  if (obj.format !== FORMAT_ID) {
    throw new Error(`Invalid browser keyword file: expected format ${FORMAT_ID}`);
  }
  if (Number(obj.schemaVersion) !== SCHEMA_VERSION) {
    throw new Error(`Unsupported browser keyword schemaVersion: ${obj.schemaVersion}`);
  }
  for (const field of ['productive', 'unproductive']) {
    if (!Array.isArray(obj[field]) || obj[field].length > 1000 || obj[field].some((tag) => typeof tag !== 'string' || tag.length > 200)) {
      throw new Error(`Invalid browser keyword file: ${field} must be a list of short strings`);
    }
  }
  return buildBrowserKeywordPack(obj);
}

function writeBrowserKeywordPack(filePath, keywords) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJson(filePath, buildBrowserKeywordPack(keywords));
}

function readBrowserKeywordPack(filePath) {
  return parseBrowserKeywordPack(fs.readFileSync(filePath, 'utf8'));
}

module.exports = {
  FORMAT_ID,
  defaultBrowserKeywords,
  normalizeBrowserKeywords,
  sameKeywords,
  loadBrowserKeywords,
  saveBrowserKeywords,
  buildBrowserKeywordPack,
  parseBrowserKeywordPack,
  writeBrowserKeywordPack,
  readBrowserKeywordPack
};
