'use strict';

const HIDDEN_ARG = '--hidden';

function supportsLoginItems(platform) {
  return platform === 'win32' || platform === 'darwin';
}

function loginItemOptions({ enabled, platform, isPackaged, execPath, env = {} }) {
  if (!supportsLoginItems(platform) || !isPackaged) return null;
  const openAtLogin = enabled !== false;
  if (platform === 'win32') {
    return {
      openAtLogin,
      enabled: openAtLogin,
      path: env.PORTABLE_EXECUTABLE_FILE || execPath,
      args: [HIDDEN_ARG]
    };
  }
  return { openAtLogin, openAsHidden: openAtLogin };
}

function syncLoginItem(appApi, enabled, context) {
  const options = loginItemOptions({ enabled, ...context });
  if (!options) return { supported: false, enabled: false };
  appApi.setLoginItemSettings(options);
  return { supported: true, enabled: options.openAtLogin, options };
}

function shouldStartHidden({ argv = [], platform, appApi }) {
  if (argv.includes(HIDDEN_ARG)) return true;
  if (platform !== 'darwin' || !appApi || typeof appApi.getLoginItemSettings !== 'function') return false;
  try {
    return appApi.getLoginItemSettings().wasOpenedAsHidden === true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  HIDDEN_ARG,
  supportsLoginItems,
  loginItemOptions,
  syncLoginItem,
  shouldStartHidden
};
