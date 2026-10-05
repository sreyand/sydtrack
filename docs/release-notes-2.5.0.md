# sydtrack v2.5.0

A closer look at your days, easier breaks, and a calmer Settings experience. This release connects focusscore to daily detail, adds flexible pause durations, and introduces Forest.

Release files are prepared and automatically checked locally. Manual acceptance and publication are pending; the v2.5.0 downloads will appear on GitHub Releases after publication. Package checks and remaining acceptance are recorded in the [release validation report](release-validation-2.5.0.md).

## From focusscore to the full day

- Click a day in the Week or Month focusscore grid to open Day Analytics for that exact date. Keyboard users can activate the same cells with Enter or Space.
- **Back to focusscore** sits below all the day’s information. It restores the originating Week or Month grid, focus on the selected day, and the previous scroll position.
- Historical days keep their existing level of detail: exact activity where available, hourly or daily totals for older records, and honest empty states where nothing was recorded. Navigation does not invent detail or change scores.

## Pause on your terms

- Settings has one **Pause for…** control: choose **15 minutes**, **30 minutes**, **1 hour**, or **Until I resume**. Selecting a duration pauses tracking immediately; the same control becomes **Resume** while paused.
- The sidebar keeps its one-click pause/resume action and shows the remaining time during a timed pause. The tray’s **Pause for** submenu offers the three timed durations.
- Timed pauses survive a restart and resume automatically when their deadline passes. Resuming manually clears the deadline. Paused time is not added back into your activity.

## Forest, and a clearer appearance picker

- Forest joins the built-in appearances with evergreen surfaces, muted sage accents, and warm ivory text. Category colors retain their Productive, Unproductive, and Other meanings.
- The nine choices are arranged from dark to light: **Midnight → Tide → Plum → Forest → Dusk → Linen → Graphite → Coral → Starlight**.
- Midnight remains the initial default. Existing saved appearance choices are preserved, and Forest includes matching native window and titlebar colors.

## Consistent time controls and quieter Settings

- FocusBoost’s Starts/Ends controls now use themed dropdowns rather than an operating-system picker. Select an exact hour and minute, then **Set time**; **Cancel** leaves the saved time unchanged. Display follows the locale’s 12- or 24-hour format, including AM/PM when appropriate.
- Existing arbitrary-minute and overnight schedules are preserved. The original time inputs remain available as a fallback if the custom picker cannot load.
- Notifications has tighter label-to-control spacing. Redundant Polling, Idle, Reminders, and Messages headings are removed, while useful group headings use sentence case.
- Tracker rows align more consistently, including **Keep session history**. Wellbeing has tighter spacing and no extra divider at the bottom of the card.
- Break reminders use one regular-weight row: **Remind me to take a break after [minutes] minutes**, beside the enable switch. Reset details now live in the README’s expandable **Idle, media, and break reminders** section. Reminder behavior is unchanged.

## Upgrade notes

- Windows 10/11 x64 remains the supported release target. The files are `sydtrack-2.5.0-setup.exe` and `sydtrack-2.5.0-portable.exe`.
- Quit sydtrack from the tray before replacing an older build. Existing activity, profiles, settings, and sessions are retained.
- Classification and the Focus Share formula are unchanged. Title-based classification remains a useful signal, not proof of intent; these changes add no new activity collection or automatic uploads.
- Builds remain unsigned, so Windows may display a SmartScreen warning. Downloads and installation remain manual.
