'use strict';

const { validDateKey } = require('./json-file');
const { emptyDay, migrateDay, appEntryName, appCategoryKey } = require('./store');

const CSV_HEADER = [
  'record', 'date', 'name', 'category', 'seconds',
  'id', 'status', 'mode', 'started_at', 'ended_at',
  'planned_sec', 'elapsed_sec', 'distractions', 'field', 'tag', 'active', 'value'
];

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  return rows;
}

function rowsToCsv(rows) {
  return [CSV_HEADER, ...rows].map((row) => CSV_HEADER.map((_, index) => csvEscape(index < row.length ? row[index] : '')).join(',')).join('\n') + '\n';
}

function activityRows(days) {
  const rows = [];
  for (const date of Object.keys(days).sort()) {
    const day = days[date];
    const summed = new Map();
    for (const [key, info] of Object.entries((day && day.byApp) || {})) {
      if (!info || info.category === 'ignored') continue;
      const category = info.category === 'productive' || info.category === 'unproductive' ? info.category : 'other';
      const seconds = Number(info.seconds) || 0;
      if (seconds <= 0) continue;
      const name = appEntryName(key);
      const id = name + '\u0000' + category;
      summed.set(id, (summed.get(id) || 0) + seconds);
    }
    for (const [id, seconds] of summed) {
      const split = id.indexOf('\u0000');
      rows.push(['activity', date, id.slice(0, split), id.slice(split + 1), seconds]);
    }
  }
  return rows;
}

function sessionRows(sessions) {
  const rows = [];
  for (const date of Object.keys(sessions || {}).sort()) {
    for (const entry of sessions[date] || []) {
      rows.push([
        'session', date, '', '', '',
        entry.id, entry.status, entry.mode, entry.startedAt, entry.endedAt,
        entry.plannedSec, entry.elapsedSec, entry.distractionCount
      ]);
    }
  }
  return rows;
}

function settingRows(settings) {
  return Object.entries(settings || {})
    .filter(([key, value]) => value != null && !['__proto__', 'constructor', 'prototype'].includes(key))
    .map(([key, value]) => ['setting', '', key, '', '', '', '', '', '', '', '', '', '', '', '', '', typeof value === 'object' ? JSON.stringify(value) : value]);
}

function tagRows(rules, ignore) {
  const rows = [];
  for (const tag of (rules && rules.productive) || []) rows.push(['rule', '', '', 'productive', '', '', '', '', '', '', '', '', '', 'productive', tag]);
  for (const tag of (rules && rules.unproductive) || []) rows.push(['rule', '', '', 'unproductive', '', '', '', '', '', '', '', '', '', 'unproductive', tag]);
  const list = Array.isArray(ignore) ? ignore : (ignore && ignore.ignore) || [];
  for (const tag of list) rows.push(['ignore', '', tag]);
  return rows;
}

function profileRows(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.profiles)) return [];
  const rows = [];
  for (const profile of snapshot.profiles) {
    for (const field of ['productive', 'unproductive', 'ignore']) {
      const tags = profile[field] || [];
      if (!tags.length) {
        rows.push(['profile', '', profile.name, '', '', profile.id, '', '', '', '', '', '', '', field, '', profile.id === snapshot.activeId ? '1' : '0']);
        continue;
      }
      for (const tag of tags) {
        rows.push(['profile', '', profile.name, '', '', profile.id, '', '', '', '', '', '', '', field, tag, profile.id === snapshot.activeId ? '1' : '0']);
      }
    }
  }
  return rows;
}

function buildCsvExport(store, opts) {
  const options = opts || {};
  const rows = [
    ...activityRows(store.allDaysMap()),
    ...sessionRows(options.sessionManager ? options.sessionManager.exportHistory() : {}),
    ...settingRows(options.includeSettings === false ? {} : store.getSettings()),
    ...tagRows(options.rules, options.ignore),
    ...profileRows(options.focusProfiles ? options.focusProfiles.snapshot() : null)
  ];
  return rowsToCsv(rows);
}

function columnMap(header) {
  const map = Object.create(null);
  header.forEach((name, index) => { map[String(name || '').trim()] = index; });
  return map;
}

function cell(row, columns, name) {
  const index = columns[name];
  return index == null ? '' : (row[index] || '');
}

