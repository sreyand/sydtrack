'use strict';

(() => {
  const chip = $('lf-cat'), tip = $('lf-explanation');
  let text = '', key = '', pinned = false, closeTimer = null;
  function hide() {
    clearTimeout(closeTimer);
    pinned = false;
    tip.classList.add('hidden');
    chip.setAttribute('aria-expanded', 'false');
    chip.removeAttribute('aria-describedby');
  }
  function place() {
    const anchor = chip.getBoundingClientRect(), rect = tip.getBoundingClientRect(), pad = 12;
    const left = Math.max(pad, Math.min(anchor.left, window.innerWidth - rect.width - pad));
    const below = anchor.bottom + 8;
    const top = below + rect.height <= window.innerHeight - pad ? below : anchor.top - rect.height - 8;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(pad, Math.min(top, window.innerHeight - rect.height - pad)) + 'px';
  }
  function show() {
    clearTimeout(closeTimer);
    if (!text || chip.disabled || $('view-home').classList.contains('hidden')) return;
    $('lf-explanation-text').textContent = text;
    tip.classList.remove('hidden');
    chip.setAttribute('aria-expanded', 'true');
    chip.setAttribute('aria-describedby', 'lf-explanation-text');
    place();
  }
  function maybeHide() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!pinned && document.activeElement !== chip && !chip.matches(':hover') && !tip.matches(':hover')) hide();
    }, 120);
  }
  function update(entry) {
    const info = entry?.explanation;
    const nextText = info && info.category === entry?.category
      ? window.sydtrackClassificationExplanation.formatExplanation(info, { demo: entry.source === 'demo' }) : '';
    const nextKey = JSON.stringify([entry?.app, entry?.title, entry?.category, nextText]);
    if (nextKey !== key) hide();
    key = nextKey;
    text = nextText;
    chip.disabled = !text;
    chip.setAttribute('aria-label', text ? entry.category + '. Why this category?' : 'Category explanation unavailable');
  }
  chip.addEventListener('mouseenter', show);
  chip.addEventListener('mouseleave', maybeHide);
  chip.addEventListener('focus', show);
  chip.addEventListener('blur', () => { pinned = false; maybeHide(); });
  chip.addEventListener('click', () => { if (pinned) hide(); else { pinned = true; show(); } });
  tip.addEventListener('mouseenter', () => clearTimeout(closeTimer));
  tip.addEventListener('mouseleave', maybeHide);
  document.addEventListener('pointerdown', event => { if (!chip.contains(event.target) && !tip.contains(event.target)) hide(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !tip.classList.contains('hidden')) { hide(); event.preventDefault(); }
  });
  document.querySelectorAll('.nav-btn').forEach(button => button.addEventListener('click', hide));
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
  document.addEventListener('scroll', hide, true);
  window.sydtrackCategoryUI = { update, hide };
  update(lastFocusedCache);
})();
