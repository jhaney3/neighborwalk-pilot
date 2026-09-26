# Redesign build plan

Status: **in progress** (started Sep 25, 2026). Phases 0–8 built and checked; see the final check for each screen's rating. **Scope: the iOS app only.** Read [`/DESIGN.md`](../../DESIGN.md) first; it explains the documents, iOS and HIG rules, and the acceptance check.

Source of truth: [`redesign-walkthrough.html`](redesign-walkthrough.html). It has 53 screens with stable IDs, all locked after three review rounds, plus 12 screens still in force from the original board (BD1–BD12, shown in the final check). Open it in a browser next to this file. Each checklist item below names a screen ID; build that screen to match its mockup and the bullets under it.

## Start here (next session)

1. Work in the redesign worktree `/home/jhaney/Work/neighborwalk-redesign` on branch `codex/ios-experiment`. Don't touch the release worktree `neighborwalk-pilot-ios`, which has the user's own uncommitted docs.
2. Read `AGENTS.md`, the release worktree's `DESIGN.md`, this plan, and the walkthrough's "Rules in force" box.
3. The tree has an uncommitted build pass from before the walkthrough. Parts of it contradict the locked design, and Phase 0 removes them. Don't commit unless the user asks.
4. Build phase by phase. After each phase, run the checks in "Verification" and compare screenshots side by side with the walkthrough mockups. Tick items here as they pass.
5. Don't invent anything the walkthrough doesn't show. If a screen needs a state the mockup doesn't cover (empty, error, loading), follow the nearest locked pattern and list it under "Decisions made while building" at the bottom, so the user can review it.

## Rules in force (from the walkthrough)

- Pins, not next door. Walkers drop a pin on each home as they walk and find their own way on the map. Leaders never pre-pin homes.
- During a walk, every conversation belongs to a house. The yellow + always opens the logger, and starts on the live walk when there is one.
- No conversation guides anywhere. No email in forms: contact is a cell phone with Text or Call.
- Type: Schibsted Grotesk for names, titles and addresses; IBM Plex Mono for times, counts and dates. There's one offset card per screen, on the next action; everything else is a grouped list.
- No floating button stacks. The map keeps only a locate button.
- Pin sheets are the outcome grid. Pins that already exist also get one quiet grey icon bar: Don't knock · Another home · History.
- Long-press a house to drop a pin straight to Don't knock. A new pin with nothing logged disappears when you tap away.
- History everywhere uses the follow-up history component: date over time in mono on the left, the entry on the right.
- A ⋯ menu replaces its sheet while it's open, and Close brings the sheet back.
- The Walks / Map / List switch is always first on the screen, in the same place, with no title above it.
- Routes are drawn or picked by hand, one at a time. Nothing splits them automatically.
- Member invites are phone only, sent by text.
- The walk page keeps its routes list (with Edit teams) and Team activity, but has no mini map (WK3).

## Phase 0 · Remove what the design rejected

- [x] **Next door.** Delete `lib/next-door.ts` and its test. Remove next-door ordering, the `hint`, Skip, the "N left on street" header and "Next door →" from `WalkVisitCard` and `app/NeighborWalkApp.tsx`.
- [x] **The off-door link.** Remove "Log a conversation away from a door" from walk mode, and the empty "Your route · N doors left / Add a home" card.
- [x] **+ during a walk.** Revert + to always open the logger (PL1); remove the `liveDoorWalk` branch.
- [x] **Conversation guides, from the UI only.** Remove:
  - `GuideView` and the guide route
  - the More row and the Settings "Favorite conversation guide" card
  - team defaults
  - "Add & use guide" and "Need a prompt?" in `PropertyDrawer` and `AddPropertyModal`
  - the guide field in the walk editor, and guide props passed from `NeighborWalkApp`

  Stop writing new guide data. Leave the stored guides and the `lib/conversation-guides.ts` / `guide-changes.ts` data paths alone; there's no migration. This touches `app/NeighborWalkApp.tsx`, `components/GuideView.tsx`, `components/PropertyDrawer.tsx`, `components/SettingsView.tsx`, `components/OutreachView.tsx` and `components/WalkSetupWizard.tsx`.
