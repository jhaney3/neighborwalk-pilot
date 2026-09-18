# Codebase cleanup and review

Reviewed 2026-09-08/09 against `0fad092` on branch
`refactor/simplify-neighborwalk`. The cleanup used source and local-demo checks.
A subsequent read-only parcel-service check is recorded below. Production
Supabase records and configuration were not changed.

## Changes

- Persisted TypeScript record types now come from the existing Zod validation
  schema. This removes duplicate definitions without weakening validation or
  changing the stored document format.
- Location visit summaries use one pass over visits. Retention and conflict
  reconciliation share that implementation instead of filtering/sorting the
  history separately for every location.
- Map selection and territory coverage share polygon/hole detection. People,
  follow-up, and parcel lists share a small grouping function that avoids
  repeatedly copying growing arrays.
- Follow-up creation, completion, cancellation, and rescheduling share record
  and history construction. These functions are independent of React, browser
  storage, and Supabase, making them reusable in a future mobile client.
- Successful snapshot sync now restores person-linked follow-ups alongside
  people and notes. Previously, those tasks could disappear from local state
  after a successful save. A regression test covers the reconstruction.
- The 930-line `Views.tsx` is replaced by individual Follow-ups, Guides, Leader,
  and Settings files, plus shared UI primitives. Their markup and CSS classes
  remain intact.
- Map records and coverage no longer recompute for unrelated state changes.
  No-op commands no longer manufacture a new document and trigger a save.
  Current-version snapshots no longer generate a full fictional dataset merely
  to check whether migration is needed.
- Static metadata allows Next.js to prerender the app shell. Google/email
  authentication and data access still use the existing client and database
  authorization. `NEXT_PUBLIC_SITE_URL` controls absolute metadata URLs; its
  default is the canonical production origin, including during local previews.
- Removed unused bootstrap/reset/guide helpers, unused map-style presets,
  template SVGs, and a standalone inequality wrapper. Removed tests that only
  exercised the deleted helpers. The unused security-header helper never ran
  on app responses; its removal does not change deployed headers.

Application source (`app`, `components`, and `lib`, including CSS) decreased
from 10,171 to 9,758 lines: **413 fewer lines**, including the new shared modules.
No dependencies, database migrations, CSS files, manifest, or service-worker
behavior changed. Migration history and future backend design documents remain.

## Verification

- Node 22: `npm run verify` passed lint, TypeScript, **64 tests in 13 files**,
  and the production build. The route report now identifies `/` as static.
- Desktop: all six screens, including the fully loaded map, matched baseline
  screenshots pixel-for-pixel at 1280 × 900.
- Phone: the five non-map screens matched baseline screenshots pixel-for-pixel
  at 390 × 844. The map was inspected separately after its asynchronous load.
- The production build loaded and activated its service worker without an
  uncaught app error during the initial check.
- Browser flows exercised territory switching, saved-address search, visit
  recording, follow-up search, completion with an additional task, and an
  offline person-note save. IndexedDB inspection confirmed visit persistence,
  completion history, and the next task's parent link.
- After stopping the temporary production server, the app reloaded from its
  service worker and showed the saved offline note. An uncached API request
  failed, confirming that the app server was unavailable.

A synthetic retention benchmark used the same 5,000 locations and 25,000 visits
for both implementations, five runs each on this device under Node 26.8.1.
The old implementation took 1,980–4,589 ms (median 3,882 ms); the new one took
22–35 ms (median 24 ms), with identical serialized output. This measures the
retention operation, not whole-app loading speed or real-phone performance.
Local screenshots and benchmark results are in the ignored `work/verification/`
directory.

Live multi-user authentication, RLS enforcement, parcel RPCs, and provider-backed
geocoding/ESV requests still need connected testing. Chromium phone-sized
layouts are not physical iPhone, Safari, or Samsung-device testing.

### Follow-up: missing local parcels

The fresh checkout had only `.env.example`, with no Supabase environment
variables. It therefore ran in demo mode and never requested official parcels;
the cleanup had not removed parcel loading. Restored the existing project's URL
and enabled publishable key in ignored `.env.local`. The local browser now
shows sign-in without an uncaught app error, and the authentication settings
endpoint returns HTTP 200 with Google and email enabled.

