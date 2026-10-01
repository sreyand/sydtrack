# sydtrack v2.3.0

This release makes the daily picture more trustworthy and mistakes easier to fix, while keeping sydtrack simple, local, and extension-free.

## Better classification

- Recognizable page-source labels take priority over broad topic words. A subreddit title such as `r/jhu` follows its source rule, while a specific exception such as `r/learnpython` can override the broad `r/` rule.
- Browser-name keywords such as `google chrome` no longer classify every page through its window-title suffix. Existing saved rules are preserved, with a notice explaining unsupported browser-name catchalls.
- New recognized subreddit activity is grouped by community, so correcting one community today does not change another. Older records remain as recorded; they are not retroactively split into invented pages.
- Unrecognized browser pages stay together in Analytics without a blanket correction that could relabel unrelated visits.
- Focus Share shows how much tracked time it is based on. When less than half of tracked time is classified, the default calculation shows no goal verdict or daily score. Other remains visible in tracked totals.

## Easier corrections

- On Home, an unfamiliar browser page opens a small title-phrase picker: select actual title words, choose P/U/O, and confirm a rule for future tracking in the active profile. No keyword is guessed from the title.
- Home rule and whole-app Ignore changes, plus Analytics today-only corrections, now offer a brief Undo action. Undo restores the affected change without overwriting unrelated edits or losing time recorded since the correction.
- Unsaved Focus Tags edits are protected. Changing pages or profiles cancels an unconfirmed phrase draft.
- Last focused stays visible after a correction and reflects the current category, including today's overrides.

## Quiet update checking

- Settings includes **Check now** and optional daily checks for newer stable GitHub releases. Automatic checks are off by default.
- Versions are compared numerically, independent of GitHub's release-list order. Offline or rate-limited checks do not falsely report that the app is up to date.
- A newer version adds a small Settings indicator and a **View release** button. Downloads and installation remain manual.
- Checks send no activity, titles, or profiles. GitHub receives a normal public web request, including the connection's IP address. Tracking still works offline.

## Polish and performance

- Added **Tide**, **Linen**, and **Plum**, bringing the theme selection to eight. Midnight remains the default.
- Evened out collapsed-sidebar footer spacing, replaced the Settings icon with a recognizable gear, and removed the redundant hotswap divider.
- Cached rule patterns and source metadata reduce repeated classification work without caching page titles. Tracking reuses one classification result for the category and its reason.
- Expanded regression checks for classification, correction scope, Undo, updates, privacy, themes, and responsive layouts.

## Upgrade notes

- Quit sydtrack from the tray before replacing an older build. Existing activity, profiles, settings, and sessions are retained; new rules affect future tracking rather than rewriting history.
- Title-only classification remains an estimate, not proof of intent. Ambiguous pages can still be Other, and older activity cannot be reconstructed from newly recognized sources.
- Windows 10/11 x64 remains the supported release target. Builds remain unsigned; Windows may display a SmartScreen warning.
