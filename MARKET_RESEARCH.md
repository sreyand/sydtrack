# sydtrack market research

_Working assessment as of September 25, 2026. This is a decision document, not a claim that product-market fit has been established._

## Executive conclusion

sydtrack currently occupies a credible but unproven niche: a private, understandable Windows activity tracker for people who want to know where their computer time went without adopting a life-logging platform or a cloud productivity suite.

At its core, sydtrack is **Screen Time for Windows with contextual productivity classification**. That is not an insult or an empty category. Windows does not provide a polished, local, adult-oriented equivalent to Apple Screen Time; Microsoft's current screen-time product is primarily the account-based [Family Safety](https://support.microsoft.com/en-us/family-safety/set-screen-time-limits-across-devices) system for organizers managing family members.

The stronger long-term product is:

> **The private Screen Time app Windows should have shipped—built to explain how your attention behaved, not replay everything you did.**

There is enough evidence to release and test sydtrack publicly. There is not enough evidence to justify another large feature wave or to assume it can support a business. Its likely outcome ranges from a strong portfolio/open-source project to a useful niche product with thousands of users. Mass-market adoption is possible only with exceptional onboarding, trust, distribution, and a simpler promise than “productivity analytics.”

The strongest present wedge is not privacy alone. It is **out-of-the-box judgment and intervention**: five work-type profiles, a legible productive/unproductive interpretation, sessions, goals, and FocusBoost are already assembled into one consumer workflow. The claim must remain comparative rather than absolute—ActivityWatch also supports categorization and preset category sets—but sydtrack asks substantially less of a new user before presenting an opinionated result.

## The customer problem

Most Windows users do not wake up wanting digital-productivity analytics. They have simpler questions:

- Where did the day go?
- Was I actually working during the hours I remember as work?
- What repeatedly interrupted me?
- When am I normally able to focus?
- Can I learn this without screenshots, an account, or uploading a detailed activity history?

Tracking is the mechanism, not the desired outcome. sydtrack should sell understanding and reflection rather than measurement infrastructure.

## Likely audience

The strongest initial users are:

- Developers, designers, writers, students, and freelancers who spend much of the day on Windows.
- Privacy-conscious people who reject screenshot capture, cloud accounts, or employee-monitoring products.
- People who find ActivityWatch valuable in principle but too technical, configurable, or expansive.
- People who want more context than a list of app durations but less machinery than a complete quantified-self platform.
- ADHD and self-reflection users who benefit from externalizing where attention went, without moralistic streaks or scores.

The weak audience is “all Windows users.” Most people do not maintain trackers, configure classification rules, or regularly inspect analytics. sydtrack must therefore be useful after a mostly default installation.

## Market reality

