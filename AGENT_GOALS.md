# sydtrack — product direction and engineering handoff

Updated September 25, 2026. This is the current source of truth for product direction and engineering constraints. Release history belongs in `docs/release-notes-*.md`; validation procedures belong in the existing manual guides.

## Product goal

Help people understand where their computer time went, whether it matched their intention, and what they can change—with minimal setup. Tracking and analysis stay local. SydTrack has no account, cloud dashboard, or automatic upload.

The intended loop is simple: choose a Focus profile if useful, work normally, review a concise result, and correct classifications when needed.

## Product principles

1. **Simple by default.** General should work immediately; profiles and detailed settings are optional.
2. **One place for each action.** Focus Tags owns classification; Settings owns preferences and data management.
3. **Explain classifications.** Show the matched app, keyword, or site rule when the data exists.
4. **Keep corrections predictable.** Profile changes affect future activity; Analytics corrections affect today's recorded activity.
5. **Prefer useful observations to dashboard volume.** Do not infer motivation, value, or causality from an app name.
6. **Trust before breadth.** Accuracy, recovery, lifecycle behavior, and low resource use outrank new features.
7. **Privacy is structural.** Avoid unnecessary capture, telemetry, server dependencies, and background-browser surveillance.
8. **Keep language direct.** Controls should say what they do without formulas or long rationales unless the detail prevents a mistake.

## Current product state

- Current release candidate: **v2.1.0**.
- Windows x64 is the supported release target. macOS and Linux packaging remain best-effort CI targets.
- Windows installer and portable builds are unsigned and Git-ignored.
- External executable, taskbar, tray, and notification surfaces use the supplied SydTrack artwork. The in-app sidebar keeps the simple **S** wordmark.
- Five bundled Focus profiles ship: General, Coding, Writing, Study, and Creative. All include the Windows Ignore baseline.
- Home, Sessions, Roundup, Analytics, Focus Tags, goals, FocusBoost, backups, retention, themes, and local recovery are active features.
- Decompress, gamification, mascot, streak-sharing, and generated share-card experiments are removed. Do not reintroduce them without a new, explicit product decision.
- Open at login defaults on for supported packaged builds and starts hidden in the tray.
- Foreground polling offers Low (5 s), Med (3 s, default), and Max (1 s). Visible timers continue to update once per second.

## Near-term priorities

1. Complete real-device upgrade, restart, sleep/lock, startup, and browser acceptance using the manual guides.
2. Keep classification reasons and same-day corrections understandable and consistent across Home and Analytics.
3. Improve backup/import interruption safety before considering a storage rewrite. Activity merge is still additive.
4. Measure startup, steady-state CPU, memory, and foreground-probe latency before changing polling or architecture.
5. Add only concise session or Roundup observations supported by recorded evidence.

## Known limitations

- Window titles cannot reliably determine whether a video, research page, or communication is useful. User-defined profiles and corrections remain authoritative.
- Automatic browser-address capture is disabled; the title-based baseline avoids retaining typed but unsubmitted addresses.
- Profile changes do not rewrite history. Today's corrections do not rewrite previous days or saved session observations.
- Previously ignored or unattributed activity cannot always be reconstructed.
- Re-importing the same additive activity backup can duplicate time; multi-file replacement is not fully transactional under disk failure.
- Media-aware idle tracking is opt-in and Windows-only. Background or paused media must not keep unrelated foreground work active.
- Builds are currently unsigned, so Windows may show SmartScreen warnings.

## Engineering invariants

- Preserve user data, malformed originals, stable IDs, data paths, and export compatibility.
- Development data lives under `data/`; packaged data uses Electron's user-data directory. Runtime data and generated backups do not belong in commits.
- Keep Electron context isolation and sandboxing enabled, Node integration disabled, navigation restricted, permissions denied by default, and IPC payloads narrowly validated.
- Use atomic JSON replacement and validate imports before changing existing state.
- Keep archive reads bounded and outside live polling. Raw history retention is 90 days; older compact rollups remain readable.
- Session distractions are transitions into unproductive activity, not every tracking tick. Ignored and zero-time ticks must not create transitions.
- Sleep, lock, pause, idle, delayed probes, and clock discontinuities must never backfill away time.
- Profiles have stable IDs, unique trimmed names, at most five slots, and a protected `default` profile. Activation changes future classification without rewriting history or session deadlines.
- Browser content can override a browser process identity; native editor titles must not turn editors into browsers.
- External publication, tags, releases, and uploads require explicit user authorization.

## Verification and release

Run before release:

```powershell
npm test
npm run test:ui
npm run test:profiles-ui
npm run dist:win
```

Also run `git diff --check`, inspect the packaged version and hashes, and follow the real-device validation guides where the change touches lifecycle or profiles. A successful build does not publish a release.

## Supporting documents

- [README](README.md) — current product, download, requirements, and setup
- [v2.1.0 release notes](docs/release-notes-2.1.0.md) — current release summary
- [Lifecycle validation](docs/manual-lifecycle-validation.md) — restart, lock, sleep, and timer checks
- [Focus profile validation](docs/manual-focus-profiles-validation.md) — profile workflows and compatibility
- [Focus profile generation guide](docs/focus-profile-generation-guide.md) — bundled and portable profile format
- [Packaging and signing](build/README.md) — local and CI packaging behavior