- [x] **Automatic route splitting.** Remove "How many routes?" and `lib/route-split.ts` with its test (PW2 picks routes by hand).
- [x] **Walk page leftovers.** Remove the mini map (WK3) and the per-neighborhood coverage panel (WK4). Keep the routes list, Edit teams and Team activity.
- [x] **Coverage percentages** in Walks → Map (MP1) and Plan a walk (PW1). The replacements are pin counts and "last walked".

## Phase 1 · Walk mode with pins (WM1–WM8)

- [x] **WM1 Walk map.** No sheet until you tap. A dismissible hint, "Tap a house to drop a pin", goes away after the first pin. The pill reads "Crockett north · N doors · time", plus Finish and the list button. Filter chips work as today. Tonight's pins are full size; pins from earlier walks are smaller. The route area is a dashed outline, and only the locate button floats.
- [x] **WM2 Drop a pin.** Tapping a house drops a porch-colored pin and opens the sheet: "New pin · street" in mono, the address (editable, from the parcel or reverse geocode), "add a unit", then the outcome grid. There's no bottom row. Tapping away with nothing logged removes the pin. **Long-press** drops a pin saved straight as Don't knock (`do_not_visit`).
- [x] **WM3 Existing pin.** Mono last-visit line, the address, the outcome grid, then the grey bar: Don't knock · Another home · History (History opens MP9/MP10).
- [x] **WM4 Anything to add?** As the locked board, with a single **Done** button.
- [x] **WM5 After a save.** The pin recolors and the sheet closes. A small one-line pill at the bottom says "✓ Saved · Undo" and lasts 5 seconds; keep the deferred-save mechanism.
- [x] **WM6 Another home here.** Unit or label field, then the outcome grid in the same sheet. On the map, a pin with several homes shows a count.
- [x] **WM7 Logged tonight.** The list button opens tonight's doors for this walk, grouped by street, newest first, as time · address · outcome · who. Tapping a row flies to the pin.
- [x] **WM8 Finish route.** The big number is doors tonight; the rest matches the locked wrap-up.

Check first: that `properties` can be created from a tap anywhere (with or without parcel data), that units map to the property `unit` field, that "doors tonight" counts this walk's visits by the target and user, and that long-press works on MapLibre touch on iOS.

## Phase 2 · The + button (PL1)

- [x] **PL1.** + opens the logger. When a walk is live, Where starts on "‹route› · away from a door" (Change available). The logger is otherwise the locked + sheet.

## Phase 3 · Map, list and homes (MP1–MP12)

- [x] **MP1 Walks → Map.** Full-bleed map. Floating on top, in order: the Walks / Map / List switch; the neighborhood capsule (name and pin count); Search; ⋯ (leaders only). Then the filter chips, and only the locate button on the map. Tap a house to drop a pin (as WM2); tap a pin to open MP9.
- [x] **MP2 Search.** The field expands over the map. Results list pinned homes first (with their last outcome), then addresses.
- [x] **MP3 Neighborhoods sheet.** Rows show "N pins · walked ‹date›". The last row is "New neighborhood" with a dashed color bar (leaders).
- [x] **MP4 ⋯ leader tools.** Edit ‹neighborhood›, New neighborhood, Print address list. Volunteers see only Print.
- [x] **MP5 Draw a neighborhood.** Full screen with ✕ · "New neighborhood" · Undo. Tap corners (tapping the first one closes the shape), or switch to "Draw a box". Then Next.
- [x] **MP6 Name it.** Name, color swatches, Save neighborhood.
- [x] **MP7 Edit neighborhood.** Name, color, a Boundary row (Redraw ›), and a quiet red Delete that asks to confirm (pins and visits stay).
- [x] **MP8 Walks → List.** Same switch and capsule, with a print icon. Search. Pinned homes grouped by street, each with its last outcome and date.
- [x] **MP9 Home sheet.** One scrolling sheet with no tabs: mono summary, address, ⋯ (MP12). The open follow-up is the offset card; then "Log a visit" with the outcome grid.
- [x] **MP10 Home sheet, scrolled.** People here (+ Add opens PE7 with the home filled in). History in the follow-up history component.
- [x] **MP11 Edit home.** Address, unit, Move pin, and a quiet red Delete home.
- [x] **MP12 Home options.** The home sheet steps away and this menu shows the address, then Edit home, Another home here and Move pin. Close brings the sheet back.

## Phase 4 · Walks and the walk page (WK1–WK10)

