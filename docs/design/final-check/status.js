// Update after each capture pass. status: "match" | "drifted" | "not-built".
// note: what differs (for drifted) or what was checked (for match), in plain words.
window.FINAL_CHECK_STATUS = {
  "checked": "2026-09-26",
  "screens": {
    "WM1": {
      "status": "match",
      "note": "Pill (route · doors · time, Finish, list button), filter chips, dashed route area, tonight's pins full size and earlier pins small, only the locate button, and the one-line hint. The hint stays until you drop your own first pin on this walk. The sample-only practice banner sits above the pill. On request (decision 68): the tab bar and + stay in walk mode, so this differs from the mockup there."
    },
    "WM2": {
      "status": "match",
      "note": "Porch pin drops at the tap; the sheet has the mono kicker, the editable address with pencil, the source line with 'add a unit', and the outcome grid, with no bottom row. The sample has no parcel records or geocoder, so the address fills with the nearest street from the map; with parcels or a geocoder it fills the full address. On request (decision 68): the tab bar and + stay in walk mode, so this differs from the mockup there."
    },
    "WM3": {
      "status": "match",
      "note": "Mono last-visit line, the address, the outcome grid and the quiet grey bar (Don't knock · Another home · History). Selected pin gets the grey halo. On request (decision 68): the tab bar and + stay in walk mode, so this differs from the mockup there."
    },
    "WM4": {
      "status": "match",
      "note": "Saved chip with the address, 'Anything to add?', Name, Stay in touch with cell phone and Text/Call, What came up (first four topics plus +), the Come back offset card with Tomorrow / default day / 1 wk / calendar, + Add a note, and one Done. On request (decision 68): the tab bar and + stay in walk mode, so this differs from the mockup there."
    },
    "WM5": {
      "status": "match",
      "note": "Sheet closes, the pin takes its outcome color, the pill ticks up a door, and a one-line '✓ Saved · Undo' pill sits where the hint was for 5 seconds. On request (decision 68): the tab bar and + stay in walk mode, so this differs from the mockup there."
    },
    "WM6": {
      "status": "match",
      "note": "Kicker with the address and home count, 'Another home here', the unit field with the grey hint inside, the outcome grid, and a red Cancel. On request (decision 68): the tab bar and + stay in walk mode, so this differs from the mockup there."
    },
    "WM7": {
      "status": "match",
      "note": "Back button with the door count, 'Logged tonight', route · walkers, streets as sections with counts, rows of time · dot · house · outcome · who, newest first."
    },
    "WM8": {
      "status": "match",
      "note": "Full screen: back, date · time walked, 'route · done', the big door count with 'doors tonight', three colored counts, Who's following up? and one Finish route button. The sample route has one owned follow-up, so no Assign chip or unassigned line shows in this capture."
    },
    "PL1": {
      "status": "drifted",
      "note": "Where row starts on 'Crockett north · away from a door' with Change, Who search and faces as drawn. Differs: the grid is the locked + grid (Talked / Prayed / Follow up / Not now) under 'What happened?', because No answer can't be recorded away from a door; the mockup shows the door grid. Logged in the build plan for you to confirm. Only one recent face shows because the sample leader has one person."
    },
    "MP1": {
      "status": "match",
      "note": "Full-bleed map with the Walks / Map / List switch, the neighborhood capsule with pin count, Search and ⋯, the filter chips, only the locate button, and the tab bar. No coverage percent."
    },
    "MP2": {
      "status": "match",
      "note": "Search field over the map with a round ✕, then Pinned results with their last outcome. The sample has no geocoder key, so the Addresses section doesn't appear."
    },
    "MP3": {
      "status": "match",
      "note": "Neighborhoods sheet: color bar, name, 'N pins · walked date' or 'No pins yet', a check on the current one, and New neighborhood as the last row with a dashed bar and chevron."
    },
    "MP4": {
      "status": "match",
      "note": "Action sheet: Edit ‹neighborhood›, New neighborhood, Print address list, then Cancel. Volunteers get only Print."
    },
    "MP5": {
      "status": "match",
      "note": "✕ · New neighborhood · Undo, the '5 corners · tap the first to close' hint, the shape with the first corner in porch, and the Tap corners / Draw a box sheet with Next."
    },
    "MP6": {
      "status": "match",
      "note": "Name it: name field, six swatches with the chosen color previewed on the shape, Save neighborhood."
    },
    "MP7": {
      "status": "match",
      "note": "Title with round ✕, Name, Color, Boundary · corners · Redraw ›, the red Delete neighborhood row ('Pins and visits stay'), Save."
    },
    "MP8": {
      "status": "match",
      "note": "Same switch and capsule with a print button, 'Street or name' search, streets as sections with counts, rows with outcome dot, house, last outcome · date · person."
    },
    "MP9": {
      "status": "match",
      "note": "Opens at a medium height: mono summary, the address, ⋯, the open follow-up as the porch offset card, then Log a visit with the outcome grid."
    },
    "MP10": {
      "status": "match",
      "note": "Scrolling expands the sheet: People here with + Add and rows (avatar, name, how to reach · owner), then History in the follow-up history component (date over time in mono)."
    },
    "MP12": {
      "status": "match",
      "note": "The home sheet steps away; the menu shows the address, Edit home, Another home here, Move pin, then Close."
    },
    "MP11": {
      "status": "match",
      "note": "Edit home: Street address, Unit or label, Move pin row, and the red Delete home row. On a home with visits the row is disabled and says why."
    },
    "WK1": {
      "status": "match",
      "note": "No title: the Walks / Map / List switch first, the porch live card (Live now · doors, name, start · meeting point, walker faces, Open ›), Coming up rows with date boxes and status chips, the dashed Plan a walk row, and Past walks with a count."
    },
    "WK2": {
      "status": "match",
      "note": "Back and ⋯, 'Live · date', the title, time · meeting point, the phase rail on Walk, and the card: Walking now · time, Doors / Talked / Follow-ups, the Your route row, Open my route and End walk. Change shows only when you have more than one route. On request (decision 70): the button reads Open route and stays on one line."
    },
    "WK3": {
      "status": "match",
      "note": "Routes with Edit teams; rows show the color bar, route, team and a 'N doors' chip. Team activity uses the history component (time on the left; dot, outcome · house, and walker). No mini map."
    },
    "WK4": {
      "status": "match",
      "note": "Done · date, the rail on Wrap up, the final numbers card, 'Who's following up?' with 2 open and Assign chips (gone once everything has an owner), and Notes for next time. Team activity follows further down."
    },
    "WK5": {
      "status": "match",
      "note": "Action sheet: Edit walk, Repeat walk, Cancel walk in red (asks to confirm), then Close. The bottom links are gone."
    },
    "WK6": {
      "status": "match",
      "note": "Full screen: ✕, 'Edit walk', the title, then Where (read-only once routes are set), When, Who and Name rows with Change, and Done."
    },
    "WK7": {
      "status": "match",
      "note": "Repeat this walk: new day cards on the walk's weekday plus a calendar, Invite the same people and Copy routes switches, Create draft. Copying routes and people happens after the draft is made."
    },
    "WK8": {
      "status": "match",
      "note": "Who's invited?: Find someone, saved team pills, 'N invited · N going', check rows with each reply in mono, and Save."
    },
    "WK9": {
      "status": "match",
      "note": "Volunteer view: rail on Walk, the porch card (Your route, route name, 'with … · N doors so far', Open my route), then the meeting point and leader rows."
    },
    "WK10": {
      "status": "match",
      "note": "WK1 without Plan a walk; the live card reads 'you're on Crockett north'; a walk waiting on your reply shows a porch Reply chip."
    },
    "PW1": {
      "status": "match",
      "note": "Full screen with ✕ and '1 of 3', 'Where are you walking?', Copy last walk as a dashed row, the neighborhood map with name · last-walked labels (dashed when never walked), rows with 'N pins · walked date' or 'Never walked' and a check, and 'It's a gathering instead'. No percents. The last walk's Notes for next time show here when there are any. On request (decision 69): a New neighborhood · Draw it on the map row under the list."
    },
    "PW2": {
      "status": "match",
      "note": "Back and '1 of 3', 'Which streets?', route chips (Route A, Route B, + Route) with the edited route filled in its color, the map with that route in its color and others faded, the hint line, route rows with streets · miles and 'Editing', and 'Draw an area instead ›'. Tapping streets adds them to the route right away. The sample's demo streets have no recent pins beside them, so no street shows dashed in this capture."
    },
    "PW3": {
      "status": "match",
      "note": "Back and '3 of 3', 'Who's coming?', saved team pills, 'N invited · Invite everyone', check rows, the summary offset card with the editable name, and the back · link · Save draft · Send invites row."
    },
    "FU1": {
      "status": "match",
      "note": "History in the shared component, then grouped rows for the person (Person page ›) and the home (Home and visits ›), and a quiet red Cancel follow-up that asks for a reason."
    },
    "TD1": {
      "status": "match",
      "note": "Volunteer with an invitation and no live walk: the porch invitation card (Invitation · date · time, walk name, meeting point · led by, I'm in / Can't make it), then follow-ups and history. After replying it collapses to one row ('You're in · Sun 27 ›'); the Your replies disclosure is gone."
    },
    "PE1": {
      "status": "match",
      "note": "Title with ink +, search, Mine · Everyone · Follow-up due chips, conversations row, rows with street · due (red when overdue). The sample shows 4 of Erica’s people; Dolores has no home."
    },
    "PE2": {
      "status": "match",
      "note": "Conversations away from doors in the history component, bold titles; tapping one opens the person. The detail line adds the needs they shared."
    },
    "PE3": {
      "status": "match",
      "note": "Avatar, name, mono summary, Text/Call (hidden per contact limit), porch follow-up card that opens the follow-up, Owner and Home rows, ⋯ menu."
    },
    "PE4": {
      "status": "match",
      "note": "Timeline heading, Add a note row, one history of notes, visits and follow-up history. No follow-ups panel."
    },
    "PE5": {
      "status": "match",
      "note": "Note / Prayer request switch, text, lock privacy line naming the owner, Save note."
    },
    "PE6": {
      "status": "match",
      "note": "Who can see ›, Change owner ›, Status control, Don’t text / call / visit switches, plus a footer saying only a leader can turn a limit off."
    },
    "PE7": {
      "status": "match",
      "note": "Name, Home with Change, the door’s contact block with the phone formatted, Save."
    },
    "PE8": {
      "status": "match",
      "note": "The same form, empty: Choose a home ›, Stay in touch on Yes with the phone empty, Add person."
    },
    "AD1": {
      "status": "match",
      "note": "Title, profile offset card (avatar, name, role · church), Your church › Team & invitations, This phone › Settings and Sync with its status in the row, Help › Help & field guide and Privacy & trust. No guides. The sample shows 'Practice' as the sync status."
    },
    "AD2": {
      "status": "match",
      "note": "Back, Team, Getting started row (4 of 5 · next: close the loop in the sample), the Invite someone offset card, People with role and count, Saved teams with faces and + New. Neighborhoods and Recent activity are gone. All 7 sample people are listed."
    },
    "AD3": {
      "status": "match",
      "note": "Name, cell phone (formatted), Volunteer · Leader, the line explaining roles, Text the invite, 'Works once · expires in 7 days'. The sample church says it can't send invites."
    },
    "AD4": {
      "status": "match",
      "note": "Team name title, Name, Members · 3, ink check rows, Delete team, Save. The sample has 7 people, so Delete team and Save are below the medium detent until you scroll."
    },
    "AD5": {
      "status": "match",
      "note": "This phone: Appearance Auto · Light · Dark, Follow-up reminders with a switch, Map ›. Church · leaders: Church profile, Records & privacy, Data. Sample church: Preview as. Reminders read 9:00 AM (the real time) and are off in the sample; Map reads 'Regular dots'."
    },
    "AD6": {
      "status": "match",
      "note": "Back with the 'Settings' label, Church name, Timezone row 'Central · Chicago' ›, Default follow-up Tomorrow · 3 days · 1 wk · 2 wks, Save."
    },
    "AD7": {
      "status": "match",
      "note": "Review records after 1 · 2 · 5 years, the 'nothing is deleted' line, Note limit 280 · 500 · 1,000, the Faith & relationship fields switch, Save."
    },
    "AD8": {
      "status": "match",
      "note": "Export records, Import a backup, the lock line, and a red Clear outreach records row that asks you to type the church name."
    },
    "AD9": {
      "status": "match",
      "note": "Back with the 'More' label, the big status card, Waiting to send, Recovery · None ›, Sync now. In the sample the card reads 'On this phone · Practice mode' and Sync now is disabled; connected churches get All sent / waiting / offline / needs review."
    },
    "BD1": {
      "status": "match",
      "note": "Church capsule and avatar, 'Today' with the day, the walk card (Walking now · time, route, walk · partners, route dots, play), Follow-ups with the overdue count and grouped rows with due chips, and History (you · N today) with time, outcome dot and 'outcome · house'. Leader-only attention rows follow below when there are any."
    },
    "BD2": {
      "status": "match",
      "note": "The whole-walk wrap-up: ✕, date · time, 'walk · done', the big 'homes visited' number, three counts, Who's following up? with owners or Assign, and Finish walk."
    },
    "BD3": {
      "status": "match",
      "note": "'Due first ▾' capsule and avatar, 'Follow-ups', Mine / Team / Open with counts, Overdue in red, This week and Later (collapsed with 'Show N ›'), grouped rows with circle, name, note, owner, channel icon and due chip. Rows still swipe for Snooze and Done. The old search and Done toggle are gone."
    },
    "BD4": {
      "status": "match",
      "note": "Round back and ⋯, the avatar with the name and 'house · met date', the porch card (due · channel, the note, owner · accepted), Log check-in, Snooze and Hand off, and History in the shared component."
    },
    "BD5": {
      "status": "match",
      "note": "A bottom sheet: 'Check-in · name', How did it go?, four outcome rows with the chosen one filled, Next follow-up (None · 1 wk · 2 wks · calendar) and Save. It says 'them' rather than 'her', since the app doesn't know pronouns; '+ Add a note' is kept for an optional note."
    },
    "BD6": {
      "status": "match",
      "note": "One sheet: 'Not you, not now?', Snooze until rows with mono dates (tomorrow at 9:00 AM), Pick a date ›, then 'Or hand it off' with faces, Leaders (give it back) and Anyone."
    },
    "BD7": {
      "status": "match",
      "note": "Leader before the walk: Ready · date, rail on Invite, the card with invited · replies, Going / Can't go / No reply, Nudge and Start check-in, and Routes. Two deliberate differences from the old board: route chips show pins or 'New' instead of the drawn coverage percents (the newer no-percent rule), and the middle count is Can't go because the app has no Maybe reply."
    },
    "BD8": {
      "status": "match",
      "note": "Walker before the walk: date · time, title, 'Led by Erica · Grace Harbor', the porch Are you coming? card with I'm in / Can't make it, the meeting point and 'Teams form at check-in' rows, and Who's going faces."
    },
    "BD9": {
      "status": "match",
      "note": "Check-in: back, 'Check-in · time', Who's here?, the face grid with check badges (dashed when not here), Teams with Auto-pair, team rows (dashed when empty), and Start walk · N teams. Tapping a team opens a sheet to move people."
    },
    "BD10": {
      "status": "match",
      "note": "Back and '2 of 3', 'When?', day cards (the coming Saturday, the Sunday after, the next Saturday, Pick), Start chips with the selected one showing AM, How long, Meet at with 'Same as last time', and Next · who."
    },
    "BD11": {
      "status": "drifted",
      "note": "Where card, faces, 'What happened?', the Talked / Prayed / Follow up / Not now grid and 'Happened earlier?' match. Differs: the header uses the newer PL1 style (large title with a round ✕), and the label reads 'Who' with 'Find or add a person' as in PL1. Logged for you to confirm."
    },
    "BD12": {
      "status": "match",
      "note": "Saved chip with the place, 'Who did you meet?', Name, Stay in touch with cell phone and Text/Call, private prayer request, Follow up? with channel · day · owner chips, and Done. On request (decision 67): with people chosen, this page also gives each person a contact block, with chips to pick whose. Stay in touch now starts on No, so the capture taps Yes (decision 71). The phone field is boxed with a focus ring (decision 73)."
    }
  }
};
