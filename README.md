<div align="left">
  <img src="./renderer/assets/logo-mark.png" width="150" alt="sydtrack logo">
  <p><strong>See the pattern, not every move.</strong></p>
  <p>A private Windows productivity tracker with live activity, focus profiles, sessions, goals, and analytics—without an account, subscription, or cloud dashboard.</p>
    <p>
    <a href="https://github.com/sreyand/sydtrack/releases"><strong>Download for Windows</strong></a>
    ·
    <a href="docs/release-notes-2.6.1.md">What’s new in v2.6.1</a>
  </p>
  <p>
    <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-5B7CFA?style=flat-square">
    <img alt="Local first" src="https://img.shields.io/badge/data-local--first-39C59D?style=flat-square">
    <img alt="Version 2.6.1" src="https://img.shields.io/badge/version-2.6.1-8B7CF6?style=flat-square">
    <img alt="GPL v3" src="https://img.shields.io/badge/license-GPL--3.0-EF6A6A?style=flat-square">
  </p>
</div>

## Your workday, made legible

sydtrack watches the app in front of you, classifies the time, and turns the result into a clean picture of your day. It runs quietly in the tray and keeps the data on your computer.

| | |
| --- | --- |
| **Live daily view** | Productive, unproductive, and uncategorized time update as you work. The total advances smoothly every second. |
| **Focus profiles** | Switch between General, Coding, Writing, Study, and Creative without rebuilding your tags every time your work changes. |
| **Useful analytics** | Open a focusscore day for its timeline and app-by-app time, or review Week, Month, and lifetime totals. Older days keep compact local summaries after detailed history expires. |
| **Focus sessions** | Run Pomodoro, Deep Work, or a custom timer with session history and distraction counts. |
| **FocusBoost** | Use a shorter reminder threshold when you want sydtrack to interrupt a distraction sooner. Optional schedules can arm it automatically, with themed, exact-minute time controls. |
| **Daily goals** | Set a productive-time share target and, if useful, a limit for total active screen time. |
| **Optional break nudges** | A configurable notification after a long stretch of active tracking, off by default. |
| **Flexible pauses** | Pause for 15 minutes, 30 minutes, or an hour, with automatic resume—or pause until you choose to resume. |
| **Nine appearances** | Choose a built-in palette, including Forest, or enable daily rotation through dark, light, or all themes. Optional UI motion respects your system's reduced-motion preference. |
| **Simple first run** | Choose a starting profile and decide whether sydtrack opens at sign-in. Tracking stays paused until you press Start. |

## Built to work on day one

sydtrack includes five editable profiles with hundreds of starting app and title terms:

- **General** — office apps, planning, communication, research, and everyday work
- **Coding** — editors, terminals, source control, cloud consoles, databases, and developer documentation
- **Writing** — drafting, notes, references, publishing, grammar, and research tools
- **Study** — learning platforms, flashcards, academic databases, coursework, and math tools
- **Creative** — design, illustration, photo, video, audio, 3D, and asset libraries

Each profile also carries a Windows-specific Ignore baseline for shell surfaces such as Explorer, Search, Start, Snipping Tool, transient hosts, overlays, and sydtrack itself. The lists are starting points, not locked policy: edit them under **Focus Tags**, or import/export a profile as a `.sydtrack-profile` file.

[General](profiles/general.sydtrack-profile) · [Coding](profiles/coding.sydtrack-profile) · [Writing](profiles/writing.sydtrack-profile) · [Study](profiles/study.sydtrack-profile) · [Creative](profiles/creative.sydtrack-profile)

## Private by architecture

There is no sydtrack account and no analytics server.

- Activity, settings, sessions, and profiles stay on your computer.
- Tracking uses the foreground process and window title; no browser extension is required.
- The production tracker does not read typed-but-unsubmitted browser addresses.
- Backups are files you explicitly save. Nothing uploads automatically.
- sydtrack can check public GitHub releases from **Settings → Tracking → Updates**. Automatic checks are off by default; enabling them makes at most one scheduled check per day. No activity, titles, or profiles are sent. GitHub receives a normal web request, including your IP address. Downloads and installation remain manual.
- Local exports can contain app names, matched title words, and session labels, so treat them like a private diary.

## A clearer loop

1. **Track** — sydtrack records the focused Windows application while you are active.
2. **Classify** — the active Focus profile matches app identities and title keywords.
3. **Review** — Home, Roundup, and Analytics show the day at different levels of detail.
4. **Correct** — fix a row for today or improve the active profile for future tracking.
5. **Refocus** — start a session or arm FocusBoost when the day begins to drift.

