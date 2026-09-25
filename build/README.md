# Packaging and signing

SydTrack installers are built with [electron-builder](https://www.electron.build/). Builds are unsigned and do not publish an auto-update feed. Nothing in the packaged app phones home.

```bash
npm run dist:win      # NSIS installer + portable exe
npm run dist:mac      # dmg + zip
npm run dist:linux    # AppImage + deb
npm run pack          # unpacked dir for the current OS
npm run dist:portable # Windows portable exe only
```

`scripts/dist.js` strips `GH_TOKEN` / `GITHUB_TOKEN` before invoking electron-builder so a CI token cannot publish a GitHub release.

## Signing later

Leave secrets out of the repo. When you have certificates, set `SYDTRACK_SIGN=1` and the builder config turns Windows signing and macOS hardened runtime on.

Windows (Authenticode):

- `CSC_LINK` — path or `file://` URL to the `.pfx`, or a base64 certificate
- `CSC_KEY_PASSWORD` — certificate password

macOS (Developer ID):

- `CSC_LINK` / `CSC_KEY_PASSWORD`, or `CSC_NAME` for a certificate already in the keychain
- `build/entitlements.mac.plist` is applied only when `SYDTRACK_SIGN=1`
- Notarization is left off. To notarize later, set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`, and change `notarize` in `build/electron-builder.config.js`

Without `SYDTRACK_SIGN=1`, macOS uses `identity: null` and Windows remains unsigned. Windows resource editing stays enabled so the executable still receives SydTrack’s icon and version metadata; it does not require a certificate.
