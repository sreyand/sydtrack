'use strict';

// Thin wrapper around package.json "build". Unsigned unless SYDTRACK_SIGN=1.
const base = JSON.parse(JSON.stringify(require('../package.json').build));
const { APP_ID } = require('../src/app-identity');
const sign = process.env.SYDTRACK_SIGN === '1';

base.appId = APP_ID;
base.publish = null;
base.linux = Object.assign({}, base.linux, {
  maintainer: 'SydTrack <noreply@sydtrack.app>'
});
// Resource editing embeds the product icon/version even for unsigned builds.
// electron-builder signs only when certificate credentials are available.
base.win = Object.assign({}, base.win, { signAndEditExecutable: true });
base.mac = Object.assign({}, base.mac, {
  hardenedRuntime: sign,
  gatekeeperAssess: false,
  notarize: false
});

if (sign) {
  delete base.mac.identity;
  base.mac.entitlements = 'build/entitlements.mac.plist';
  base.mac.entitlementsInherit = 'build/entitlements.mac.plist';
} else {
  base.mac.identity = null;
}

module.exports = base;
