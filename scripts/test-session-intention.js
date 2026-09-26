'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, todayKey } = require('../src/store');
const { createSessionManager } = require('../src/sessions');
const { buildExport, importBackup } = require('../src/backup');
const { validateIpcPayload } = require('../src/ipc-validate');

const roots = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-intention-')); roots.push(root); return root; };
try {
  const root = temp();
  const store = createStore(root);
  let sessions = createSessionManager({ dataDir: root, getSettings: () => store.getSettings() });
  assert.deepStrictEqual(validateIpcPayload('session:start', { mode: 'pomodoro', intention: '  Write chapter 2  ' }),
    { mode: 'pomodoro', intention: 'Write chapter 2' });
  assert.throws(() => validateIpcPayload('session:start', { intention: 'x'.repeat(81) }));
  assert.throws(() => validateIpcPayload('session:start', { intention: 'one\ntwo' }));
  assert.throws(() => sessions.startSession({ intention: 'one\ntwo' }), /Invalid session intention/);
  const active = sessions.startSession({ mode: 'pomodoro', intention: '  Write chapter 2  ' });
  assert.strictEqual(active.intention, 'Write chapter 2');
  sessions = createSessionManager({ dataDir: root, getSettings: () => store.getSettings() });
  assert.strictEqual(sessions.getActiveSession().intention, 'Write chapter 2', 'intention survives restart');
  sessions.stopSession();
  assert.strictEqual(sessions.getSessionsForDay(todayKey())[0].intention, 'Write chapter 2', 'completed log retains intention');
  const backup = buildExport(store, { sessionManager: sessions });
  assert.strictEqual(backup.sessions[todayKey()][0].intention, 'Write chapter 2');
  const restoredRoot = temp();
  const restoredStore = createStore(restoredRoot);
  const restoredSessions = createSessionManager({ dataDir: restoredRoot, getSettings: () => restoredStore.getSettings() });
  assert(importBackup(restoredStore, backup, { mode: 'replace', sessionManager: restoredSessions }).ok);
  assert.strictEqual(restoredSessions.getSessionsForDay(todayKey())[0].intention, 'Write chapter 2', 'backup restores intention');
  const invalid = structuredClone(backup);
  invalid.sessions[todayKey()][0].intention = 'x'.repeat(81);
  assert.strictEqual(importBackup(restoredStore, invalid, { mode: 'replace', sessionManager: restoredSessions }).ok, false);
  assert.strictEqual(restoredSessions.getSessionsForDay(todayKey())[0].intention, 'Write chapter 2', 'bad backup preserves existing log');
  const unlabeled = sessions.startSession({ mode: 'deep' });
  assert.strictEqual(unlabeled.intention, '', 'intention remains optional');
  const legacyActivePath = path.join(root, 'active-session.json');
  const legacyActive = JSON.parse(fs.readFileSync(legacyActivePath, 'utf8'));
  delete legacyActive.intention;
  fs.writeFileSync(legacyActivePath, JSON.stringify(legacyActive));
  const migratedSessions = createSessionManager({ dataDir: root, getSettings: () => store.getSettings() });
  assert.strictEqual(migratedSessions.getActiveSession().intention, '', 'older active sessions restore without an intention');
  migratedSessions.stopSession();
  const legacyBackup = structuredClone(backup);
  delete legacyBackup.sessions[todayKey()][0].intention;
  const oldRoot = temp();
  const oldStore = createStore(oldRoot);
  const oldSessions = createSessionManager({ dataDir: oldRoot, getSettings: () => oldStore.getSettings() });
  assert(importBackup(oldStore, legacyBackup, { mode: 'replace', sessionManager: oldSessions }).ok,
    'older backups without intentions remain importable');
  console.log('session intention checks passed');
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