function parseNumber(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function importCsv(store, text, opts) {
  const options = opts || {};
  const result = { ok: false, daysImported: 0, sessionsImported: 0, error: null };
  let table;
  try { table = parseCsv(text); } catch (err) {
    result.error = err.message;
    return result;
  }
  if (!table.length || table[0][0] !== 'record') {
    result.error = 'Invalid CSV: missing record header';
    return result;
  }
  const columns = columnMap(table[0]);
  const days = new Map();
  const sessions = {};
  const settings = {};
  const rules = { productive: [], unproductive: [] };
  const ignore = [];
  const profiles = new Map();
  let activeId = null;

  for (const row of table.slice(1)) {
    const record = cell(row, columns, 'record');
    if (record === 'activity') {
      const date = cell(row, columns, 'date');
      const name = cell(row, columns, 'name');
      const category = cell(row, columns, 'category');
      const seconds = parseNumber(cell(row, columns, 'seconds'));
      if (!validDateKey(date) || !name || !['productive', 'unproductive', 'other'].includes(category) || seconds == null || seconds < 0) {
        result.error = 'Invalid CSV activity row';
        return result;
      }
      if (!days.has(date)) days.set(date, emptyDay(date));
      const day = days.get(date);
      const key = appCategoryKey(name, category);
      if (!day.byApp[key]) day.byApp[key] = { seconds: 0, category };
      day.byApp[key].seconds += seconds;
      day.byCategory[category] += seconds;
    } else if (record === 'session') {
      const date = cell(row, columns, 'date');
      const id = cell(row, columns, 'id');
      const status = cell(row, columns, 'status');
      const startedAt = parseNumber(cell(row, columns, 'started_at'));
      const endedAt = parseNumber(cell(row, columns, 'ended_at'));
      if (!validDateKey(date) || !id || !['completed', 'stopped'].includes(status) || startedAt == null || endedAt == null || endedAt < startedAt) {
        result.error = 'Invalid CSV session row';
        return result;
      }
      if (!sessions[date]) sessions[date] = [];
      sessions[date].push({
        id,
        date,
        status,
        mode: cell(row, columns, 'mode') || 'custom',
        modeLabel: cell(row, columns, 'mode') || 'Custom',
        startedAt,
        endedAt,
        plannedSec: parseNumber(cell(row, columns, 'planned_sec')) || 0,
        elapsedSec: parseNumber(cell(row, columns, 'elapsed_sec')) || 0,
        distractionCount: parseNumber(cell(row, columns, 'distractions')) || 0,
        topApps: []
      });
    } else if (record === 'setting') {
      const key = cell(row, columns, 'name');
      if (!key || ['__proto__', 'constructor', 'prototype'].includes(key)) {
        result.error = 'Invalid CSV setting';
        return result;
      }
      const raw = cell(row, columns, 'value');
      if (raw === 'true' || raw === 'false') settings[key] = raw === 'true';
      else if (raw !== '' && Number.isFinite(Number(raw)) && String(Number(raw)) === raw.trim()) settings[key] = Number(raw);
      else settings[key] = raw;
    } else if (record === 'rule') {
      const field = cell(row, columns, 'field');
      const tag = cell(row, columns, 'tag');
      if (!['productive', 'unproductive'].includes(field) || !tag) {
        result.error = 'Invalid CSV rule';
        return result;
      }
      rules[field].push(tag);
    } else if (record === 'ignore') {
      const tag = cell(row, columns, 'name');
      if (!tag) {
        result.error = 'Invalid CSV ignore row';
        return result;
      }
      ignore.push(tag);
    } else if (record === 'profile') {
      const id = cell(row, columns, 'id');
      const name = cell(row, columns, 'name');
      const field = cell(row, columns, 'field');
      const tag = cell(row, columns, 'tag');
      if (!id || !name || !['productive', 'unproductive', 'ignore'].includes(field)) {
        result.error = 'Invalid CSV profile row';
        return result;
      }
      if (!profiles.has(id)) profiles.set(id, { id, name, productive: [], unproductive: [], ignore: [] });
      if (tag) profiles.get(id)[field].push(tag);
      if (cell(row, columns, 'active') === '1') activeId = id;
    } else if (record) {
      result.error = 'Invalid CSV record type ' + record;
      return result;
    }
  }

  let profileSnapshot = null;
  if (profiles.size) {
    try {
      const { validateProfiles } = require('./focus-profiles');
      const active = activeId && profiles.has(activeId)
        ? activeId
        : (profiles.has('default') ? 'default' : profiles.keys().next().value);
      profileSnapshot = validateProfiles({
        schemaVersion: 1,
        activeId: active,
        profiles: Array.from(profiles.values())
      });
    } catch (err) {
      result.error = err.message || 'Invalid CSV profiles';
      return result;
    }
  }
  try {
    result.backupPath = require('./data-ownership').backupUserConfig(store.dataDir);
  } catch (err) {
    result.error = 'Could not back up settings before import: ' + err.message;
    return result;
  }

  for (const [date, day] of days) {
    const migrated = migrateDay(day);
    if (date === require('./store').todayKey()) {
      const current = store.getState();
      store.replaceToday(require('./backup').mergeDays(current, migrated));
    } else {
      const existing = store.loadHistoryDay(date);
      store.writeHistoryDay(existing ? require('./backup').mergeDays(existing, migrated) : migrated);
    }
    result.daysImported += 1;
  }
  if (options.sessionManager && Object.keys(sessions).length) {
    result.sessionsImported = options.sessionManager.importHistory(sessions, 'merge') || 0;
  }
  if (Object.keys(settings).length && options.applySettings !== false) {
    if (options.onSettings) options.onSettings(settings);
    else store.updateSettings(settings);
  }
  if ((rules.productive.length || rules.unproductive.length) && options.onRules) options.onRules(rules);
  if (ignore.length && options.onIgnore) options.onIgnore(ignore);
  if (profileSnapshot && options.focusProfiles) options.focusProfiles.restore(profileSnapshot);
  store.pruneOldHistory();
  result.ok = true;
  return result;
}

module.exports = {
  CSV_HEADER,
  buildCsvExport,
  importCsv,
  parseCsv
};
