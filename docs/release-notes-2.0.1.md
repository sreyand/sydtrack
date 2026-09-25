# sydtrack v2.0.1

A small but important follow-up to v2.0.0, focused on packaged startup, Windows identity, and final interface polish.

## Fixed

- Fixed an immediate JavaScript crash in installed and portable builds caused by reading build-only metadata from the packaged app manifest.
- Embedded SydTrack’s updated icon into the actual Windows executable, installer, taskbar identity, tray, and notifications instead of falling back to Electron artwork.
- Kept the simple **S** wordmark inside the app while using the supplied black-and-white mark for external Windows surfaces.

## Refined

- Unified Month analytics so Last 30 days and Top apps fill the space beside the chart cleanly.
- Reworked week and month scoring into compact `focusscore` cards with no explanatory subtitle or rolling-average clutter.
- Shortened Week over week language and removed the visible formula.
- Simplified Roundup language, removed the duplicate focus-share highlight, and stopped repeating the goal calculation in the daily summary.

## Upgrade note

Quit SydTrack from the tray before installing. If v2.0.0 is showing a startup-error dialog, close the dialog or end `sydtrack.exe`, then run the v2.0.1 installer.

**Full changelog:** `v2.0.0...v2.0.1`
