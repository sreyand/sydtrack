'use strict';

const assert = require('assert');
const { createBreakReminder } = require('../src/break-reminder');
const { createTracker } = require('../src/tracker');
const { defaultSettings } = require('../src/store');
const { validateIpcPayload } = require('../src/ipc-validate');

async function run() {
  const reminder = createBreakReminder();
  assert.strictEqual(defaultSettings().breakReminderEnabled, false);
  assert.strictEqual(validateIpcPayload('settings:update', { breakReminderEnabled: true, breakReminderMinutes: 45 }).breakReminderMinutes, 45);
  assert.throws(() => validateIpcPayload('settings:update', { breakReminderMinutes: 5 }));
  assert.strictEqual(reminder.update({ enabled: false, minutes: 10, counted: true, elapsedSec: 600 }), false);
  assert.strictEqual(reminder.update({ enabled: true, minutes: 10, counted: true, elapsedSec: 599 }), false);
  assert.strictEqual(reminder.update({ enabled: true, minutes: 10, counted: true, elapsedSec: 1 }), true);
  assert.strictEqual(reminder.update({ enabled: true, minutes: 10, counted: true, elapsedSec: 600 }), false);
  reminder.update({ enabled: true, minutes: 10, counted: false, elapsedSec: 0 });
  assert.strictEqual(reminder.update({ enabled: true, minutes: 10, counted: true, elapsedSec: 600 }), true);

  const settings = { ...defaultSettings(), pollMs: 5000, breakReminderEnabled: true, breakReminderMinutes: 10 };
  const store = {
    getSettings: () => settings,
    addInterval: () => {},
    resetStreak: () => {},
    shouldRemind: () => false
  };
  let clock = Date.now();
  let idleSec = 0;
  const events = [];
  const tracker = createTracker({
    store,
    rules: { productive: [], unproductive: [], identities: { productiveApps: ['Code'] } },
    ignore: [],
    now: () => clock,
    backend: { getActiveWindow: async () => ({ window: { owner: { name: 'Code' }, title: 'Work' }, idleSec }) },
    onReminder: event => events.push(event)
  });
  const poll = async () => { clock += 5000; await tracker.poll(); };
  for (let i = 0; i < 120; i++) await poll();
  assert.strictEqual(events.length, 1, 'one break reminder after ten minutes of active tracking');
  assert.strictEqual(events[0].kind, 'break');
  for (let i = 0; i < 120; i++) await poll();
  assert.strictEqual(events.length, 1, 'no repeated reminder during the same stretch');
  idleSec = 300;
  await poll();
  idleSec = 0;
  for (let i = 0; i < 120; i++) await poll();
  assert.strictEqual(events.length, 2, 'a real idle break permits a new reminder');
  settings.trackingPaused = true;
  tracker.markPauseBoundary();
  await poll();
  settings.trackingPaused = false;
  tracker.markPauseBoundary();
  for (let i = 0; i < 120; i++) await poll();
  assert.strictEqual(events.length, 3, 'pausing resets continuous use');
  tracker.stop();
  console.log('break reminder checks passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
