# Packaging and signing

sydtrack installers are built with [electron-builder](https://www.electron.build/). Builds are unsigned and do not publish an auto-update feed. The update checker reads public GitHub release metadata on demand, or once a day if the user opts in. Automatic checks are off by default; no activity data is sent. It opens a validated release page for manual download and never downloads or installs updates itself.

```bash
npm run dist:win      # NSIS installer + portable exe
npm run dist:mac      # dmg + zip
npm run dist:linux    # AppImage + deb
npm run pack          # unpacked dir for the current OS
npm run dist:portable # Windows portable exe only
npm run test:packaged # inspect + smoke-test extracted Windows payloads (Node 22+)
```

`scripts/dist.js` strips `GH_TOKEN` / `GITHUB_TOKEN` before invoking electron-builder so a CI token cannot publish a GitHub release.

`test:packaged` extracts both artifacts into a new temporary folder without executing their installer/portable wrappers. It compares the bundled source and versions, then launches each extracted application under the main-process debugger with temporary app/user-data paths and startup-registration writes intercepted before application code runs. Tracking stays paused; fixtures contain no personal activity. The test covers first run, the hardened renderer/preload, Home and Analytics corrections/Undo, preserved fixture history, theme/pause persistence, and a public GitHub version check. It requires Windows and Node.js 22+ for the diagnostic's WebSocket client; the app's normal source/build requirement remains Node.js 18+.

This is not an installer acceptance test. Before publishing, manually validate setup installation/upgrading, portable-wrapper launch, tray/login behavior, and real lock/sleep/resume using the [lifecycle guide](../docs/manual-lifecycle-validation.md). See [Electron's main-process debugging documentation](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process) for the inspector switches used only by the test.

## Signing later

Leave secrets out of the repo. When you have certificates, set `SYDTRACK_SIGN=1` and the builder config turns Windows signing and macOS hardened runtime on.

Windows (Authenticode):

- `CSC_LINK` — path or `file://` URL to the `.pfx`, or a base64 certificate
- `CSC_KEY_PASSWORD` — certificate password

macOS (Developer ID):

- `CSC_LINK` / `CSC_KEY_PASSWORD`, or `CSC_NAME` for a certificate already in the keychain
- `build/entitlements.mac.plist` is applied only when `SYDTRACK_SIGN=1`
- Notarization is left off. To notarize later, set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`, and change `notarize` in `build/electron-builder.config.js`

Without `SYDTRACK_SIGN=1`, macOS uses `identity: null` and Windows remains unsigned. Windows resource editing stays enabled so the executable still receives sydtrack’s icon and version metadata; it does not require a certificate.
