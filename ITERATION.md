# SydTrack — next iteration

This is the single product and engineering handoff for future work. It describes what SydTrack is, what makes it worth using, and what should happen next. Release history belongs in `docs/release-notes-*.md`; validation procedures belong in the existing manual guides.

## The product thesis

**SydTrack helps people see patterns in their digital work without creating a replay of their life.**

It is for people who want a meaningful answer to “where did my computer time go?” but do not want screenshots, keystrokes, exhaustive browser history, workplace monitoring, an account, or a cloud service holding their activity.

The intended loop is:

1. Start with a useful profile.
2. Work normally while SydTrack stays out of the way.
3. Review a concise, understandable picture of the day.
4. Correct uncertain classifications when necessary.
5. Use the result to make one better decision.

SydTrack is a reflection tool, not an employee monitor, project-management suite, life logger, or AI productivity coach.

## Why it can stand out

Clean visuals are not a moat by themselves. SydTrack is differentiated when its restraint is consistent across the whole product:

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

SydTrack should not chase their breadth. Its opportunity is to be the calm, opinionated option between a cloud productivity suite and a configurable life-logging platform.

## Who must find it easy

SydTrack is not only for quantified-self enthusiasts or people who already understand productivity analytics. A basic user should be able to install it, accept the recommended defaults, leave it alone, and later understand where the day went.

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
- **Settings:** How does SydTrack behave, and where is my data?

If a screen cannot state its purpose this simply, it is becoming too dense.

## Free by design

SydTrack is free. Donations and recommendations are welcome, but they do not change functionality.

- Do not lock features behind payment.
- Do not add donation popups, countdowns, guilt, or repeated prompts.
- A quiet support link belongs in About, the README, and the download page.
- Do not add cloud infrastructure or a subscription merely to justify charging users.

The trust model is stronger when the product has no incentive to collect more behavioral data than it needs.

## Current stopping point

Version 2.1 is a coherent product boundary. It includes Home, Sessions, Roundup, Analytics, Focus Tags, five starter profiles, goals, FocusBoost, themes, backups, recovery, local retention, startup behavior, and selectable foreground polling.

Windows x64 is the supported release target. macOS and Linux packaging are best-effort CI targets. Builds are unsigned. The app is ready for observation and user testing; it does not need another feature wave before people try it.

The next milestone is not “v3.” It is watching several new users install SydTrack, understand what it records, correct a classification, and return to review another day.

## Next iteration, in order

### 1. Onboarding and trust

Build a 60–90 second first-run path with recommended choices already selected. The primary path should:

1. Say: “See where your computer time goes.”
2. Explain that SydTrack observes the active app and uses its title for local classification.
3. State that it never records keystrokes, screenshots, background windows, or automatic uploads.
4. Ask what the computer is mainly used for: General, Coding, Writing, Study, or Creative.
5. Finish with General or the chosen profile, Balanced tracking, startup enabled, and a clear **Start tracking** action.

Pause, Export, Delete My Data, category definitions, tracking precision, and the generated demo can be shown as optional follow-up—not required setup. Do not tour every control or ask seven questions before the user sees value. The goal is informed trust and a useful starting configuration.

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

Do not rename persisted fields or export formats merely to change visible copy. Test “On track / Distracting” before replacing Productive / Unproductive everywhere; the new wording should feel less judgmental without becoming vague.

Advanced controls should sit lower on the page, inside an optional section, or appear when relevant. A user who never opens Activity rules must still receive a useful result.

### 2. A visual day timeline

Add one primary visualization showing category blocks across the day. It should make long focus periods, interruptions, idle gaps, and context switching visible without exposing a raw title-by-title surveillance log.

The timeline must aggregate adjacent compatible activity, handle missing/idle periods honestly, and provide accessible text equivalents. It should be filterable by category and profile where the stored data supports that distinction.

### 3. An actionable Other inbox

Turn uncategorized time into a short queue ordered by impact:

> Classify these three apps to explain 90% of today's Other time.

One correction should have an obvious scope: today only, future profile rule, or Ignore. Do not make users manage hundreds of tags before SydTrack becomes useful.

### 4. Privacy controls that reinforce the promise

Consider:

- Tracking days and working hours.
- An always-private app list.
- “Pause for 15 minutes.”
- A persistent, unmistakable paused state.
- A plain-language “What SydTrack stores” view.
- Optional retention choices and a visible local data location.

Privacy controls are product features, not compliance decoration.

### 5. Intention versus outcome

Sessions may optionally ask, “What are you working on?” Store a short local label, not a project hierarchy. A completion summary can compare planned duration, completed duration, profile-aligned time, and the largest interruption when the evidence exists.

Do not turn this into task management, invoicing, or another scoring system.

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

### 7. Custom desktop chrome

Replace the generic Electron/Windows frame with a calm, integrated title bar after onboarding and the core analytics direction are validated.

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

- Can they describe what SydTrack records and does not record?
- Can they finish onboarding without understanding “polling,” “local-first,” or classification rules?
- Can they choose an appropriate profile without help?
- Can they explain why an app received its category?
- Can they correct a mistake with the intended scope?
- Do they understand Other and Ignore?
- Can they identify one useful pattern after a day?
- Do they voluntarily reopen it after three days?
- What did SydTrack help them notice that they would not otherwise have noticed?

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


## A new idea
Hotkey to quickswitch profiles that the user sets. So for example, pressing Alt+B to cycle. Ex. just now, i was watching youtube for my course, so if im in default productivity mode, i can do a quick Alt + B to cycle to Education? is this even feasible?

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
- [Current release notes](docs/release-notes-2.1.0.md)
- [Lifecycle validation](docs/manual-lifecycle-validation.md)
- [Focus profile validation](docs/manual-focus-profiles-validation.md)
- [Focus profile generation guide](docs/focus-profile-generation-guide.md)
- [Packaging and signing](build/README.md)
