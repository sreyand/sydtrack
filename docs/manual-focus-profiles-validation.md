# Focus profile manual checks

Run `npm start`. Existing profile files remain compatible.

1. Home: open focusprofile; confirm five choices. An empty slot opens Focus Tags with a name field.
2. Create a profile. It becomes active in both selectors and starts with empty lists.
3. Quick Add a keyword; switch away and back. Confirm the keyword persists only in that profile.
4. Edit a list without saving. Attempt to switch; cancel and confirm the draft and active profile remain. Accept discard and confirm the destination lists load.
5. Rename with a tag draft. Confirm only the name is saved and the tag draft remains unsaved. Try a duplicate name and confirm the error preserves both fields.
6. Save keywords and Ignore; restart. Confirm the profile selection and saved lists persist.
7. Import a profile file: it is added and activated. Cancel the picker with unsaved edits and confirm they remain. Export requires saved tags. At five profiles, creation/import is disabled.
8. Delete a non-default active profile: Default becomes active. Default cannot be deleted. Past totals remain unchanged throughout.
9. Settings has full backup controls and no duplicate profile editor. Profile action messages clear after five seconds on Focus Tags and Home.

## Classification refinement (development build)

Use a temporary profile or export your current profile first; do not reset personal tags just to test.

1. Add `jhu` to Productive and `r/` to Unproductive. Focus a browser title ending in `- r/jhu`: it should be Unproductive, and a new Apps detail row should read `r/jhu`, not a topic word.
2. Add `r/learnpython` to Productive. A recognizable title for that community should be Productive despite the broad `r/` rule. The same exact keyword in Other should give a neutral result.
3. Check a GitHub page whose title mentions Reddit and a YouTube page whose title mentions GitHub. Their explicit source labels should govern the category; an explicit `youtube lecture` exception should still work on a matching title.
4. Visit an unfamiliar page with no matching keyword, and the bare Google homepage. Home should show Other, not a “browser” category or a guessed keyword. P/U/O should be disabled with a Focus Tags explanation; whole-app Ignore remains available. Known sources should show the intended keyword in the button tooltip.
5. Add a browser name to a draft P/U/O list. A notice should explain that it cannot classify pages. Save it if testing a legacy rule: it must not make unrelated pages productive/unproductive. Quick Add should refuse browser-name P/U rules, but allow whole-app Ignore.
6. Correct one recorded subreddit row for today. Confirm a different subreddit and previous days are unchanged. Generic “Unrecognized pages” must not offer a blanket P/U/I correction. Historical rows without a source stay aggregated.
7. Verify selected P/U/O/I letters remain outlined in their category color, available letters remain neutral until hovered, and keyboard focus is visible. Repeat in light and dark themes.
8. Switch windows while saving a Home rule. The new Last focused item must not inherit the old page's optimistic category. Repeated clicks during a save must not race; switching profiles must not save old tags into the new profile.
9. With a synthetic/test day dominated by Other, confirm Focus Share keeps the P/(P+U) percentage, shows its tracked-time basis, and gives no goal verdict or daily score. With at least half classified, normal scoring resumes. Enabling include-Other uses the conservative all-time denominator instead.

Automated equivalents: `npm test`, `npm run test:ui`, and `npm run test:profiles-ui`. These do not replace real-window and packaged lifecycle checks.
