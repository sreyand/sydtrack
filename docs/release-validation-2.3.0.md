# v2.3.0 release preparation — 2026-09-30

Status: Windows x64 artifacts prepared locally. No Git tag, commit, release, or upload was created by this preparation pass. Manual acceptance checks below remain before publication.

## Artifacts

- `dist/sydtrack-2.3.0-setup.exe` — 77,775,253 bytes; SHA-256 `337e0a4457de89c70c388e023ab08fdd1fec36ec71096a09cfb9f3de4c3228da`.
- `dist/sydtrack-2.3.0-portable.exe` — 77,509,048 bytes; SHA-256 `8eb8c516a32fa2e5fcd66c1744034a12b35d31f285a6264d5a3f221e4c33699a`.
- `dist/sydtrack-2.3.0-setup.exe.blockmap` — SHA-256 `8097e8c8e1ab00b8bb950aeaf87575c6e8b9b4dec7279a1c549435aeea1142e3`.
- `dist/SHA256SUMS-2.3.0.txt` records these hashes for distribution.

Both executables report v2.3.0 in their Windows product/file metadata and are unsigned. The setup and portable payloads contain the same `app.asar`, SHA-256 `1fedeaf22fcd78371a656f2fac43a112272e1c3bedfc303ff7065ef32019e7fa`.

## Completed checks

- Package and lockfile root versions agree on 2.3.0. Dependency versions were not upgraded.
- README, release notes, privacy/update wording, packaging instructions, and ITERATION status were updated. Historical release notes remain unchanged.
- `npm run dist:win` completed successfully with publication disabled. Older versioned setup/portable files were preserved. Stale native-build `.DELETE.*` backups are excluded from the final artifacts.
- `npm test`, `npm run test:ui`, and `npm run test:profiles-ui` passed for v2.3.0. These use temporary data and synthetic fixtures.
- `npm run test:packaged` passed against the actual extracted setup and portable payloads. All 65 source/renderer files matched the working source; the archive contains no development activity data, test scripts, or Git directory. Windows native bindings and the foreground-probe resource are present.
- Each extracted app was launched with the production main process, preload, protocol, and sandbox. The diagnostic used an inspector pause before app code to set temporary app/user-data paths and intercept login-startup writes. Tracking remained paused; personal activity and startup registration were not modified.
- Packaged checks covered fresh onboarding, all eight theme choices, P/U/O rule saving, Home Undo, seeded-history preservation, Analytics correction/Undo, and theme/pause/rule persistence across restart.
- Manual GitHub metadata checks from both packaged payloads succeeded: installed 2.3.0, highest published stable version 2.2.1, no newer release available. Automatic checking stayed off. The release page was not opened and nothing was downloaded or installed by the checker.
- `git diff --check` passed.

The payload diagnostic does **not** execute the NSIS setup or portable wrapper. It is not evidence that installation, startup registration, Windows SmartScreen, or real power events have been manually validated.

## Before publication

1. Quit the existing app from its tray, then check a real setup installation/upgrade and portable-wrapper launch. Confirm existing activity/settings remain available, tray controls work, and open-at-login points to the chosen installation or portable file.
2. Follow [Windows lifecycle validation](manual-lifecycle-validation.md), especially real foreground switching, lock/unlock, sleep/wake, pause, and session recovery. Do not clear personal history or change the system clock for testing.
3. Run the [Focus profile validation](manual-focus-profiles-validation.md) with real titles, especially source/topic conflicts and specific exceptions. Confirm today's corrections and future rules have the intended scope.
4. After acceptance, remove the temporary publication-pending wording from README/release notes, commit/tag the approved source, and publish the release with setup, portable, and checksum files. Publication needs explicit user authorization.

Do not present the optional update checker as automatic installation or title classification as proof of intent.
