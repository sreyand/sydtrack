# sydtrack v2.2.0

This release makes the first run shorter and the daily picture more useful, while keeping tracking local and title-only.

## New

- Fresh installs open paused to a single onboarding screen: choose General, Coding, Writing, Study, or Creative, choose whether to open at sign-in, then press **Start tracking**. Existing installs skip onboarding.
- Analytics → Apps shows where active time went by app for Day, Week, or Month. A browser remains one app slice even when different titles were classified differently.
- Expand an app on the Day view to see grouped classification reasons and correct today's time with P/U/O/I. Home also offers an Other choice alongside its quick future-classification actions.
- Analytics → Day has a local activity timeline with category changes, detected idle, and untracked gaps. The overview groups rapid switches into clock-aligned intervals; trackpad pinch or +/− zooms into exact segments, while **Recenter** returns to the activity overview. Older data is clearly marked when only hourly or daily totals exist.
- Analytics → Lifetime uses compact local rollups to show total tracked time, category totals, active days, and the most tracked day beyond the 90-day detailed-history window.
- An optional global shortcut cycles through Focus profiles. It is off by default and can be configured in Settings → Tracking.

## Refinements

- Browser classification uses the active profile and editable title keywords without reading browser addresses or requiring an extension. Unmatched browsers and unknown apps remain Other instead of being assigned a productive label without evidence.
- Simplified the Sessions timer layout, Analytics hierarchy, classification controls, and onboarding copy. Scrollbar thumbs now recede after interaction, and the timeline's hourly chart appears only when older or partially recorded data needs it.
- Preserved same-day correction scope, existing profile data, backups, and long-term summaries. New timeline segments contain category, timestamps, and profile ID—not window titles.

## Upgrade notes

- Quit sydtrack from the tray before replacing an older Windows build. Your existing activity, settings, profiles, and sessions remain in place.
- Windows 10/11 x64 is the supported release target. The setup and portable builds are unsigned, so Windows may display a SmartScreen warning.
- New onboarding is for genuinely fresh installs only; upgrading does not pause an existing tracker or replace chosen settings.
- sydtrack has no auto-update feed; upgrades are installed manually from the published downloads.
