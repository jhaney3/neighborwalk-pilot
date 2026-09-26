# Design decisions

Durable design decisions for the NeighborWalk iOS app. Process lives in the
project design workflow; visual values live in `app/styles/foundation.css`.

## 2026-09-23 · iOS redesign direction (accepted)

**Area:** whole iOS app (navigation, Today, walks, logging, follow-ups, walk
planning). Implementation happens on `codex/ios-experiment`.

**Direction.** Combine "Quiet native" grouped lists and a Today home with a
map-first walk mode. The typography is modeled on timespent: a heavy grotesk
for titles and a monospace face for times, counts and due dates.

### System

- **Type.** Headlines, names and addresses use Schibsted Grotesk (variable,
  400–900). Times, counts and due dates use IBM Plex Mono in small caps-style
  uppercase. Body text stays on the system font. Both fonts are open-licensed
  (SIL OFL 1.1) and bundled in `app/fonts/` so they work offline.
- **Color.** The existing hedge-and-porch-light palette stays. Map pins keep
  the outcome colors in `lib/domain.ts`.
- **Emphasis.** An ink outline with an offset shadow marks only the single next
  thing to do on a screen. Everything else uses flat grouped lists.
- **Tab bar.** A pill with icon-only inactive tabs; the active tab shows its
  icon and label on an ink segment. Tabs: Today · Walks · Follow-ups · People.
  The porch-colored + sits outside the pill. More moves behind the avatar.
  The user explicitly chose icon-only inactive tabs; keep VoiceOver labels on
  every tab.

### Screens and flows

- **Today.** No calendar strip. Shows the live walk (the one offset card),
  follow-ups due as a checklist, and a History of the signed-in person's own
  visits and conversations today. Team activity lives on the walk page.
- **Walk mode.** A full-screen map with a slim progress pill (route, homes,
  minutes, End) and no tab bar. The bottom card asks what happened at the
  selected home. One tap saves "No answer" (or "Not now", "Couldn't reach").
  "Talked" and "Come back" open the optional details sheet, which saves once.
  An ink toast confirms each save and the pin takes its outcome color. With no
  home selected, the card says "Tap a home to log it" and offers Add a home.
- **Logging is outcome-first everywhere**: at the door, when checking in on a
  follow-up, and from the + button.
- **Details sheet (shared).** One Name field (no first/last split) creates the
  person inline. "Stay in touch?" is a Yes/No switch; Yes shows a single cell
  phone field with a Text/Call choice on its right. No email in the UI.
  "Do not contact" lives on the person page. Needs, prayer request and
  "Come back?" (prefilled type, date, owner) follow.
- **Ending a walk.** Big numbers, then every follow-up the walk created with its
  owner; unassigned ones go to the Open queue.
- **Follow-ups tab.** Grouped by when (Overdue, This week, Later), split
  Mine / Team / Open, with swipe actions for Snooze and Done. The follow-up
  page shows the person, the open follow-up as the offset card, Log check-in,
  Snooze, Hand off, and the full history. Check-in is outcome-first with a
  one-line "Next follow-up" control (None · 1 wk · 2 wks · calendar). Snooze
  and hand-off share one sheet; "Before the next walk" is a snooze option.
- **Walk details.** One page that follows the walk's phase
  (Plan → Invite → Check in → Walk → Wrap up) and the viewer's role. The offset
  card is always the viewer's next action: RSVP counts and Nudge for leaders,
  I'm in / Can't make it for walkers, check-in with auto-pairing on the day,
  and route progress plus team activity while live.
- **Creating a walk.** Full-screen, one question per screen, in the order
  Where → When → Who. Neighborhoods show coverage; routes are streets, not
  lists of homes. When uses chips and carries over the last meeting point.
  Who lists saved teams first; the invite link is an icon beside Save draft
  and Send invites.
- **The + button.** Logs a conversation that didn't happen at a door. A
  prominent Where row (defaulting to a live gathering or the last place used),
  optional Who with search plus recent faces, then the outcome grid. It opens
  the same details sheet as the door. During a live door walk, + opens the walk.
- **Conversation guides are retired** from the new UI.

### Open

- **Pins.** Walkers will likely create pins on dwellings rather than pins
  existing in advance, so a "next door" suggestion can only use homes someone
  already added. Until resolved, the walk card acts on the selected home and
  otherwise says "Tap a home to add it".
- **Contact mapping (verified).** "Stay in touch: Yes" maps to
  `contactPermission: "requested"` ("They asked us to reach out"); the phone
  and Text/Call choice map to `phone` and `preferredContact`.
