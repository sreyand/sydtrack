# sydtrack v2.2.1

This hotfix keeps live tracking moving after a transient Windows foreground-probe failure and improves recognition of subreddit titles.

## Fixed

- A failed Windows foreground sample no longer switches tracking permanently to the fallback backend. The primary probe is retried on the next sample.
- A stalled fallback is time-bounded so it cannot indefinitely hold up the tracking loop.
- The `r/` title keyword now recognizes `r/<subreddit>` markers and takes precedence over a productive topic word in the same browser title. Users can still correct today's classification or edit their profile rules.

## Upgrade notes

- Quit sydtrack from the tray before replacing an older Windows build. Existing activity, settings, profiles, and sessions remain in place.
- Time missed while an older build was stalled cannot be reconstructed.
- Windows 10/11 x64 is the supported release target. Setup and portable builds are unsigned, so Windows may display a SmartScreen warning.
- sydtrack has no auto-update feed; install this update manually.
