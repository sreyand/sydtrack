<div align="center">
  <img src="./renderer/assets/logo-mark.png" width="200" alt="Logo">
  <br><br>
<video src="https://github.com/user-attachments/assets/71ab84a4-04a8-404e-9be7-914084e00791" width="100%" autoplay loop muted playsinline style="pointer-events: none;"></video>

SydTrack is a local-first Windows productivity tracker that watches your active window, classifies time as productive, unproductive, or other, and helps you understand where your day went.


## Features

- **Local active-window tracking:** records foreground applications on Windows.
- **Browser-independent title tracking:** recognized browsers, apps named Browser, and configured browser identities are productive when no title keyword matches. No browser extension is needed.
- **Keyword overrides:** unproductive keywords such as YouTube take priority over the browser default.
- **Portable website rules:** existing `site:example.com` tags are retained, but require a captured address. Normal Windows tracking currently uses title keywords; automatic address capture remains experimental and disabled.
- **Separate app categories:** the same app can appear in both productive and unproductive analytics with separate time totals.
- **Home:** mood, time pie, last-focused app, FocusBoost, and quick productive/unproductive/ignore actions.
- **Analytics:** day, week, month, hourly, and app views, plus a weekly comparison and per-app hours.
- **Roundup:** daily focus-share goal, optional screen-time limit, top focus, biggest distraction, peak hour, and a daily story.
- **Decompress breaks:** local suggestions after an hour on track, or a break you start yourself.
- **Gamification (off by default):** focus-share streaks, alternate wording, a duck mascot, and a local share card. Nothing is uploaded.
- **Focus sessions:** Pomodoro, deep work, or custom timers with session history and distraction counts.
- **Focus Tags:** editable productive, unproductive, and ignore keywords.
- **Focus profiles:** five slots, a Home chooser below FocusBoost, and management on Focus Tags. New installs include General, Coding, Writing, Study, and Creative. Existing profiles are preserved, and empty slots are filled once on upgrade. Deleted starter profiles stay deleted on later launches.
- **Live tag search:** reflects current editor drafts immediately, including unsaved additions and removals; quick-add moves a tag between lists.
- **FocusBoost:** shorter reminders for unproductive streaks, with optional schedules.
- **Portable data:** local `.sydtrack` backups and `.sydtrack-profile` focus-tag packs.
- **Tray operation:** keeps tracking quietly while the main window is hidden.
- **Consistent layout:** collapsed sidebar controls share a center line; narrow windows retain horizontal navigation, and custom-session minutes align with the Start button.

## Privacy

SydTrack is fully local. It does not require an account and does not upload activity to a server. Local data can include application names, window titles, and URLs captured from active browser windows, so treat exported backup files as private records.


### Usage

Requirements:

- Windows 10 or Windows 11, x64
- Node.js 18 or newer
- PowerShell available for the Windows foreground-window backend

From the project directory in Command Prompt:

```
npm install
npm start
```

The first `npm install` downloads Electron. After that, day-to-day work is `git pull` then `npm start`. Run `npm install` again only when `package-lock.json` changed. Same Command Prompt steps are in [CONTRIBUTING.md](CONTRIBUTING.md).

Optional demo mode:

```
npm run start:demo
```

Run the smoke tests:

```
npm test
```

Optional isolated Electron UI checks (no tracking or access to your activity data):

```
npm run test:ui
```


## Classification

Classification checks process names, window titles, URLs, and configured keywords.

