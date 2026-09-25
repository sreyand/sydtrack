'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeDataset } = require('./generate-activity');
const { createStore, MAX_HISTORY_DAYS } = require('../src/store');

function hr(fn) {
  const start = process.hrtime.bigint();
  const value = fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { ms, value };
}

function parseAllRaw(dataDir) {
  const historyDir = path.join(dataDir, 'history');
  const days = {};
  for (const name of fs.readdirSync(historyDir).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
    days[name.slice(0, 10)] = JSON.parse(fs.readFileSync(path.join(historyDir, name), 'utf8'));
  }
  const statsPath = path.join(dataDir, 'stats.json');
  if (fs.existsSync(statsPath)) days.today = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
  return days;
}

function fileBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    total += stat.isDirectory() ? fileBytes(full) : stat.size;
  }
  return total;
}

function run(days = 110, seed = 20260924) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-bench-'));
  writeDataset(root, { days, seed, includeToday: true });
  const rawCount = fs.readdirSync(path.join(root, 'history')).filter((n) => n.endsWith('.json')).length;
  const beforeBytes = fileBytes(root);

  const beforeFull = hr(() => parseAllRaw(root));
  const beforeWeek = hr(() => {
    const all = parseAllRaw(root);
    return Object.keys(all).sort().slice(-7);
  });

  const opened = hr(() => createStore(root));
  const store = opened.value;
  const reopen = hr(() => createStore(root));
  const afterToday = hr(() => store.snapshot([], { includeWeek: false }));
  const afterWeek = hr(() => store.historySummary(7));
  const afterFull = hr(() => store.historySummary(90));
  const liveBytes = fileBytes(path.join(root, 'history')) + fileBytes(path.join(root, 'rollups'))
    + (fs.existsSync(path.join(root, 'stats.json')) ? fs.statSync(path.join(root, 'stats.json')).size : 0);
  const afterBytes = fileBytes(root);
  const rawAfter = store.listHistoryDates().length;
  const rollups = store.listRollupDates().length;

  const report = {
    generatedDays: rawCount + 1,
    rawRetentionDays: MAX_HISTORY_DAYS,
    before: {
      fullParseMs: Number(beforeFull.ms.toFixed(2)),
      weekFromFullParseMs: Number(beforeWeek.ms.toFixed(2)),
      bytes: beforeBytes,
      rawFiles: rawCount
    },
    after: {
      firstOpenMigrateMs: Number(opened.ms.toFixed(2)),
      reopenMs: Number(reopen.ms.toFixed(2)),
      todaySnapshotMs: Number(afterToday.ms.toFixed(2)),
      weekSummaryMs: Number(afterWeek.ms.toFixed(2)),
      analytics90Ms: Number(afterFull.ms.toFixed(2)),
      liveBytes,
      bytesWithMigrationBackup: afterBytes,
      rawFiles: rawAfter,
      rollupFiles: rollups
    }
  };
  report.speedup = {
    todayVsFullParse: Number((beforeFull.ms / Math.max(afterToday.ms, 0.01)).toFixed(1)),
    weekVsFullParse: Number((beforeWeek.ms / Math.max(afterWeek.ms, 0.01)).toFixed(1)),
    analyticsVsFullParse: Number((beforeFull.ms / Math.max(afterFull.ms, 0.01)).toFixed(1))
  };
  fs.rmSync(root, { recursive: true, force: true });
  return report;
}

if (require.main === module) {
  const days = Number(process.argv[2]) || 110;
  const report = run(days);
  const out = path.join(__dirname, '..', 'docs', 'storage-benchmark.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

module.exports = { run };
