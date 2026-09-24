'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson, validDateKey, readRecoverableJson } = require('./json-file');
const { writeRollup, readRollup, totalsMatch } = require('./rollups');

const JOURNAL_NAME = 'retention-journal.json';

function journalPath(dataDir) {
  return path.join(dataDir, JOURNAL_NAME);
}

function readJournal(dataDir) {
  const value = readRecoverableJson(journalPath(dataDir), (journal) => {
    return journal && typeof journal === 'object' && !Array.isArray(journal)
      && Array.isArray(journal.pending)
      && journal.pending.every((date) => validDateKey(date));
  }, () => {});
  return value && Array.isArray(value.pending) ? value.pending.slice() : [];
}

function writeJournal(dataDir, pending) {
  writeJson(journalPath(dataDir), { pending: pending.slice() });
}

function rawPath(historyDir, dateKey) {
  return path.join(historyDir, `${dateKey}.json`);
}

/**
 * Delete one raw day only after its rollup is on disk and reads back with the
 * same category totals. The journal is renamed into place before the unlink,
 * so a crash either keeps the raw file or finishes the delete on the next launch.
 */
function purgeOne(dateKey, { dataDir, historyDir, rollupDir, readRawDay, buildRollup }) {
  const filePath = rawPath(historyDir, dateKey);
  const day = readRawDay(dateKey);
  if (!day) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return 'dropped';
  }
  const rollup = buildRollup(day);
  if (!totalsMatch(day, rollup)) throw new Error('Rollup totals did not match ' + dateKey);
  writeRollup(rollupDir, rollup);
  const stored = readRollup(rollupDir, dateKey);
  if (!stored || !totalsMatch(day, stored)) throw new Error('Rollup verify failed for ' + dateKey);
  const pending = readJournal(dataDir);
  if (!pending.includes(dateKey)) pending.push(dateKey);
  writeJournal(dataDir, pending);
  fs.unlinkSync(filePath);
  writeJournal(dataDir, readJournal(dataDir).filter((date) => date !== dateKey));
  return 'purged';
}

function replayJournal({ dataDir, historyDir, rollupDir, readRawDay, buildRollup }) {
  const pending = readJournal(dataDir);
  if (!pending.length) return;
  const stillPending = [];
  for (const dateKey of pending) {
    try {
      const stored = readRollup(rollupDir, dateKey);
      const filePath = rawPath(historyDir, dateKey);
      if (!fs.existsSync(filePath)) continue;
      const day = readRawDay(dateKey);
      if (stored && day && totalsMatch(day, stored)) {
        fs.unlinkSync(filePath);
        continue;
      }
      purgeOne(dateKey, { dataDir, historyDir, rollupDir, readRawDay, buildRollup });
    } catch (err) {
      stillPending.push(dateKey);
      console.error('[retention] interrupted purge will retry', dateKey, err.message);
    }
  }
  writeJournal(dataDir, stillPending.filter((date, index, all) => all.indexOf(date) === index));
}

function listRawDates(historyDir) {
  try {
    if (!fs.existsSync(historyDir)) return [];
    return fs.readdirSync(historyDir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .map((name) => name.replace(/\.json$/, ''))
      .filter((date) => validDateKey(date))
      .sort();
  } catch (_) {
    return [];
  }
}

/**
 * Remove raw history strictly older than cutoffKey. A day that cannot be
 * rolled up is left in place; the cap never deletes bytes it could not preserve.
 */
function purgeExpiredRaw({ dataDir, historyDir, rollupDir, cutoffKey, readRawDay, buildRollup }) {
  fs.mkdirSync(rollupDir, { recursive: true });
  replayJournal({ dataDir, historyDir, rollupDir, readRawDay, buildRollup });
  const result = { purged: [], kept: [], errors: [] };
  for (const dateKey of listRawDates(historyDir)) {
    if (dateKey >= cutoffKey) {
      result.kept.push(dateKey);
      continue;
    }
    try {
      purgeOne(dateKey, { dataDir, historyDir, rollupDir, readRawDay, buildRollup });
      result.purged.push(dateKey);
    } catch (err) {
      result.errors.push({ date: dateKey, message: err.message });
      console.error('[retention] kept raw day after failed purge', dateKey, err.message);
    }
  }
  return result;
}

function clearJournal(dataDir) {
  const filePath = journalPath(dataDir);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = {
  JOURNAL_NAME,
  purgeExpiredRaw,
  replayJournal,
  readJournal,
  writeJournal,
  clearJournal,
  listRawDates
};