- [x] **WK1 Walks list.** No title; the switch sits in the same place as on MP1 and MP8. Then the live walk card (porch), Coming up rows with date boxes and status chips, a dashed "Plan a walk" row (leaders), and a Past walks row.
- [x] **WK2 Walk page, live, leader.** The card shows Doors / Talked / Follow-ups, a "Your route" row with Change, then **Open my route** (primary) and End walk.
- [x] **WK3 Routes and activity.** No mini map. Routes list with "Edit teams" (opens the locked check-in and teams screen, BD9); each row shows the color bar, the route name, the team, and a "N doors" chip. Team activity uses the history component: time on the left; outcome dot, outcome and address, and walker on the right.
- [x] **WK4 After the walk.** The card holds only the final numbers. Below it, "Who's following up?" with Assign chips (the section disappears once everything has an owner), then "Notes for next time". These notes show again when the walk is copied.
- [x] **WK5 ⋯ options.** Edit walk, Repeat walk, and Cancel walk in red, plus Close. Remove the bottom links.
- [x] **WK6 Edit walk.** A summary with Where (read-only once routes are set), When, Who and Name; each Change jumps into that Plan-a-walk step.
- [x] **WK7 Repeat walk.** Day chips and a calendar; switches for "Invite the same people" and "Copy routes"; Create draft.
- [x] **WK8 Invitations.** Search, saved team pills, and check rows with each reply in mono. Save.
- [x] **WK9 Walk page, live, volunteer.** Porch card: "Your route", the route name, "with …", and **Open my route**. Then rows for the meeting point and the leader.
- [x] **WK10 Walks list, volunteer.** WK1 without Plan a walk; walks waiting on your reply show a Reply chip.


## Phase 5 · Plan a walk (PW1–PW3)

- [x] **PW1 Where.** Copy last walk as a dashed row, then the neighborhood map and list. Each neighborhood shows "N pins · walked ‹date›" or "Never walked". "It's a gathering instead" stays. Show the last walk's "Notes for next time" on this step.
- [x] **PW2 Which streets?** Route chips (A, B, + Route). Tap streets to add them to the selected route. The route you're editing is drawn in its color and the other routes are faded. Streets with pins from the last 60 days are dashed grey. Each route row shows its streets and length. "Draw an area instead ›" covers other areas.
- [x] **PW3 Who's coming?** Saved team pills, check rows, and the summary card with the editable name. The link icon opens AD3.

## Phase 6 · Follow-ups and Today (FU1, TD1)

- [x] **FU1 Follow-up detail, lower part.** History (the shared component), then grouped rows for the person and the home, and a quiet red "Cancel follow-up" row.
- [x] **TD1 Today invitation (volunteer).** Porch card with **I'm in / Can't make it**. After replying it collapses to one line; remove the "Your replies" disclosure.

## Phase 7 · People (PE1–PE8)

