'use strict';

const fs = require('fs');
const path = require('path');
const { emptyDay, emptyByHour, todayKey, activityKey } = require('../src/store');

const APPS = [
  { name: 'Code', category: 'productive', reason: 'App identity', hours: [9, 10, 11, 14, 15] },
  { name: 'Cursor', category: 'productive', reason: 'App identity', hours: [10, 11, 16] },
  { name: 'Chrome', category: 'productive', reason: 'github', title: 'cursor/sydtrack: Pull Request — GitHub', hours: [11, 16] },
  { name: 'Chrome', category: 'unproductive', reason: 'youtube', title: 'Lo-fi beats — YouTube', hours: [12, 20] },
  { name: 'Chrome', category: 'unproductive', reason: 'reddit', title: 'programming — Reddit', hours: [13] },
  { name: 'Slack', category: 'other', reason: 'No matching keyword', hours: [9, 15] },
  { name: 'WindowsTerminal', category: 'productive', reason: 'terminal', hours: [14] },
  { name: 'Notion', category: 'productive', reason: 'notes', hours: [15] },
  { name: 'Spotify', category: 'other', reason: 'No matching keyword', hours: [9, 21] },
  { name: 'Discord', category: 'unproductive', reason: 'discord', hours: [21] }
];

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function addEntry(day, app, hour, seconds, rand) {
  if (seconds <= 0) return;
  const activity = { category: app.category, reason: app.reason };
  const key = activityKey(app.name, app.category, activity);
  if (!day.byApp[key]) day.byApp[key] = { seconds: 0, category: app.category };
  day.byApp[key].seconds += seconds;
  day.byCategory[app.category] += seconds;
  if (!day.byHour[hour]) day.byHour[hour] = { productive: 0, unproductive: 0, other: 0, byApp: Object.create(null) };
  day.byHour[hour][app.category] += seconds;
  if (!day.byHour[hour].byApp[key]) day.byHour[hour].byApp[key] = { seconds: 0, category: app.category };
  day.byHour[hour].byApp[key].seconds += seconds;
}

function buildDay(dateKey, rand) {
  const day = emptyDay(dateKey);
  day.byHour = emptyByHour();
  const date = new Date(`${dateKey}T12:00:00`);
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const idleDay = rand() < 0.08;
  if (idleDay) return day;
  const scale = weekend ? 0.35 + rand() * 0.25 : 0.75 + rand() * 0.45;
  for (const app of APPS) {
    const weekendSkip = weekend && app.category === 'productive' && rand() < 0.45;
    if (weekendSkip) continue;
    const weekdaySkip = !weekend && app.category === 'unproductive' && rand() < 0.2;
    if (weekdaySkip) continue;
    for (const hour of app.hours) {
      if (rand() < 0.18) continue;
      const seconds = Math.round((8 + rand() * 42) * 60 * scale * (weekend && app.category !== 'productive' ? 1.4 : 1));
      addEntry(day, app, hour, seconds, rand);
    }
  }
  return day;
}

function dateKeys(days, end = new Date()) {
  const keys = [];
  for (let i = days; i >= 1; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    keys.push(todayKey(d.getTime()));
  }
  return keys;
}

function writeDataset(dataDir, { days = 110, seed = 20260924, includeToday = true } = {}) {
  fs.mkdirSync(path.join(dataDir, 'history'), { recursive: true });
  const rand = mulberry32(seed);
  const keys = dateKeys(days);
  const written = [];
  for (const key of keys) {
    const day = buildDay(key, rand);
    fs.writeFileSync(path.join(dataDir, 'history', `${key}.json`), JSON.stringify(day));
    written.push(key);
  }
  if (includeToday) {
    const today = buildDay(todayKey(), rand);
    fs.writeFileSync(path.join(dataDir, 'stats.json'), JSON.stringify(today, null, 2) + '\n');
  }
  return { days: written.length + (includeToday ? 1 : 0), keys: written, dataDir };
}

function parseArgs(argv) {
  const opts = { days: 110, seed: 20260924, dir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') opts.days = Number(argv[++i]);
    else if (argv[i] === '--seed') opts.seed = Number(argv[++i]);
    else if (argv[i] === '--dir') opts.dir = argv[++i];
  }
  return opts;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const dir = opts.dir || path.join(require('os').tmpdir(), 'sydtrack-fake-activity');
  const result = writeDataset(dir, opts);
  console.log(JSON.stringify({ ok: true, ...result, dir }, null, 2));
}

module.exports = { writeDataset, buildDay, dateKeys, mulberry32, APPS };
