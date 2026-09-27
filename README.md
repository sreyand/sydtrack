<div align="left">
  <img src="./renderer/assets/logo-mark.png" width="150" alt="sydtrack logo">
  <p><strong>See the pattern, not every move.</strong></p>
  <p>A private Windows productivity tracker with live activity, focus profiles, sessions, goals, and analytics—without an account, subscription, or cloud dashboard.</p>
    <p>
    <a href="https://github.com/sreyand/sydtrack/releases"><strong>Download for Windows</strong></a>
    ·
    <a href="docs/release-notes-2.2.0.md">What’s new in v2.2.0</a>
  </p>
  <p>
    <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-5B7CFA?style=flat-square">
    <img alt="Local first" src="https://img.shields.io/badge/data-local--first-39C59D?style=flat-square">
    <img alt="Version 2.2.0" src="https://img.shields.io/badge/version-2.2.0-8B7CF6?style=flat-square">
    <img alt="GPL v3" src="https://img.shields.io/badge/license-GPL--3.0-EF6A6A?style=flat-square">
  </p>
</div>

## Your workday, made legible

sydtrack watches the app in front of you, classifies the time, and turns the result into a clean picture of your day. It runs quietly in the tray and keeps the data on your computer.

| | |
| --- | --- |
| **Live daily view** | Productive, unproductive, and uncategorized time update as you work. The total advances smoothly every second. |
| **Focus profiles** | Switch between General, Coding, Writing, Study, and Creative without rebuilding your tags every time your work changes. |
| **Useful analytics** | Inspect category trends, an activity timeline, app-by-app time for day/week/month, and lifetime totals. Older days keep compact local summaries after detailed history expires. |
| **Focus sessions** | Run Pomodoro, Deep Work, or a custom timer with an optional intention, session history, and distraction counts. |
| **FocusBoost** | Use a shorter reminder threshold when you want sydtrack to interrupt a distraction sooner. Optional schedules can arm it automatically. |
| **Daily goals** | Set a productive-time share target and, if useful, a limit for total active screen time. |
| **Optional break nudges** | A configurable notification after a long stretch of active tracking, off by default. Pausing or five idle minutes resets the stretch. |
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

- `sydtrack-2.2.0-setup.exe` — standard installer
- `sydtrack-2.2.0-portable.exe` — run without installation

Find published builds on [GitHub Releases](https://github.com/sreyand/sydtrack/releases). Quit an older copy from the tray before upgrading. Existing activity and settings are preserved. Builds are currently unsigned, so Windows may show a SmartScreen warning.

## System requirements

| | Minimum | Recommended |
| --- | --- | --- |
| **OS** | Windows 10 x64 | Windows 11 x64 |
| **Processor** | 2-core x64 processor, 2 GHz | Modern 4-core processor or better |
| **Memory** | 4 GB RAM | 8 GB RAM |
| **Storage** | 350 MB free | 500 MB free |

On an Intel Core Ultra 9 185H, tray tracking used about **281 MB of working memory** and an estimated **~1% total CPU** with the 3-second tracking cadence. The short Windows foreground probe accounts for most of that CPU time; results will vary with the machine and other activity.

## What’s new in v2.2.0

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
npm run start:demo       # generated demo activity
npm run dist:win         # installer + portable build
npm run sync:profiles    # regenerate bundled profile packs
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup details.

<details>
<summary><strong>How classification works</strong></summary>

sydtrack checks ignored process identities first. For native apps, explicit app tags and productive app identities take precedence over unrelated words in a document or project title. For browsers, the active profile’s unproductive keywords win over productive keywords, followed by the editable browser fallback list. Browsers with no match and unknown applications remain Other.

The same browser can therefore contribute productive GitHub time and unproductive YouTube time without collapsing the two. Title matching is browser-independent. `site:example.com` rules remain portable, but production address capture is disabled until it can be made reliable without observing unsubmitted address-bar text.

</details>

<details>
<summary><strong>Idle and media behavior</strong></summary>

The idle timeout stops counting after a period without keyboard or mouse input. Two optional Windows-only settings can keep counting when the focused app is actively playing music or video. Paused media, background players, sleep, and the lock screen do not count. Media detection only decides whether an idle sample is kept; the active Focus profile still decides its category.

</details>

<details>
<summary><strong>Local data and recovery</strong></summary>

Packaged builds use Electron’s sydtrack user-data directory. Raw daily activity stays available for 90 days; older days are compacted into verified rollups so long-term category, hourly, and app totals remain available. Analytics → Lifetime combines one summary per tracked day; clearing history resets it. The v2 storage migration creates a recovery copy before changing schema. Malformed settings, statistics, or session files are preserved beside the original rather than silently discarded.

`.sydtrack` backups can include activity, sessions, settings, profiles, browser keywords, and app identities. Import is additive for activity. Re-importing the same backup adds its activity again, while session IDs are deduplicated.

</details>

<a href="https://ko-fi.com/sreyandas"><strong>Like sydtrack? Buy me a coffee</strong></a>
