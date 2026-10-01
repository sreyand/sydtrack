# sydtrack v2.4.0

This release makes live tracking status easier to see and category decisions easier to understand, with quieter controls on Home and in the tray.

Release files are prepared locally. Publication is pending; the v2.4.0 downloads will appear on GitHub Releases after publication.

## Live status in the tray

- The tray logo is green for **Productive**, red for **Unproductive**, and gray for **Other**. It follows the current tracking decision, rather than the retained Last focused activity.
- The standard black logo marks neutral states such as paused tracking, idle time, ignored apps, missing or unavailable activity, onboarding, sleep, and lock. Stale tracking status also returns to neutral. Demo activity is labeled explicitly.
- Hover shows a short status and a countdown when a focus session is running, without app names or page titles.
- The simpler menu contains **Open sydtrack**, **Pause/Resume tracking**, **Pause for 15 minutes**, **Notifications** with its current setting, and **Quit**. FocusBoost remains available on Home and in Settings.

## A tidier Home

- FocusBoost and the profile selector share one compact row. Home's columns now account for the space between them, keeping the layout inside the content area.
- The title-rule editor is now **Create a rule**, with cleaner copy, a roomier phrase field, a header Cancel action, and category choices beside Save.
- Rule and Ignore confirmations name the profile actually saved. Rules still affect future tracking in that profile; Analytics corrections remain scoped to today's activity. Existing draft protection and Undo are preserved.

## Why this category?

- Hover, keyboard-focus, or click the existing Last focused category chip to open an explanation. Click keeps it open; Escape or leaving the context dismisses it.
- The explanation uses the actual classifier result: a profile keyword, global Browser keyword, app rule, unmatched **Other**, **Ignore**, or a today-only correction. It names the winning rule separately from the activity's grouping label—for example, activity grouped as `r/jhu` can have matched the broader `r/` rule.
- Categories and explanations refresh together after rule changes, corrections, and Undo. Retained corrections show their date when needed, so yesterday's correction is not described as today's. Demo activity is identified, and missing or stale evidence does not produce an invented reason.
- Explanations are transient. They add no foreground probes, saved titles, activity regrouping, history rewrites, or network requests. Rule and profile names are displayed as plain text.

## Upgrade notes

- Windows 10/11 x64 remains the supported release target. The release files are `sydtrack-2.4.0-setup.exe` and `sydtrack-2.4.0-portable.exe`.
- Quit sydtrack from the tray before replacing an older build. Existing activity, profiles, settings, and sessions are retained.
- These changes explain existing classification decisions; title-based classification still cannot determine intent. Changing a rule affects future tracking rather than rewriting history.
- Builds remain unsigned, so Windows may display a SmartScreen warning. Downloads and installation remain manual.
