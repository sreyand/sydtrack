'use strict';

const assert = require('assert').strict;
const { WINDOW_SHORTCUTS, createWindowShortcut, toggleWindowVisibility } = require('../src/window-shortcut');

assert.deepEqual(WINDOW_SHORTCUTS, ['', 'CommandOrControl+Alt+S', 'CommandOrControl+Shift+S', 'Alt+S']);
assert(Object.isFrozen(WINDOW_SHORTCUTS), 'Supported shortcuts cannot be changed by callers');

const callbacks = new Map();
const calls = [];
let rejectKey = '', throwKey = '', toggles = 0;
const globalShortcut = {
  register(key, callback) {
    calls.push(['register', key]);
    if (key === throwKey) throw new Error('Synthetic registration failure');
    if (key === rejectKey || callbacks.has(key)) return false;
    callbacks.set(key, callback);
    return true;
  },
  unregister(key) {
    calls.push(['unregister', key]);
    callbacks.delete(key);
  }
};
const onToggle = () => { toggles++; };
const shortcut = createWindowShortcut(globalShortcut, onToggle);
assert.equal(shortcut.active(), '', 'Shortcut defaults to Off');
assert.deepEqual(shortcut.set(''), { ok: true, shortcut: '' });
shortcut.dispose();
assert.equal(calls.length, 0, 'Off and disposal do not touch OS bindings when nothing is registered');

assert.deepEqual(shortcut.set('CommandOrControl+Alt+S'), { ok: true, shortcut: 'CommandOrControl+Alt+S' });
assert.equal(callbacks.get(shortcut.active()), onToggle, 'Registered callback is the supplied toggle action');
callbacks.get(shortcut.active())();
assert.equal(toggles, 1);
const sameCalls = calls.length;
assert.deepEqual(shortcut.set('CommandOrControl+Alt+S'), { ok: true, shortcut: 'CommandOrControl+Alt+S' });
assert.equal(calls.length, sameCalls, 'Reusing the active shortcut does not re-register or unregister it');

rejectKey = 'Alt+S';
assert.deepEqual(shortcut.set(rejectKey), { ok: false, shortcut: 'CommandOrControl+Alt+S' });
assert.equal(shortcut.active(), 'CommandOrControl+Alt+S');
assert(callbacks.has(shortcut.active()), 'A collision preserves the working shortcut');
callbacks.get(shortcut.active())();
assert.equal(toggles, 2, 'The old callback stays functional after a collision');
throwKey = 'CommandOrControl+Shift+S';
assert.deepEqual(shortcut.set(throwKey), { ok: false, shortcut: 'CommandOrControl+Alt+S' });
assert(callbacks.has(shortcut.active()), 'A thrown registration preserves the working shortcut');
assert.equal(callbacks.size, 1);
for (const invalid of ['Control+X', 'CommandOrControl+Alt+B', undefined, null, 0]) {
  const before = calls.length;
  assert.throws(() => shortcut.set(invalid), /Unsupported window shortcut/);
  assert.equal(shortcut.active(), 'CommandOrControl+Alt+S');
  assert.equal(calls.length, before, 'Unsupported values are rejected before registration');
}

throwKey = '';
const switchStart = calls.length;
assert.deepEqual(shortcut.set('CommandOrControl+Shift+S'), { ok: true, shortcut: 'CommandOrControl+Shift+S' });
assert.deepEqual(calls.slice(switchStart), [
  ['register', 'CommandOrControl+Shift+S'], ['unregister', 'CommandOrControl+Alt+S']
], 'New binding is secured before the old one is released');
assert(!callbacks.has('CommandOrControl+Alt+S'));
assert.equal(shortcut.set('CommandOrControl+Alt+S').ok, true, 'Caller can restore the prior binding after a settings-save failure');
assert(callbacks.has('CommandOrControl+Alt+S') && !callbacks.has('CommandOrControl+Shift+S'),
  'Rolling back restores the prior callback and removes the replacement');
assert.equal(shortcut.set('CommandOrControl+Shift+S').ok, true);
assert.deepEqual(shortcut.set(''), { ok: true, shortcut: '' });
assert.equal(callbacks.size, 0, 'Off releases the registered binding');

rejectKey = '';
assert.equal(shortcut.set('Alt+S').ok, true, 'Every supported enabled shortcut can register');
shortcut.dispose();
const disposedCalls = calls.length;
shortcut.dispose();
assert.equal(calls.length, disposedCalls, 'Repeated disposal is idempotent');
assert.equal(shortcut.active(), '');
assert.equal(callbacks.size, 0, 'Disposal removes the binding');
assert.equal(shortcut.set('CommandOrControl+Alt+S').ok, true, 'Manager can be reused after disposal');
callbacks.get(shortcut.active())();
assert.equal(toggles, 3);
callbacks.set('Unrelated binding', () => {});
shortcut.dispose();
assert.deepEqual([...callbacks.keys()], ['Unrelated binding'], 'Disposal does not unregister another feature\'s shortcut');
callbacks.delete('Unrelated binding');

function mockWindow({ visible = false, minimized = false, focused = false, destroyed = false } = {}) {
  const actions = [];
  return {
    actions,
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    isMinimized: () => minimized,
    isFocused: () => focused,
    restore: () => { actions.push('restore'); },
    show: () => { actions.push('show'); },
    focus: () => { actions.push('focus'); },
    hide: () => { actions.push('hide'); }
  };
}
for (const visible of [false, true]) {
  for (const minimized of [false, true]) {
    for (const focused of [false, true]) {
      const window = mockWindow({ visible, minimized, focused });
      assert.equal(toggleWindowVisibility(window), true);
      const expected = visible && !minimized && focused ? ['hide'] :
        [...(minimized ? ['restore'] : []), 'show', 'focus'];
      assert.deepEqual(window.actions, expected, 'Correct action for ' + JSON.stringify({ visible, minimized, focused }));
    }
  }
}
const destroyedWindow = mockWindow({ visible: true, focused: true, destroyed: true });
assert.equal(toggleWindowVisibility(destroyedWindow), false);
assert.deepEqual(destroyedWindow.actions, [], 'Destroyed windows are left alone');
for (const invalid of [undefined, null, {}, { isDestroyed: () => false }]) {
  assert.equal(toggleWindowVisibility(invalid), false, 'Invalid or missing windows are no-ops');
}
assert.equal(toggleWindowVisibility({ isDestroyed: () => true }), false, 'Destroyed partial objects need no state methods');
const missingAction = mockWindow();
delete missingAction.focus;
assert.equal(toggleWindowVisibility(missingAction), false);
assert.deepEqual(missingAction.actions, [], 'Invalid window interfaces do not cause partial actions');
const racedWindow = mockWindow();
racedWindow.isVisible = () => { throw new Error('Synthetic destroyed-window race'); };
assert.equal(toggleWindowVisibility(racedWindow), false, 'State-query destruction races are harmless');
assert.deepEqual(racedWindow.actions, []);
const racedAction = mockWindow({ visible: true, focused: true });
racedAction.hide = () => { throw new Error('Synthetic close during toggle'); };
assert.equal(toggleWindowVisibility(racedAction), false, 'Action destruction races are harmless');

console.log('Window shortcut checks passed: Off, registration/collision rollback, callback reuse/disposal and all window visibility states.');
