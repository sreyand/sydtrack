'use strict';

// Thin wrapper around package.json "build". Unsigned unless SYDTRACK_SIGN=1.
const base = JSON.parse(JSON.stringify(require('../package.json').build));
const sign = process.env.SYDTRACK_SIGN === '1';

base.publish = null;
base.win = Object.assign({}, base.win, { signAndEditExecutable: sign });
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
