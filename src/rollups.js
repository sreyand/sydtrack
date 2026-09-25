'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson, validDateKey } = require('./json-file');

const ROLLUP_SCHEMA_VERSION = 1;

function rollupPath(rollupDir, dateKey) {
  return path.join(rollupDir, `${dateKey}.json`);
}

function categoryTotals(source) {
  const totals = source && source.byCategory ? source.byCategory : source || {};
  return {
    productive: finiteSeconds(totals.productive),
    unproductive: finiteSeconds(totals.unproductive),
    other: finiteSeconds(totals.other)
  };
}

function finiteSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function hourTotals(hour) {
  const source = hour && typeof hour === 'object' ? hour : {};
  return {
    productive: finiteSeconds(source.productive),
    unproductive: finiteSeconds(source.unproductive),
    other: finiteSeconds(source.other)
  };
}

/**
 * Compact daily summary. Hourly app maps stay in the raw file; the rollup
 * keeps category totals, per-hour category totals, and per-app totals.
 */
function buildRollup(day, appEntryName) {
  if (!day || !validDateKey(day.date)) throw new Error('Invalid rollup date');
  const nameOf = appEntryName || ((key) => String(key));
  const apps = new Map();
  for (const [key, info] of Object.entries(day.byApp || {})) {
    if (!info || typeof info !== 'object') continue;
    const category = info.category === 'productive' || info.category === 'unproductive'
      ? info.category
      : info.category === 'ignored' ? 'ignored' : 'other';
    if (category === 'ignored') continue;
    const seconds = finiteSeconds(info.seconds);
    if (seconds <= 0) continue;
    const name = nameOf(key);
    const id = name + '\u0000' + category;
    const current = apps.get(id);
    if (current) current.seconds += seconds;
    else apps.set(id, { name, category, seconds });
  }
  const byHour = Array.from({ length: 24 }, (_, index) => hourTotals(day.byHour && day.byHour[index]));
  return {
    schemaVersion: ROLLUP_SCHEMA_VERSION,
    date: day.date,
    byCategory: categoryTotals(day),
    byHour,
    apps: Array.from(apps.values()).sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))
  };
}

function totalsMatch(day, rollup) {
  if (!day || !rollup || day.date !== rollup.date) return false;
  const left = categoryTotals(day);
  const right = categoryTotals(rollup);
  return ['productive', 'unproductive', 'other'].every((category) => Math.abs(left[category] - right[category]) < 1e-6);
}

function isRollup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!validDateKey(value.date)) return false;
  if (value.schemaVersion != null && Number(value.schemaVersion) !== ROLLUP_SCHEMA_VERSION) return false;
  if (!value.byCategory || typeof value.byCategory !== 'object') return false;
  if (!Array.isArray(value.apps)) return false;
  return true;
}

function writeRollup(rollupDir, rollup) {
  if (!isRollup(rollup)) throw new Error('Refusing to write an invalid rollup');
  fs.mkdirSync(rollupDir, { recursive: true });
  writeJson(rollupPath(rollupDir, rollup.date), rollup);
}

function readRollup(rollupDir, dateKey) {
  if (!validDateKey(dateKey)) return null;
  const filePath = rollupPath(rollupDir, dateKey);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    const value = JSON.parse(raw);
    if (!isRollup(value) || value.date !== dateKey) return null;
    value.byCategory = categoryTotals(value);
    value.byHour = Array.from({ length: 24 }, (_, index) => hourTotals(value.byHour && value.byHour[index]));
    value.apps = value.apps.filter((app) => app && typeof app.name === 'string' && finiteSeconds(app.seconds) > 0);
    return value;
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

function listRollupDates(rollupDir) {
  try {
    if (!fs.existsSync(rollupDir)) return [];
    return fs.readdirSync(rollupDir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .map((name) => name.replace(/\.json$/, ''))
      .filter((date) => validDateKey(date))
      .sort();
  } catch (_) {
    return [];
  }
}

function appKey(name, category) {
  if (category === 'productive' || category === 'unproductive') return String(name) + '::' + category;
  return String(name);
}

/** Reconstruct a day object analytics can read after the raw file is gone. */
function dayFromRollup(rollup) {
  const byApp = Object.create(null);
  for (const app of rollup.apps || []) {
    const category = app.category === 'productive' || app.category === 'unproductive' ? app.category : 'other';
    const key = appKey(app.name, category);
    if (!byApp[key]) byApp[key] = { seconds: 0, category };
    byApp[key].seconds += finiteSeconds(app.seconds);
  }
  return {
    date: rollup.date,
    byApp,
    byCategory: categoryTotals(rollup),
    byHour: Array.from({ length: 24 }, (_, index) => {
      const hour = hourTotals(rollup.byHour && rollup.byHour[index]);
      hour.byApp = Object.create(null);
      return hour;
    }),
    unproductiveStreak: 0,
    lastReminderAt: 0,
    activityCorrections: {},
    appCorrections: {}
  };
}

function removeRollups(rollupDir) {
  if (!fs.existsSync(rollupDir)) return;
  for (const name of fs.readdirSync(rollupDir)) {
    if (/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) fs.unlinkSync(path.join(rollupDir, name));
  }
}

module.exports = {
  ROLLUP_SCHEMA_VERSION,
  buildRollup,
  writeRollup,
  readRollup,
  listRollupDates,
  dayFromRollup,
  totalsMatch,
  removeRollups,
  categoryTotals
};
