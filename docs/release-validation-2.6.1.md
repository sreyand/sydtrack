# v2.6.1 release validation — 2026-10-07

Windows x64 setup and portable builds include the tab-flicker fixes. Both report **2.6.1** and are **NotSigned**.

## Artifacts

- `dist/sydtrack-2.6.1-setup.exe` — 78,459,588 bytes; SHA-256 `64d77ac816985593f8753f11b20d6f6faa69066c789d4fc3f23f4a720303d889`.
- `dist/sydtrack-2.6.1-portable.exe` — 78,193,383 bytes; SHA-256 `301ccec2320d5fb65c4a0f222b7b08a3e8cd6af1c649b721745493c54c3442ea`.
- `dist/sydtrack-2.6.1-setup.exe.blockmap` — 82,672 bytes; SHA-256 `248ed6aabc13d2988812bd45e2eea5f16a08be720cbb9ea1dad22ee0bb8e7783`.

All three hashes were independently checked against `dist/SHA256SUMS-2.6.1.txt`. The v2.6.0 files and checksums are unchanged.

## Checks

- Core suite passed at 2.6.1, including 107 syntax checks.
- All eight UI harnesses passed for the release source before the version-only bump; all 140 transition assertions passed again at 2.6.1.
- Both extracted packages passed fresh-launch and restart checks, including real cached Week/Month transitions with motion off/on.
- Both source-matching archives contain 921 files and share SHA-256 `ee4ac95c4ae04aed68c60c6cb6e5c128fa19c73d1f4ab9347f13b8b80d620172`.

Packaged tests use temporary data, paused tracking, and intercepted startup/hotkey registrations. No installer or portable wrapper was executed. A restricted debugger launch timed out; the approved isolated rerun passed.

## Versioning and manual acceptance

Package and lockfile versions, README links, and release notes are aligned to 2.6.1. Suggested commit: `2.6.1`; tag: `v2.6.1`. No commit, tag, push, installation, or publication was performed.

Before publishing, test setup upgrade and portable launch with retained history/settings, plus actual shortcuts, tray/display scaling, and lock/sleep/resume. See the [lifecycle guide](manual-lifecycle-validation.md). The deferred Windows foreground-backend warning is unchanged.