1. Ignored process identities are excluded from tracking.
2. For non-browser apps, an explicit unproductive process-name tag wins; otherwise productive process identities take precedence over window titles and URLs.
3. For browsers with a captured address, `site:` tags take precedence over keywords. The most specific matching domain wins; the same domain in both lists is unproductive. For example, productive `site:learn.youtube.com` overrides unproductive `site:youtube.com` on that subdomain only. Rules match domain boundaries, never a domain mentioned in a page title or URL path.
4. Unproductive keyword matches in the active Focus profile take priority over ordinary productive keywords.
5. Productive keyword matches in the active Focus profile are applied next.
6. If the focused window is a browser and the profile did not match, the local browser keyword list is checked with exact tokens (not substrings). Unproductive keywords in that list win over productive ones. The list ships with a local default and travels with backups. Editing it in the UI is a later Focus Tags change. It does not apply to native apps. Changing bundled defaults does not rewrite stored history.
7. Recognized browsers with no matching keyword default to productive.
8. Unknown applications without a match are other.

Add website tags to the existing Productive or Unproductive lists (one per line). Use a domain without a path or wildcard, such as `site:youtube.com`. Ignore still applies to whole applications. Website tags travel with existing backups and profile packs; no data migration is needed. Older app versions preserve these strings but do not interpret them as website rules.

Normal Windows tracking reads the foreground application and window title. For browsers, add title keywords such as `youtube` or `github` in Focus Tags. It makes no address-bar query and does not read typed but unsubmitted addresses. This works independently of browser engine, provided the browser exposes a meaningful foreground title. Pages with vague or missing titles cannot be classified reliably from their website; they use the existing productive browser default unless a keyword matches.

Recognition includes Chrome, Firefox and other named browsers, an executable named `Browser.exe`, and application names ending in a separate `Browser` word. Add an unfamiliar executable name to `browserApps` in your app-data `app-identities.json`, then restart. Existing identity files without this optional array continue to work. Main tracking and the UI share the same recognition rules. A document title mentioning "browser" does not turn its native application into a browser.

The address-bar prototype remains disabled in production: live Chrome testing exposed unsubmitted-address capture and an unreliable focus guard. It can only be enabled explicitly by a developer through the backend factory for testing. Existing `site:` rules and profile packs remain readable, but these rules do not match ordinary title-only Windows samples. Do not rely on them instead of title keywords yet. No stored history is rewritten when this capture behavior changes.

`app-identities.json` contains the configurable process/app identities. On first run SydTrack copies it to its app-data folder, where it can be customized without editing the installed app (restart after editing). Identities match exact process names or executable basenames, with or without `.exe`. Browser identities never override content classification. Invalid JSON falls back to bundled identities while preserving the custom file.

Browser activity is stored by category, so switching from a productive GitHub tab to an unproductive YouTube tab does not reclassify the earlier time.

Idle tracking pauses at the configured timeout and retains time earned before that timeout. That timeout remains the default for music and video. Two separate settings, both off by default, can keep counting when the focused app itself is playing media: **Track music while idle** and **Track video while idle**. Paused or stopped playback never counts. Playback in a different app does not keep the focused window active. Sleep and the lock screen never count, even when media is playing. A confirmed screen-off counts only opted-in foreground music. Productive and unproductive tags still choose the category; media only decides whether the idle sample is kept. Sessions and reminders use that same decision. Paused or idle ticks do not add session distractions. Sessions that expire while the app is closed finish at their original deadline.

Playback state is Windows-only. SydTrack reads System Media Transport Controls in the existing PowerShell probe, and only when a media-while-idle setting is on. A probe failure is “no playback.” Chromium often reports video as Music; YouTube and similar tabs are treated as video unless the title is clearly music. macOS and Linux keep the idle timeout. The screensaver flag is a conservative Windows screen-off signal.

System sleep and screen lock suspend capture independently of your idle timeout. Waking while still locked keeps capture suspended, and waking never changes a manual tracking pause. Interrupted probes are discarded; sleep, lock, and tracker startup clear old reminder streaks. Focus sessions keep their wall-clock deadlines, but away time is not added to their app totals.

Slow foreground probes retain elapsed time while regular timer callbacks continue. A gap in those callbacks (over five seconds at the default polling rate), a backward clock change, or a sleep/lock event invalidates uncertain time. Activity intervals split across local hour/day boundaries, including fractional seconds and samples arriving after the day was archived. A failed reminder-streak write is logged without escaping the sleep/lock handler; the in-memory streak still resets. Lifecycle behavior has automated simulation coverage; physical Windows sleep/lock acceptance testing remains outstanding. See the [manual validation guide](docs/manual-lifecycle-validation.md).

