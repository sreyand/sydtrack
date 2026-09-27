'use strict';

const assert = require('assert');
const { createProfileShortcut, PROFILE_SHORTCUTS } = require('../src/profile-shortcut');
const { validateIpcPayload } = require('../src/ipc-validate');

const callbacks = new Map();
const globalShortcut = {
  register(key, callback) {
    if (key === 'Alt+B') return false;
    callbacks.set(key, callback);
    return true;
  },
  unregister(key) { callbacks.delete(key); }
};
let cycles = 0;
const shortcut = createProfileShortcut(globalShortcut, () => { cycles++; });
assert.deepStrictEqual(shortcut.set('CommandOrControl+Alt+B'), { ok: true, shortcut: 'CommandOrControl+Alt+B' });
assert.deepStrictEqual(shortcut.set('Alt+B'), { ok: false, shortcut: 'CommandOrControl+Alt+B' });
assert(callbacks.has('CommandOrControl+Alt+B'), 'collision must preserve the working shortcut');
callbacks.get('CommandOrControl+Alt+B')();
assert.strictEqual(cycles, 1);
assert.strictEqual(shortcut.set('CommandOrControl+Shift+B').ok, true);
assert(!callbacks.has('CommandOrControl+Alt+B'), 'switching must unregister the old shortcut');
assert.throws(() => shortcut.set('Control+X'));
assert.strictEqual(shortcut.set('').shortcut, '');
assert.strictEqual(callbacks.size, 0);
shortcut.dispose();
for (const value of PROFILE_SHORTCUTS) assert.strictEqual(validateIpcPayload('settings:update', { profileShortcut: value }).profileShortcut, value);
assert.throws(() => validateIpcPayload('settings:update', { profileShortcut: 'Control+X' }));
assert.strictEqual(validateIpcPayload('profiles:cycle', undefined), undefined);
console.log('Profile shortcut checks passed');
