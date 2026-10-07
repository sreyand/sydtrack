'use strict';

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('child_process').spawn(require('electron'), [__filename], {
    env, stdio: 'inherit', windowsHide: true
  });
  const timeout = setTimeout(() => { console.error('DOM patch checks timed out'); child.kill(); }, 30000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('exit', code => { clearTimeout(timeout); process.exitCode = code == null ? 1 : code; });
  return;
}

// A hidden blank renderer only: no production UI/preload/main, tracker, network,
// OS shortcut registration, startup writes, or personal application profile.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-dom-patch-'));
const userData = path.join(temporary, 'user-data');
fs.mkdirSync(userData);
app.setPath('appData', temporary);
app.setPath('userData', userData);
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, width: 800, height: 600,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadURL('about:blank');
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'dom-patch.js'), 'utf8'));
    const results = await win.webContents.executeJavaScript(`(() => {
      const check = (condition, message) => { if (!condition) throw Error(message); };
      const patch = window.sydtrackDOM.patchChildren;
      const target = document.createElement('div');
      document.body.append(target);
      const results = [];
      const tile = (date, score, hit = 'yes') => '<button type="button" class="week-score-day focus-score-day" data-score-date="' + date +
        '" data-hit="' + hit + '" title="' + date + ': ' + score + '% focus"><span>' + date + '</span><strong>' + score +
        '%</strong><span class="focus-score-open" aria-hidden="true">↗</span></button>';
      const grid = rows => '<div class="week-score-grid">' + rows.join('') + '</div>';
      const dates = ['2026-10-05', '2026-10-06', '2026-10-07'];
      const original = grid(dates.map(date => tile(date, 80)));
      check(patch(target, original, { key: 'data-score-date' }), 'Initial markup is a change');
      const wrapper = target.firstElementChild;
      const buttons = [...wrapper.children];
      const score = buttons[1].querySelector('strong');
      let clicks = 0;
      buttons[1].addEventListener('click', () => { clicks++; });
      const observer = new MutationObserver(() => {});
      observer.observe(target, { attributes: true, characterData: true, childList: true, subtree: true });
      check(patch(target, original, { key: 'data-score-date' }) === false, 'Stable markup returns false');
      check(observer.takeRecords().length === 0, 'Stable markup causes no mutation');
      buttons[1].focus({ preventScroll: true });
      const updated = grid([tile(dates[0], 80), tile(dates[1], 63, 'no'), tile(dates[2], 80)]);
      check(patch(target, updated, { key: 'data-score-date' }), 'Changed score returns true');
      check(target.firstElementChild === wrapper && wrapper.children[1] === buttons[1], 'Wrapper and changed button retain identity');
      check(buttons[1].querySelector('strong') === score && score.textContent === '63%', 'Score descendant is patched, not recreated');
      check(buttons[1].dataset.hit === 'no' && buttons[1].title.includes('63%'), 'Metadata attributes update');
      check(document.activeElement === buttons[1], 'Numerical update preserves keyboard focus');
      check(observer.takeRecords().every(record => record.type !== 'childList'), 'Compatible live update does not replace descendants');
      check(patch(target, updated, { key: 'data-score-date' }) === false && observer.takeRecords().length === 0, 'Updated stable markup stays mutation-free');
      const reordered = grid([tile(dates[1], 63, 'no'), tile(dates[2], 80), tile(dates[0], 80)]);
      check(patch(target, reordered, { key: 'data-score-date' }), 'Key reorder is a change');
      check(wrapper.children[0] === buttons[1] && wrapper.children[1] === buttons[2] && wrapper.children[2] === buttons[0], 'Distinct dates reorder original buttons');
      check(document.activeElement === buttons[1], 'Key reorder retains focus on the same date');
      buttons[1].click(); check(clicks === 1, 'Existing button listener survives patch and reorder');
      check(patch(target, grid([tile(dates[1], 64, 'no'), tile('2026-10-08', 90)]), { key: 'data-score-date' }), 'New and removed dates are patched');
      check(wrapper.children[0] === buttons[1] && !buttons[0].isConnected && !buttons[2].isConnected, 'Surviving date stays, removed dates leave DOM');
      check(document.activeElement === buttons[1] && wrapper.children[1].dataset.scoreDate === '2026-10-08', 'New date does not steal focus');
      observer.disconnect(); results.push('stable grids, changed text/attributes, keyed reorder and date rollover');

      const column = (hour, height, empty = false) => '<div class="day-col' + (empty ? ' empty' : '') + '" data-hour="' + hour +
        '" style="--bar-h:' + height + '%">' + (empty ? '<div class="day-stack empty-slot" aria-hidden="true"></div>' :
        '<div class="day-stack"><div class="day-seg prod" style="height:50%"></div><div class="day-seg unprod" style="height:20%"></div><div class="day-seg other" style="height:30%"></div></div>') +
        '<span class="day-tick">' + hour + '</span></div>';
      const chart = document.createElement('div'); document.body.append(chart);
      patch(chart, [column(0, 10), column(1, 0, true), column(2, 30)].join(''), { key: 'data-hour' });
      const columns = [...chart.children];
      const segment = columns[0].querySelector('.prod');
      patch(chart, [column(0, 80), column(1, 50), column(2, 30)].join(''), { key: 'data-hour' });
      check(chart.children[0] === columns[0] && columns[0].querySelector('.prod') === segment, 'Changing heights preserves columns and stack segments');
      check(columns[0].style.getPropertyValue('--bar-h') === '80%' && columns[1].querySelectorAll('.day-seg').length === 3, 'Height and empty-to-active stack updates render');
      check(!columns[1].classList.contains('empty') && !columns[1].firstElementChild.hasAttribute('aria-hidden'), 'Obsolete class and accessibility attributes are removed');
      patch(chart, [column(2, 30), column(0, 80), column(1, 50)].join(''), { key: 'data-hour' });
      check(chart.children[0] === columns[2] && chart.children[1] === columns[0], 'Hours reorder by identity');
      const axis = document.createElement('div'); document.body.append(axis);
      patch(axis, '<span>1h</span><span>30m</span><span>0</span>');
      const axisNodes = [...axis.children];
      patch(axis, '<span>2h</span><span>1h</span><span>0</span>');
      check([...axis.children].every((node, index) => node === axisNodes[index]) && axis.children[0].textContent === '2h', 'Unkeyed axis labels update in place');
      results.push('column heights, active/empty structure, hour reorder and y-axis labels');

      buttons[1].focus();
      patch(target, '<p>No days to score yet.</p>', { key: 'data-score-date' });
      check(target.firstElementChild.tagName === 'P' && !buttons[1].isConnected, 'Incompatible group is replaced without stale descendants');
      check(document.activeElement !== buttons[1], 'Deleted focused date is not refocused or fabricated');
      patch(target, grid([tile('2026-10-09', 70, 'no')]), { key: 'data-score-date' });
      check(target.querySelectorAll('button').length === 1 && !target.querySelector('p'), 'Empty-to-grid structural return is correct');
      patch(target, grid([tile('duplicate', 1), tile('duplicate', 2)]), { key: 'data-score-date' });
      patch(target, grid([tile('duplicate', 3), tile('duplicate', 4)]), { key: 'data-score-date' });
      check([...target.querySelectorAll('strong')].map(node => node.textContent).join(',') === '3%,4%', 'Duplicate keys do not conflate separate rows');
      results.push('removed groups, structural replacement and duplicate keys');

      const form = document.createElement('div'); document.body.append(form);
      patch(form, '<input value="saved"><select><option value="a">A</option><option value="b">B</option></select><textarea>saved</textarea>');
      const input = form.querySelector('input'); input.focus(); input.value = 'unsaved';
      patch(form, '<input value="new"><select><option value="a">A</option><option value="b">B</option></select><textarea>saved</textarea>');
      check(form.querySelector('input') === input && input.value === 'unsaved', 'Focused input draft is not overwritten');
      const select = form.querySelector('select'); select.focus(); select.value = 'b';
      patch(form, '<input value="new"><select><option value="a" selected>Different A</option></select><textarea>saved</textarea>');
      check(form.querySelector('select') === select && select.value === 'b' && select.options.length === 2, 'Focused select draft and options are not overwritten');
      const textarea = form.querySelector('textarea'); textarea.focus(); textarea.value = 'draft';
      patch(form, '<input value="new"><select><option value="a">A</option></select><textarea>new</textarea>');
      check(form.querySelector('textarea') === textarea && textarea.value === 'draft', 'Focused textarea draft is not overwritten');
      results.push('defensive focused form-value preservation');

      window.__domPatchScriptRan = false;
      patch(target, '<span>&lt;script&gt;window.__domPatchScriptRan=true&lt;/script&gt; &amp; &lt;unsafe&gt;</span>');
      check(target.textContent === '<script>window.__domPatchScriptRan=true</script> & <unsafe>' && !target.querySelector('script'), 'Escaped labels remain text');
      patch(target, '<script>window.__domPatchScriptRan=true</script><span>Trusted parser fixture</span>');
      check(window.__domPatchScriptRan === false, 'Template-created script does not execute on insertion');
      check(patch(null, 'ignored') === false, 'Missing target is harmless');
      results.push('escaped labels, inert template parsing and missing target');
      return results;
    })()`);
    assert.equal(results.length, 5);
    assert.equal(win.isVisible(), false, 'Synthetic renderer remains hidden');
    console.log('DOM patch checks passed:', results.join('; '));
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { app.quit(); });
