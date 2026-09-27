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

Version 2.2.0 has been published. It adds first-run onboarding, an activity timeline, app-by-app and Lifetime Analytics, same-day P/U/O/I corrections, a neutral Other choice on Home, and an optional profile-switch shortcut to the coherent 2.1 foundation. Version 2.2.1 is a local hotfix candidate that includes the `r/` classification fix described below and recovery from transient Windows foreground-probe failures; it has not been published.

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
“Pause for 15 minutes” is implemented: it skips foreground probes, survives restarts, and resumes without backfilling paused time. The other controls above remain candidates.

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

An optional global shortcut now cycles through configured Focus profiles, skipping empty slots. It defaults to Off. Settings → Tracking offers Alt+B, Ctrl/⌘+Alt+B, and Ctrl/⌘+Shift+B; a conflicting shortcut is rejected without replacing the previous working choice. The new profile is confirmed in the app and, when notifications are enabled and supported, with a quiet desktop notification. The tray tooltip also names the active profile. Unsaved Focus Tags edits must not be silently discarded. Profile changes affect future classification, not past totals.

Validate the shortcut on packaged Windows and best-effort macOS/Linux builds; operating systems may reserve combinations or decline global registration. Do not present the shortcut as necessary for basic use.

## Verification

Run before release:

```powershell
npm test
npm run test:ui
npm run test:profiles-ui
npm run dist:win
git diff --check
```

Inspect the packaged version and hashes. Use the manual lifecycle and Focus profile guides when changes touch those systems. A successful build does not publish a release.

Supporting references:

- [README](README.md)
- [Current release notes](docs/release-notes-2.2.1.md)
- [Lifecycle validation](docs/manual-lifecycle-validation.md)
- [Focus profile validation](docs/manual-focus-profiles-validation.md)
- [Focus profile generation guide](docs/focus-profile-generation-guide.md)
- [Packaging and signing](build/README.md)

## Next classification refinement: useful Other, without a review queue

Other means the available foreground app and window title do not justify a productive or unproductive judgment. Keep it in totals and app slices; do not turn every unmatched title into a prompt, a separate inbox, or a long list on Home. Analytics → Apps should remain grouped by app, with more detail only when a person expands a row.

The `r/jhu` case exposed two distinct issues. A literal `r/` keyword previously failed to match `r/jhu` because the whole-term matcher required a boundary after the slash; the matcher and bundled presets now recognize `r/<subreddit>` as an unproductive title marker. More generally, a recognizable page/source marker is stronger evidence about context than a topical word such as `jhu`. This does not imply that every Reddit visit is wasted, nor that an ambiguous title can be classified reliably. Keep the Windows tracker title-only; do not inspect addresses or add an extension to solve this.

Future work should make corrections precise without storing a title-by-title browsing diary:

1. Use a small, tested set of high-confidence title signatures. Allow an explicit, more-specific user rule (for example `r/learnpython`) to override a broad source marker (`r/`); broad topical words alone must not override a clear source marker. Fall back to Other when no reliable signature exists.
2. Store only the minimal local source identifier needed to distinguish a recognizable group (for example `r/jhu`), under the existing 90-day detailed-data retention. Do not persist full unmatched titles, URLs, searches, or source identifiers in lifetime rollups just to make the UI more granular.
3. In expanded Analytics → Apps, show concise recognizable groups and one aggregate “Unrecognized pages” row. Do not offer a P/U/I action on a generic no-match group if it would silently reclassify unrelated browser pages. A future rule based on the currently focused title is different from a same-day correction to a known group; label that scope plainly.
4. Preserve existing records. Older activity without a source identifier stays aggregated and cannot be split or retroactively assigned to invented pages. Test mixed-use browsers, marker/topic conflicts, specific exceptions, false-positive lookalikes, and the no-marker fallback across themes and keyboard access.

Judge this work by whether someone can understand and correct a real mistake in one place, without being asked to review their entire browsing day. Do not broaden the UI merely to make the Other percentage look smaller.
