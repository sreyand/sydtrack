'use strict';

// Keep the Windows application identity available at runtime. electron-builder
// strips development-only package.json fields (including `build`) from the
// packaged app manifest, so startup code must not read build.appId there.
const APP_ID = 'com.gitpaperclip.sydtrack';

module.exports = { APP_ID };