Changing profiles affects future tracking; it does not rewrite history. Analytics corrections are deliberately scoped to today so a profile switch cannot silently change the record of your day.

## Download

sydtrack currently targets **Windows 10/11 x64**.

- `sydtrack-2.6.1-setup.exe` — standard installer
- `sydtrack-2.6.1-portable.exe` — run without installation

Version 2.6.1 is packaged and checked locally; manual acceptance and publication are pending. Downloads become available after publication. The [release validation report](docs/release-validation-2.6.1.md) records checks and remaining manual acceptance.

**In v2.6.1:** flicker-free analytics transitions and steadier layout, with UI motion on or off.

Find published builds on [GitHub Releases](https://github.com/sreyand/sydtrack/releases). Quit an older copy from the tray before upgrading. Existing activity and settings are preserved. Builds are currently unsigned, so Windows may show a SmartScreen warning.

## System requirements

| | Minimum | Recommended |
| --- | --- | --- |
| **OS** | Windows 10 x64 | Windows 11 x64 |
| **Processor** | 2-core x64 processor, 2 GHz | Modern 4-core processor or better |
| **Memory** | 4 GB RAM | 8 GB RAM |
| **Storage** | 350 MB free | 500 MB free |

On an Intel Core Ultra 9 185H, tray tracking used about **281 MB of working memory** and an estimated **~1% total CPU** with the 3-second tracking cadence. The short Windows foreground probe accounts for most of that CPU time; results will vary with the machine and other activity.

## What’s new in v2.6.1

- Analytics keeps existing charts, timelines, and app lists visible during tab changes and loading.
- Tab highlights transition continuously; headers, loading indicators, and scrollbars keep the layout stable.
- Activity updates preserve keyboard focus and ignore outdated responses. Classification, Focus Share, and storage formats are unchanged.

Read the [v2.6.1 release notes](docs/release-notes-2.6.1.md) for upgrade details.

## What changed in v2.6.0

- **Daily theme rotation**, off by default, uses the two-arrow icon at the right of **Settings → Tracking → Appearance**. While enabled, the adjacent moon, sun, or **ALL** control cycles **Night → Day → ALL → Night**: dark themes, light themes, or both. Themes follow a predictable sequence for each local calendar day across restarts, sleep, and skipped days. Picking a theme manually turns rotation off.
- **Enable UI motion**, off by default, adds gentle press feedback, uninterrupted tab transitions, quick menu entrances, and a clockwise pie-chart draw. It respects reduced motion and does not replay on live updates. The rebuilt packages include the lighter transitions and removal of FocusBoost's delayed second press.
- **Show/hide sydtrack** adds an optional shortcut under **Settings → Tracking**: **Off** (default), **Ctrl+Alt+S**, **Ctrl+Shift+S**, or **Alt+S**. Hide the focused window or bring sydtrack forward. If a shortcut is unavailable, the previous working choice is preserved.
- **Polling mode**, **Focus profile hotswap**, and **Show/hide sydtrack** use themed dropdowns with keyboard access and native controls as a fallback.
- Charts and focusscore day buttons stay in place during live updates, preserving keyboard focus and hover. Active Week and Month grids keep today's values fresh. Returning from Day Analytics restores focus and scroll without leaving a tile selected.
- Expanded sidebar controls align consistently. Week comparisons use **Up/Down …% from last week** wording; the calculation remains the difference between the two periods' Focus Share percentages.

Read the [v2.6.0 release notes](docs/release-notes-2.6.0.md) for upgrade details and [ITERATION.md](ITERATION.md) for the implementation handoff and remaining limitations.

## What changed in v2.5.0

- Click a day in Week or Month focusscore to open Analytics for that exact date. **Back to focusscore**, below the day’s information, restores the original grid, focused day, and scroll position.
- **Pause for…** offers 15 minutes, 30 minutes, 1 hour, or **Until I resume**. The same Settings control becomes **Resume** while paused; the sidebar shows a timed-pause countdown, and the tray offers the three timed durations.
- Forest adds evergreen surfaces, sage accents, and ivory text. The nine choices run dark to light: Midnight, Tide, Plum, Forest, Dusk, Linen, Graphite, Coral, Starlight. Existing appearance preferences are preserved.
- FocusBoost schedule controls now match the app’s dropdowns. Choose an exact hour and minute, then **Set time**; **Cancel** leaves the saved time unchanged. Display follows the locale’s 12- or 24-hour format.
- Settings has tighter spacing, fewer redundant section headings, and one compact **Remind me to take a break after [minutes] minutes** row. Break reset behavior is documented below rather than repeated in the UI.

Read the [v2.5.0 release notes](docs/release-notes-2.5.0.md) for upgrade details and [ITERATION.md](ITERATION.md) for the implementation handoff and remaining limitations.

The [v2.5.0 release validation report](docs/release-validation-2.5.0.md) records checks and remaining acceptance for those frozen builds.

## What changed in v2.4.0

- The tray logo is green for Productive, red for Unproductive, and gray for Other. It returns to the standard black logo for paused, idle, ignored, or unavailable activity and other inactive states. Hover shows a short status and, during a focus session, its countdown.
- A simpler tray menu keeps Open, Pause/Resume, Pause for 15 minutes, Notifications, and Quit together. FocusBoost remains available on Home and in Settings.
- Home places FocusBoost and the profile selector on one compact row. Its columns account for their gap to stay inside the content area.
- **Create a rule** has cleaner copy, a roomier phrase field, and compact actions. Save confirmations identify the profile actually changed; rules still affect future tracking.
- Hover, focus, or click the Last focused category chip for **Why this category?** It explains the actual winning rule, unmatched Other, Ignore, or a dated today-only correction. Subreddit grouping labels are distinguished from matching rules, and demo activity is identified explicitly.

Read the [v2.4.0 release notes](docs/release-notes-2.4.0.md) for upgrade details and [ITERATION.md](ITERATION.md) for the implementation handoff and remaining limitations.

## What changed in v2.3.0

- Recognizable page-source labels take precedence over topic words. A specific `r/learnpython` rule can override a broad `r/` rule.
- Browser names such as `google chrome` no longer classify every page through the window-title suffix.
- Home uses recognizable sources or existing matched keywords for quick rules. For an unfamiliar page, P/U/O opens a small picker: select literal words from the title and confirm a future rule. There are no guessed keywords or blanket browser rules. Analytics keeps unrecognized browser pages together without a blanket P/U/I correction.
- A brief **Undo** action follows Home rule changes and Analytics today-only corrections. It restores the affected rule or match without overwriting other edits or discarding newly tracked seconds. Unsaved Focus Tags edits are protected.
- A quiet GitHub update checker supports **Check now** and opt-in daily checks. It compares stable version numbers rather than release-list ordering, handles offline/rate-limited checks, and opens the release page only when you choose. Nothing is downloaded or installed automatically.
- Focus Share shows how much tracked time it is based on. When most time is Other, excluded-Other goals and daily scores have no verdict.
- Cached rule patterns and source metadata reduce repeated classification work without retaining titles or searches.
- Tide, Linen, and Plum add three palettes using the existing layout and typography. The collapsed sidebar has evenly spaced bottom controls and a compact tracking-status light.
- Last focused stays visible after corrections and reflects the current category. Settings has a recognizable gear icon and no redundant hotswap divider.

Read the [v2.3.0 release notes](docs/release-notes-2.3.0.md) for upgrade details and [ITERATION.md](ITERATION.md) for the implementation handoff and remaining limitations.

## What changed in v2.2.1

- Tracking retries the Windows foreground probe after a transient failure instead of remaining on the fallback until restart.
- A stalled fallback has a time limit, allowing subsequent tracking samples to continue.
- Browser titles with an `r/<subreddit>` marker now match the `r/` unproductive rule even when the title also contains a productive topic keyword.

Read the [v2.2.1 release notes](docs/release-notes-2.2.1.md) for details.

## What changed in v2.2.0

- A short privacy-first onboarding flow for fresh installs; existing installs skip it.
- App-by-app Day, Week, and Month analytics that keep mixed-use browsers as one app while showing their category breakdown.
- Same-day P/U/O/I corrections in Analytics, and a matching Other option on Home for future classification.
- A local activity timeline that summarizes busy periods, shows idle and untracked gaps, and zooms into exact changes. Older hourly-only days are labeled honestly.
- Lifetime tracked time and category totals from compact local rollups.
- An optional global shortcut to switch Focus profiles, plus quieter layout and scrollbar behavior.

Read the [v2.2.0 release notes](docs/release-notes-2.2.0.md) for details.

## v2 foundations

- Rebuilt interface with Satoshi typography and Midnight, Graphite, Dusk, Coral, and Starlight themes
- Responsive Home hierarchy and a tracked-time display designed for the full 24-hour range
- Redesigned Month analytics with a compact 30-day score grid
- Five substantial Focus profile presets and editable browser fallback keywords
- Focus-share goals, optional active screen-time limits, weekly comparisons, and stronger Roundup insights
- Smooth one-second live totals between foreground tracking samples
- More accurate sleep, lock, pause, idle, media, and hour/day-boundary handling
- Crash-safe 90-day raw retention plus verified long-term rollups
- Expanded local backups and recovery for malformed files
- Hardened Electron sandbox, navigation, permissions, content security policy, and IPC validation
- Clear Windows installer and portable artifact names

Earlier notes: [v2 overview](docs/release-notes-2.0.0.md), [v2.0.1 patch](docs/release-notes-2.0.1.md), and [v2.1.0](docs/release-notes-2.1.0.md).

## Run from source

Requirements: Windows 10/11 x64, Node.js 18+, and PowerShell.

```bash
npm install
npm start
```

Useful commands:

```bash
npm test                 # core test suite
npm run test:ui          # isolated renderer checks
npm run test:tray        # tray state and tracker regression checks
npm run test:tray-native # isolated Electron icon/API check (no real tracking)
npm run test:packaged    # extracted setup/portable checks (Windows, Node 22+)
npm run start:demo       # generated demo activity
npm run dist:win         # installer + portable build
npm run sync:profiles    # regenerate bundled profile packs
npm run benchmark:classification # synthetic matcher timings
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup details.

<details>
<summary><strong>How classification works</strong></summary>

sydtrack checks ignored process identities first. For native apps, explicit app tags and productive app identities take precedence over unrelated words in a document or project title. Explicit Other keywords provide neutral exceptions.

Browsers use the page title without the trailing browser label. A recognizable source such as `- YouTube`, `- GitHub`, or `- r/jhu` takes precedence over a topic word. A more specific source rule, such as `r/learnpython` or `youtube lecture`, can override a broad source rule. Without a recognized source, explicit Other wins, then unproductive over productive; editable browser keywords are the fallback. No match remains Other. Title keywords are useful signals, not proof of the purpose of a visit.

The same browser can therefore contribute productive GitHub time and unproductive YouTube time without collapsing the two. Title matching is browser-independent. `site:example.com` rules remain portable, but production address capture is disabled until it can be made reliable without observing unsubmitted address-bar text.

By default, Focus Share is productive ÷ (productive + unproductive). Other stays in tracked totals but outside that ratio. sydtrack displays the classified portion alongside the percentage, and skips goal verdicts and daily scores when less than half of tracked time is classified. Including Other in Settings explicitly uses all active tracked time instead. Coverage describes assigned categories, not how accurate those assignments are.

</details>

<details>
<summary><strong>Idle, media, and break reminders</strong></summary>

The idle timeout stops counting after a period without keyboard or mouse input. Two optional Windows-only settings can keep counting when the focused app is actively playing music or video. Paused media, background players, sleep, and the lock screen do not count. Media detection only decides whether an idle sample is kept; the active Focus profile still decides its category.

Break reminders send one nudge after the configured minutes of continuous active tracking; both break reminders and notifications must be enabled. Pausing or five idle minutes resets the stretch, including when media keeps tracking. Sleep, lock, or an earlier stop in counted tracking (such as a shorter idle timeout or an ignored app) also resets it. Switching between tracked apps does not reset the timer, and it does not repeat until a new stretch begins.

</details>

<details>
<summary><strong>Local data and recovery</strong></summary>

Packaged builds use Electron’s sydtrack user-data directory. Raw daily activity stays available for 90 days; older days are compacted into verified rollups so long-term category, hourly, and app totals remain available. Analytics → Lifetime combines one summary per tracked day; clearing history resets it. The v2 storage migration creates a recovery copy before changing schema. Malformed settings, statistics, or session files are preserved beside the original rather than silently discarded.

`.sydtrack` backups can include activity, sessions, settings, profiles, browser keywords, and app identities. Import is additive for activity. Re-importing the same backup adds its activity again, while session IDs are deduplicated.

</details>

<a href="https://ko-fi.com/sreyandas"><strong>Like sydtrack? Buy me a coffee</strong></a>
