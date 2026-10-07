# v2.6.0 rebuild validation — 2026-10-07

Rebuilt setup and portable files include the earlier UI-motion refinements. These replace the earlier local v2.6.0 packages; no installation or publication was performed. Subsequent tab-flicker fixes are included in v2.6.1, not these v2.6.0 files.

## Artifacts

- `dist/sydtrack-2.6.0-setup.exe` — 78,458,870 bytes; SHA-256 `3fa39fb106127af75ac462d1ddaa84efacba7612a1d0eaafbb7277580793282e`.
- `dist/sydtrack-2.6.0-portable.exe` — 78,192,653 bytes; SHA-256 `dad51aa6731c54a260259f4a034cce26164c28ca46c24a7c1a943e7f35199d83`.
- `dist/sydtrack-2.6.0-setup.exe.blockmap` — 83,089 bytes; SHA-256 `8b52428d0ada0782c88a39b7cbc35875b2d7eb0098e4e7a06ec1faa919a7b187`.

Checksums are in `dist/SHA256SUMS-2.6.0.txt` and verified against all three files. Both executables report **2.6.0** and are **NotSigned**.

Setup and portable contain identical source-matching archives: `2afa9a351c68197b1706a3a261bc17704511cd8ae505f8b7c27366afb47fd733`. Each contains 921 files, including 81 source/renderer files and 23 required feature files.

## Checks

- `npm test` passed, including 106 syntax checks.
- `npm run test:packaged` passed for fresh launch and restart of both extracted apps.
- `npm run test:ui` passed on a sequential rerun. The initial concurrent run failed to open one dropdown; no product changes were required.
- Package and lockfile versions remain 2.6.0; no dependencies were upgraded.

Packaged checks use the real main process, preload, and protected app protocol with temporary data, paused tracking, and intercepted startup/hotkey registrations. They verify saved motion, reduced motion, theme rotation, custom menus, shortcuts, history, Undo, and focusscore navigation. Installer/portable wrappers were not executed.

## Before publication

Manually test setup upgrade, portable launch, actual shortcuts, tray/display scaling, and lock/sleep/resume using the [lifecycle guide](manual-lifecycle-validation.md). Confirm retained data and live tracking.

The previously reported Windows foreground-backend warning remains unchanged. Automated checks do not establish real tracking health on the affected machine. Classification and Focus Share are unchanged; focusstreak is not included.
