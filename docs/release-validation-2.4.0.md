# v2.4.0 release preparation — 2026-10-01

Status: Windows x64 setup and portable artifacts prepared and automatically checked locally. No Git commit, tag, release, upload, or installation was performed by this preparation pass. Manual acceptance remains before publication.

## Artifacts

- `dist/sydtrack-2.4.0-setup.exe` — 78,438,226 bytes; SHA-256 `475a9b2750f75947500134716b8d0a53edede503e7dafc07ef781da8f5cb83d1`.
- `dist/sydtrack-2.4.0-portable.exe` — 78,172,088 bytes; SHA-256 `09c49163a6b2a5b29ec0c4eabe2a117ddfc066913521f83a093a36ca799b363d`.
- `dist/sydtrack-2.4.0-setup.exe.blockmap` — 82,848 bytes; SHA-256 `ebba294b30df4adced896f59621b4f89dbe5c90170c3fe0b84eb28dd732ec3a6`.
- `dist/SHA256SUMS-2.4.0.txt` records these hashes for distribution. The blockmap does not enable automatic downloads or installation.

Both executables report 2.4.0 in Windows product/file metadata and are **NotSigned**. Setup and portable contain identical `app.asar` payloads, SHA-256 `7d6175038c663b9d13889c07dcf5be0afdeaf6f5518bb78f73a6e56f75ec3f8a`.

The frozen v2.3.0 setup and portable files still match their [recorded hashes](release-validation-2.3.0.md); neither was rebuilt or replaced.

## Completed checks

- Package and lockfile versions agree on 2.4.0. Dependencies were not upgraded. README, [release notes](release-notes-2.4.0.md), ITERATION, and manual validation guidance reflect this release, with publication clearly pending.
- Windows setup and portable packaging completed with publication disabled. All 72 source/renderer files in each archive match the working source. The explanation modules and all four tray logos are included; development data, test scripts, Git contents, and stale native-build backups are absent.
- Both packages include the Windows native binding, foreground/address probe resources, and shell icon. All four tray PNGs decode successfully through Electron from the packaged archive.
- `npm test`, `npm run test:ui`, `npm run test:profiles-ui`, `npm run test:tray-native`, and `npm run test:packaged` passed. `git diff --check` passed with the repository's line-ending safety override. Tests use temporary data and synthetic activity.
- The packaged diagnostic launches the extracted application with the production main process, preload, protected `sydtrack://app` protocol, context isolation, and sandbox. An inspector pause isolates app/user-data and intercepts startup-registration writes before app code runs. Tracking stays paused; the user's installed app and personal history are left alone.
- The new formatter and category UI actually execute through the production protocol. An initial check caught the formatter missing from the protected file allowlist; the final build allows that exact shared script, with regression coverage confirming unrelated source modules remain inaccessible.
- Packaged checks verify the actual winning keyword rather than a subreddit grouping label, tooltip accessibility attributes, hover/click/Escape handlers, dated today-only corrections, Other/Ignore explanations, stale metadata disabling, the cleaner rule editor, actual saved-profile confirmation, and Home save/Undo through the production preload. The hidden-window fixture explicitly dispatches a focus event when its document is inactive; real keyboard interaction remains a manual acceptance check.
- Fresh onboarding, eight available themes, saved theme/pause/rules across restart, existing synthetic history, and Analytics correction/Undo passed for both extracted payloads. Source UI checks additionally cover 800/1040/1600px layouts and explanation contrast across all eight themes.
- The isolated native tray check covers all four logos, 1x/2x/3x images, category switching, pause/resume, synthetic lock handling, and disposal. It does not establish actual Windows overflow placement, display scaling, or real power-event behavior.
- Explicit GitHub metadata checks from both extracted apps succeeded: current version 2.4.0, highest published stable version 2.3.0, no newer release available. Automatic checks stayed off. No release page was opened and nothing was downloaded or installed.

The payload diagnostic does **not** execute the NSIS setup or portable wrapper. It is not an installer, startup-registration, SmartScreen, real foreground-tracking, or real sleep/lock acceptance test. This release explains existing category decisions; it does not claim an increase in classification accuracy or whole-app performance.

## Before publication

1. Quit the existing app from its tray, then check a real setup upgrade and portable-wrapper launch. Confirm existing activity, profiles, settings, and sessions remain intact and startup points to the intended executable.
2. Follow [Windows lifecycle validation](manual-lifecycle-validation.md), including real foreground switching, pause, lock/unlock, sleep/wake, tray colors/hover/menu, display scaling, and Home explanations with keyboard interaction.
3. Check a recognizable source/topic conflict, a neutral exception, a today-only correction, a future rule, and Undo using the [Focus profile guide](manual-focus-profiles-validation.md). Do not clear personal history or change the system clock to test them.
4. After acceptance and explicit publication approval, remove publication-pending wording, commit/tag the approved source, and upload setup, portable, and checksums with the release notes. No further feature work is required for this release candidate.