ActivityWatch demonstrates real demand for private, local activity tracking: its main GitHub repository has roughly 19,000 stars and an active ecosystem. That proves the category exists, not that sydtrack has product-market fit. ActivityWatch describes its goal as collecting as much valuable life data as possible without compromising privacy and supports servers, buckets, watchers, browser extensions, importers, APIs, and multiple interfaces. It also supports editable categories and build-shipped preset category sets; describing it as only a raw uncategorized event log would be inaccurate. See its [repository](https://github.com/ActivityWatch/activitywatch), [architecture](https://docs.activitywatch.net/en/latest/architecture.html), [categorization documentation](https://github.com/ActivityWatch/docs/blob/master/src/features/categorization.rst), and [watcher documentation](https://docs.activitywatch.net/en/latest/watchers.html).

The important competitive distinction is philosophical:

- **ActivityWatch:** extensible infrastructure for collecting, categorizing, querying, and exploring rich local activity data across multiple platforms.
- **RescueTime and similar commercial products:** cloud-backed tracking, reports, coaching, blocking, goals, teams, and subscriptions.
- **sydtrack:** opinionated Windows defaults, explicit daily judgment, and lightweight behavior-change tools using the minimum observation necessary to produce a useful, calm account of a person's day.

sydtrack should not try to beat ActivityWatch at extensibility or breadth. It should be the product for someone who says:

> “I tried ActivityWatch, but I only wanted a simple answer to where my day went.”

## Current product position

sydtrack currently covers approximately one and a half layers of a three-layer product:

1. **Logging:** Where did the time go?
2. **Interpretation:** What patterns affected my work?
3. **Action:** What should I change?

Active-app duration, daily totals, charts, and application breakdowns are screen-time features. Productive/unproductive classification and focus profiles add useful context, but `focusscore` is still primarily a renamed percentage and Roundup can become a textual repetition of visible statistics.

sydtrack already goes beyond a passive screen-time viewer in three concrete ways:

- Five editable profiles ship with 507 researched terms, producing a usable classification starting point for General, Coding, Writing, Study, and Creative work.
- FocusBoost and its optional schedule shorten the time before a distracting activity produces a reminder.
- Sessions and daily productive-share or active-screen-time goals put intention and intervention inside the core loop.

These features place sydtrack between ActivityWatch's flexible observation platform and commercial focus products such as RescueTime or Freedom. That is useful territory, but it means sydtrack competes on two fronts: ActivityWatch has greater maturity, platform coverage, and extensibility, while commercial focus products have mature nudging, blocking, polish, and onboarding.

The most promising route beyond basic screen time is to answer:

> **What disrupted the work I intended to do?**

Using data sydtrack already collects, useful interpretations could include:

- A coding session was interrupted six times.
- Discord consumed only 18 minutes but fragmented three focus blocks.
- The longest uninterrupted block was 42 minutes.
- Productive time increased while focus became more fragmented.
- Chrome was aligned with Research but distracting during Coding.
- Morning focus blocks were consistently longer than afternoon blocks.

These are interpretations, not additional surveillance. sydtrack does not need more raw collection to become more valuable.

## Differentiation and defensibility

Clean visual design is valuable but is not a moat. Neither are donut charts, macOS-inspired chrome, focus terminology, keyword presets, privacy-first copy, or an attractive README. A competitor can recreate these.

sydtrack cannot ensure that ActivityWatch or another project will not introduce a simpler interface. Copyright protects sydtrack's particular code, writing, and artwork, but not the idea, method, system, or general product layout. Trademark can protect a brand name and logo, not the product concept. See the [U.S. Copyright Office](https://copyright.gov/help/faq/faq-protect.html) and [USPTO trademark overview](https://www.uspto.gov/trademarks/basics/trademark-process).

sydtrack is GPL-3.0. Others may modify and redistribute the code, including commercially, if they comply with the license and provide corresponding source. The license discourages closed-source appropriation; it does not prevent a fork or independent recreation.

The defensible advantages available to sydtrack are:

### Consistent product judgment

Hundreds of coherent decisions about defaults, language, empty states, onboarding, privacy, classification, and deliberately excluded features are harder to copy than one screen. sydtrack should repeatedly reject features that turn it into a monitoring platform.

### A focused brand

The clearest territory is **the tracker that deliberately knows less about you**. Public releases, design writing, recognizable presentation, and a consistent philosophy establish authorship and reputation. If the project develops meaningful recognition, perform a proper trademark search and consider registering the sydtrack name and logo.

### Maintained Windows defaults

A trusted, continuously maintained corpus of Windows application identities, ignored system processes, title aliases, focus-profile presets, and community corrections can create compounding product quality. The static keyword list is copyable; the maintenance loop and community trust are less so.

### Distribution and operational trust

Reliable installers, code signing, WinGet availability, predictable updates, low processor use, clear data controls, clean uninstallation, responsive issue handling, and stable export behavior are product advantages. For background software, trust and installation quality matter as much as interface polish.

### An editorial analytics model

More charts are not defensibility. Consistently selecting the small number of observations that help someone understand attention can become sydtrack's signature. The moat is taste applied repeatedly, not a secret formula.

## Adoption constraints

The largest risks are not competitor copying:

1. **Weak retention.** People may inspect several interesting days and stop opening the application.
2. **Configuration work.** Profiles, keywords, ignored applications, and category corrections can feel like homework.
3. **Passive value.** Knowing that Discord took 37 minutes may be interesting without changing a decision.
4. **Installation trust.** An unfamiliar executable, SmartScreen warning, startup process, and unsigned installer deter nontechnical users.
5. **Abstract language.** “Focus share,” “uncategorized,” and formulas can alienate people who only want an understandable recap.
6. **Privacy as a secondary motive.** Privacy helps someone choose between trackers after they want tracking; it does not normally create the initial desire.
7. **Windows-only reach.** The supported focus permits better native defaults, but it excludes macOS and Linux users and caps the addressable market. This matters because privacy-oriented and open-source audiences contain many non-Windows users.

Onboarding, progressive disclosure, excellent defaults, and one useful recurring recap address these risks more directly than advanced settings or decorative analytics.

## Realistic scale and monetization

A plausible range, assuming competent distribution and continued improvement, is:

- Hundreds of interested early adopters.
- Low thousands of regular users if retention is credible.
- Tens of thousands if sydtrack becomes the clearly best simple, private Windows tracker.
- Millions only with a more mainstream promise, outstanding installation trust, and exceptional distribution.

This is not presently evidence for a venture-scale company or a dependable salary. It is credible as a free open-source product supported by recommendations and occasional donations. Ko-fi revenue should be expected to be irregular: often nothing, occasional small donations, and perhaps a launch-driven spike. Place a quiet support link in About, the README, and the download page; never interrupt onboarding or withhold features.

The project is worthwhile even if it remains small. It demonstrates shipped desktop engineering, Windows integration, packaging, security, performance work, data modeling, release management, product writing, and UI/UX judgment. That portfolio value does not substitute for market validation, but it lowers the cost of discovering that the market is limited.

## Validation plan

Further development should pause long enough to test the current release with 20–30 qualified strangers rather than supportive friends. Participants should use Windows heavily and either have tried a tracker or expressed a real interest in understanding computer use.

Do not ask “Do you like it?” Observe and ask:

- Did they complete installation without assistance?
- Did sydtrack remain running?
- Did they understand what was and was not recorded?
- Did they choose or modify a profile?
- When did they last reopen Home, Roundup, or Analytics?
- Did an observation change anything they did?
- What nearly caused them to uninstall it?
- Would they recommend it to one specific person?
- Would they notice if it disappeared?

Follow up after approximately 7 and 21 days. A rough decision rule after 20 qualified testers:

- **0–2 retained users:** the current product has weak pull; pause or reposition it.
- **3–6 retained users:** a niche may exist, but recurring value needs substantial work.
- **7–10 retained users:** enough evidence to continue deliberately.
- **Unprompted recommendations:** the strongest early signal.

The most valuable qualitative evidence is repeated independent language. If several participants say, without prompting, that sydtrack is the understandable alternative to ActivityWatch, the positioning is working.

## Go-to-market

### Core message

Primary:

> **See where your computer time went—without screenshots, accounts, or surveillance.**

Accessible alternative:

> **The private Screen Time app Windows should have shipped.**

More ambitious product direction:

> **Screen Time tells you what you used. sydtrack tells you how your attention behaved.**

Suggested landing copy:

> **See where your computer time went.**  
> sydtrack is a free, private Windows tracker that turns active-app time into a clear picture of your day. No screenshots, accounts, or cloud.

Primary action: **Download for Windows**. Secondary action: **View source**.

### Launch kit

Prepare:

- A 20–30 second recording of tracking, classification, and review.
- Four strong screenshots: Home, Analytics, Activity rules, and privacy/settings.
- A direct Windows installer with checksum and transparent unsigned-build guidance where applicable.
- A concise statement of exactly what is and is not recorded.
- A feedback link and quiet Ko-fi link.

### Launch sequence

1. Soft-launch to classmates, CS/design/robotics groups, and relevant Discord communities.
2. Publish a polished GitHub release and README.
3. Submit stable releases to WinGet; Microsoft's [community repository](https://learn.microsoft.com/en-us/windows/package-manager/package/repository) makes accepted packages discoverable through `winget`.
4. Post a genuine Show HN after participating in the community. Show HN expects a personally built product people can try, and vote solicitation is prohibited. See [Show HN](https://news.ycombinator.com/showhn.html) and the [HN guidelines](https://news.ycombinator.com/newsguidelines.html).
5. Prepare a Product Hunt launch with strong gallery assets and a personal maker comment. Makers can submit their own products. See the [Product Hunt posting guide](https://help.producthunt.com/en/articles/479557-how-to-post-a-product).
6. Post selectively in relevant productivity, privacy, open-source, Windows, and side-project communities after reading each community's promotion rules.
7. Publish useful development stories rather than repetitive announcements.

Good content angles include:

- “I built a productivity tracker that deliberately knows less about you.”
- “Why sydtrack will never take screenshots.”
- “Why a productivity app does not need streaks, a mascot economy, or guilt.”
- “How much CPU should a background tracker use?”
- “I tried ActivityWatch but wanted one understandable answer.”
- An honest sydtrack versus ActivityWatch versus RescueTime comparison, including where each alternative is better.

Do not purchase ads before retention and installation conversion are known. Early money is better spent on code signing, a domain, installation reliability, or a polished demonstration.

## Strategic product boundaries

To preserve its reason for existing, sydtrack should avoid becoming a smaller clone of comprehensive competitors. Do not add features merely to make the list longer:

- No screenshots, keystrokes, or background-window recording.
- No employee monitoring, teams, manager dashboards, or universal productivity judgments.
- No cloud account required for the core application.
- No project-management suite, invoicing system, or elaborate life-log database.
- No AI coach without a concrete user problem and a privacy-preserving implementation.
- No streak economy, mascot progression, or donation pressure.
- No collection expansion when an interpretation of existing data would provide more value.

The next meaningful product work should improve activation and recurring understanding: onboarding, an actionable `Other` queue, a visual day timeline, focus-fragmentation insights, and a concise recap that says something not already visible in the charts.

Cross-platform support and sync could widen the addressable market later, but they should follow evidence of retention on Windows. Adding them before validating the core loop would multiply engineering and support cost without proving that the simpler experience is valuable.

## Decision

sydtrack has not proven that a large market exists, but it has identified a real gap worth testing. “Screen Time for Windows” is a legitimate initial utility because Microsoft's native offering is family-management oriented rather than a clear local self-reflection tool. The durable opportunity is narrower and more valuable: an intentionally restrained tracker that turns minimal local activity data into an understandable account of attention.

The next milestone is not more breadth. It is evidence that unfamiliar users install sydtrack, trust it, reopen it after a week, learn something, and recommend it without being asked.