Pause takes effect even while a foreground-window check is pending. Reading the session timer from the tray or UI does not consume its completion event, and tray settings changes do not replay completed events.

## Focus profiles

### Included profiles and downloads

The native app ships with these five editable starter profiles. Fresh installs have all five ready to use; choose one from **Home → focusprofile** or **Focus Tags**. Existing installations keep their profiles and active selection, and receive starter profiles in empty slots once on upgrade. Deleting a starter profile does not cause it to return on restart.

- [Download General](profiles/general.sydtrack-profile) — broad everyday work.
- [Download Coding](profiles/coding.sydtrack-profile) — editors, terminals, development documentation, and source control.
- [Download Writing](profiles/writing.sydtrack-profile) — writing, notes, and research.
- [Download Study](profiles/study.sydtrack-profile) — coursework, flashcards, and reference tools.
- [Download Creative](profiles/creative.sydtrack-profile) — design, illustration, and editing.

On GitHub, open a profile link and use **Download raw file**, keeping the `.sydtrack-profile` extension. In sydtrack, open **Focus Tags → Import profile…** and select the downloaded file. Import adds and activates the profile; a free slot and a unique name are required. There are five slots total, so an installation that already has all five does not need to import them again. All lists remain editable. These are starting points; review video/social keywords for your workflow.

