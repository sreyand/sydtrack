# v2.7.0 release validation — 2026-11-16

Windows x64 setup and portable both report **2.7.0** and are unsigned. The version and lockfile were bumped without changing dependencies.

## Artifacts

- `dist/sydtrack-2.7.0-setup.exe` — 78,459,730 bytes; SHA-256 `8fbcd85966d3014f5bd1e1e38fc160f57bde300c77ac23abb51062a50d6686a5`.
- `dist/sydtrack-2.7.0-portable.exe` — 78,193,582 bytes; SHA-256 `ada2582d84e9edaabe700936cfc9b70e4539b250c0f66f28f66f5a64feabd021`.
- `dist/sydtrack-2.7.0-setup.exe.blockmap` — 83,018 bytes; SHA-256 `92464c4574ffeffa3f5bda8d41e918294be180a637b4b1ac453176ede81aeb8e`.

Verified against `dist/SHA256SUMS-2.7.0.txt`. The v2.6.1 downloads and checksums were left unchanged.

## Checks

- Core tests passed.
- All eight UI checks passed, including next-day settings, glisten, sidebar reversal, reduced motion, and Analytics layout/time formatting.
- Both extracted apps passed fresh-launch and restart checks against temporary data. The checks verified the glisten stylesheet, opt-in and persistence, and saved next-day resume without unpausing a fixture.
- The identical, source-matching app archives contain 922 files. Shared SHA-256: `627157e4718d5b8c8a08efdf6db3fd03a60474b1c5c865eb632f05a2c7a9c52d`.

Tracking stayed paused in packaged checks. No installer or portable wrapper was executed. Manual Windows upgrade, portable launch, and overnight behavior remain to be checked using the [lifecycle guide](manual-lifecycle-validation.md). No commit, tag, or publication was performed.
