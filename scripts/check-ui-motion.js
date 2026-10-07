'use strict';

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
  const timeout = setTimeout(() => { console.error('UI motion checks timed out'); child.kill(); }, 90000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('exit', code => { clearTimeout(timeout); process.exitCode = code == null ? 1 : code; });
  return;
}

// Exercise the shipped sandboxed preload and renderer against synthetic IPC.
// This never starts the tracker, modifies personal settings, or registers OS shortcuts.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { THEME_IDS } = require('../src/theme');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sydtrack-ui-motion-'));
const userData = path.join(temporary, 'user-data');
fs.mkdirSync(userData);
app.setPath('appData', temporary);
app.setPath('userData', userData);
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const date = require('../src/store').todayKey();
  let settings = {
    onboardingComplete: true, trackingPaused: false, trackingPauseUntil: 0, launchAtStartup: false,
    updateChecksEnabled: false, notificationsEnabled: false, theme: 'midnight', pollMs: 3000,
    profileShortcut: '', windowShortcut: '', themeRotationEnabled: false, themeRotationMode: 'dark',
    themeRotationAnchorDate: '', themeRotationAnchorTheme: '', uiMotionEnabled: false,
    thresholdSec: 600, focusBoost: false, focusBoostScheduleEnabled: true,
    focusBoostScheduleStart: '09:07', focusBoostScheduleEnd: '23:59', focusShareGoalPct: 80,
    focusShareIncludeOther: false
  };
  let emptyApps = false;
  const syntheticApps = [{ name: 'Editor', category: 'productive', seconds: 3600 },
    { name: 'Browser', category: 'unproductive', seconds: 600 }, { name: 'Browser', category: 'other', seconds: 300 }];
  const stats = () => ({ date, settings: { ...settings }, byCategory: { productive: 3600, unproductive: 600, other: 300 },
    byHour: Array.from({ length: 24 }, () => ({ productive: 0, unproductive: 0, other: 0 })),
    topApps: emptyApps ? [] : syntheticApps, appBreakdown: emptyApps ? [] : syntheticApps, activityRows: [] });
  const profile = { id: 'default', name: 'Synthetic profile', productive: [], unproductive: [], other: [], ignore: [] };
  const writes = [];
  let win, failNext = false, heldWrite = null;
  const motionWrites = () => writes.filter(partial => Object.hasOwn(partial, 'uiMotionEnabled'));
  const cycleWrites = () => writes.filter(partial => Object.hasOwn(partial, 'themeRotationMode'));
  const publish = () => win.webContents.send('tracker:update', { stats: stats(), now: null, lastFocused: null, session: null });
  const handlers = {
    'state:get': () => ({ stats: stats(), now: null, lastFocused: null, session: null, platform: process.platform }),
    'profiles:get': () => ({ schemaVersion: 1, activeId: 'default', profiles: [profile] }),
    'rules:get': () => ({ ...profile, profileId: 'default' }), 'ignore:get': () => ({ ignore: [], profileId: 'default' }),
    'keywords:get': () => ({ productive: [], unproductive: [] }),
    'updates:get': () => ({ currentVersion: require('../package.json').version, available: false, phase: 'idle' }),
    'session:getActive': () => null,
    'session:getForDay': (_event, day) => ({ date: day || date, sessions: [], recentDays: [], historyEnabled: true }),
    'history:summary': () => [{ date, byCategory: { productive: 3600, unproductive: 600, other: 300 }, apps: syntheticApps }],
    'history:lifetime': () => ({ days: 0, totalSec: 0, byCategory: { productive: 0, unproductive: 0, other: 0 }, topApps: [] }),
    'history:timelineDay': () => ({ ...stats(), timeline: [] }),
    'settings:update': async (_event, partial) => {
      assert(partial && typeof partial === 'object');
      writes.push(partial);
      if (failNext) { failNext = false; throw new Error('Synthetic appearance save failed'); }
      if (heldWrite) await heldWrite;
      settings = { ...settings, ...partial };
      if (Object.hasOwn(partial, 'theme')) settings.themeRotationEnabled = false;
      publish();
      return { ...settings };
    }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  win = new BrowserWindow({ show: false, width: 1040, height: 760,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2 && !message.includes('Electron Security Warning') && !message.includes('ERR_BLOCKED_BY_CLIENT')) errors.push(message);
  });
  const render = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, message) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await render(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(message);
  };
  // Hidden windows may deliver rAF at one-second intervals even when execution
  // throttling is off. Flush mutation observers without outwaiting 150ms motion.
  const frame = () => render('new Promise(resolve => setTimeout(resolve, 0))');
  async function capture() {
    for (let attempt = 0; attempt < 5; attempt++) {
      try { return await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); }
      catch (error) {
        if (!error.message.includes('Current display surface not available') || attempt === 4) throw error;
        await render('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      }
    }
  }
  const settle = async () => {
    // A hidden capture wakes the compositor without ever showing the window;
    // it starts/samples the same timelines a visible renderer paints normally.
    await capture();
    await new Promise(resolve => setTimeout(resolve, 400));
    await capture();
    await frame();
  };
  const showSettings = () => render(`document.querySelector('.nav-btn[data-tab="settings"]').click();
    document.querySelector('[data-settings-tab="tracking"]').click()`);
  const moduleAnimations = () => render(`document.getAnimations().filter(animation => animation.id === 'sydtrack-ui-motion').map(animation => ({
    target: animation.effect.target.id || animation.effect.target.className, state: animation.playState,
    duration: animation.effect.getTiming().duration, iterations: animation.effect.getTiming().iterations,
    delay: animation.effect.getTiming().delay }))`);
  const records = () => render(`window.__motionRecords.map(record => ({id:record.animation.id, target:record.target.id || record.target.className, parent:record.parent,
    state:record.animation.playState, duration:record.animation.effect.getTiming().duration,
    frames:record.animation.effect.getKeyframes()}))`);
  async function instrument() {
    await render(`(() => {
      window.__motionRecords = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        window.__motionRecords.push({target:this, parent:this.parentElement?.id || this.parentElement?.className, animation});
        return animation;
      };
    })()`);
  }
  async function media(value) {
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value }]
    });
    await wait(`matchMedia('(prefers-reduced-motion: reduce)').matches === ${value === 'reduce'}`, 'Reduced-motion emulation did not apply');
    await wait(`document.documentElement.dataset.uiMotion === (latestGoalSettings?.uiMotionEnabled === true && ${value !== 'reduce'} ? 'on' : 'off')`,
      'Live reduced-motion listener did not synchronize its runtime');
    await frame();
  }
  async function key(name) {
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const code = { Space: 32, Escape: 27, Enter: 13 }[name];
    const input = { key: name === 'Space' ? ' ' : name, code: name, windowsVirtualKeyCode: code };
    if (name === 'Space' || name === 'Enter') input.text = input.unmodifiedText = name === 'Space' ? ' ' : '\r';
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...input });
    delete input.text; delete input.unmodifiedText;
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...input });
  }
  async function pressScale(selector = '.nav-btn[data-tab="settings"]') {
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const point = await render(`(() => {const button=document.querySelector(${JSON.stringify(selector)}), r=button.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...point });
    await render(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).scale`);
    await frame();
    await new Promise(resolve => setTimeout(resolve, 85));
    // Chromium suspends hidden compositor timelines. Inspect the genuine CSS
    // transition produced by the trusted press, then sample its natural endpoint.
    await render(`(() => {const button=document.querySelector(${JSON.stringify(selector)});
      for (const animation of button.getAnimations()) if (animation.transitionProperty==='scale') animation.currentTime=animation.effect.getTiming().duration;})()`);
    const scale = await render(`(() => {const button=document.querySelector(${JSON.stringify(selector)}), style=getComputedStyle(button);
      return {active:button.matches(':active'), scale:parseFloat(style.scale)||1,
        detail:{transform:style.transform, duration:style.transitionDuration, property:style.transitionProperty,
          runtime:document.documentElement.dataset.uiMotion, media:matchMedia('(prefers-reduced-motion: no-preference)').matches}};})()`);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...point });
    return scale;
  }
  async function toggleWithSpace() {
    await showSettings();
    await render(`document.getElementById('ui-motion-toggle').scrollIntoView({block:'center'});
      document.getElementById('ui-motion-toggle').focus({preventScroll:true})`);
    await key('Space');
  }
  async function expectSaved(enabled) {
    await wait(`!appearanceSaving && latestGoalSettings.uiMotionEnabled === ${enabled} &&
      document.getElementById('ui-motion-toggle').checked === ${enabled} && !document.getElementById('ui-motion-toggle').disabled`, 'Motion save did not settle');
    assert.equal(settings.uiMotionEnabled, enabled);
  }
  async function reload() {
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
    await wait(`document.readyState === 'complete' && typeof window.sydtrackUIMotion?.create === 'function' &&
      document.getElementById('ui-motion-toggle') && typeof latestGoalSettings === 'object'`, 'Motion renderer did not initialize');
    await render('new Promise(resolve => requestAnimationFrame(resolve))');
    await instrument();
  }
  async function appearanceLayout(rotationEnabled) {
    const layout = await render(`(() => {
      const card=document.getElementById('settings-appearance-card'),heading=card.querySelector('.appearance-head');
      const rotate=document.getElementById('theme-rotation-toggle'),cycle=document.getElementById('theme-rotation-cycle');
      const row=document.getElementById('ui-motion-row'),label=row.querySelector('.switch-title'),input=document.getElementById('ui-motion-toggle');
      const head=heading.getBoundingClientRect(),r=rotate.getBoundingClientRect(),c=cycle.getBoundingClientRect();
      const l=label.getBoundingClientRect(),i=input.getBoundingClientRect(),chips=card.querySelector('.theme-swatches').getBoundingClientRect();
      const bare=button=>{const style=getComputedStyle(button);return style.backgroundColor==='rgba(0, 0, 0, 0)' && style.backgroundImage==='none' &&
        ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'].every(side=>parseFloat(style[side])===0);};
      const glyph=rotate.querySelector('.appearance-rotate-icon'),arcs=glyph.querySelector('path[stroke-width="2.3"]'),heads=glyph.querySelector('path[fill="currentColor"]');
      return {headerActions:heading.contains(rotate) && heading.contains(cycle) && rotate.tagName==='BUTTON' && rotate.type==='button' &&
          rotate.getAttribute('aria-pressed')===${JSON.stringify(String(rotationEnabled))} && Math.abs(r.right-head.right)<=2 && r.width<=44 && r.height<=44,
        cycle:${rotationEnabled} ? cycle.getClientRects().length>0 && c.right<=r.left-3 && r.left-c.right<=16 && Math.abs((c.top+c.bottom-r.top-r.bottom)/2)<=2
          : cycle.getClientRects().length===0,
        motionRow:label.textContent.trim()==='Enable UI motion' && row.tagName==='LABEL' && row.contains(input) &&
          Math.abs(l.left-head.left)<=2 && Math.abs(i.right-head.right)<=2 && row.getBoundingClientRect().top>=chips.bottom+12 &&
          Math.abs((l.top+l.bottom-i.top-i.bottom)/2)<=2 && card.scrollWidth<=card.clientWidth+1,
        noOldPool:!document.getElementById('theme-rotation-mode'),
        bareIcons:bare(rotate) && bare(cycle),
        matchingTypeface:[rotate,cycle].every(button=>getComputedStyle(button).fontFamily.includes('Satoshi')),
        openArrows:glyph.getAttribute('stroke-linecap')==='round' && glyph.getAttribute('stroke-linejoin')==='round' &&
          (arcs.getAttribute('d').match(/M/g)||[]).length===2 && (arcs.getAttribute('d').match(/a/g)||[]).length===2 && !/z/i.test(arcs.getAttribute('d')) &&
          (heads.getAttribute('d').match(/M/g)||[]).length===2 && heads.getAttribute('stroke-width')==='1.2',
        detail:{rotation:[r.left,r.right,r.width,r.height],cycle:[c.left,c.right,c.width,c.height],heading:[head.left,head.right],
          label:[l.left,l.right,l.top,l.bottom],input:[i.left,i.right,i.top,i.bottom],gap:row.getBoundingClientRect().top-chips.bottom}};
    })()`);
    assert.equal(layout.headerActions && layout.cycle && layout.motionRow && layout.noOldPool && layout.bareIcons && layout.openArrows && layout.matchingTypeface, true,
      `Appearance ${rotationEnabled ? 'on' : 'off'} layout: heading actions and full-width motion row ${JSON.stringify(layout)}`);
  }
  async function smoothnessChecks() {
    await showSettings(); await settle();
    await render(`(() => {
      document.querySelector('.main').scrollTop=0;
      const view=document.getElementById('view-settings');
      const group=document.createElement('div');group.id='motion-other-group';group.className='segment-control';
      for (const [label,active] of [['Alpha',true],['Beta',false]]) {
        const button=document.createElement('button');button.type='button';button.className='segment-btn'+(active?' active':'');button.textContent=label;group.append(button);
      }
      const popup=document.createElement('div');popup.id='motion-unrelated-popup';popup.className='select-menu-listbox';popup.hidden=true;popup.textContent='Synthetic menu';
      const parent=document.createElement('div');parent.id='motion-panel-parent';parent.className='view hidden';parent.style.minHeight='40px';
      const child=document.createElement('div');child.id='motion-panel-child';child.className='settings-panel hidden';child.textContent='Synthetic nested panel';parent.append(child);
      view.append(group,popup,parent);
      uiMotion.setEnabled(false);uiMotion.setEnabled(true);
    })()`); await frame();
    await render(`window.__motionRecords.length=0;document.getElementById('motion-panel-parent').classList.remove('hidden')`); await frame();
    const parentEntrance=await render(`(() => {
      const element=document.getElementById('motion-panel-parent'),animation=element.getAnimations().find(animation=>animation.id==='sydtrack-ui-motion');
      if (!animation) return null;
      animation.pause();animation.currentTime=0;
      return {frames:animation.effect.getKeyframes(),duration:animation.effect.getTiming().duration,opacity:parseFloat(getComputedStyle(element).opacity),transform:getComputedStyle(element).transform};
    })()`);
    assert(parentEntrance && parentEntrance.opacity>=0.9 && parentEntrance.opacity<1 && parentEntrance.transform==='none' &&
      parentEntrance.frames.every(frame=>frame.transform==null) && parentEntrance.duration>=80 && parentEntrance.duration<=160,
    'Panel entrance keeps content almost fully visible and never transforms the fixed-menu coordinate system: '+JSON.stringify(parentEntrance));
    await render(`document.getElementById('motion-panel-child').classList.remove('hidden')`); await frame();
    assert.equal((await records()).some(record=>record.target==='motion-panel-child'),false,
      'A nested panel revealed in a later observer batch does not compound an active ancestor fade');
    await render(`document.getElementById('motion-panel-parent').remove();window.__motionRecords.length=0;
      document.querySelector('[data-settings-tab="wellbeing"]').click()`); await frame();
    const continuityStart=await render(`(() => {
      const pill=document.querySelector('.settings-toolbar .ui-motion-indicator');
      const animation=pill.getAnimations().find(animation=>animation.id==='sydtrack-ui-motion');
      if (!animation) return false;
      animation.pause();animation.currentTime=Number(animation.effect.getTiming().duration)*.4;
      window.__heldIndicator=animation;window.__heldPill=pill;
      const r=pill.getBoundingClientRect();window.__heldIndicatorRect={left:r.left,top:r.top,width:r.width,height:r.height};
      window.__heldIndicatorCount=window.__motionRecords.filter(record=>record.target===pill).length;
      return true;
    })()`);
    assert.equal(continuityStart,true,'Settings highlight can be sampled midway through its real transition');
    const unchangedIndicator=async message=>{
      const state=await render(`(() => {
        const animation=window.__heldPill.getAnimations().find(animation=>animation.id==='sydtrack-ui-motion'),r=window.__heldPill.getBoundingClientRect();
        return {same:animation===window.__heldIndicator,paused:animation?.playState==='paused',
          stationary:['left','top','width','height'].every(key=>Math.abs(r[key]-window.__heldIndicatorRect[key])<.75),
          noRestart:window.__motionRecords.filter(record=>record.target===window.__heldPill).length===window.__heldIndicatorCount};
      })()`);
      assert.deepEqual(state,{same:true,paused:true,stationary:true,noRestart:true},message+': '+JSON.stringify(state));
    };
    await render(`(() => {const group=document.getElementById('motion-other-group');group.querySelector('.active').classList.remove('active');group.querySelectorAll('.segment-btn')[1].classList.add('active');})()`); await frame();
    await unchangedIndicator('Changing a different tab group does not restart or snap the current highlight');
    await render(`(() => {const group=document.getElementById('motion-other-group'),button=document.createElement('button');
      button.type='button';button.className='segment-btn';button.textContent='Inserted';group.insertBefore(button,group.querySelector('.active'));})()`); await frame();
    assert.equal(await render(`(() => {const group=document.getElementById('motion-other-group'),active=group.querySelector('.active'),pill=group.querySelector('.ui-motion-indicator');
      return Math.abs(parseFloat(pill.style.left)-active.offsetLeft)<1 && Math.abs(parseFloat(pill.style.width)-active.offsetWidth)<1;})()`),true,
      'Inserting a tab before the unchanged active tab refreshes the highlight target geometry');
    await unchangedIndicator('Inserting into a different tab group does not disturb the current highlight');
    await render(`document.getElementById('motion-unrelated-popup').hidden=false`); await frame();
    await unchangedIndicator('Opening an unrelated popup does not restart or snap the current highlight');
    const popupEntrance=(await records()).find(record=>record.target==='motion-unrelated-popup');
    assert(popupEntrance && Number(popupEntrance.frames[0].opacity)>=.85 && popupEntrance.frames.every(frame=>!String(frame.transform||'').includes('scale')) &&
      popupEntrance.duration>=80 && popupEntrance.duration<=160,'Popup entrance is a short, nearly visible translation without scaling');
    await render(`document.querySelector('[data-settings-tab="wellbeing"]').classList.add('motion-unrelated-class')`); await frame();
    await unchangedIndicator('A non-selection class mutation does not restart the highlight');
    publish(); await frame();
    await unchangedIndicator('A live stats update does not restart or snap the current highlight');
    const retarget=await render(`(() => {
      const pill=window.__heldPill,r=pill.getBoundingClientRect();window.__retargetStart={left:r.left,top:r.top,width:r.width,height:r.height};
      const button=document.querySelector('[data-settings-tab="notifications"]');button.focus({preventScroll:true});button.click();
      return button.classList.contains('active') && button.getAttribute('aria-selected')==='true' && document.activeElement===button;
    })()`);
    assert.equal(retarget,true,'Interrupting a highlight still commits its newest native tab selection and focus immediately'); await frame();
    const interrupted=await render(`(() => {
      const pill=window.__heldPill,animations=pill.getAnimations().filter(animation=>animation.id==='sydtrack-ui-motion'),animation=animations[0];
      if (!animation) return null;
      animation.pause();animation.currentTime=0;
      const r=pill.getBoundingClientRect(),frames=animation.effect.getKeyframes();
      return {one:animations.length===1,replaced:animation!==window.__heldIndicator,oldCanceled:window.__heldIndicator.playState==='idle',
        continuous:['left','top','width','height'].every(key=>Math.abs(r[key]-window.__retargetStart[key])<1.25),
        transformOnly:frames.every(frame=>frame.width==null && frame.height==null && frame.left==null && frame.top==null) && frames.some(frame=>String(frame.transform).includes('scale')),
        stableTint:!getComputedStyle(document.querySelector('.settings-toolbar .segment-btn.active')).transitionProperty.split(',').some(property=>['background-color','border-color'].includes(property.trim())),
        frames};
    })()`);
    assert(interrupted && interrupted.one && interrupted.replaced && interrupted.oldCanceled && interrupted.continuous && interrupted.transformOnly && interrupted.stableTint,
      'Retargeting starts at the displayed rectangle with one transform-only animation, without layout-width interpolation: '+JSON.stringify(interrupted));
    await render(`(() => {const chart=document.createElement('div');chart.id='motion-geometry-pie';chart.className='pie-chart';
      Object.assign(chart.style,{width:'0px',height:'0px',background:'conic-gradient(green 0deg 180deg, red 180deg 360deg)'});
      document.getElementById('view-settings').append(chart);})()`); await frame();
    assert.equal((await records()).filter(record=>record.target==='ui-motion-pie-cover' && record.parent==='motion-geometry-pie').length,0,
      'A connected zero-sized chart does not start a sweep before its geometry exists');
    await render(`Object.assign(document.getElementById('motion-geometry-pie').style,{width:'80px',height:'80px'})`); await frame();
    assert.equal((await records()).filter(record=>record.target==='ui-motion-pie-cover' && record.parent==='motion-geometry-pie').length,1,
      'A chart draws exactly once when its async geometry becomes nonzero');
    await render(`document.getElementById('motion-geometry-pie').style.background='conic-gradient(green 0deg 200deg, red 200deg 360deg)'`); await frame();
    assert.equal((await records()).filter(record=>record.target==='ui-motion-pie-cover' && record.parent==='motion-geometry-pie').length,1,
      'Later chart style/data updates do not replay its geometry-ready sweep');
    await render(`for (const button of document.querySelectorAll('#motion-other-group .segment-btn:not(.active)')) button.remove()`); await frame();
    assert.equal(await render(`(() => {const group=document.getElementById('motion-other-group');
      return !group.querySelector('.ui-motion-indicator') && !group.hasAttribute('data-motion-pill') && !group.classList.contains('ui-motion-segment');})()`),true,
      'A group reduced to one button releases its unnecessary highlight decoration');
    await render(`document.querySelector('[data-settings-tab="wellbeing"]').classList.remove('motion-unrelated-class');
      document.getElementById('motion-other-group').remove();document.getElementById('motion-unrelated-popup').remove();document.getElementById('motion-geometry-pie').remove();
      for (const animation of document.getAnimations()) if (animation.id==='sydtrack-ui-motion') animation.finish();
      delete window.__heldIndicator;delete window.__heldPill;delete window.__heldIndicatorRect;delete window.__retargetStart;delete window.__heldIndicatorCount`);
    await showSettings(); await settle();
  }
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await wait(`typeof window.sydtrackUIMotion?.create === 'function' && document.getElementById('ui-motion-toggle') &&
      typeof latestGoalSettings === 'object'`, 'Motion renderer did not initialize');
    await media('no-preference');
    await instrument();
    await showSettings(); await frame();
    assert.equal(await render(`(() => {
      const input = document.getElementById('ui-motion-toggle');
      return input.tagName === 'INPUT' && input.type === 'checkbox' && input.getAttribute('role') === 'switch' &&
        input.closest('label')?.querySelector('.switch-title')?.textContent.trim()==='Enable UI motion' && input.closest('#settings-appearance-card') != null && !input.checked;
    })()`), true, 'Opt-in native switch has an accessible Appearance label and defaults off');
    await appearanceLayout(false);
    for (const width of [800,1600,1040]) {
      win.setSize(width,760);
      const [contentWidth,contentHeight]=win.getContentSize();
      await wait(`Math.abs(innerWidth-${contentWidth})<=2 && Math.abs(innerHeight-${contentHeight})<=2`,'Appearance viewport did not resize');
      await frame(); await appearanceLayout(false);
    }
    assert.equal(await render(`document.documentElement.dataset.uiMotion === 'on'`), false);
    assert.equal((await records()).length, 0, 'Default navigation has no WAAPI motion');
    assert.equal(await render(`document.querySelectorAll('.ui-motion-indicator').length`), 0, 'Default keeps the original tab appearance');
    assert.equal(await render(`(() => { const style=getComputedStyle(document.querySelector('[data-settings-tab="tracking"]'));
      return !style.transitionProperty.split(',').some(property => property.trim() === 'transform') || style.transitionDuration.split(',').every(duration => parseFloat(duration) === 0); })()`), true,
    'Press transform transitions are opt-in');
    const plainPress = await pressScale();
    assert.equal(plainPress.active, true); assert.equal(plainPress.scale, 1, 'Default-off trusted pointer press leaves the original geometry unchanged');

    await render(`document.getElementById('theme-rotation-toggle').click()`);
    await wait(`!appearanceSaving && latestGoalSettings.themeRotationEnabled===true`, 'Header rotation button did not enable');
    await appearanceLayout(true);
    for (const [mode, label, next] of [['light','Day','All'],['any','All','Night'],['dark','Night','Day']]) {
      const beforeCycle=cycleWrites().length;
      await render(`document.getElementById('theme-rotation-cycle').click()`);
      await wait(`!appearanceSaving && latestGoalSettings.themeRotationMode===${JSON.stringify(mode)}`, 'Header rotation cycle did not settle');
      assert.equal(cycleWrites().length,beforeCycle+1,'One icon cycle click makes one exact settings write');
      assert.deepEqual(cycleWrites().at(-1),{themeRotationMode:mode});
      assert.equal(await render(`(() => {const button=document.getElementById('theme-rotation-cycle');
        return button.getAttribute('aria-label').includes(${JSON.stringify(label)}) &&
          button.getAttribute('aria-label').includes(${JSON.stringify('Switch to ' + next)}) && button.title.includes(${JSON.stringify(next)});})()`),true,
      'Icon cycle exposes its current pool and correct next step in accessible text');
      assert.equal(await render(`(() => {const button=document.getElementById('theme-rotation-cycle');
        const shown=[...button.querySelectorAll('[data-rotation-icon]')].filter(icon=>icon.getClientRects().length>0);
        const icon=shown[0];
        return button.dataset.rotationMode===${JSON.stringify(mode)} && shown.length===1 && icon.dataset.rotationIcon===${JSON.stringify(mode)} &&
          icon.getAttribute('aria-hidden')==='true' && (${JSON.stringify(mode)}==='any'
            ? icon.localName==='span' && icon.textContent==='ALL' && parseFloat(getComputedStyle(icon).fontSize)===10 &&
              new DOMMatrixReadOnly(getComputedStyle(icon).transform).f===1 && getComputedStyle(icon).fontFamily.includes('Satoshi') &&
              document.fonts.check('700 10px Satoshi','ALL')
            : icon.localName==='svg' && icon.getBoundingClientRect().width===16 && icon.getBoundingClientRect().height===16);})()`),true,
      `${label}: only the current compact icon shows, with literal ALL text instead of a half-circle`);
    }
    let releaseCycle;
    heldWrite=new Promise(resolve=>{releaseCycle=resolve;});
    const beforeCycleHeld=writes.length;
    await render(`document.getElementById('theme-rotation-cycle').click()`);
    await wait(`appearanceSaving && document.getElementById('theme-rotation-cycle').disabled && document.getElementById('theme-rotation-toggle').disabled && document.getElementById('ui-motion-toggle').disabled`,
      'Header cycle did not share the pending Appearance guard');
    await render(`document.getElementById('theme-rotation-cycle').click(); document.getElementById('theme-rotation-toggle').click(); document.getElementById('ui-motion-toggle').click()`);
    assert.equal(writes.length,beforeCycleHeld+1,'Rapid cycle/rotation/motion clicks cannot race a pending Appearance save');
    heldWrite=null; releaseCycle();
    await wait(`!appearanceSaving && latestGoalSettings.themeRotationMode==='light'`,'Held Night→Day cycle did not settle');
    await render(`document.getElementById('theme-rotation-toggle').click()`);
    await wait(`!appearanceSaving && latestGoalSettings.themeRotationEnabled===false`,'Header rotation disabling did not settle');
    await appearanceLayout(false);

    let before = motionWrites().length;
    failNext = true; await toggleWithSpace();
    await wait(`!appearanceSaving && document.getElementById('appearance-status').textContent.includes('Could not save')`, 'Failed motion enable did not settle/report');
    assert.equal(settings.uiMotionEnabled, false);
    assert.equal(await render(`!document.getElementById('ui-motion-toggle').checked && document.documentElement.dataset.uiMotion !== 'on'`), true,
      'Failed enable restores the authoritative unchecked/off state');
    assert.equal(motionWrites().length, before + 1, 'One trusted Space produces one attempted write');
    await toggleWithSpace(); await expectSaved(true);
    assert.deepEqual(motionWrites().at(-1), { uiMotionEnabled: true });
    assert.equal(motionWrites().length, before + 2, 'One Space retry produces one settings write');
    await wait(`document.documentElement.dataset.uiMotion === 'on' && document.querySelectorAll('.ui-motion-indicator').length > 0`, 'Enabled motion did not activate');
    assert.equal(await render(`typeof uiMotion.setEnabled === 'function' && typeof uiMotion.dispose === 'function' && typeof uiMotion.enabled === 'boolean'`), true,
      'Controller exposes its limited enabled/setEnabled/dispose interface');
    await settle();
    const navigationPress = await pressScale();
    assert.equal(navigationPress.active, true, 'Navigation is exercised with a real pointer');
    assert.equal(navigationPress.scale,1,'Navigation uses color and selection feedback without a second scaling motion');
    await render(`(() => {const button=document.createElement('button');button.id='motion-action-probe';button.type='button';button.className='session-play';button.textContent='Action';
      Object.assign(button.style,{position:'fixed',left:'320px',bottom:'20px',zIndex:'10000'});document.body.append(button);})()`); await frame();
    const actionPress=await pressScale('#motion-action-probe');
    assert.equal(actionPress.active,true,'Synthetic direct-action probe receives the trusted press: '+JSON.stringify(actionPress));assert(actionPress.scale>=.97 && actionPress.scale<.995,
      'A direct action uses only a small responsive press: '+JSON.stringify(actionPress));
    assert.equal(actionPress.detail.transform,'none','Opt-in press neutralizes the session button legacy active transform instead of stacking two scales');
    await render(`document.getElementById('motion-action-probe').remove()`);
    await settle();
    await render(`document.body.classList.add('nav-collapsed')`); await settle();
    assert.equal(await render(`[...document.querySelectorAll('.rail, .rail .logo-copy, .rail .nav-label, .rail .tiny, .rail .status-pill')].every(element=>
      getComputedStyle(element).transitionDuration.split(',').every(duration=>parseFloat(duration)===0))`),true,
      'Collapsing the sidebar snaps structural widths and labels instead of reflowing the page on a slower legacy timeline');
    const arrowTransform = await render(`getComputedStyle(document.getElementById('nav-toggle')).transform`);
    const arrowPress = await pressScale('#nav-toggle');
    assert.equal(arrowPress.active, true); assert(arrowPress.scale>=.97 && arrowPress.scale<.995,'Sidebar action keeps only a small press compression');
    assert.equal(arrowPress.detail.transform, arrowTransform, 'Individual action scale preserves the collapsed arrow direction');
    await render(`document.body.classList.remove('nav-collapsed')`); await settle();
    const tabPress=await pressScale('[data-settings-tab="tracking"]');assert.equal(tabPress.scale,1,'Segment tabs use their highlight rather than press scaling');
    await render(`document.getElementById('poll-mode-select-trigger').scrollIntoView({block:'center'})`); await frame();
    const menuPress=await pressScale('#poll-mode-select-trigger');assert.equal(menuPress.scale,1,'Menu triggers do not scale while the menu opens');
    await key('Escape'); await settle();
    await smoothnessChecks();

    // Visibility and ARIA state must change in the click itself; animation only
    // decorates that completed state and never postpones focus or content.
    await render('window.__motionRecords.length = 0');
    assert.equal(await render(`(() => { const target=document.querySelector('.nav-btn[data-tab="analytics"]'); target.focus({preventScroll:true}); target.click();
      return !document.getElementById('view-analytics').classList.contains('hidden') && document.getElementById('view-settings').classList.contains('hidden') && document.activeElement === target; })()`), true,
      'Page navigation and focus are immediate with motion enabled');
    await frame();
    assert((await records()).some(record => record.id === 'sydtrack-ui-motion' && record.target === 'view-analytics'), 'Page enters with a short module animation');
    await settle();
    await render('window.__motionRecords.length = 0');
    const tabSemantic = await render(`(() => { const button=document.querySelector('[data-segment="week"]'); button.focus({preventScroll:true}); button.click();
      return {active:button.classList.contains('active'), selected:button.getAttribute('aria-selected'),
        shown:!document.getElementById('panel-week').classList.contains('hidden'), focus:document.activeElement===button}; })()`);
    assert.deepEqual(tabSemantic, { active: true, selected: 'true', shown: true, focus: true }, 'Tab semantics and focus commit immediately');
    await frame();
    assert((await records()).some(record => record.id === 'sydtrack-ui-motion' && record.target === 'panel-week'), 'Analytics panel enters smoothly');
    assert((await records()).some(record => record.id === 'sydtrack-ui-motion' && String(record.target).includes('ui-motion-indicator')), 'Selected tab highlight slides');
    await settle();
    const pillGeometry = await render(`(() => {
      const group=document.querySelector('.analytics-toolbar .segment-control'), button=group.querySelector('.segment-btn.active'), pill=group.querySelector('.ui-motion-indicator');
      const a=button.getBoundingClientRect(), b=pill.getBoundingClientRect();
      return {ready:group.dataset.motionPill === 'ready', decorative:pill.getAttribute('aria-hidden')==='true' && pill.tabIndex < 0,
        aligned:Math.abs(a.left-b.left)<2 && Math.abs(a.top-b.top)<2 && Math.abs(a.width-b.width)<2 && Math.abs(a.height-b.height)<2};
    })()`);
    assert.deepEqual(pillGeometry, { ready: true, decorative: true, aligned: true }, 'Decorative highlight settles exactly behind the selected button: ' + JSON.stringify(pillGeometry));

    await render('window.__motionRecords.length=0; document.querySelector(".nav-btn[data-tab=home]").click()');
    await frame();
    const homePie = await render(`(() => {
      const pie=document.getElementById('pie-chart'), cover=pie.querySelector('.ui-motion-pie-cover');
      return {cover:!!cover, decorative:cover?.getAttribute('aria-hidden')==='true', noninteractive:cover && getComputedStyle(cover).pointerEvents==='none',
        role:pie.getAttribute('role'), tabIndex:pie.tabIndex, label:pie.getAttribute('aria-label'), center:pie.closest('.pie-wrap').querySelector('.pie-center')?.textContent.trim(),
        classes:pie.className, background:getComputedStyle(pie).backgroundImage};
    })()`);
    assert(homePie.cover && homePie.decorative && homePie.noninteractive && homePie.role==='button' && homePie.tabIndex===0 &&
      !homePie.label.includes('No time') && homePie.center.length>0,
    'Home pie draws in with an inaccessible noninteractive cover while data and center remain available: ' + JSON.stringify(homePie));
    assert((await records()).some(record => record.id === 'sydtrack-ui-motion' && record.target === 'ui-motion-pie-cover' && record.parent === 'pie-chart' &&
      record.duration >= 200 && record.duration <= 320 && record.frames.some(frame => Object.keys(frame).some(key => key.startsWith('--ui-motion-')))),
    'Home ring uses a real short clockwise conic reveal instead of fading static content');
    await settle();
    assert.equal(await render(`document.querySelectorAll('.ui-motion-pie-cover').length`), 0, 'Completed pie reveal releases its temporary cover');
    await render('window.__motionRecords.length=0'); publish(); await frame();
    assert.equal((await records()).some(record => record.target === 'ui-motion-pie-cover'), false, 'A live stats refresh never replays an existing pie entrance');
    await render(`window.__motionRecords.length=0; document.getElementById('focusboost-btn').click()`);
    await wait(`latestGoalSettings.focusBoost === true`, 'Synthetic FocusBoost toggle did not save'); await frame();
    assert.equal((await records()).some(record=>record.target==='focusboost-btn'),false,
      'FocusBoost does not play a delayed second press after its settings save');
    await render('window.__motionRecords.length=0; document.querySelector(".nav-btn[data-tab=analytics]").click(); document.querySelector("[data-segment=apps]").click()');
    await frame();
    assert((await records()).some(record => record.target === 'ui-motion-pie-cover' && record.parent === 'apps-donut'), 'App-time donut draws in from its real nonempty data');
    assert.equal(await render(`document.getElementById('apps-donut').getAttribute('role')==='img' && !document.getElementById('apps-donut').getAttribute('aria-label').includes('No app time')`), true,
      'Animated Apps donut preserves its real data announcement');
    await settle();
    await render('window.__motionRecords.length=0; document.querySelector("[data-segment=month]").click()');
    await wait(`document.querySelector('#panel-month .pie-chart')?.style.background.includes('conic-gradient')`, 'Month history pie did not arrive');
    await frame();
    assert((await records()).some(record => record.target === 'ui-motion-pie-cover' && String(record.parent).includes('pie-chart')), 'Asynchronously inserted Month pie receives one draw-in');
    await settle();
    await render('window.__motionRecords.length=0'); publish(); await frame();
    assert.equal((await records()).some(record => record.target === 'ui-motion-pie-cover'), false, 'Month live refresh does not replay the existing pie');
    await render('document.querySelector(".nav-btn[data-tab=home]").click()'); await frame();
    assert.equal(await render(`document.getElementById('pie-chart').querySelectorAll('.ui-motion-pie-cover').length`), 1, 'Revisiting a page begins one new real pie reveal');
    await render('document.querySelector(".nav-btn[data-tab=settings]").click()'); await frame();
    assert.equal(await render(`document.getElementById('pie-chart').querySelectorAll('.ui-motion-pie-cover').length`), 0, 'Hiding a pie cancels and removes its reveal immediately');
    emptyApps = true; publish(); await frame();
    await render('window.__motionRecords.length=0; document.querySelector(".nav-btn[data-tab=analytics]").click(); document.querySelector("[data-segment=apps]").click()');
    await frame();
    assert.equal(await render(`document.getElementById('apps-donut').querySelectorAll('.ui-motion-pie-cover').length`), 0, 'An empty Apps donut never sweeps blank data');
    emptyApps = false; publish();
    await wait(`getComputedStyle(document.getElementById('apps-donut')).backgroundImage.includes('conic-gradient')`, 'Synthetic app data did not arrive');
    await frame();
    assert.equal((await records()).filter(record => record.target==='ui-motion-pie-cover' && record.parent==='apps-donut').length, 1,
      'First async data after an empty Apps entrance draws exactly once');
    publish(); await frame();
    assert.equal((await records()).filter(record => record.target==='ui-motion-pie-cover' && record.parent==='apps-donut').length, 1,
      'Later app data updates do not replay or duplicate the sweep');

    await showSettings(); await settle();
    await render('window.__motionRecords.length=0; document.getElementById("poll-mode-select-trigger").scrollIntoView({block:"center"})');
    await frame();
    assert.equal(await render(`(() => { const button=document.getElementById('poll-mode-select-trigger'); button.focus({preventScroll:true}); button.click();
      return !document.getElementById('poll-mode-select-listbox').hidden && button.getAttribute('aria-expanded')==='true' && document.activeElement.id==='poll-mode-select-listbox'; })()`), true,
      'Dropdown semantics and existing listbox focus commit immediately');
    await frame();
    assert((await records()).some(record => record.id === 'sydtrack-ui-motion' && record.target === 'poll-mode-select-listbox'), 'Custom select opens smoothly');
    await key('Escape');
    assert.equal(await render(`document.getElementById('poll-mode-select-listbox').hidden && document.activeElement.id==='poll-mode-select-trigger'`), true, 'Escape dismisses without waiting for animation');
    await frame();
    assert.equal((await moduleAnimations()).some(record => record.target === 'poll-mode-select-listbox'), false, 'Closed popup animation is canceled');

    await render(`document.getElementById('pause-settings-btn').scrollIntoView({block:'center'}); window.__motionRecords.length=0`); await frame();
    assert.equal(await render(`(() => {document.getElementById('pause-settings-btn').click();
      return !document.getElementById('pause-settings-menu').classList.contains('hidden') && document.getElementById('pause-settings-menu').contains(document.activeElement);})()`), true,
      'Pause menu opens and assigns focus immediately');
    await frame();
    assert((await records()).some(record => record.id === 'sydtrack-ui-motion' && record.target === 'pause-settings-menu'), 'Pause menu uses the same short entrance');
    await key('Escape');
    assert.equal(await render(`document.getElementById('pause-settings-menu').classList.contains('hidden')`), true);
    await render(`document.querySelector('[data-settings-tab="notifications"]').click(); document.getElementById('fb-schedule-start-trigger').scrollIntoView({block:'center'})`);
    await settle(); await render('window.__motionRecords.length=0');
    assert.equal(await render(`(() => {document.getElementById('fb-schedule-start-trigger').click();
      return !document.getElementById('fb-schedule-start-popover').hidden && document.getElementById('fb-schedule-start-trigger').getAttribute('aria-expanded')==='true';})()`), true,
      'Schedule picker opens immediately');
    await frame();
    assert((await records()).some(record => record.id === 'sydtrack-ui-motion' && record.target === 'fb-schedule-start-popover'), 'Schedule picker uses the same short entrance');
    await key('Escape');

    await render('window.__motionRecords.length=0');
    for (let attempt = 0; attempt < 10; attempt++) {
      await render(`document.querySelector('[data-settings-tab="${attempt % 2 ? 'tracking' : 'wellbeing'}"]').click()`);
      await frame();
      const active = await moduleAnimations();
      assert(active.length <= 4, 'Rapid switching leaves only the current panel/highlight animations');
      assert(active.every(record => record.duration >= 100 && record.duration <= 220 && record.iterations === 1 && record.delay === 0),
        'Interaction animations are short single-shot motions without delayed input');
    }
    assert((await records()).some(record => record.state === 'idle'), 'Interrupted animations are canceled instead of accumulating');
    await settle(); assert.equal((await moduleAnimations()).length, 0, 'Finished animations release their effects');

    await showSettings(); await settle();
    let releaseHeld;
    heldWrite = new Promise(resolve => { releaseHeld = resolve; });
    before = motionWrites().length;
    await render(`document.getElementById('ui-motion-toggle').click()`);
    await wait(`appearanceSaving && document.getElementById('ui-motion-toggle').disabled && document.getElementById('theme-rotation-toggle').disabled && document.getElementById('theme-rotation-cycle').disabled`, 'Motion pending save did not guard Appearance controls');
    await render(`document.getElementById('ui-motion-toggle').click(); document.querySelector('[data-theme-id="graphite"]').click(); document.getElementById('theme-rotation-toggle').click()`);
    assert.equal(motionWrites().length, before + 1, 'Rapid toggles cannot duplicate a pending settings write');
    assert.equal(writes.at(-1).uiMotionEnabled, false);
    heldWrite = null; releaseHeld(); await expectSaved(false);
    assert.equal(await render(`document.documentElement.dataset.uiMotion !== 'on' && document.querySelectorAll('.ui-motion-indicator').length===0`), true,
      'Disabling clears the runtime, pill decorations, and press presentation');
    assert.equal((await moduleAnimations()).length, 0, 'Disabling cancels all module animations');
    await reload(); await expectSaved(false);
    assert.equal(await render(`document.documentElement.dataset.uiMotion==='on'`), false, 'Disabled preference survives renderer reload');
    await toggleWithSpace(); await expectSaved(true); await reload(); await expectSaved(true);
    await wait(`document.documentElement.dataset.uiMotion==='on'`, 'Enabled saved preference did not restore after reload');
    await showSettings(); await settle();
    await render(`document.querySelector('[data-settings-tab="wellbeing"]').focus({preventScroll:true}); document.querySelector('[data-settings-tab="wellbeing"]').click()`);
    await frame();
    assert((await moduleAnimations()).length > 0, 'A transition is active before the system preference changes');
    const focusBeforeReduction = await render(`document.activeElement.id || document.activeElement.dataset.settingsTab || document.activeElement.tagName`);
    await media('reduce');
    assert.equal(await render(`document.documentElement.dataset.uiMotion==='on'`), false, 'System reduced motion immediately overrides the runtime');
    assert.equal(await render(`document.getElementById('ui-motion-toggle').checked`), true, 'System preference does not change the saved opt-in switch');
    assert.equal(settings.uiMotionEnabled, true);
    assert.equal((await moduleAnimations()).length, 0, 'Reduced motion cancels already-running interactions');
    assert.equal(await render(`document.querySelectorAll('.ui-motion-indicator').length`), 0, 'Reduced motion restores original static highlights');
    assert.equal(await render(`document.activeElement.id || document.activeElement.dataset.settingsTab || document.activeElement.tagName`), focusBeforeReduction, 'Reduced-motion change does not alter focus');
    await render(`window.__motionRecords.length=0; document.querySelector('[data-settings-tab="tracking"]').click();
      document.getElementById('poll-mode-select-trigger').click()`); await frame();
    assert.equal((await records()).length, 0, 'Reduced-motion pages, tabs, and menus are instant');
    await key('Escape');
    await render('document.querySelector(".nav-btn[data-tab=home]").click()'); await frame();
    assert.equal(await render(`document.querySelectorAll('.ui-motion-pie-cover').length`), 0, 'Reduced motion shows complete pie charts without drawing overlays');
    assert.equal((await records()).length, 0, 'Reduced-motion pie charts are instant');
    await media('no-preference');
    assert.equal(await render(`document.documentElement.dataset.uiMotion==='on' && document.getElementById('ui-motion-toggle').checked`), true,
      'Restoring system motion resumes saved opt-in without another write');

    // Resize snaps a highlight to the selected button, rather than animating
    // stale pixel coordinates across responsive layouts.
    await showSettings(); await settle();
    await render(`document.querySelector('[data-settings-tab="notifications"]').click()`); await frame();
    win.setSize(800, 600);
    const [width, height] = win.getContentSize();
    await wait(`Math.abs(innerWidth-${width})<=2 && Math.abs(innerHeight-${height})<=2`, 'Motion viewport did not resize');
    await wait(`(() => {const group=document.querySelector('.settings-toolbar'),active=group.querySelector('.segment-btn.active'),pill=group.querySelector('.ui-motion-indicator');
      const a=active.getBoundingClientRect(),b=pill.getBoundingClientRect();return Math.abs(a.left-b.left)<2 && Math.abs(a.width-b.width)<2;})()`,
    'Live resize listener did not align its indicator');
    await frame();
    assert.equal(await render(`(() => { const group=document.querySelector('.settings-toolbar'), active=group.querySelector('.segment-btn.active'), pill=group.querySelector('.ui-motion-indicator');
      const a=active.getBoundingClientRect(), b=pill.getBoundingClientRect(); return Math.abs(a.left-b.left)<2 && Math.abs(a.width-b.width)<2; })()`), true,
      'Responsive resize snaps the indicator to its current selected tab');
    assert.equal((await moduleAnimations()).some(record => String(record.target).includes('ui-motion-indicator')), false, 'Resize does not animate a stale pill position');

    await showSettings(); await settle();
    for (const theme of THEME_IDS) {
      await render(`uiMotion.setEnabled(false); applyTheme(${JSON.stringify(theme)})`); await frame();
      const native = await render(`(() => {const style=getComputedStyle(document.querySelector('.settings-toolbar .segment-btn.active'));
        return {background:style.backgroundColor,borderColor:style.borderTopColor,borderWidth:style.borderTopWidth,borderStyle:style.borderTopStyle,radius:style.borderRadius};})()`);
      await render('uiMotion.setEnabled(true)'); await frame();
      const decorated = await render(`(() => {const style=getComputedStyle(document.querySelector('.settings-toolbar .ui-motion-indicator'));
        return {background:style.backgroundColor,borderColor:style.borderTopColor,borderWidth:style.borderTopWidth,borderStyle:style.borderTopStyle,radius:style.borderRadius};})()`);
      assert.deepEqual(decorated, native, `${theme}: sliding indicator retains the original final selected-tab colors and border`);
    }
    await render(`applyTheme(${JSON.stringify(settings.theme)})`); await frame();

    win.setSize(1040, 760);
    const [captureWidth, captureHeight] = win.getContentSize();
    await wait(`Math.abs(innerWidth-${captureWidth})<=2 && Math.abs(innerHeight-${captureHeight})<=2`, 'Screenshot viewport did not resize');
    await showSettings(); await settle();
    for (const theme of ['graphite', 'forest']) for (const enabled of [false, true]) {
      await render(`applyTheme(${JSON.stringify(theme)}); syncAppearanceUi({...latestGoalSettings,uiMotionEnabled:${enabled},themeRotationEnabled:${enabled},themeRotationMode:'any'});
        document.getElementById('settings-appearance-card').scrollIntoView({block:'start'}); document.activeElement?.blur()`);
      await settle();
      await appearanceLayout(enabled);
      if (enabled) console.log('ALL optical alignment:', JSON.stringify(await render(`(() => {
        const text=document.querySelector('#theme-rotation-cycle [data-rotation-icon="any"]'),style=getComputedStyle(text),rect=text.getBoundingClientRect();
        const svg=document.querySelector('#theme-rotation-toggle svg').getBoundingClientRect(),context=document.createElement('canvas').getContext('2d');
        context.font=style.fontWeight+' '+style.fontSize+' '+style.fontFamily;const metrics=context.measureText('ALL');
        const baseline=rect.top+(rect.height-metrics.fontBoundingBoxAscent-metrics.fontBoundingBoxDescent)/2+metrics.fontBoundingBoxAscent;
        return {theme:document.documentElement.dataset.theme,font:context.font,ascent:metrics.actualBoundingBoxAscent,descent:metrics.actualBoundingBoxDescent,
          opticalOffset:new DOMMatrixReadOnly(style.transform).f,estimatedInkCenterOffset:baseline+(metrics.actualBoundingBoxDescent-metrics.actualBoundingBoxAscent)/2-(svg.top+svg.bottom)/2};
      })()`)));
      try {
        const file = path.join(temporary, `appearance-${theme}-motion-${enabled ? 'on' : 'off'}.png`);
        fs.writeFileSync(file, (await capture()).toPNG()); console.log('UI motion screenshot:', file);
      } catch (error) { console.warn('Optional appearance screenshot unavailable:', error.message); }
      if (enabled) for (const [mode,label] of [['light','day'],['dark','night']]) {
        await render(`syncAppearanceUi({...latestGoalSettings,uiMotionEnabled:true,themeRotationEnabled:true,themeRotationMode:${JSON.stringify(mode)}})`);
        await settle(); await appearanceLayout(true);
        try {
          const file=path.join(temporary,`appearance-${theme}-${label}.png`);
          fs.writeFileSync(file,(await capture()).toPNG());console.log('UI motion screenshot:',file);
        } catch (error) {console.warn('Optional pool icon screenshot unavailable:',error.message);}
      }
    }
    await render(`syncAppearanceUi({...latestGoalSettings,uiMotionEnabled:true}); document.querySelector('.nav-btn[data-tab="analytics"]').click();
      document.querySelector('[data-segment="apps"]').click()`); await frame();
    await render(`for (const animation of document.getAnimations()) if (animation.id==='sydtrack-ui-motion') {
      if (animation.effect.target.classList.contains('ui-motion-pie-cover')) {animation.pause();animation.currentTime=Number(animation.effect.getTiming().duration)*.4;} else animation.finish();
    }`);
    const partialRing = await render(`(() => {const pie=document.getElementById('apps-donut'),cover=pie.querySelector('.ui-motion-pie-cover'),style=getComputedStyle(cover);
      const angle=parseFloat(style.getPropertyValue('--ui-motion-sweep'));
      return {partial:angle>0 && angle<360,mask:style.maskImage.includes('conic-gradient'),centerAbove:parseInt(getComputedStyle(pie.querySelector('.pie-center')).zIndex)>=1,
        label:pie.getAttribute('aria-label'),center:pie.querySelector('.pie-center').textContent.trim()};})()`);
    assert.equal(partialRing.partial && partialRing.mask && partialRing.centerAbove && partialRing.center.length>0, true,
      'Paused ring sample reveals a real partial sweep while its data and center stay visible');
    try {
      // The angle is paused, so allow its mask to reach a painted frame without
      // consuming the short animation's lifetime in the hidden compositor.
      await render('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const file = path.join(temporary, 'apps-ring-partial.png'); fs.writeFileSync(file, (await capture()).toPNG()); console.log('UI motion screenshot:', file);
    } catch (error) { console.warn('Optional partial ring screenshot unavailable:', error.message); }
    await render(`for (const animation of document.getAnimations()) if (animation.id==='sydtrack-ui-motion') animation.finish()`);
    await settle();
    assert.equal(await render(`document.querySelectorAll('.ui-motion-pie-cover').length`), 0, 'Paused diagnostic sweep releases its cover when finished');
    try {
      const file = path.join(temporary, 'apps-ring-complete.png'); fs.writeFileSync(file, (await capture()).toPNG()); console.log('UI motion screenshot:', file);
    } catch (error) { console.warn('Optional completed ring screenshot unavailable:', error.message); }
    await render(`applyTheme(${JSON.stringify(settings.theme)}); syncAppearanceUi(latestGoalSettings)`); await frame();

    before = motionWrites().length; failNext = true; await toggleWithSpace();
    await wait(`!appearanceSaving && document.getElementById('appearance-status').textContent.includes('Could not save')`, 'Failed disabling did not settle/report');
    assert.equal(settings.uiMotionEnabled, true);
    assert.equal(await render(`document.getElementById('ui-motion-toggle').checked && document.documentElement.dataset.uiMotion==='on'`), true,
      'Failed disabling restores the confirmed on state');
    assert.equal(motionWrites().length, before + 1);
    await toggleWithSpace(); await expectSaved(false); await settle();
    await render('window.__motionRecords.length=0; document.querySelector(".nav-btn[data-tab=home]").click()'); await frame();
    assert.equal((await records()).length, 0, 'Disabled interactions return completely to instant presentation');
    await render('uiMotion.setEnabled(true); document.querySelector(".nav-btn[data-tab=settings]").click()'); await frame();
    assert.equal(await render(`uiMotion.enabled && document.documentElement.dataset.uiMotion==='on'`), true, 'Reusable controller can be enabled independently');
    await render('uiMotion.dispose(); window.__motionRecords.length=0');
    assert.equal(await render(`document.documentElement.dataset.uiMotion!=='on' && document.querySelectorAll('.ui-motion-indicator,.ui-motion-pie-cover').length===0`), true,
      'Disposal cancels and removes all decorative presentation');
    await render('document.querySelector(".nav-btn[data-tab=home]").click()'); await frame();
    assert.equal((await records()).length, 0, 'Disposed controller no longer observes navigation');
    assert.deepEqual(errors, [], 'No unexpected renderer errors');
    console.log('UI motion checks passed: responsive Appearance heading actions/full-width motion row, Night→Day→All cycle/single-write/shared-pending, default off, native Space/failure/reload, immediate page/tab/menu semantics, high-opacity non-compounding panel entrances, quiet navigation/menu presses, subtle action press without stacked transforms or delayed FocusBoost replay, interruption-continuous transform-only highlights unchanged by unrelated groups/popups/live updates, inserted-tab geometry/single-button cleanup/stable selected tint, real Home/Apps/async-Month/geometry-ready pie reveal without replaying live updates, live reduced-motion override, and responsive resize');
    win.destroy(); app.quit();
  } catch (error) {
    console.error(error);
    win.destroy(); app.exit(1);
  }
}).catch(error => { console.error(error); app.exit(1); });