See [profile notes](profiles/README.md) for assumptions. The downloaded packs match the bundled profiles. The native executable is available from the repository’s [Releases page](https://github.com/sreyand/sydtrack/releases) when published.

Use **Home → focusprofile** (under FocusBoost) or the **Active profile** selector at the top of **Focus Tags** to switch profiles. All profile controls live on Focus Tags: New profile, Rename, Delete, Import, and Export. New profiles start empty and become active immediately. The lists below and Quick Add edit that active profile; there is no duplicate Settings editor. Switching asks before discarding unsaved edits. Default cannot be deleted; deleting the active profile returns to Default.

Each profile owns complete lists, with global process identities retained. Focus Tags and quick-tagging edit the active profile. All tag edits and profile switches now affect future tracking only: historical totals are neither reclassified nor hidden by new Ignore tags. Running focus sessions keep their deadlines and app totals; switching resets the reminder/classification boundary and discards pending capture. Unsaved editor changes require confirmation before switching; canceled or failed saves retain drafts.

The first upgrade creates `focus-profiles.json` in your Data folder from existing rules/ignore lists. Legacy files stay untouched but are no longer the active source; edit profiles through the UI. Profile writes are atomic and the selection survives restart. A malformed profile collection is preserved with a recovery filename before falling back to Default from legacy tags; tracking pauses for review. Downgrading to an older version uses the preserved legacy tags and does not understand newer named profiles.

**Import profile…** adds a `.sydtrack-profile` file to an empty slot and activates it. **Export profile…** exports the saved active profile; save tag drafts first. Full backups in Settings include the profile collection and active selection; importing one asks before replacing profiles. Older backups update Default’s lists without replacing other named profiles. The schema and existing files are unchanged.

Give another model the [profile generation guide](docs/focus-profile-generation-guide.md), then validate its files with `node scripts/validate-profile.js <file>`. Follow the [manual Focus profile checks](docs/manual-focus-profiles-validation.md) for local acceptance. The five starter profiles above are bundled with the native app. Coral, Midnight, Dusk, and Starlight themes remain deferred.

## Data

During development, SydTrack stores local data under `data/`. Packaged builds use Electron's `sydtrack` user-data directory. Data includes daily statistics, hourly buckets, history, compact daily rollups, settings, and focus sessions. An existing `focusflow` user-data directory from before the rename is copied in once; the old folder is left in place.

Settings can export:

- `.sydtrack` backups containing activity, session history/checkpoints, settings, rules, ignore lists, and app identities.
- `.sydtrack-profile` files containing portable focus tags only.

Activity backup merge is additive: importing the same backup again adds its activity time again. Session IDs are deduplicated; completed records supersede stopped checkpoints, and later records of the same status supersede earlier ones. An active session is exported as a stopped checkpoint without stopping the source timer; importing never starts a timer or replaces the target's active session. Older schema-1 backups remain accepted; absent session/identity fields leave those local data intact. Older app versions ignore these additional fields. Validation covers all imported sections before any replacement, but multi-file imports are not transactional on disk failure. Daily statistics, settings, app identities, and session writes replace complete JSON files to reduce truncation risk. Malformed stored statistics are preserved and reported rather than silently reset.

Live snapshots contain today's data only. Opening Analytics parses the retained window (up to 90 days) once and shows a loading state; week and month views slice that result. Summaries are cached until history changes or the local date rolls over. Raw history older than 90 days is deleted only after a compact daily rollup is stored and read back; those rollups stay so category totals, hourly category totals, and per-app totals remain available to export and to later reads. Manually edited archive files require an app restart to refresh the cache.

### Storage format

`storage-schema.json` records schema version 2 (`product`, `rawRetentionDays`, `migratedAt`). Schema 1 is the previous layout with no version file. The first launch that sees schema 1 copies the data directory to `migration-backups/schema-1-<timestamp>/` and writes `BACKUP_COMPLETE.json` last, then builds rollups, then writes the schema file. After that write succeeds, the schema-1 copy is deleted so raw history is not kept twice past 90 days; live `history/` plus `rollups/` are the record. A crash during the copy leaves no complete marker; the next launch removes incomplete `schema-1-*` folders and retries. If the backup itself fails, the error is logged, schema 1 is left in place, and purge is skipped for that launch so the app still starts.

The Windows installer identity stays `com.gitpaperclip.sydtrack`. electron-builder/NSIS derives the uninstall GUID from `appId`; changing it would install side by side and orphan the previous install. User-facing names and the `sydtrack` user-data folder are unchanged. An existing `focusflow` user-data directory is copied once.

| Path | Contents |
| --- | --- |
| `stats.json` | Today's raw day |
| `history/YYYY-MM-DD.json` | Raw day, kept for 90 days |
| `rollups/YYYY-MM-DD.json` | Compact rollup kept after the raw file is purged |
| `retention-journal.json` | Dates whose raw delete was committed but not finished |
| `settings.json`, `sessions/`, `focus-profiles.json`, `app-identities.json` | Preferences, sessions, profiles, identities |

A raw day stores `byCategory`, `byApp` (including keyword attribution), and `byHour` with per-app totals. A rollup stores `schemaVersion`, `date`, `byCategory`, 24 hourly category totals, and `apps` as `{ name, category, seconds }`. It does not keep hourly per-app maps or keyword attribution. Ignored time is omitted. The purge writes the rollup, reads it back, records the date in the journal, then unlinks the raw file and clears that journal entry. If the rollup cannot be verified, the raw file stays.

Settings can export JSON (`.sydtrack`, format `sydtrack-backup`, backup schema 1) or CSV (one spreadsheet of activity, sessions, settings, tags, and profiles). Both are local files. Import backs up settings, profiles, and tag lists first. Older `focusflow-backup` and `focusflow-profile` files still import. **Delete all my data** removes activity, rollups, sessions, settings, profiles, tags, logs, migration copies, and the leftover focusflow data folder, then restores the bundled defaults. **Clear all history** removes activity only.

Warnings, errors, fatal main-process errors, renderer console errors, and renderer exits are recorded locally in `logs/errors.log` under the Data location shown in Settings. Rotation retains one previous file, approximately 256 KB per file. Errors may contain private paths or text; review logs before sharing. They are never uploaded or included in backups. Logging failures are contained. Startup failures before logging is installed may still require the terminal output.

Imported settings apply the same behavior as Settings controls. In particular, importing **Keep session history: off** retains only the latest local session. That retained entry is saved successfully before older session files are removed.

Malformed settings and session files are set aside as adjacent `.recovery-…` files, preserving their exact original contents. A recovery notice shows the saved location. Settings recovery restores defaults and pauses tracking until you review Settings and resume. Damaged sessions are not reconstructed automatically. File-access or preservation failures stop the operation instead of resetting data; startup failures display an error. Recovery files remain local and are not automatically pruned or included in exports.

## Project Status

SydTrack is an actively developed Windows desktop application. Default browser tracking uses foreground titles; automatic website detection is deferred pending reliable browser-independent validation. It remains focused on simple productivity totals and reminders, without a browsing-history dashboard or background-tab monitoring.

License: GPL v3

Focus Tags layout: a full-width focusprofile switcher, Quick Add, then the profile editor and management actions at the bottom. Home aligns the focusprofile label with focusboost and places the active name at the right.

### Correcting today’s Apps analytics
Analytics → Apps ranks the ten most-used apps today, then shows separate rows by original classification and matched keyword. The ten-app limit can therefore produce more than ten rows. New activity records the winning keyword (or Browser default / App identity / No matching keyword). Legacy activity shows **Keyword not recorded**; past titles are not reconstructed.

P/U/ign applies to that activity row only: today’s recorded category totals and hourly buckets update, and the same app/keyword/classification combination uses the correction for the rest of today. Other keywords in the same browser stay independent. Legacy rows can be corrected historically but cannot identify future matching content. Ignore keeps already-recorded seconds recoverable; selecting P/U restores them, or clicking selected ign restores them as Other. Time skipped during Ignore cannot be recreated. Corrections survive restart and expire at midnight; prior days, Focus profiles, and session logs stay unchanged. Previously made whole-app corrections remain honored until midnight, but the Apps UI now creates only row corrections.

Matched keywords are stored locally alongside the existing app aggregates; no extra titles, URLs, network capture, or browser-specific instrumentation is added. Existing files and backups load without fabricated attribution.

Analytics → Month shows the last 30 days as a Home-style pie with focus share in the center. By default that is productive divided by productive + unproductive. Settings can include uncategorized Other apps, which changes the denominator to active tracked time. Below are total tracked time, active days, average per active day, the five most-used apps, and a day-by-day focus score with 7- and 30-day averages. Ignored time is excluded. Reopen Month to refresh the summary.

## Goals and breaks

The daily goal is a focus share, recommended at 80%. It is a category ratio, not a grade. A day meets the goal when the rounded percentage is at least the goal. Days under one minute of the denominator are too thin to score. Rolling averages skip those days instead of treating them as zero.

An optional screen-time limit is off until you enable it. It counts active tracked time (productive + unproductive + other). Idle and ignored time are already excluded. Roundup shows it next to the focus-share goal only while it is on.

A previous productivity-hours goal is not converted into a percentage. If you had changed it from the 2 hour default, that number becomes the starting value for the screen-time limit and the limit stays off. The old field is kept so older versions and backups can still read it.

Decompress suggestions use tracked time, not the clock. After 60 minutes of the focus-share denominator while the rounded share stays at or above the goal, sydtrack can suggest a break. The default is 3 breaks of 10 minutes. Other apps do not count toward that hour unless Other is included in focus share. The suggested clock time comes from your own history: the next hour where focus share usually drops by at least 5 points, seen on at least 3 days. You can start a break even after the daily suggestions are used. Notices stay on this computer.

Gamification is off by default. Streaks count a day only after 15 minutes of the focus-share denominator. A qualified day under the goal resets the streak. A day with less tracked time does not. The duck is a separate unserious-mode toggle. Share copies text to the clipboard or saves a PNG you choose. There is no upload.
