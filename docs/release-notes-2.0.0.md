# sydtrack v2.0.0

SydTrack 2 is a new generation of the app: a rebuilt interface, more dependable tracking, stronger local-data recovery, and much better defaults. It remains a local-first Windows app with no account or cloud sync.

## A clearer daily view

- A redesigned Home keeps the day’s total, category split, FocusBoost, active profile, and last-focused app readable at both compact and expanded window sizes.
- The tracked-time total stays on one line across the full 24-hour range, and the live display advances smoothly once per second between tracker samples.
- Roundup now centers on a daily focus-share goal, with an optional active screen-time limit and clearer daily highlights.
- Analytics adds week-over-week comparison, 30-day focus history, daily focus scores, and cleaner app-level detail.

## Focus profiles that are useful immediately

- General, Coding, Writing, Study, and Creative presets now ship with **507 unique researched terms** across work tools, learning services, creative software, common distractions, real page-title signatures, and Windows shell processes.
- Every bundled profile includes the same Windows-specific Ignore baseline for transient surfaces such as Explorer, Search, Snipping Tool, Start, shell hosts, overlays, and SydTrack itself.
- Switch profiles from Home or manage them under Focus Tags. Profiles can be created, renamed, imported, exported, and edited independently.
- Browser fallback keywords are editable under Focus Tags and travel with backups.

## More accurate tracking

- Sleep, lock, unlock, pauses, delayed probes, idle transitions, and hour/day boundaries no longer invent, duplicate, or erase tracked time.
- Productive app identities are protected from unrelated words in document or project titles, while browser content can still be classified by its own title.
- Optional Windows media detection can keep actively playing music or video tracked after the idle timeout; paused and background media stay excluded.
- Today’s app rows preserve the matched keyword and can be corrected without reclassifying unrelated activity.

## Safer local data

- Raw activity is retained for 90 days, with older days compacted into verified rollups so long-term totals remain available.
- The schema upgrade creates a recovery backup before migration and resumes safely after interrupted writes.
- Backups now cover activity, settings, sessions, app identities, browser keywords, and focus profiles, with stricter validation before import.
- Malformed local files are preserved for recovery instead of being silently replaced.

## Design and settings cleanup

- Five palettes—Midnight, Graphite, Dusk, Coral, and Starlight—use the bundled Satoshi typeface and a consistent visual system.
- Navigation, Focus Tags, Sessions, Roundup, Analytics, and Settings have clearer hierarchy and better narrow-window behavior.
- Settings is shorter and grouped around appearance, tracking, reminders, goals, idle behavior, messages, and data.
- Removed the unreleased Decompress, gamification, mascot, and generated-share-card experiments before they reached a stable release.
- The sidebar wordmark now uses the correct **S** initial.

## Security and packaging

- Electron now uses context isolation, sandboxing, strict navigation and permission guards, a local-only content security policy, and validated IPC payloads.
- CI covers syntax, tracking, storage, startup, security, and isolated UI checks.
- Windows downloads are named clearly: `sydtrack-2.0.0-setup.exe` and `sydtrack-2.0.0-portable.exe`.

## Upgrade notes

- Existing activity and settings are preserved. The first launch may migrate local storage and remove retired experimental settings.
- Existing edited Focus profiles are not overwritten. The expanded presets apply to fresh installs and are also available as importable files in the repository’s `profiles` folder.
- Quit the previous SydTrack copy from the tray before installing or opening the portable build.
- Windows binaries are currently unsigned, so Windows may show a SmartScreen warning.

**Full changelog:** `dev...v2.0.0`