- **Saving and undo.** Visits are append-only; corrections are a separate
  reviewed flow. So the details sheet saves once when you tap Save (the visit is
  not saved before it opens), and the confirmation toast has no Undo yet.
- **Not built yet.** Street-level coverage, auto-splitting streets into routes,
  Nudge and recurring walks do not exist in the data or backend.

### References

Mobbin (iOS) references reviewed on 2026-09-23, including timespent (Today,
Settings), Tripadvisor and Wanderlog (map cards), Strava and Citizen (activity
mode), Oura (quick logging), Todoist, Asana and Attio (task lists), Outlook and
ClickUp (snooze), GroupMe and Partiful (event RSVP and check-in), Discord and
Luma (event creation). Shipped screens are examples, not proof of usability.

## 2026-09-24 · Implementation notes

All eight parts of the direction are built on `codex/ios-experiment`: system and
tab bar, Today, walk mode, Follow-ups, walk details, creating a walk, the +
button, and ending a route. The screens the board didn't draw (Walks list, map
browse, People, person profile, More, Settings, Team & invitations) use the
same type and card system. Where the build differs from the mockups:

- **Next door** is the nearest already-mapped home the walker hasn't visited,
  preferring the same street. Walkers can still add a home that isn't mapped.
  Whether walkers should drop pins instead is still an open question.
- **Undo** holds each door save for 5 seconds before it's committed. Visits
  can't be edited after they're saved, so holding them back is what makes Undo
  possible. The save commits early if the walker moves on, leaves the app or
  opens the wrap-up.
- **Follow-ups lists** are Mine · Team · Open. Open is the leaders' queue of
  follow-ups without an active owner, or declined by their owner; only leaders
  see it.
- **Hand-off** follows existing permissions: leaders reassign; an owner who
  can't take a follow-up gives it back, which puts it in the Open queue.
- **The + button opens your walk** while a door walk is live. The walk card
  has "Log a conversation away from a door" for off-door talks. With no live
  door walk, + opens the logger.
- **Creating a walk** keeps the existing route planner (streets, whole zone,
  shapes) under "Which streets?". Streets whose homes were mostly (80%+)
  visited are drawn dashed. "How many routes?" splits the chosen homes into
  2–4 even routes in strips along the area's long side. If a route's outline
  would leave the neighborhood, it falls back to the neighborhood outline.
  "Copy last walk" copies routes from one neighborhood only. "Send invites" is
  the old "Save & mark ready".
- **The invite-link icon** opens the existing one-time invitation sheet.
  NeighborWalk has no reusable church-wide link; each invitation is for one
  person.
- **The walk name** lives in the Who step's summary card. It defaults to
  "{neighborhood} · {day}" until the leader types over it.
- **Walk details** puts Replace route and Cancel assignment behind a per-route
  "Manage route" disclosure. Manage invitations lives in the People section.
  Leaders get Nudge (the share sheet with a reminder, or a copied message when
  sharing isn't available) and Start check-in; "Start walk" stays available
  when teams are already set. Walkers get "See you {day}" with Add to calendar
  (an .ics file).
- **Ending** a route or a whole walk opens the wrap-up sheet (numbers, then
  follow-up owners) instead of a plain confirmation. The assign picker lists
  people checked in or logging on this walk first.
- **Narrow phones (≤360pt)**: the active tab keeps its ink segment but drops
  its label so four tabs and + fit; VoiceOver labels are unchanged.

## September 26, 2026 — SendMe public name

The user approved SendMe everywhere people see the product name: iOS display name, app and website copy, invitations, notifications, exports and share metadata/artwork. Keep the existing visual design. Preserve `app.neighborwalk.ios`, the `neighborwalk://` scheme, storage/serialization identifiers and existing service URLs for compatibility. Historical design captures retain the original name. APNs accepts the existing fixed generic database copy and renders SendMe at delivery; email retries retain their original payload for provider idempotency.

The share image at `public/og.png` was edited with the built-in image-generation tool. Prompt: replace only the large headline “NeighborWalk” with “SendMe”; retain the dark green serif typography, scale, left alignment, landscape composition, phone illustration, colors and “Neighborhood outreach, kept in order.” copy. The inspected output is 1730 × 909.

## September 26, 2026 — Broad haptic feedback

The user asked for more haptic feedback and chose every option offered: a tick on every button press and text field tap, success on other saves, errors, a warning on destructive confirmations, and taps for drawing corners. This replaces the earlier "sparingly" guidance. The vocabulary is fixed in `mobile/haptics.ts` (tick, light impact, success, warning, error), with dedupe so one action never buzzes twice. Details are in build plan decision 74.
