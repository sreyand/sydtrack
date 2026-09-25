'use strict';

function electronLaunchArgs({ platform, env, appPath, extra }) {
  const flags = ['--disable-gpu'];
  const headless = platform === 'linux' && !env.DISPLAY;
  // Headless containers often cannot create the Chromium sandbox. Packaged
  // apps and normal desktops keep it enabled.
  if (env.SYDTRACK_NO_SANDBOX === '1' || headless) {
    flags.unshift('--no-sandbox', '--disable-dev-shm-usage');
  }
  return {
    args: [appPath].concat(flags, extra || []),
    headless
  };
}

module.exports = { electronLaunchArgs };
