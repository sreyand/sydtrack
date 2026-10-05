# sydtrack — next iteration

This is the single product and engineering handoff for future work. It describes what sydtrack is, what makes it worth using, and what should happen next. Release history belongs in `docs/release-notes-*.md`; validation procedures belong in the existing manual guides.

## The product thesis

**sydtrack helps people see patterns in their digital work without creating a replay of their life.**

It is for people who want a meaningful answer to “where did my computer time go?” but do not want screenshots, keystrokes, exhaustive browser history, workplace monitoring, an account, or a cloud service holding their activity.

The intended loop is:

1. Start with a useful profile.
2. Work normally while sydtrack stays out of the way.
3. Review a concise, understandable picture of the day.
4. Correct uncertain classifications when necessary.
5. Use the result to make one better decision.

sydtrack is a reflection tool, not an employee monitor, project-management suite, life logger, or AI productivity coach.

## Why it can stand out

Clean visuals are not a moat by themselves. sydtrack is differentiated when its restraint is consistent across the whole product:

- Local data, no account, and no automatic upload.
- Active-window tracking without screenshots or keystrokes.
- Enough classification to create insight without preserving every possible detail.
- A curated native application rather than a technical tracking toolkit.
- Explanations and user corrections instead of pretending classification is objectively correct.
- Focus tools without team dashboards, billing, profitability, or administrative machinery.
- Direct language and a small number of useful views.

The competitive space helps define this position:

