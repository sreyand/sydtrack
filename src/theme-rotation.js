'use strict';

const { THEME_IDS, normalizeTheme, isDarkTheme } = require('./theme');

const MODES = new Set(['dark', 'light', 'any']);
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeRotationMode(value) {
  return MODES.has(value) ? value : 'dark';
}

function poolForMode(value) {
  const mode = normalizeRotationMode(value);
  return THEME_IDS.filter((id) => mode === 'any' || isDarkTheme(id) === (mode === 'dark'));
}

function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = new Date(value + 'T00:00:00Z');
  return Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

// Dates are supplied by the caller in the local calendar. Use UTC only to
// subtract those calendar labels, never elapsed local-midnight milliseconds.
function dateOrdinal(date) {
  return new Date(date + 'T00:00:00Z').getTime() / DAY_MS;
}

function millisecondsUntilNextDay(nowDate) {
  if (!(nowDate instanceof Date) || !Number.isFinite(nowDate.getTime())) return 60 * 1000;
  const next = new Date(nowDate.getTime());
  next.setHours(24, 0, 0, 0);
  const remaining = next.getTime() - nowDate.getTime();
  return Number.isFinite(remaining) ? Math.max(1, remaining) : 60 * 1000;
}

function initializeThemeRotation(settings, today) {
  if (!validDateKey(today)) return {};
  const source = settings && typeof settings === 'object' ? settings : {};
  const mode = normalizeRotationMode(source.themeRotationMode);
  const pool = poolForMode(mode);
  const current = normalizeTheme(source.theme);
  const theme = pool.includes(current) ? current : pool[0];
  return {
    theme,
    themeRotationMode: mode,
    themeRotationAnchorDate: today,
    themeRotationAnchorTheme: theme
  };
}

// Return only values main must persist. The original anchor never advances:
// restarts, skipped dates, and a backward clock all resolve the same calendar
// date to the same theme. Initialization is explicitly allowed while disabled
// so main can prepare a single atomic enabling/mode-change settings patch.
function resolveDailyTheme(settings, today) {
  const source = settings && typeof settings === 'object' ? settings : {};
  if (source.themeRotationEnabled !== true || !validDateKey(today)) return {};
  const mode = normalizeRotationMode(source.themeRotationMode);
  const pool = poolForMode(mode);
  const anchorDate = source.themeRotationAnchorDate;
  const anchorIndex = pool.indexOf(source.themeRotationAnchorTheme);
  if (!validDateKey(anchorDate) || anchorIndex < 0) return initializeThemeRotation(source, today);

  const offset = dateOrdinal(today) - dateOrdinal(anchorDate);
  const index = ((anchorIndex + offset) % pool.length + pool.length) % pool.length;
  const theme = pool[index];
  const patch = {};
  if (source.theme !== theme) patch.theme = theme;
  if (source.themeRotationMode !== mode) patch.themeRotationMode = mode;
  return patch;
}

module.exports = {
  poolForMode,
  normalizeRotationMode,
  validDateKey,
  millisecondsUntilNextDay,
  initializeThemeRotation,
  resolveDailyTheme
};
