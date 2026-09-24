'use strict';

const CHANNELS = [
  'state:get',
  'apps:correctActivityToday',
  'apps:correctToday',
  'history:summary',
  'rules:get',
  'rules:set',
  'rules:reset',
  'ignore:get',
  'ignore:set',
  'ignore:reset',
  'profiles:get',
  'profiles:save',
  'profiles:activate',
  'profiles:delete',
  'profiles:import',
  'settings:update',
  'data:export',
  'data:import',
  'profile:export',
  'profile:import',
  'data:clearToday',
  'data:clearAll',
  'session:start',
  'session:stop',
  'session:getActive',
  'session:getForDay',
  'session:delete'
];

const PROFILE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SESSION_ID = /^s_[0-9a-z]{1,24}_[0-9a-z]{1,16}$/;
const CATEGORIES = new Set(['productive', 'unproductive', 'ignored', 'other']);
const SESSION_MODES = new Set(['pomodoro', 'deep', 'custom']);

function invalid() {
  throw new Error('Invalid IPC payload');
}

function finiteInt(value, min, max) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) invalid();
  return value;
}

function bool(value) {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) invalid();
  return value;
}

function assertKeys(obj, allowed) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) invalid();
  }
}

function stringList(value) {
  if (!Array.isArray(value) || value.length > 1000) invalid();
  for (const item of value) {
    if (typeof item !== 'string' || item.length > 200 || item.includes('\0')) invalid();
  }
  return value.slice();
}

function optionalProfileId(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !PROFILE_ID.test(value)) invalid();
  return value;
}

function requiredProfileId(value) {
  if (typeof value !== 'string' || !PROFILE_ID.test(value)) invalid();
  return value;
}

function category(value) {
  if (typeof value !== 'string' || !CATEGORIES.has(value)) invalid();
  return value;
}

function activityId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) invalid();
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (_) {
    invalid();
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) invalid();
  for (const part of parsed) {
    if (typeof part !== 'string' || part.length > 500 || part.includes('\0')) invalid();
  }
  return value;
}

function appName(value) {
  if (typeof value !== 'string' || value.length > 500 || !value.trim() || value.includes('\0')) invalid();
  return value;
}

function message(value) {
  if (typeof value !== 'string' || value.length > 2000 || value.includes('\0')) invalid();
  return value;
}

function clock(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) invalid();
  return value;
}

function isDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function profileName(value) {
  if (typeof value !== 'string' || value.length > 80 || value.includes('\0')) invalid();
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 40) invalid();
  return value;
}

function noPayload(payload) {
  if (payload !== undefined) invalid();
  return undefined;
}

function activityCorrection(payload) {
  const obj = plainObject(payload);
  assertKeys(obj, ['id', 'category']);
  if (!Object.hasOwn(obj, 'id') || !Object.hasOwn(obj, 'category')) invalid();
  return { id: activityId(obj.id), category: category(obj.category) };
}

function appCorrection(payload) {
  const obj = plainObject(payload);
  assertKeys(obj, ['name', 'category']);
  if (!Object.hasOwn(obj, 'name') || !Object.hasOwn(obj, 'category')) invalid();
  return { name: appName(obj.name), category: category(obj.category) };
}

function historyDays(payload) {
  return finiteInt(payload, 1, 90);
}

function rulesSet(payload) {
  const obj = plainObject(payload);
  assertKeys(obj, ['productive', 'unproductive', 'profileId']);
  if (!Object.hasOwn(obj, 'productive') || !Object.hasOwn(obj, 'unproductive')) invalid();
  const out = {
    productive: stringList(obj.productive),
    unproductive: stringList(obj.unproductive)
  };
  if (Object.hasOwn(obj, 'profileId')) out.profileId = optionalProfileId(obj.profileId);
  return out;
}

function resetProfile(payload) {
  if (payload === undefined) return null;
  return optionalProfileId(payload);
}

function ignoreSet(payload) {
  const obj = plainObject(payload);
  assertKeys(obj, ['ignore', 'profileId']);
  if (!Object.hasOwn(obj, 'ignore')) invalid();
  const out = { ignore: stringList(obj.ignore) };
  if (Object.hasOwn(obj, 'profileId')) out.profileId = optionalProfileId(obj.profileId);
  return out;
}

function profileFields(value) {
  const obj = plainObject(value);
  assertKeys(obj, ['name', 'productive', 'unproductive', 'ignore']);
  if (!Object.keys(obj).length) invalid();
  const out = {};
  if (Object.hasOwn(obj, 'name')) out.name = profileName(obj.name);
  for (const field of ['productive', 'unproductive', 'ignore']) {
    if (Object.hasOwn(obj, field)) out[field] = stringList(obj[field]);
  }
  return out;
}

