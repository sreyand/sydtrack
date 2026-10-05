# v2.5.0 release preparation — 2026-10-05

Status: Windows x64 setup and portable artifacts prepared and automatically checked locally. No commit, tag, GitHub release, upload, installation, or personal-data migration was performed. Manual acceptance and publication remain pending.

## Artifacts

- `dist/sydtrack-2.5.0-setup.exe` — 78,446,970 bytes; SHA-256 `88ee3219c472c5ff2e449bb801b625c2d56cf1e02a346a17b471b23bbe915382`.
- `dist/sydtrack-2.5.0-portable.exe` — 78,180,769 bytes; SHA-256 `d455e0808834732d87874d1190815a3d441c72087abaa83b7c687d8ebe5020e4`.
- `dist/sydtrack-2.5.0-setup.exe.blockmap` — 83,007 bytes; SHA-256 `548ad294d189837c20a53827a1b7fda0ea29f6f0afdc4af90834c9163841c0bf`.
- `dist/SHA256SUMS-2.5.0.txt` records the distribution hashes. The blockmap does not enable automatic downloads or installation.

Both executable wrappers report 2.5.0 in Windows file/product metadata and are **NotSigned**. Setup and portable contain identical `app.asar` payloads matching the unpacked staging archive, SHA-256 `60d3c0210d79d5693c8ded6da2ddbf65ed0a356e1e61d83c987ba2758b4667f2`.

The frozen v2.4.0 setup, portable, and blockmap still match their [recorded hashes](release-validation-2.4.0.md); none was rebuilt or replaced.

## Completed checks

- Package and lockfile root versions agree on 2.5.0. No dependency versions were upgraded. README, [release notes](release-notes-2.5.0.md), and ITERATION describe the actual delta from the frozen v2.4.0 build, including clickable focusscore navigation committed after that release.
- `npm run dist:win` completed for setup and portable, with publication disabled.
- `npm test`, `npm run test:ui`, `npm run test:profiles-ui`, `npm run test:tray-native`, and `npm run test:packaged` passed at version 2.5.0. `git diff --check` passed with the repository's line-ending safety override. Checks use temporary data and synthetic activity. Distribution checksums were independently verified against the built files.
- The core suite covers classification/explanations, storage, corrections and Undo, startup, IPC validation, timers, pause persistence/expiry/accounting, reminders, updates, and tray state. Syntax checks passed for 94 files; diagnostic-only additions also passed syntax/whitespace checks.
- Clickable focusscore checks cover exact-date navigation, trusted keyboard activation, bottom Back placement, grid focus/scroll restoration, older and empty history, pinned historical dates, late responses, and midnight rollover.
- Pause-menu checks cover 15/30/60-minute choices, indefinite pause, resume, sidebar countdowns, pending-action guards, failed-write retries, keyboard and focus handling, and 27 theme/width cases. Core tests verify durable deadlines, automatic expiry, manual clearing, and no backfill of paused time.
- Schedule-picker checks cover all 60 minutes, existing arbitrary-minute and overnight schedules, draft/Cancel/Escape, keyboard input, save failures and retained retry drafts, pending writes, external reloads, disabled state, native fallback, 27 theme/width cases, small dark/light windows, and an actual en-GB 24-hour reload. Stored schedule fields and semantics are unchanged.
- Settings checks cover 72 combinations across 800/1040/1600px windows, Midnight/Linen/Forest, and screen-time-limit/break-reminder states. They verify tight label/control spacing, no overflow or overlap, regular-weight inline Breaks copy, disabled-when-off minutes, and retained saved values.
- Contrast checks cover all nine appearances. Profile UI checks cover Forest persistence and dark-to-light theme ordering alongside existing corrections, Undo, and opt-in update checks.
- Native tray checks cover four logos, 1x/2x/3x images, category changes and neutral states, timed-pause submenu/callbacks, onboarding guards, synthetic lock handling, and disposal. They do not establish actual Windows overflow placement, display scaling, or real power-event behavior.

## Packaged diagnostics

Both extracted payloads passed. Each archive contains 914 files, including 74 source/renderer files matching the working source and 15 required release-feature files. Windows native bindings, foreground/address probe resources, shell icon, and tray logos are included; development data, test scripts, Git contents, and stale native-build backups are excluded.

The diagnostic uses the real packaged main process, preload, sandbox, and protected `sydtrack://app` protocol, but pauses before app code to isolate data and intercept startup-registration writes. It does not execute either distribution wrapper or install the app. Main-process tracking stays paused and personal history is not used; only the renderer's displayed pause state is synthesized to exercise timed choices safely.

- The schedule module is instantiated and its stylesheet is parsed through the production protocol. Hidden native backing inputs, visible themed triggers, exact-minute overnight saves, disabled states, and confirmed values after restart passed. These checks cannot pass through native fallback alone.
- Forest is present among nine themes, saves through the production preload, and survives restart with the matching renderer theme. The original default and fresh onboarding remain intact.
- 15/30/60-minute pause IPC and the legacy 15-minute bridge passed. The compact Breaks row has no reset helper, uses regular-weight copy, and preserves its saved minutes while disabled.
- Real synthetic historical data passes Week/Month focusscore → exact-date Day Analytics → bottom Back navigation, including restored grid focus. Final assertions wait for loaded fixture totals rather than the initial empty placeholder.
- Existing explanation, quick-rule save/Undo, profile-aware confirmation, Analytics correction/Undo, tray-image decoding, and saved settings/history restart checks also passed.
- Explicit public GitHub metadata checks succeeded for both extracted apps: `currentVersion: 2.5.0`, `latestVersion: 2.4.0`, `phase: current`, `available: false`. Automatic checks remained off. No release page was opened and nothing was downloaded or installed.

Inspector clone/path-normalization and asynchronous-wait issues found while extending the diagnostic were corrected in the test harness only; no product source or binary was changed in response.

## Scope and deferred warning

This release does not implement focusstreak or change classification, the Focus Share formula, or the break-reminder engine. The reported Windows foreground-backend timeout/JSON warning is left unchanged at the user's explicit request. Automated synthetic checks and paused packaged launches do not prove that real foreground tracking is healthy on the affected machine.

## Before publication

1. Quit the existing app from its tray, then test a real setup upgrade and portable-wrapper launch. Confirm existing activity, profiles, settings, and sessions remain intact, and startup registration points to the intended executable.
2. Follow [Windows lifecycle validation](manual-lifecycle-validation.md), including foreground switching, pause, lock/unlock, sleep/wake, tray status/menu, and display scaling. Confirm live tracking continues without requiring a restart; the deferred warning should be assessed separately before making reliability claims.
3. Try a focusscore day and its bottom Back action, 15/30/60-minute pause plus manual resume, Forest after restart, exact-minute schedule edits, and the compact Breaks row in the visible app. No personal history deletion or system-clock change is needed.
4. After acceptance and explicit publication approval, commit/tag the approved source and upload setup, portable, and checksums with the release notes. Update publication-pending wording only after publication actually occurs.
