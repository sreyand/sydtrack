<div align="center">
  <img src="./renderer/assets/logo-mark.png" width="150" alt="SydTrack logo">
  <h1>SydTrack</h1>
  <p><strong>See where your day actually went.</strong></p>
  <p>A private Windows productivity tracker with live activity, focus profiles, sessions, goals, and analytics—without an account, subscription, or cloud dashboard.</p>

  <p>
    <a href="https://github.com/sreyand/sydtrack/releases"><strong>Download for Windows</strong></a>
    ·
    <a href="docs/release-notes-2.0.0.md">What’s new in v2</a>
  </p>

  <p>
    <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-5B7CFA?style=flat-square">
    <img alt="Local first" src="https://img.shields.io/badge/data-local--first-39C59D?style=flat-square">
    <img alt="Version 2.0.0" src="https://img.shields.io/badge/version-2.0.0-8B7CF6?style=flat-square">
    <img alt="GPL v3" src="https://img.shields.io/badge/license-GPL--3.0-EF6A6A?style=flat-square">
  </p>
</div>

<video src="https://github.com/user-attachments/assets/71ab84a4-04a8-404e-9be7-914084e00791" width="100%" autoplay loop muted playsinline></video>

## Your workday, made legible

SydTrack watches the app in front of you, classifies the time, and turns the result into a clean picture of your day. It runs quietly in the tray and keeps the data on your computer.

| | |
| --- | --- |
| **Live daily view** | Productive, unproductive, and uncategorized time update as you work. The total advances smoothly every second. |
| **Focus profiles** | Switch between General, Coding, Writing, Study, and Creative without rebuilding your tags every time your work changes. |
| **Useful analytics** | Inspect today, the last week, the last 30 days, focus share, peak hours, top apps, and matched classification reasons. |
| **Focus sessions** | Run Pomodoro, Deep Work, or a custom timer with session history and distraction counts. |
| **FocusBoost** | Use a shorter reminder threshold when you want SydTrack to interrupt a distraction sooner. Optional schedules can arm it automatically. |
| **Daily goals** | Set a productive-time share target and, if useful, a limit for total active screen time. |

## Built to work on day one

SydTrack v2 includes **507 researched preset terms** across five editable profiles:

- **General** — office apps, planning, communication, research, and everyday work
- **Coding** — editors, terminals, source control, cloud consoles, databases, and developer documentation
- **Writing** — drafting, notes, references, publishing, grammar, and research tools
- **Study** — learning platforms, flashcards, academic databases, coursework, and math tools
- **Creative** — design, illustration, photo, video, audio, 3D, and asset libraries

Each profile also carries a Windows-specific Ignore baseline for shell surfaces such as Explorer, Search, Start, Snipping Tool, transient hosts, overlays, and SydTrack itself. The lists are starting points, not locked policy: edit them under **Focus Tags**, or import/export a profile as a `.sydtrack-profile` file.

[General](profiles/general.sydtrack-profile) · [Coding](profiles/coding.sydtrack-profile) · [Writing](profiles/writing.sydtrack-profile) · [Study](profiles/study.sydtrack-profile) · [Creative](profiles/creative.sydtrack-profile)

## Private by architecture

There is no SydTrack account and no analytics server.

- Activity, settings, sessions, and profiles stay on your computer.
- Tracking uses the foreground process and window title; no browser extension is required.
- The production tracker does not read typed-but-unsubmitted browser addresses.
- Backups are files you explicitly save. Nothing uploads automatically.
- Local exports can contain app names and window titles, so treat them like a private diary.

## A clearer loop

1. **Track** — SydTrack records the focused Windows application while you are active.
2. **Classify** — the active Focus profile matches app identities and title keywords.
3. **Review** — Home, Roundup, and Analytics show the day at different levels of detail.
4. **Correct** — fix a row for today or improve the active profile for future tracking.
5. **Refocus** — start a session or arm FocusBoost when the day begins to drift.

Changing profiles affects future tracking; it does not rewrite history. Analytics corrections are deliberately scoped to today so a profile switch cannot silently change the record of your day.

## Download

SydTrack currently targets **Windows 10/11 x64**.

- `sydtrack-2.0.0-setup.exe` — standard installer
- `sydtrack-2.0.0-portable.exe` — run without installation

Get both from [GitHub Releases](https://github.com/sreyand/sydtrack/releases). Quit an older copy from the tray before upgrading. Existing activity and settings are preserved. Builds are currently unsigned, so Windows may show a SmartScreen warning.

## What’s new in v2

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

Read the full [v2.0.0 release notes](docs/release-notes-2.0.0.md).

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

SydTrack checks ignored process identities first. For native apps, explicit app tags and productive app identities take precedence over unrelated words in a document or project title. For browsers, the active profile’s unproductive keywords win over productive keywords, followed by the editable browser fallback list. Recognized browsers with no match default to productive; unknown applications become Other.

The same browser can therefore contribute productive GitHub time and unproductive YouTube time without collapsing the two. Title matching is browser-independent. `site:example.com` rules remain portable, but production address capture is disabled until it can be made reliable without observing unsubmitted address-bar text.

</details>

<details>
<summary><strong>Idle and media behavior</strong></summary>

The idle timeout stops counting after a period without keyboard or mouse input. Two optional Windows-only settings can keep counting when the focused app is actively playing music or video. Paused media, background players, sleep, and the lock screen do not count. Media detection only decides whether an idle sample is kept; the active Focus profile still decides its category.

</details>

<details>
<summary><strong>Local data and recovery</strong></summary>

Packaged builds use Electron’s SydTrack user-data directory. Raw daily activity stays available for 90 days; older days are compacted into verified rollups so long-term category, hourly, and app totals remain available. The v2 storage migration creates a recovery copy before changing schema. Malformed settings, statistics, or session files are preserved beside the original rather than silently discarded.

`.sydtrack` backups can include activity, sessions, settings, profiles, browser keywords, and app identities. Import is additive for activity. Re-importing the same backup adds its activity again, while session IDs are deduplicated.

</details>

## Project status

SydTrack is actively developed and Windows-first. It is local-first software, not an employee-monitoring service, browser-history recorder, or cloud productivity platform.

Licensed under [GPL-3.0](LICENSE.md).