function profilesSave(payload) {
  const obj = plainObject(payload);
  assertKeys(obj, ['id', 'fields']);
  if (!Object.hasOwn(obj, 'id') || !Object.hasOwn(obj, 'fields')) invalid();
  return { id: optionalProfileId(obj.id), fields: profileFields(obj.fields) };
}

const SETTINGS = {
  thresholdSec: (value) => finiteInt(value, 1, 86400),
  focusBoost: bool,
  focusBoostRestoreSec: (value) => (value === null ? null : finiteInt(value, 1, 86400)),
  focusBoostSec: (value) => finiteInt(value, 5, 86400),
  idleTimeoutSec: (value) => finiteInt(value, 0, 7 * 86400),
  reminderMessage: message,
  focusBoostReminderMessage: message,
  dailyGoalSec: (value) => finiteInt(value, 900, 57600),
  trackingPaused: bool,
  notificationsEnabled: bool,
  focusBoostScheduleEnabled: bool,
  focusBoostScheduleStart: clock,
  focusBoostScheduleEnd: clock,
  sessionCustomMin: (value) => finiteInt(value, 1, 1440),
  sessionHistoryEnabled: bool
};

function settingsUpdate(payload) {
  const obj = plainObject(payload);
  assertKeys(obj, Object.keys(SETTINGS));
  const out = {};
  for (const key of Object.keys(obj)) out[key] = SETTINGS[key](obj[key]);
  return out;
}

function optionalObject(payload) {
  if (payload == null) return {};
  return plainObject(payload);
}

function dataExport(payload) {
  const obj = optionalObject(payload);
  assertKeys(obj, ['includeSettings', 'includeRules', 'includeIgnore']);
  const out = {};
  for (const key of ['includeSettings', 'includeRules', 'includeIgnore']) {
    if (Object.hasOwn(obj, key)) out[key] = bool(obj[key]);
  }
  return out;
}

function dataImport(payload) {
  const obj = optionalObject(payload);
  assertKeys(obj, ['mode']);
  const out = {};
  if (Object.hasOwn(obj, 'mode')) {
    if (obj.mode !== 'merge' && obj.mode !== 'replace') invalid();
    out.mode = obj.mode;
  }
  return out;
}

function profileExport(payload) {
  const obj = optionalObject(payload);
  assertKeys(obj, ['id', 'name']);
  const out = {};
  if (Object.hasOwn(obj, 'id')) out.id = requiredProfileId(obj.id);
  if (Object.hasOwn(obj, 'name')) out.name = profileName(obj.name);
  return out;
}

function sessionStart(payload) {
  const obj = optionalObject(payload);
  assertKeys(obj, ['mode', 'customMin']);
  const out = {};
  if (Object.hasOwn(obj, 'mode')) {
    if (!SESSION_MODES.has(obj.mode)) invalid();
    out.mode = obj.mode;
  }
  if (Object.hasOwn(obj, 'customMin')) out.customMin = finiteInt(obj.customMin, 1, 1440);
  return out;
}

function optionalDate(payload) {
  if (payload == null) return null;
  if (!isDateKey(payload)) invalid();
  return payload;
}

function sessionDelete(payload) {
  const obj = plainObject(payload);
  assertKeys(obj, ['id', 'dateKey']);
  if (typeof obj.id !== 'string' || !SESSION_ID.test(obj.id)) invalid();
  const out = { id: obj.id };
  if (Object.hasOwn(obj, 'dateKey') && obj.dateKey != null) {
    if (!isDateKey(obj.dateKey)) invalid();
    out.dateKey = obj.dateKey;
  }
  return out;
}

const VALIDATORS = {
  'state:get': noPayload,
  'apps:correctActivityToday': activityCorrection,
  'apps:correctToday': appCorrection,
  'history:summary': historyDays,
  'rules:get': noPayload,
  'rules:set': rulesSet,
  'rules:reset': resetProfile,
  'ignore:get': noPayload,
  'ignore:set': ignoreSet,
  'ignore:reset': resetProfile,
  'profiles:get': noPayload,
  'profiles:save': profilesSave,
  'profiles:activate': requiredProfileId,
  'profiles:delete': requiredProfileId,
  'profiles:import': noPayload,
  'settings:update': settingsUpdate,
  'data:export': dataExport,
  'data:import': dataImport,
  'profile:export': profileExport,
  'profile:import': noPayload,
  'data:clearToday': noPayload,
  'data:clearAll': noPayload,
  'session:start': sessionStart,
  'session:stop': noPayload,
  'session:getActive': noPayload,
  'session:getForDay': optionalDate,
  'session:delete': sessionDelete
};

function validateIpcPayload(channel, payload) {
  const validator = VALIDATORS[channel];
  if (!validator) throw new Error('Unknown IPC channel');
  return validator(payload);
}

module.exports = {
  channels: CHANNELS,
  validateIpcPayload
};