- [RescueTime](https://www.rescuetime.com/) is comprehensive and cloud-backed, combining tracking, blocking, goals, reports, teams, and timesheets.
- [ActivityWatch](https://activitywatch.net/) is local-first and extensible, with a philosophy of retaining granular raw data for future analysis.
- [Rize](https://rize.io/) emphasizes AI categorization, coaching, teams, projects, and business reporting.

sydtrack should not chase their breadth. Its opportunity is to be the calm, opinionated option between a cloud productivity suite and a configurable life-logging platform.

## Who must find it easy

sydtrack is not only for quantified-self enthusiasts or people who already understand productivity analytics. A basic user should be able to install it, accept the recommended defaults, leave it alone, and later understand where the day went.

Design for this usage distribution:

- Most people use Home and occasionally Roundup.
- Some people explore Analytics or change their profile.
- A small minority edits rules, imports profiles, changes retention, or tunes tracking.

The sophisticated machinery can exist, but it must not become required knowledge. Do not create a separate “basic mode”; use progressive disclosure, useful defaults, and contextual explanations so there is only one coherent product.

Each page has one job:

- **Home:** What have I spent time on, am I broadly on track, and what is happening now?
- **Roundup:** What stood out today?
- **Analytics:** What patterns exist over time?
- **Focus Tags:** Why was something classified this way, and how do I change future classification?
- **Settings:** How does sydtrack behave, and where is my data?

If a screen cannot state its purpose this simply, it is becoming too dense.

## Free by design

sydtrack is free. Donations and recommendations are welcome, but they do not change functionality.

- Do not lock features behind payment.
- Do not add donation popups, countdowns, guilt, or repeated prompts.
- A quiet support link belongs in About, the README, and the download page.
- Do not add cloud infrastructure or a subscription merely to justify charging users.

The trust model is stronger when the product has no incentive to collect more behavioral data than it needs.

## Current stopping point

The repository version is 2.5.0, with Windows setup and portable packages prepared and automatically checked locally; manual acceptance and publication are pending. Version 2.2.0 added first-run onboarding, an activity timeline, app-by-app and Lifetime Analytics, same-day P/U/O/I corrections, a neutral Other choice on Home, and an optional profile-switch shortcut to the coherent 2.1 foundation. Version 2.2.1 added the `r/` classification fix and recovery from transient Windows foreground-probe failures. Version 2.3.0 added the source/topic classification refinement, coverage-aware Focus Share, precise corrections with Undo, optional GitHub update checks, and three additional themes. Version 2.4.0 added the live-category tray logo, simpler tray menu and Home layout, profile-aware rule confirmations, and on-demand Home category explanations. Version 2.5.0 adds clickable focusscore days, flexible pauses, Forest, custom exact-minute FocusBoost schedule controls, and quieter Settings. Release history belongs in `docs/release-notes-*.md`; the dated records below preserve the state at each implementation step.

Windows x64 is the supported release target. macOS and Linux packaging are best-effort CI targets. Builds are unsigned. The app is ready for observation and user testing; it does not need another feature wave before people try it.

Early informal feedback is positive: people described the app as simple and said its terms and corrections make sense. This is useful evidence, but it does not yet establish first-run comprehension, multi-day retention, or whether the shortcut works well across operating systems. Keep observing actual use rather than broadening the feature set by default.

## Next iteration, in order

### 1. Onboarding and trust

Build a 60–90 second first-run path with recommended choices already selected. The primary path should:

1. Open with “See the pattern, not every move.”
2. Keep the detailed active-app/title explanation in the README and Settings rather than making first run read like a manual.
3. State that it never records keystrokes, screenshots, background windows, or automatic uploads.
4. Ask what the computer is mainly used for: General, Coding, Writing, Study, or Creative.
5. Finish with General or the chosen profile, Balanced tracking, startup enabled, and a clear **Start tracking** action.

Pause, Export, Delete My Data, category definitions, tracking precision, and the generated demo can be shown as optional follow-up—not required setup. Do not tour every control or ask seven questions before the user sees value. The goal is informed trust and a useful starting configuration.

The first-run path is implemented: new installs start paused, state the privacy boundary in one short line, offer the five starter profiles with General selected, and begin tracking only after **Start tracking**. Existing installs skip it. The setup avoids explaining polling cadence or every correction control up front. Early feedback says the app's terms and corrections are understandable; observe first-run use and a later return visit before treating onboarding as fully validated.

### 1a. Human language and progressive disclosure

Prefer language that communicates an outcome without assuming technical vocabulary. Candidate presentation changes to validate with users:

| Internal or current term | Friendlier presentation |
| --- | --- |
| Polling mode | Tracking response |
| Low / Med / Max | Battery saver / Balanced / Precise |
| Focus profile | What are you doing? |
| Focus Tags | Activity rules |
| Uncategorized | Not classified |
| Focus share goal | Daily focus target |
| Productive / Unproductive | On track / Distracting |
| Local-first | Your data stays on this computer |

Do not rename persisted fields or export formats merely to change visible copy. Early users said the current terms and correction controls make sense, so do not rename Productive / Unproductive on speculation. Test any alternative such as “On track / Distracting” before changing visible copy broadly.

Advanced controls should sit lower on the page, inside an optional section, or appear when relevant. A user who never opens Activity rules must still receive a useful result.

### 2. A visual day timeline

Add one primary visualization showing category blocks across the day. It should make long focus periods, interruptions, idle gaps, and context switching visible without exposing a raw title-by-title surveillance log.

The timeline must aggregate adjacent compatible activity, handle missing/idle periods honestly, and provide accessible text equivalents. Keep controls to those users actually need; category/profile filters and a text-range disclosure were removed after they made Day Analytics feel cluttered.

Implemented in Analytics → Day. New raw days store coalesced local segments containing only category, timestamps, and profile ID; detected idle is separate. Pauses and unknown gaps are not recorded as activity. Older days retain their hourly (or daily-only) totals and are labeled as lower precision rather than assigned a fabricated sequence. Exact segments expire with the existing 90-day raw retention; compact long-term rollups do not keep them.

The timeline fits the recorded activity by default instead of shrinking a few evening minutes onto a full-day rail. At overview scale it summarizes dominant category in clock-aligned intervals and marks genuinely mixed intervals, keeping high-frequency switching readable; zooming in reveals exact changes and preserves the text equivalent. Trackpad pinch zooms around the pointer; +/− zoom, 0 reset, and a bottom-right Recenter button are available. Hourly totals remain for older or partially recorded days, but are hidden when the exact timeline already tells the story.

### 3. An actionable Other inbox

Turn uncategorized time into a short queue ordered by impact:

> Classify these three apps to explain 90% of today's Other time.

One correction should have an obvious scope: today only, future profile rule, or Ignore. Do not make users manage hundreds of tags before sydtrack becomes useful.

The Focus Tags “Unclassified today” queue was removed because it duplicated Analytics and cluttered the page. Day Analytics → Apps now shows app slices and grouped activity reasons with compact P/U/O/I buttons for same-day corrections. Home offers quick P/U/O/I actions for future classification of the last focused item, and Focus Tags retains the editable profile rules. These scopes must stay distinct: an Analytics correction changes today's activity, while a Home or Focus Tags rule affects future tracking. Browser classification remains title-only, with no address-bar or URL capture. Do not restore a second review queue without user evidence that it solves a different problem.

### 4. Privacy controls that reinforce the promise

Consider:

- Tracking days and working hours.
- An always-private app list.
- “Pause for 15 minutes.”
- A persistent, unmistakable paused state.
- A plain-language “What sydtrack stores” view.
- Optional retention choices and a visible local data location.

Privacy controls are product features, not compliance decoration.

Settings → Tracking → Data now has an expandable “What sydtrack stores” explanation and shows the local data folder. It states the title-only Windows boundary, what is saved locally, the 90-day detailed-history limit, and what remains in long-term rollups. This adds no collection or retention change.
Timed pauses are implemented for 15, 30, and 60 minutes: they skip foreground probes, survive restarts, and resume without backfilling paused time. Settings also offers **Until I resume** through the same compact control; the sidebar and tray retain pause/resume access. The other controls above remain candidates.

### 5. Intention versus outcome

Sessions may optionally ask, “What are you working on?” Store a short local label, not a project hierarchy. A completion summary can compare planned duration, completed duration, profile-aligned time, and the largest interruption when the evidence exists.

Do not turn this into task management, invoicing, or another scoring system.

The optional “Working on” input was removed from the current Sessions UI to recover the original centered, simple timer layout. Existing intention labels remain readable in session history and compatible with backups. Intention-versus-outcome is a future candidate, not a reason to put that input back without user demand.

### 6. Advanced analytics, for insight and delight

Good candidates:

- Focus-block duration distribution.
- Longest uninterrupted block.
- Category-switch count and common transitions.
- Hour-of-day heatmap.
- Week-over-week “what changed.”
- Profile-aligned time.
- A compact calendar view.

Each visualization must answer a sentence-shaped question. Avoid dashboards whose only purpose is to look advanced. Prefer interpretable facts over a synthetic productivity score.

Analytics now includes a restrained Lifetime view: total tracked time, category totals, active days, average active day, and most tracked day. It derives from existing long-term rollups; it is not a second score or a title-level archive.

Day Analytics also shows the longest recorded productive block when exact timeline segments exist. Idle, category changes, and untracked gaps break a block. Older hourly-only days show no invented block length.

Analytics → Apps now separates “where time went” by app from the Day/Week/Month category summaries. Its app donut keeps mixed-use browsers as one app slice; the expanded Day detail retains per-reason categories and same-day corrections. The compact layout and consistent row spacing are intentional. Avoid adding a second, more verbose classification table.

### 7. Custom desktop chrome

The generic Electron/Windows frame has been replaced with an integrated title bar. Continue to check its behavior at different display scales and on macOS/Linux rather than redesigning it again for appearance alone.

Aim for the finish associated with a good macOS application without copying macOS traffic lights. Preserve Windows resizing, snap layouts, minimize/maximize/close behavior, keyboard access, contrast, drag regions, and the system menu. Windows 11 material effects can be progressive enhancement, not a requirement.

## Gerald the Duck

Gerald is brand texture, not a feature system.

Appropriate uses:

- A friendly onboarding guide who disappears afterward.
- An About-page illustration.
- A rare empty state or small Easter egg.
- A quiet visual accent when there is not enough data for Roundup.

Do not add currency, levels, streak rewards, care mechanics, unlocks, shame, or a separate Gerald settings category. If Gerald creates maintenance, notification noise, or gamification pressure, remove him.

## Explicit non-goals

Do not add these without a new product decision backed by user evidence:

- Screenshots, keystrokes, camera, microphone recording, or background-window surveillance.
- Cloud accounts, team monitoring, manager dashboards, or employee scoring.
- AI coaching merely because competitors advertise AI.
- A universal productivity score or moral judgment attached to an app.
- Automatic browser-address capture that can retain typed but unsubmitted text.
- Large project-management, calendar, invoicing, or timesheet systems.
- Decompress, gamification, mascot progression, streak sharing, or generated share cards.
- More settings explanations when a clearer label can do the job.
- A separate basic mode that creates two divergent versions of the interface.
- Donation nagging, paid feature gates, subscriptions without a real ongoing service, or monetization tied to behavioral data.

## How to judge the next iteration

Test with at least five people who did not build the app, including people who do not already use productivity trackers. Observe rather than explain.

Useful questions:

- Can they describe what sydtrack records and does not record?
- Can they finish onboarding without understanding “polling,” “local-first,” or classification rules?
- Can they choose an appropriate profile without help?
- Can they explain why an app received its category?
- Can they correct a mistake with the intended scope?
- Do they understand Other and Ignore?
- Can they identify one useful pattern after a day?
- Do they voluntarily reopen it after three days?
- What did sydtrack help them notice that they would not otherwise have noticed?

The strongest evidence is repeated voluntary use, not time spent exploring settings during a demo.

## Product rules for future agents

- Preserve the clean information hierarchy. New features must earn a place in an existing view or justify a new one.
- Optimize the default path for someone who wants to install, forget, and glance later. Advanced users can discover depth without imposing it on everyone.
- Use progressive disclosure instead of a separate basic mode.
- Keep language concise, human, and literal. Do not expose formulas unless they resolve genuine ambiguity.
- Distinguish observation from interpretation. App names and titles do not establish whether an activity was worthwhile.
- Make uncertainty and missing data visible rather than inventing precision.
- Prefer one actionable observation over several decorative metrics.
- Preserve user data, stable IDs, export compatibility, and malformed originals during recovery.
- Profile changes affect future classification. Same-day Analytics corrections do not silently rewrite unrelated or historical activity.
- Sleep, lock, pause, idle, delayed probes, and clock discontinuities must never backfill away time.
- Keep raw-history reads bounded and outside live polling. Raw retention is 90 days; older compact rollups remain readable.
- Keep Electron sandboxing and context isolation enabled, Node integration disabled, navigation restricted, permissions denied by default, and IPC payloads narrowly validated.
- External publication, tags, releases, and uploads require explicit user authorization.


## Profile-switch shortcut

An optional global shortcut now cycles through configured Focus profiles, skipping empty slots. It defaults to Off. Settings → Tracking offers Alt+B, Ctrl/⌘+Alt+B, and Ctrl/⌘+Shift+B; a conflicting shortcut is rejected without replacing the previous working choice. The new profile is confirmed in the app and, when notifications are enabled and supported, with a quiet desktop notification. As of v2.4.0, tray hover is reserved for current tracking state and an optional session countdown, not the profile name. Unsaved Focus Tags edits must not be silently discarded. Profile changes affect future classification, not past totals.

Validate the shortcut on packaged Windows and best-effort macOS/Linux builds; operating systems may reserve combinations or decline global registration. Do not present the shortcut as necessary for basic use.

## Verification

Run before release:

```powershell
npm test
npm run test:ui
npm run test:profiles-ui
npm run test:tray-native
npm run dist:win
npm run test:packaged
git diff --check
```

Inspect the packaged version and hashes. Use the manual lifecycle and Focus profile guides when changes touch those systems. A successful build does not publish a release.

Supporting references:

- [README](README.md)
- [Current release notes](docs/release-notes-2.5.0.md)
- [Lifecycle validation](docs/manual-lifecycle-validation.md)
- [Focus profile validation](docs/manual-focus-profiles-validation.md)
- [Focus profile generation guide](docs/focus-profile-generation-guide.md)
- [Packaging and signing](build/README.md)

## Next classification refinement: useful Other, without a review queue

Other means the available foreground app and window title do not justify a productive or unproductive judgment. Keep it in totals and app slices; do not turn every unmatched title into a prompt, a separate inbox, or a long list on Home. Analytics → Apps should remain grouped by app, with more detail only when a person expands a row.

The `r/jhu` case exposed two distinct issues. A literal `r/` keyword previously failed to match `r/jhu` because the whole-term matcher required a boundary after the slash; the matcher and bundled presets now recognize `r/<subreddit>` as an unproductive title marker. More generally, a recognizable page/source marker is stronger evidence about context than a topical word such as `jhu`. This does not imply that every Reddit visit is wasted, nor that an ambiguous title can be classified reliably. Keep the Windows tracker title-only; do not inspect addresses or add an extension to solve this.

The refinement should make corrections precise without storing a title-by-title browsing diary:

1. Use a small, tested set of high-confidence title signatures. Allow an explicit, more-specific user rule (for example `r/learnpython`) to override a broad source marker (`r/`); broad topical words alone must not override a clear source marker. Fall back to Other when no reliable signature exists.
2. Store only the minimal local source identifier needed to distinguish a recognizable group (for example `r/jhu`), under the existing 90-day detailed-data retention. Do not persist full unmatched titles, URLs, searches, or source identifiers in lifetime rollups just to make the UI more granular.
3. In expanded Analytics → Apps, show concise recognizable groups and one aggregate “Unrecognized pages” row. Do not offer a P/U/I action on a generic no-match group if it would silently reclassify unrelated browser pages. A future rule based on the currently focused title is different from a same-day correction to a known group; label that scope plainly.
4. Preserve existing records. Older activity without a source identifier stays aggregated and cannot be split or retroactively assigned to invented pages. Test mixed-use browsers, marker/topic conflicts, specific exceptions, false-positive lookalikes, and the no-marker fallback across themes and keyboard access.

Judge this work by whether someone can understand and correct a real mistake in one place, without being asked to review their entire browsing day. Do not broaden the UI merely to make the Other percentage look smaller.

## Classification and coverage implementation — 2026-09-30 (unreleased)

This pass implements the bounded classification refinement above, not a new tracking mechanism or a UI overhaul. The package version remains 2.2.1; no release, installer, or personal saved profile was changed.

### Implemented

- **Source before topic.** Shared browser matching recognizes a small set of explicit source labels, strips browser-shell suffixes, and normalizes full-width characters and whitespace. `r/jhu` follows its source rule rather than the `jhu` topic tag. A specific `r/learnpython` exception or source-containing phrase can override a broad rule. Equal-length specific conflicts retain Other > Unproductive > Productive precedence. Generic `r/` matching does not mistake a search query or a reference in prose for a subreddit visit.
- **No browser-name catchall.** Exact browser names are ignored as P/U/O keywords, including custom browser identities. A conditional notice in Focus Tags explains existing browser-name rules without deleting them; Quick Add rejects new ones. Whole-app Ignore remains available.
- **Precise local groups.** New recognized subreddit activity records only the short `r/community` identifier as its reason, allowing a same-day correction to one community without changing another. Existing records stay untouched; detailed identifiers expire with raw history and are absent from lifetime rollups. Full unmatched titles, searches, and URLs are not added to storage.
- **Safer correction scope.** Expanded Apps labels generic browser no-match activity “Unrecognized pages.” P/U/I are unavailable for that aggregate, with a backend guard including custom browsers. Older miscorrected aggregates can still be restored to Other. Home derives quick rules from known sources or existing matched keywords rather than inventing a last-word tag; an unfamiliar title stays Other. The Other chip is consistent between Home and Analytics.
- **Reliable quick saves.** Home disables competing actions while saving, pins the original profile guard, and does not apply a late response to a newly focused page. Moving from Ignore to P/U/O is a single atomic profile save, so a failed rule write cannot leave the app unexpectedly unignored. Profile switching waits for an ongoing tag/Home save. Optimistic outlines are cleared when tracking confirms the state or rules reload. Native app identities and browser fallback lists are included in the renderer's preview context.
- **Coverage-aware Focus Share.** The ratio remains P/(P+U) by default and displays “Based on X of Y tracked.” If less than half of active tracked time is classified, the ratio remains visible but receives no goal verdict or daily score, and does not enter rolling daily averages. Week comparisons also avoid claims from mostly-Other data. Home shows a neutral partial-picture status. The optional include-Other calculation uses all active tracked time; this is a chosen metric, not a guess that Other is unproductive.
- **Lower matcher overhead.** Patterns, normalized rule metadata, and source-rule candidates are cached; arrays are checked for replacement and in-place edits. Pattern/source caches are bounded, rule-list caches are weakly held, and no page titles are cached. Tracking now uses one classification result for category and reason instead of classifying twice per sample.

### Verification and performance

The automated classification fixtures cover suffixes across browsers, custom identities, source/topic conflicts, specific P/O exceptions, marker lookalikes, regex metacharacters, live rule edits, native identity precedence, precise corrections, restart persistence, and rollup privacy. Goal tests cover mostly-Other days, the half-classified boundary, include-Other calculations, and comparisons/averages. Isolated renderer and real-preload profile checks cover selected/hover behavior, disabled unknown controls, late saves, precise source exceptions, coverage presentation, themes, and responsive layouts.

Run `npm test`, `npm run test:ui`, and `npm run test:profiles-ui`. `npm run benchmark:classification -- --compare-head` compares synthetic browser fixtures against the committed matcher without reading user activity. In a local three-run median measurement, General improved from about 178 to 26 µs/classification (~6.8×), and a synthetic 1,500-term list from about 1,469 to 93 µs (~15.8×). These are matcher measurements, not whole-app CPU improvements or classification-accuracy claims.

### Remaining boundaries and next validation

- Titles cannot reveal intent. Research on a distraction site can still be valuable, and a work-labeled page can still be a distraction. Known source labels are heuristics, not verified browser addresses.
- Unknown titles stay Other; ordinary topic keywords can still be imperfect. Do not add broad productive browser rules merely to make coverage larger.
- Source recognition is deliberately finite. Add signatures only from representative, sanitized examples with positive and lookalike tests; do not persist a browsing diary to discover them.
- Older activity cannot be split into communities or pages after the fact. A label recorded as “google chrome” remains historical evidence, not a reason to rewrite the day.
- The majority-classified threshold is a guard against a visibly partial picture, not statistical confidence or a guarantee that P/U assignments are right.
- Before the next release, run the manual profile/classification checks on Windows with real titles and observe regular users for several days. Prioritize wrong-source matches and correction scope over maximizing the percentage classified. Packaged lifecycle validation remains required before distributing new installers.

## Sidebar spacing and additional themes — 2026-09-30 (unreleased)

- The collapsed sidebar footer now uses 44px slots and 8px gaps. Notification and pause controls share the navigation's target size, with centered 16px icons. Tracking status is a small light in its own slot instead of an empty circular button; its text and hover label remain available. Expanded and narrow-window layouts retain their existing arrangement.
- Added **Tide** (deep blue/teal), **Linen** (warm paper/brass), and **Plum** (dark violet). They reuse the existing type, spacing, borders, and category semantics. Midnight remains the default, and the original five themes are unchanged.
- New themes are wired into the Appearance picker, renderer, validated settings IPC, saved preferences, and native window canvas/title controls. Bright dark-theme action fills use dark text for readable contrast; privacy warnings also follow dark palettes.
- Regression checks cover theme-list/palette consistency, settings persistence, new-theme contrast and selection, and collapsed footer spacing/containment across window sizes and tracking states. No version bump or installer rebuild is part of this pass.
- Verified `npm test`, `npm run test:ui`, `npm run test:profiles-ui`, and `git diff --check`. New-theme sampled text/controls meet the 4.5:1 contrast check; visual previews were inspected.

## Quick corrections, Undo, and update checks — 2026-09-30 (unreleased)

### Implemented

- **Unknown-title correction on Home.** Recognized sources and existing matched rules retain their one-click P/U/O behavior. An unfamiliar browser title opens a compact phrase picker instead of inventing a tag: select literal title words or type a matching phrase, choose P/U/O, and confirm. Browser suffixes are stripped from the preview; browser-name catchalls, fabricated phrases, partial-word matches, and address rules are rejected. Full unmatched titles remain transient, not saved as a browsing diary. Only the explicitly confirmed keyword enters the active profile. Existing historical groups are not rewritten or split.
- **Scoped Undo.** Home rules and whole-app Ignore changes, plus Analytics today-only match corrections, expose a brief Undo action. Opaque main-process tokens expire after two minutes and are single-use, bounded, and cleared on data import/clearing/deletion or quit. Rule Undo restores only the affected keyword/Ignore memberships, preserves unrelated edits, and checks the active profile and current target state. Activity Undo restores the prior override (including its absence), hourly/category totals, and all currently recorded seconds for that match, including time accrued after the original change. Stale/day-changed/deleted activity cannot be restored. Disk failures leave the token available to retry.
- **Draft protection and compact feedback.** Home corrections do not overwrite unsaved Focus Tags edits. Saving locks competing quick actions, pins the original profile, and never relabels a newly focused page. Unconfirmed phrase drafts close on a page/profile change or Escape. Undo stays visible while hovered/focused; category letters retain neutral-at-rest, colored-on-hover, and selected-outline behavior. The picker scrolls into view on smaller windows.
- **True Last focused state.** Quick saves account for today-only overrides instead of pinning a future-rule preview over the tracker. Rule changes and today corrections refresh the existing ephemeral Last focused context while sydtrack is foreground, rather than erasing it. Refreshing that category does not capture a new window, write a title diary, or rewrite time. Destructive invalidation still clears the context.
- **Quiet GitHub release checking.** Settings → Tracking → Updates shows the installed version, Check now, and an automatic-check toggle that defaults off. Opt-in checks run at most daily and wait until onboarding is complete. Stable semantic versions are compared numerically across the bounded public release list, ignoring draft/prerelease/malformed tags and publication order. A newer release adds a small Settings marker and a View release button; there is no OS notification, automatic asset download, or installer execution. The opener constructs a fixed sydtrack GitHub release URL rather than trusting remote links or renderer URLs.
- **Network bounds and privacy.** The main-process GET sends only fixed public API headers, not activity/titles/profiles/credentials/cookies. Redirects are not followed; responses are size-bounded and checks time out after eight seconds. Concurrent requests are deduplicated, manual clicks have a cooldown, and offline/rate-limit failures back off without claiming the installed version is current. `update-check.json` stores only version/check timestamps/backoff metadata and is removed by Delete all my data. README/build privacy wording now discloses the optional GitHub request. Tracking remains offline-capable.

### Verification and handoff

- `npm test` covers literal phrase validation, source-specific exceptions, atomic Ignore changes, target-only Undo, unrelated edits, newly earned seconds, previous override restoration, restart persistence, stale profiles, expiry, failures, and IPC sender/payload guards. Syntax checking now includes renderer scripts too.
- Updater fixtures cover semantic ordering (including 2.10 versus 2.3), stable-only selection, constructed safe links, defaults, cached daily scheduling, manual deduplication/cooldown, opt-out, onboarding, offline/rate-limit backoff, redirects, malformed/oversized/interrupted responses, timeouts, and cancellation. The real public endpoint was checked once and selected v2.2.1; no personal data or settings were used.
- Isolated `npm run test:profiles-ui` exercises title selection and confirmation, cancellation, unsaved-tag protection, Home and Analytics Undo, opt-in settings, and layouts at 800/1040/1600px. `npm run test:ui` samples the new controls across all eight themes at 4.5:1 or better and verifies existing layouts. Preview screenshots are temporary test artifacts, not repository/user activity data.
- Still unreleased: no version bump, installer rebuild, commit, or publication in this pass. Before release, smoke-test the installed setup and portable builds with real foreground tracking and a manual update check. Title-only classification still cannot determine intent, and the checker intentionally does not provide automatic installation.

## v2.3.0 release preparation — 2026-09-30

- Bumped package and lockfile root versions to 2.3.0 without changing dependency versions. Promoted the classification/correction/theme/update work into README's release summary and finalized [v2.3.0 release notes](docs/release-notes-2.3.0.md), with publication explicitly pending.
- Built unsigned Windows x64 setup and portable executables. Existing versioned artifacts were preserved. Native-build `.DELETE.*` leftovers are excluded from the final packages; no dependency or personal files were deleted.
- Core, renderer, and real-preload profile tests passed. Added `npm run test:packaged` (Windows, Node 22+) to compare the archived source and smoke-test both extracted executable payloads with temporary data and startup writes intercepted before application code runs.
- Packaged checks passed for fresh onboarding, sandbox/preload IPC, Home rules/Undo, Analytics correction/Undo, preserved seeded history, restart settings, and manual GitHub release checking. The setup/portable app archives are identical. No personal activity was used, and the checker made no downloads or installation attempts.
- Recorded sizes, SHA-256 hashes, exact verification scope, and pending manual checks in [release validation](docs/release-validation-2.3.0.md); distribution hashes are in `dist/SHA256SUMS-2.3.0.txt`.
- Publication, tagging, and committing have not happened. The diagnostic launches extracted app payloads, not the installer/portable wrappers. Manual setup/upgrade, tray/login, real browser-title, and lock/sleep/resume acceptance remain before publishing. Feature work is frozen for this release; the next product step is regular-user observation rather than additional controls.

## Live-category tray logo — 2026-10-01 (next release, unreleased)

- With explicit user approval to implement, added the four supplied logo PNGs unchanged: standard black, Other gray, Productive green, and Unproductive red. Colors affect only the tray; window/taskbar branding remains unchanged. The original exports have white backgrounds, retained deliberately.
- The indicator uses the current tracker decision, never sticky Last focused. Paused, onboarding, idle, ignored apps, missing windows, screen-off, sleep/lock, unavailable probes, and clock discontinuities are neutral black with an explanatory tooltip. Demo categories are labeled Demo. Opted-in foreground media follows the existing counting decision.
- A small tracker notification invalidates the indicator immediately on profile/rule/today-correction changes, pause boundaries, sleep/lock changes, stop, or probe failure. A new sample restores the color. An invalidated in-flight probe cannot revive the old assignment. A single bounded expiry timer neutralizes a stale category if tracking stops reporting; it never performs an additional foreground probe or writes activity.
- All images are decoded once and cached with 1x/2x/3x representations. Unchanged colors and tooltips are not resent. Missing/corrupt variants fall back to the standard logo while text still gives the state. Existing menus, timed pause, focusboost, alerts, profile labels, and double-click-to-open remain intact. No settings, IPC surface, automatic notifications, or extra data collection were added.
- Added `npm run test:tray` to the core suite and `npm run test:tray-native` for an isolated real Electron Tray/NativeImage check. Synthetic fixtures cover live category, stale Last focused, onboarding, pause/resume, lock/sleep, idle, media, demo, profile changes, delayed/failed probes, missing assets, image caching, high-DPI sizes, and timer cleanup. Native tests verify all four logos preserve their supplied pixels at each scale. Manual Windows tray/overflow and lifecycle checks are documented in the existing guide.
- The existing v2.3.0 setup, portable, release notes, and checksums are not rebuilt or replaced. Package version remains 2.3.0 pending the next release decision; the README clearly distinguishes this source-only feature from those frozen artifacts. No commit, tag, upload, or publication is part of this pass.
- Verification passed: `npm test`, `npm run test:ui`, `npm run test:profiles-ui`, `npm run test:tray-native`, and `git diff --check`. Rechecked the frozen setup/portable SHA-256 hashes against the release-preparation values. Small-size light/dark-background previews were inspected; real Windows tray placement and lock/sleep acceptance remain manual.

## Tray copy and Home layout cleanup — 2026-10-01 (next release, unreleased)

- Tray hover now shows only `sydtrack — <current state>` and a short countdown when a session is running. Removed the profile name, boost state, and notification state from hover; no app/page titles are added.
- The tray menu contains Open sydtrack, Pause/Resume tracking, Pause for 15 minutes, a checked Notifications toggle, and Quit. FocusBoost remains on Home and in Settings, not in the tray menu. Manual resume clears a timed-pause deadline; pause controls are disabled before onboarding. No profile-switching submenu or new settings were added.
- Home keeps its chart and Last focused behavior. FocusBoost and the profile selector now share one compact row; the selector shows the current name with a descriptive hover/accessibility label. Fractional columns account for the gap instead of allocating 100% plus the gap, avoiding spill beyond the content area.
- The inline title-rule editor has tighter spacing, a header Cancel action, and category buttons opposite Save on one row. Title selection, explicit phrase confirmation, current-profile/future-only scope, keyboard cancellation, draft protection, and Undo are preserved. Responsive checks cover 800/1040/1600px, contained inputs/actions, compact editor height, aligned Home controls, and usable profile menus.
- Source-only follow-up: no version bump, setup/portable rebuild, commit, or publication. The v2.3.0 artifacts remain frozen.
- Final copy refinement requested by the user: the editor heading is “Create a rule.” Removed both the phrase-selection subtitle and the current-profile/future-tracking subtitle. The phrase field is now at least 44px tall with 12px horizontal padding and an accessible name; saving still affects future rules in the current profile, not historical totals.
- Rule-save confirmations now identify the saved profile: `Rule saved for future tracking. (default profile)` or `(Coding profile)`. The backend returns the name of the profile actually saved, rather than reading a possibly changed selector after the response. Ignore confirmations use the same context; today-only Analytics corrections do not imply a profile change. The toast expands to its content while remaining viewport-bounded, with text wrapping and usable Undo/dismiss controls on smaller windows.
- Regression checks cover exact Default/Coding confirmation text, name snapshotting across a rename, long confirmation messages at 800/1040/1600px, Undo, the cleaned editor copy, and its 44px accessible input.
- Verification passed: the full `npm test` suite, UI/profile UI checks, isolated native tray checks, and `git diff --check`. Updated the old percentage-column layout assertion to guard the new gap-aware Home columns.

## Home category explanations — 2026-10-01 (v2.4.0 candidate, unreleased)

- The existing Last focused category chip now exposes “Why this category?” on hover, keyboard focus, or click. There is no new card, permanent subtitle, or title-testing tool. Click can keep the explanation open; Escape, clicking elsewhere, scrolling, or leaving Home closes it.
- Explanations use the actual classifier result, distinguishing profile keywords, global Browser keywords, app rules, unmatched Other, Ignore, and today-only corrections. A subreddit group such as `r/jhu` still keeps its existing activity identity, while the explanation can correctly name the winning `r/`, `reddit`, or neutral exception keyword. Demo activity is labeled explicitly.
- Category and explanation refresh together after rules, corrections, and Undo. Matching refreshed Last focused metadata takes priority over a narrower rule-save preview. Retained today-only corrections carry their date, so an overnight or paused snapshot does not misleadingly call yesterday’s correction “today.” Missing or stale evidence disables the explanation rather than inventing a reason.
- Explanation metadata is transient: no extra foreground probes, title storage, activity regrouping, history rewrite, IPC command, network request, or setting was added. Rule/profile strings are displayed as plain text. The tooltip is viewport-bounded and keyboard-described, with contrast checked across all eight themes.
- Added core regression coverage for winning-rule identity, correction precedence/scope, saved profile names, day-boundary wording, refresh without earning time, demo, and private disk history. UI checks cover hover/focus/click/Escape, stale-context dismissal, safe text, save/Undo, and 800/1040/1600px layouts. Version and frozen v2.3.0 artifacts are unchanged; no release publication is part of this pass.
- Verification passed: `npm test`, `npm run test:ui`, `npm run test:profiles-ui`, and `git diff --check`. The isolated Home preview was visually inspected; no personal tracking data was used.

## v2.4.0 release preparation — 2026-10-01

- Bumped package and lockfile versions to 2.4.0 without dependency upgrades. Updated README, [release notes](docs/release-notes-2.4.0.md), packaging guidance, and the manual lifecycle checklist for live tray status and Home category explanations.
- Created local Windows x64 setup and portable files plus `dist/SHA256SUMS-2.4.0.txt`. Both executables carry 2.4.0 Windows metadata, remain unsigned, and contain identical app archives. Frozen v2.3.0 setup/portable hashes were rechecked and are unchanged.
- The production-payload check caught the shared explanation formatter missing from the protected file allowlist. The final build permits that exact script; regression coverage still denies unrelated source modules. Packaged fixtures use the actual saved profile name rather than assuming every fresh profile is named Default.
- Passed the full core suite, isolated UI/profile checks, native tray checks, and checks of both extracted packages. Those packages use the real main/preload/protocol/sandbox, with temporary data, tracking paused, and startup writes intercepted. Explanations, cleaned rule editor, profile confirmations, Undo, native artwork decoding, and restart/history preservation were checked. GitHub metadata checks identified published 2.3.0 below the local 2.4.0 build, with automatic checks off.
- [Release validation](docs/release-validation-2.4.0.md) records final sizes/hashes, verification limits, and remaining manual acceptance. Installer/portable wrappers, real keyboard interaction, taskbar scaling, and real sleep/lock/tracking checks remain manual. No commit, tag, upload, installation, or publication was performed. The next step is acceptance and release, not another feature wave.

## Clickable focusscore days — 2026-10-05 (unreleased)

- With user approval, Week and Month focusscore day cells become native keyboard-accessible buttons with subtle hover/focus feedback and a selected-date affordance. Activating a day opens the existing Day Analytics for that exact date.
- **Back to focusscore** restores the originating Week or Month view, focus on the clicked day, and the prior scroll position.
- Historical days reuse existing empty, Other-heavy, and older hourly-only states without inventing detail. Late requests and live updates cannot overwrite the selected date, which stays pinned across midnight. Returning grids overlay current-day totals and refresh their bounded history range at rollover; invalidated pending reads cannot revive stale caches.
- This is navigation into existing analytics: no new metric, dashboard, IPC command, tracking behavior, stored data, setting, score formula, notification, or focusstreak change. Package version remains 2.4.0; existing setup/portable files are frozen. No packaging, publication, or commit is part of this pass.
- Verification passed: `npm test`, `npm run test:ui` (now including the dedicated `test:score-navigation` check), the isolated real-preload profile checks, and `git diff --check`. Synthetic fixtures cover exact dates, trusted Enter/Space/Escape input, Back focus/scroll, empty/Other-heavy/daily-only/hourly-only days, delayed replies, current-score freshness, midnight range refresh, and 800/1040/1600px dark/light layouts. Selected-grid and Day screenshots were inspected. No personal activity was used.

## Flexible tracking pauses — 2026-10-05 (unreleased)

- Settings uses one **Pause for** menu with 15, 30, and 60 minutes or **Until I resume**. Choosing a duration pauses immediately; the same control becomes **Resume** while paused.
- The sidebar keeps its one-click indefinite pause/resume toggle and shows the countdown during a timed pause. The tray's **Pause for** submenu offers 15, 30, and 60 minutes.
- Timed deadlines persist across restarts and expire automatically. Paused time is never backfilled into activity, and the existing pause/privacy boundary is preserved. The legacy 15-minute pause entry point remains compatible.
- Source-only follow-up: package version remains 2.4.0; existing setup/portable files are frozen. No release-note/version update, package rebuild, commit, or publication is part of this pass.
- Verification passed: the full core suite, isolated general UI, profile UI, clickable focusscore navigation, dedicated pause-menu checks, and native tray checks. Synthetic fixtures cover exact durations, restart/expiry and paused-time accounting, immediate selection, indefinite pause/resume, countdowns, trusted keyboard input and focus restoration, failed-write retries, shared pending-action guards, navigation/scroll dismissal, and 800/1040/1600px layouts across all eight themes. The real Electron tray submenu/callbacks and onboarding guard were checked without a production tracker, and the open-menu screenshot was inspected. The dedicated `test:pause-menu` check is included in `test:ui`; no personal activity was used.

## Settings and Analytics spacing polish — 2026-10-05 (unreleased)

- Tracker's three top control rows now share a consistent minimum height and centered labels. Removed the extra gap after **Keep session history** before Polling; paused status text can still expand its row naturally.
- Moved **Back to focusscore** below all Day analytics information. Existing keyboard navigation, selected date, and return focus/scroll behavior are unchanged.
- Isolated pause-menu geometry checks pass across all eight themes and three widths; score-navigation checks pass in dark/light layouts at three widths, including the bottom button's visual order, keyboard reachability, and return behavior. Settings and Day screenshots were inspected. No theme, tracking change, version bump, or package rebuild in this polish pass.

## Forest appearance — 2026-10-05 (unreleased)

- Added Forest as a ninth built-in preset: evergreen surfaces, muted sage accents, and warm ivory text using the existing layout and typography. Productive, Unproductive, and Other retain their green/red/gray meaning; no appearance customization UI was added.
- Ordered choices by canvas luminance, darkest to lightest: Midnight, Tide, Plum, Forest, Dusk, Linen, Graphite, Coral, Starlight. Midnight remains the initial default, and existing saved theme choices are preserved.
- Forest saves through the validated settings path, survives restart and unrelated settings updates, and supplies matching native window/titlebar colors. Dark privacy-warning styles include Forest. Packaged checks now use the archive's own theme catalog rather than a fixed count, retaining compatibility with frozen eight-theme builds.
- Verification passed: the full core suite, expanded hardening/storage checks, isolated UI and real-preload profile checks, and pause-menu/layout checks across all nine themes at three widths. Forest's 30 sampled UI color pairs exceed 4.5:1 contrast; the picker preserves order, fits without overlap, and wraps when constrained. Synthetic Forest Settings and Home screenshots were inspected.
- Source-only change: version remains 2.4.0 and existing setup/portable artifacts remain unchanged. No dependency changes, package rebuild, commit, tag, upload, or publication.

## Consistent schedule controls and quieter Settings — 2026-10-05 (unreleased)

- FocusBoost's Starts/Ends controls now use compact, themed dropdown triggers and an exact-minute hour/minute picker, including AM/PM where the locale uses it. Existing HH:mm settings and overnight schedules remain unchanged; native time inputs are preserved as a fallback if the new picker module is unavailable.
- The picker edits a draft before **Set time**, uses the existing settings/preload save path, and supports keyboard navigation, Escape/Cancel, and outside/navigation/scroll dismissal. Failed saves restore the confirmed time and retain the attempted draft for retry; pending saves guard both time controls.
- Notifications fields now have one 8px label-to-control gap, without stacked margins or artificial two-line label heights. Removed redundant Polling, Idle, Reminders, and Messages headings; retained useful Daily goals/Breaks headings in sentence case and the normal Focus profile hotswap field label.
- Removed Wellbeing's trailing divider whether optional Breaks controls are hidden or enabled. Existing controls, dependent-field visibility, and all saved settings are preserved.
- The full core suite, hidden general UI checks (72 Settings width/theme/state combinations), clickable focusscore navigation, profile UI, and pause-menu regressions pass. Focused schedule checks cover all 60 minutes, exact overnight edits, cancellation, keyboard/focus behavior, draft/retry preservation, delayed/failed writes, settings reload/disable, native fallback, all nine themes at three widths, short-height windows, and a real 24-hour locale reload. Clean Wellbeing and Notifications screenshots were inspected; `test:schedule-time` is also included in `test:ui`.
- Source-only change: version remains 2.4.0; frozen setup/portable artifacts were not rebuilt. No dependency changes, new IPC/settings keys, tracking changes, commit, tag, upload, or publication.

## v2.5.0 release preparation — 2026-10-05

- With explicit user approval to package the release, promoted the work since the frozen v2.4.0 build into the README and [v2.5.0 release notes](docs/release-notes-2.5.0.md): clickable focusscore days and bottom Back action, flexible pause durations, Forest and ordered appearances, custom exact-minute FocusBoost schedule controls, and Settings spacing/copy cleanup.
- The final Breaks control is one regular-weight sentence with an inline minutes field and enable switch. Reset details are documented in README’s expandable **Idle, media, and break reminders** section; the timer’s behavior and stored settings are unchanged.
- Bumped package and lockfile versions to 2.5.0 without dependency upgrades. Created unsigned Windows x64 setup and portable files, both carrying 2.5.0 executable metadata, plus `dist/SHA256SUMS-2.5.0.txt`. Existing v2.4.0 executable hashes are unchanged.
- Passed the full core suite, isolated UI checks (general Settings states, clickable focusscore navigation, flexible pauses, and exact-minute/24-hour schedule controls), real-preload profile checks, and native tray checks. Both extracted packages passed their checks with identical app archives; the new UI modules run in the actual packaged main/preload/protocol/sandbox, with synthetic data, startup writes intercepted, and no production tracker. Restart/settings persistence and seeded activity/session history preservation passed.
- [Release validation](docs/release-validation-2.5.0.md) records final sizes/hashes, the verification boundary, and remaining manual acceptance. GitHub metadata checking reported published 2.4.0 below the local 2.5.0 build; automatic checks remain off by default. Installer/portable wrappers, real tracking, Windows tray interaction, and sleep/lock acceptance remain manual.
- No new classifier behavior, Focus Share formula, focusstreak feature, or foreground tracking reliability fix is included. The reported Windows backend timeout/JSON warning is deferred at the user’s request and must not be described as fixed.
- Previous versioned release artifacts remain frozen. No commit, tag, upload, production-profile migration, or installation is part of this preparation.