A read-only check found 66,252 parcels across the four imported counties.
Viewport and territory RPCs returned 2,866 and 2,950 parcels respectively for
a test area near Lawrenceburg (the territory query includes its boundary buffer).
These SQL checks used management access; they do not verify a signed-in
volunteer's full browser flow. Parcel access requires an active church
membership. MapTiler and ESV settings remain absent locally.

## Findings for the next development pass

| Priority | Finding and evidence | Suggested direction |
| --- | --- | --- |
| High | Sign-out calls Supabase but does not clear IndexedDB. The primary document and several caches use shared keys, with connection metadata identifying the last user. See `SupabaseGate.tsx`, `storage.ts`, and `use-neighborwalk.ts`. | Define an account-switch/lost-device policy; partition cached records by account and workspace, then test sign-out, revocation, and offline re-entry. |
| High | Snapshot merge reconciled entities, but protected-table writes and the snapshot update were separate operations. Two edits to one person or property could overwrite fields; no-op sync also did not fetch other devices' changes. The historical `runSync`/`workspace-sync.ts` path was retired during the church-readiness rework. | Add tests with two authenticated devices, explicit same-record conflict rules, and a deliberate remote-refresh strategy before larger group use. |
| High | `enforceRetention` removes resolved tasks without a retained source visit, regardless of how recently the task was completed. Standalone person tasks can therefore disappear on reload. | Give completed/cancelled tasks an explicit age-based retention rule and test task history across reload, sync, and expiration. This policy was preserved during cleanup. |
| High | Several command paths cap the pending mutation queue with `.slice(-2000)`. Old protected-record updates/deletions can lose their pending marker during a long offline session. | Compact repeated mutations by entity without dropping distinct unsaved work; test more than 2,000 queued changes. |
| Medium | Dates frequently use UTC string slicing while tasks are scheduled at 5 p.m. in the device's timezone. A church timezone setting exists but is not consistently applied. | Decide whether dates follow the church or the device, then share date-only conversion and test evening/DST boundaries. |
| Medium | Backups include `NeighborWalkData`, but the newer guide library, favorites, and group defaults live separately. | Define a complete versioned export/import format and test restoring it on a fresh device. |
| Medium | Some command validation returns without saving, while callers still show a success message. Import also writes device storage before the connected workflow finishes preparing the replacement. | Return explicit command results and validate imports completely before replacing active state. |
| Medium | Several dialogs lack focus trapping/keyboard dismissal, and some action labels are ambiguous when repeated. | Make the shared modal handle focus and Escape, with keyboard and screen-reader checks. |
| Product | New users need an invitation; the client has no workspace-creation flow. The database allows only one active church membership per user. | Decide whether the product will serve one congregation or support people belonging to several churches before designing onboarding. |
| Product | Coverage is cumulative over retained location outcomes, while some copy says it describes the selected event. Multiple dwellings can share one residential parcel. | Define event coverage versus ongoing coverage and make the denominator clear to leaders. |

## Web and mobile direction

The existing responsive PWA remains the working product. Keep domain validation,
geometry, and outreach rules independent from browser APIs; add platform-specific
storage, navigation, notifications, and authentication adapters when a native
delivery approach is selected. There is no native shell in this repository yet.

Before store distribution, validate the app on real iPhones and Android devices,
including large text, interrupted connectivity, installation/upgrades, auth
redirects, and cache lifecycle. Full offline map regions and background push
delivery remain separate capabilities; the current PWA provides bounded map
caching and notifications while it is running.

## Follow-up: development isolation

Local development has since been separated from production. See
[sandbox.md](sandbox.md) for startup, test accounts, the connection guard,
browser network policy, separate caches, and network restrictions in unit tests.
Production records were not copied; the sandbox currently uses fictional data
and synthetic parcel rectangles. The earlier Supabase `.env.local` connection
was replaced with the isolated local project. A hosted-only migration assumption
was fixed so a fresh local database can replay the complete migration history.