- [x] **PE1 People.** Title with an ink + (add person). Search. Chips: Mine · Everyone · Follow-up due. A "Conversations away from doors" row. Rows show the avatar, the name, and "street · due …" (red when overdue).
- [x] **PE2 Conversations.** Everything logged with + away from doors, in the history component.
- [x] **PE3 Person page.** Avatar, name, and a mono summary. Text and Call buttons (hidden when a contact limit applies). The open follow-up as the porch offset card. Owner and Home rows. ⋯ opens PE6.
- [x] **PE4 Timeline.** An "Add a note" row, then one timeline of visits, conversations, check-ins and notes in the history component. There's no follow-ups panel.
- [x] **PE5 Add a note.** Note / Prayer request switch, the text, a privacy line, Save. Reached from the PE4 row and from ⋯ on PE3.
- [x] **PE6 Privacy and status.** Who can see (›), Change owner (›), a Status control (Active · Paused · Archived), and contact limits (Don't text · Don't call · Don't visit).
- [x] **PE7 Edit person.** Name, Home (Change), then the Stay in touch block: Yes/No, with the cell phone and a Text/Call control. No email and no dropdowns.
- [x] **PE8 Add person.** The PE7 form, empty: Stay in touch starts on Yes with the phone empty.

Check first: map "Don't visit" to the existing `contactRestricted` channels, and map the Note / Prayer request kinds to the existing note kinds.

## Phase 8 · More, team and settings (AD1–AD9)

- [x] **AD1 More.** Profile card; Team & invitations; Settings; Sync (with its status in the row); Help & field guide; Privacy & trust. No guides.
- [x] **AD2 Team.** A "Getting started" row until setup is done. The "Invite someone" offset card. People with their roles. Saved teams with faces and + New. Neighborhoods and Recent activity are removed from this page.
- [x] **AD3 Invite someone.** Name, cell phone, role (Volunteer · Leader). "Text the invite". Works once and expires in 7 days; phone only.
- [x] **AD4 Saved team.** Name, member check rows, a red Delete team, Save.
- [x] **AD5 Settings.** One grouped list:
  - This phone: Appearance (Auto · Light · Dark), Follow-up reminders, Map ›
  - Church (leaders only): Church profile ›, Records & privacy ›, Data ›
  - Sample church only: Preview as ›
- [x] **AD6 Church profile.** Name, timezone, and default follow-up (Tomorrow · 3 days · 1 wk · 2 wks). This default is what the Come back switch starts on.
- [x] **AD7 Records & privacy.** Review after (1 · 2 · 5 years), note limit (280 · 500 · 1,000), and the faith fields switch.
- [x] **AD8 Data.** Export, import, and a red Clear outreach records that makes you type the church name.
- [x] **AD9 Sync.** A big status card, "Waiting to send", Recovery ›, and Sync now.

Check first: whether invites can go by SMS today (`LeaderInvitations` supports phone contact), and where the reminder time is stored.

## Verification (after every phase)

iOS only. Web (Next.js) tests no longer gate this work; don't spend time on them. The code is shared, though, so it must still lint and typecheck.

- `npm run lint`, `npm run typecheck`, `npx vitest run`.
- `npm run mobile:build:sample` (the iOS bundle builds).
- Mobile suite: `MOBILE_TEST_PORT=4392 CHROME_EXECUTABLE=/usr/bin/chromium npx playwright test --config playwright.mobile.config.ts --project chromium`. Update tests that reference removed UI (next door, guides, the split, "Going / Can't go", where "Walk name" lives, and so on) to the locked copy.
- **Final check (the acceptance gate):**
  1. Add a step for each built screen in `docs/design/final-check/capture.mjs`.
  2. With `npm run mobile:dev -- --port 4392 --strictPort` running, run `node docs/design/final-check/capture.mjs`.
  3. Open `docs/design/final-check/index.html`, compare each capture with its mockup, and set its status and note in `status.js`.

  A phase is done only when all its screens are Match. Also check at 320pt and in dark mode: `FINAL_CHECK_THEME=dark FINAL_CHECK_OUT=work/redesign-tmp/dark` and `FINAL_CHECK_WIDTH=320 FINAL_CHECK_OUT=work/redesign-tmp/w320` write elsewhere, so `built/` keeps the gate captures.
- The HIG checklist in `/DESIGN.md`, for each screen you touch.
- This Linux machine has no Xcode, iOS simulator or WebKit. Say so in the report, and list what still needs checking on a Mac or device (`npm run ios:sync`, then run it in Xcode).

## Decisions made while building

Please review these. Each one fills a gap the walkthrough didn't draw, or settles a conflict between two locked screens.

**Walk mode (WM)**
1. **Leaving walk mode.** WM1's pill has no back arrow, so the only way out was Finish. Tapping the route name in the pill opens the walk page (VoiceOver: "Open the walk page"). Nothing visible changed.
2. **Pins outside the route's parcel list.** The server only tags a visit to a route when the home is on that route's frozen parcel list. A pin dropped elsewhere in the area still counts for the walk, but isn't tagged to the route. "Doors tonight" counts this walk's visits by the route's walkers (or tagged to its route), one per home. No database change.
3. **Don't knock from the grey bar** saves behind Undo, like long-press, with no confirm dialog. It still cancels open follow-ups when it commits.
4. **VoiceOver and long-press.** The new-pin sheet has a VoiceOver-only "Mark Don't knock" button. In a browser, a right-click stands in for long-press. Long-press waits for a still finger (550 ms, under 10 pt of movement), so pans and pinches never trigger it.
5. **Addresses without parcels or a geocoder.** The pin reads the nearest street name (and the house number when the map tiles carry one) from the map. The walker taps it to finish the address. If nothing is found, the grid waits for an address. A long-press with no address saves as "Address not recorded", which can be fixed in Edit home.
6. **"Already saved" in Anything to add?** Talked and Come back are held while the details sheet is open. Done, or swiping the sheet down, starts the 5-second Undo, and then it commits. Leaving the app commits at once. Undo reopens the pin's sheet, so you can pick another outcome.
7. **The hint** ("Tap a house to drop a pin") stays until you drop your own first pin on that walk on this phone, or tap it away.
8. **Filter chips** are All · Talked · No answer · Come back · Don't knock, as drawn ("Not yet" is gone, since nothing is pre-pinned).

**Map, list and homes (MP)**

9. **The home sheet (MP9)** opens at a medium height and grows to full height as you scroll or drag it up (MP10), like an iOS sheet detent.
10. **Delete home** shows to leaders, or to whoever dropped the pin that day. On a home with visits, people or Don't knock, the row is disabled and says why, because the server keeps those.
11. **Move pin** (not drawn): the sheet steps away and a draggable pin appears, with a small sheet reading "Drag it onto the right house · Or tap the house on the map", plus Cancel and Save.
12. **Delete neighborhood** moves its pins and visits to the nearest other neighborhood, because the server needs somewhere to put them. The confirm says where. It's disabled when there's only one neighborhood.
13. **⋯ on Walks → Map.** The plan says leaders only; MP4 says volunteers see only Print. I followed MP4, so volunteers get ⋯ with Print.
14. **The church header** (church capsule and avatar) shows only where it's drawn: Today and Follow-ups. Walks / Map / List and People start with their own controls.
15. **Printing** uses the Walks → List page (MP8). The old numbered field worksheet for a route is gone with the old address list.

**The + logger (PL1, BD11, BD12)**

16. **PL1 vs BD11.** PL1 draws the door grid (No answer, Come back), but No answer can't be recorded away from a door. The logger keeps BD11's locked grid (Talked · Prayed · Follow up · Not now) under "What happened?". The header follows the newer PL1 (large title, round ✕) and "Who / Find or add a person". **Needs your call**; both screens are rated Drifted until then.
17. **BD12's follow-up chips.** Channel (Call / Text / Visit) and day each open a short action sheet. Owner shows "Me" and only opens a choice when the person already has another owner.

**Shared**

18. **Haptics:** a light tap when a pin drops, a success tap when a visit saves, and a selection tick on chips and segments.
19. **Maps in the app pan with one finger** (the web embed still needs two), and pinch zooms. The +/− buttons are gone; only locate remains, drawn as the navigation arrow.
20. **The sample app** uses a "live sample" built at load: the walk started 72 minutes ago, there are more doors on Crockett north, an earlier walk (26 days ago), and walks coming up. Unit tests still use the fixed sample.
21. **Old guide links** (`?view=guide`) now open More.

**Walks and the walk page (WK, BD7–BD9)**

22. **Past walks** (a row on WK1 and WK10, not drawn) opens a page with the same rows as Coming up, plus a back button.
23. **Route rows on the walk page** open a short action sheet for leaders: walk another route (when you have more than one), Replace route, and Cancel route (asks to confirm). This keeps the old Manage route tools reachable.
24. **Before the walk, route chips** show how many pins the route already has, or "New". The board's coverage percents break the no-percent rule. BD7's "Maybe" count is "Can't go", since there's no Maybe reply.
25. **The volunteer "You're in" state** (after I'm in, not drawn): the porch card reads "You're in" with Add to calendar and Can't make it. A volunteer's ⋯ holds Add to calendar and Can't make it.
26. **Edit walk's Change buttons** open focused sheets. When reuses Plan a walk's When fields; Who is the WK8 sheet; Name is a one-field sheet. Where opens Plan a walk while the walk is still a draft.
27. **Check-in (BD9)**: tapping a team row opens a sheet to put checked-in people on that route. "Everyone is here" and "Clear check-in" are gone, as drawn.
28. **The walk page's People section and Debrief panel are gone.** Invitations live in Edit walk → Who, and the debrief is Notes for next time.

**Plan a walk (PW, BD10)**

29. **Plan a walk is a full-screen flow** (not a sheet), with ✕ on the first screen and back on the rest. Step 1 is two screens: tapping a neighborhood opens Which streets?, and "Next · when" continues. It's a gathering skips to When.
30. **New neighborhood is gone from Plan a walk** (it's in Walks → Map ⋯, MP4). The old Rectangle / Polygon / Streets / Whole zone tools, "Also select connected sections" and the 100 m street suggestions are gone. Tapping a home can still add or drop it from a street route.
31. **Routes save as you tap.** Route names are letters (Route A, B…). A route whose last street you tap off disappears. "Draw an area instead" draws a shape for the route you're on, with Undo and "Use this area"; "Tap streets instead" goes back.
32. **"Dashed = walked recently"** means pins in the last 60 days.
33. **New walks start on the coming Saturday at 9:30 for 2 hours** (BD10). The timezone field is gone; walks use the church's timezone. Purpose and leader contact fill themselves in, and only show on Who's coming? if one is missing.
34. **Last walk's notes.** Plan a walk shows the last walk's Notes for next time under the neighborhood list, as a small grey block.

**Today and Follow-ups (TD1, FU1, BD1, BD3–BD6)**

35. **The global app header is gone on the phone.** Today and Follow-ups draw the drawn capsule and avatar. Today's capsule shows the church, or the sync status when something needs attention, and opens Sync; the avatar opens More.
36. **Follow-ups' "Due first ▾"** switches between Due first and Newest first. Today's follow-ups sit in This week, and Later starts collapsed. The search field and the Done toggle are gone, as drawn.
37. **The follow-up detail's contact link** (text/call/directions) is gone, as drawn; Text and Call live on the person page. ⋯ holds Person page, Home and visits, and Cancel follow-up.
38. **Check-in keeps "+ Add a note"** (not drawn) and says "them" because the app doesn't record pronouns.
39. **Snooze and Hand off open the same sheet.** Hand-off shows two people from the same walk first, then "Anyone" for everyone. "Leaders" gives your own follow-up back to the leaders' Open list.
40. **Today when a walk is live and you also have an invitation:** the walk keeps the offset card, and the invitation shows as a plain outlined card below it (one offset card per screen).
41. **People's "Follow-up due" chip** shows anyone with an open follow-up due within 7 days, including overdue ones. Rows sort due first, then by name. "Due first" is a label, not a menu.
42. **Archived people** leave all three chips but still come up in search. Paused people stay listed with "paused" in their line.
43. **⋯ on the person page** is a short menu: Edit person, Add a note, Plan a follow-up (only when nothing is open) and Privacy and status. Edit person and Plan a follow-up aren't drawn anywhere else, and follow-ups can still be planned without a conversation.
44. **The Owner row** opens Change owner directly; the hand-off still has to be accepted. A pending hand-off shows "Waiting on …" and can be cancelled from Privacy and status. Whoever is asked sees Accept / Decline on the person page.
45. **Who can see** opens a sheet of check rows (people who aren't leaders, and teams) with Save. It replaces the old "Who can see this profile?" disclosure.
46. **Contact limits need no typed reason.** A switch records "They asked not to be texted" (called, visited). Only a leader can turn one off. "Don't contact at all" shows all three switches on and locked. **Don't visit** is the existing person-level `visit` restriction.
47. **Note kinds:** Note saves as `general` and Prayer request as `prayer`. Older conversation and milestone notes show as "Note". Tapping a note offers Archive note to its author or a leader, which replaces the trash button.
48. **Edit person drops** faith status, relationship stage (the pathway rail), preferred email, the "contact request" dropdown and Archive person, as the design says. Status lives in Privacy and status. The data is untouched. **Your call:** churches with the relationship pathway turned on no longer see it anywhere in the app.
49. **Changing a person's home** saves with the reason "Home changed in Edit person"; the old move review and typed reason are gone. Choose a home is a searchable list of pinned homes plus "No home"; picking on a map isn't built.
50. **Home sheet "+ Add"** opens New person over the map with that home filled in, then returns to the sheet.
51. **Sample data for People:** Erica now owns Elena and Marcus, Tasha has a cell for texts, her first door visit is linked to her, and four conversations away from doors were added (Church lot, Food drive, Community meal, Corner store).
52. **The follow-up reminder time is 9:00 AM**, the hour the app already schedules. The mockup says 8:00; changing the time is a behavior change, so it's your call.
53. **Follow-up reminders is one switch** for on-device reminders. iOS asks for permission the first time; a block shows as "Blocked in iOS Settings".
54. **Settings keeps an Account group, for signed-in churches only.** It holds the signed-in email, the password, email reminders, Sign out and Delete account. It isn't drawn, but the App Store requires account deletion to stay reachable, and the sample church never shows it.
55. **Map ›** opens a small page with the small-dots switch and the map style address.
56. **Church profile timezones** are an action sheet of US zones plus the church's current zone. The default follow-up choices are 1, 3, 7 and 14 days; any other saved value appears as an extra segment.
57. **Records & privacy** offers 1, 2 or 5 years (365, 730, 1,825 days). An existing 90- or 180-day setting appears as an extra segment. "Apply to sample records" is gone.
58. **Data** shows Import and Clear only in the sample, as before. Signed-in leaders get "Review records" (the Data & health tools), and Export opens those same reviewed-export tools. Data & health is no longer a row on More.
59. **Team:** the Getting started steps open as an action sheet. A person row opens Access (the existing roster, role and suspension tools, sign-in confirmation and pending invites) for signed-in leaders; in the sample it explains that roles change once you sign in. Saved teams hide tonight's route crews.
60. **Invite someone** creates the one-time link, then opens Messages with the text and link filled in. US numbers can skip the +1. If the server wants a recent sign-in, the error says to confirm it in Team › Access. The sample church says it can't send invites.
61. **Sync** reads "On this phone · Practice mode" in the sample, with Sync now disabled. Recovery › opens the existing recovery tools (compare, keep, backups), now titled Recovery.
62. **Removed as unused:** LeaderView, DeviceReminderSettings, ContactRestrictions and ConversationFeed (their jobs moved into the new screens).
63. **The mobile suite was rewritten** for the new screens (23 tests). It keeps the old checks — 44pt targets, iPad safe areas, fitting at 320/393/768, touch vs keyboard focus rings, dark mode that persists, Enter releasing focus, logging a conversation, the contextual return from the map — and drops tests of removed UI (filter menu, tabbed home sheet, route dropdown, the zone creator in Plan a walk).
64. **HIG fixes from verification:** round sheet buttons (close, ⋯) grew from 40 to 44pt, and "+ Add" on the home sheet got a 44pt target. An old phone rule forced every segmented control into three columns, which squeezed the two-choice ones (Note / Prayer request, Volunteer / Leader, Tap corners / Draw a box); they now split evenly. The Plan-a-walk action row and the settings controls shrink to fit at 320pt.
65. **Dark mode:** every screen reads correctly, but the map tiles stay light because the OpenFreeMap "bright" style has no dark version. **Your call:** a dark map style for dark mode.
66. **At 320pt,** "Appearance" shortens to "Appeara…" beside its three-way switch (VoiceOver reads the full label), and a few two-word buttons wrap to two lines (Can't make it, Start check-in, Open my route). The WM6 capture step taps map coordinates set for 393pt, so it doesn't run at 320.

### Changes requested after review (2026-09-25)

67. **Contact on the logger's second page.** Every person in the conversation can get a phone, with Text or Call, on "Anything to add?". With more than one person, chips pick whose contact you're editing. People already on file start from their saved phone; new names start on Yes. The details save to that person's record on Done, and the follow-up's channel follows the first person's choice. People who asked not to be contacted get no contact block. This goes beyond BD12, which drew the contact block only when no one was chosen.
68. **The tab bar and + stay in walk mode**, as on the browse map. The "Tap a house" hint, the "Saved · Undo" pill and the map attribution sit above the tab bar. The Walk log and wrap-up are full-screen, so they still hide it. The WM mockups drew walk mode without the tab bar; this change replaces that.
69. **Plan a walk: New neighborhood.** A "New neighborhood · Draw it on the map" row sits under the neighborhood list on "Where are you walking?". It opens the map's own draw-then-name steps full screen, and saving selects the new neighborhood and moves on to "Which streets?".
70. **"Open my route" is "Open route"** on the leader's live walk card, and the two card buttons no longer wrap. A volunteer's full-width button keeps "Open my route", since it fits.
71. **The logger's contact block starts on No** for a new person. Anyone whose phone is already on file isn't asked again, so picking Tasha plus a new name shows only the new name's block. This supersedes the "starts on Yes" part of decision 67 and of BD12. The door pin sheet (WM4) and Edit/New person (PE7/PE8) still start on Yes, as drawn.
72. **Done on the logger's second page is never greyed out.** If a follow-up names no one and says nothing, tapping Done explains what to add instead. "What should happen next?" used to vanish after the first letter typed; it now stays for the whole follow-up.
73. **The cell phone field is a boxed input** with a 44pt height, and gets a green focus ring. This applies everywhere the contact block appears: logger, pin sheet, Edit person, New person.
