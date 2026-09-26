# Development context

> Historical record. For the current iOS release status and requirements, see the [iOS release guide](../ios-release.md).

Repository orientation recorded on 2026-09-08 at commit `0fad092` on `main`.
Updated during the earlier cleanup on `refactor/simplify-neighborwalk`. These are historical orientation notes, not the current rework contract or an audit of the live deployment. Use [current architecture](../current-architecture.md), the [execution ledger](rework-progress.md) and [release gates](production-checklist.md) for current branch behavior and verification.

## Development on this device

Checkout: `/home/jhaney/Work/neighborwalk-pilot`.
Git remote: `https://github.com/jhaney3/neighborwalk-pilot.git`.

The project requires Node 22.x. Node 22.23.2 was installed through the existing
mise installation, alongside the device's default Node 26. Dependencies were
installed from `package-lock.json` using `npm ci`.

```bash
cd /home/jhaney/Work/neighborwalk-pilot
mise exec node@22 -- npm run dev
```

Use the URL printed by Next.js. No environment file is needed for the fictional
Grace Harbor demo. Without Supabase configuration, records stay on this browser's
device storage. The default map style is OpenFreeMap Bright.

Connected local development now uses an isolated Supabase stack. Run
`mise exec node@22 -- npm run sandbox:start`, then sign in with the test account
in [sandbox.md](../sandbox.md). Production connections are blocked in local and
preview builds. The original local production settings were saved in ignored
`.env.before-test-isolation.local`; they are not loaded by Next.js.

`NEXT_PUBLIC_MAPTILER_KEY` was added locally by the user and is preserved.
ESV and a custom geocoder are not configured. Do not paste production database
settings into `.env.local`.

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` enable
  authentication and church records in the selected environment. Local
  development accepts only the isolated local database.
- `NEXT_PUBLIC_MAPTILER_KEY` enables MapTiler Streets and external address search.
- `NEXT_PUBLIC_MAP_STYLE_URL` overrides the default map style.
- `NEXT_PUBLIC_GEOCODER_URL` selects a reverse-geocoding endpoint.
- Historical only: `ESV_API_KEY` once enabled inline Scripture. The rework is reference-only; its retired passage endpoint makes no provider request and does not use this key.
- `NEXT_PUBLIC_SITE_URL` overrides the metadata origin.

Baseline verification under Node 22:

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 59 tests passed across 11 files.
- `npm run build`: passed with network access. The restricted first attempt
  failed to download Archivo and IBM Plex Mono from Google Fonts.

Run these through `mise exec node@22 --`, or run
`mise exec node@22 -- npm run verify` for the complete sequence.
Connected auth, live database policies, browser interactions, and offline
reconnection were not exercised during this orientation.

## Product and navigation

NeighborWalk is a mobile-first church outreach PWA. Its six main views are the
walk map, people, follow-ups, conversation guides, leader administration, and
settings. It tracks locations and objective visit outcomes, with separate
person-oriented discipleship records. Coverage measures operational activity;
there are no conversion scores or volunteer leaderboards.

The repository contains no native iOS/Android project, React Native/Expo app,
or Capacitor wrapper. App Store packaging is future work.

## Code map

| Area | Main files | Responsibility |
| --- | --- | --- |
| Entry and authentication | `app/page.tsx`, `components/SupabaseGate.tsx`, `lib/auth.ts` | Demo/connected mode, Google and email/password sign-in, recovery, optional email links |
| App shell | `app/NeighborWalkApp.tsx` | View selection, map search, territory editing, property/parcel dialogs, feature wiring |
| State and commands | `lib/use-neighborwalk.ts` | Loading, ordered saves, mutations, audit entries, memberships, sync, guide actions |
| Domain and storage | `lib/domain.ts`, `lib/storage.ts`, `lib/seed.ts` | Types, Zod schemas, schema migration, retention, IndexedDB, JSON backup import/export |
| Map | `components/MapCanvas.tsx`, `lib/map-*`, `lib/geocoding.ts` | MapLibre layers, camera, location/building selection, drawing, geolocation, address lookup |
| Parcels and coverage | `lib/parcels.ts`, `lib/parcel-*`, `lib/use-*-parcels.ts`, `lib/territory-coverage.ts` | Spatial RPCs, territory caching, viewport loading, dwelling grouping, residential coverage |
| Visit workflow | `components/PropertyDrawer.tsx` | Guided conversations, outcomes, person entry, location details, history |
| People | `components/PeopleView.tsx`, `lib/discipleship.ts` | Ownership/sharing, stages, notes, tasks, protected database persistence |
| Other views | `components/FollowUpsView.tsx`, `components/GuideView.tsx`, `components/LeaderView.tsx`, `components/SettingsView.tsx`, `components/MembersPanel.tsx` | Follow-up queue, guide editor, leader metrics, membership/invitations, settings |
| Guide library | `lib/conversation-guides.ts` | Church/personal guides, favorites, group defaults, local and connected storage |
| Scripture | `components/ScriptureReader.tsx`, `app/api/scripture/route.ts` | Reference-only external links; the retired API route returns a provider-free reference response |
| Appearance | `app/globals.css`, `app/styles/*.css` | Feature CSS, responsive layout, shared controls; preserve the documented import order |
| PWA | `public/sw.js`, `public/manifest.webmanifest` | Installation and bounded caching; service worker registers only in production |
| Database | `supabase/migrations/` | Actual pilot schema history, grants, RLS, guard functions, parcel RPCs |
| Supporting designs | `docs/database/postgres.sql`, `docs/api/openapi.yaml` | Archived proposals, not the implemented backend or an executable migration/API contract |

## Data flow and boundaries

At this orientation checkpoint, the local document was `NeighborWalkData` schema
version 10 and connected writes still used a revision-checked shared snapshot plus
separate protected-person tables. That snapshot merge and its direct protected-
record persistence were retired by the church-readiness rework.

The current branch uses schema version 11 for account/church/environment-scoped
device state and an immutable outbox. Connected reads use bounded relational
collections; connected field writes use versioned, transactional commands with
server receipts. Legacy snapshots remain only as preserved migration evidence.
See [current architecture](../current-architecture.md) for the maintained contract.

Membership roles are leader and volunteer. SQL policies and guards enforce
membership and privileged operations. Person visibility includes the creator,
assigned owner, explicitly shared users/teams, and church leaders. New people
start owned by their authenticated creator, enforced in both client and SQL.
The schema permits only one active church membership per user.

Parcel identity is county FIPS plus GIS link; multiple dwellings may share a
parcel. Territory parcels are cached for twelve hours with boundary and dataset
revision metadata. Coverage uses residential parcels when available and mapped
locations otherwise. `scripts/parcel-import/` contains a separate Python importer
for Giles, Lawrence, Lewis, and Wayne county archives; it needs an external
authenticated import endpoint and is not required to run the web app.

At the recorded baseline, the service worker cached app assets and a bounded set
of map responses. The current branch prepares build-pinned anonymous app assets
only; it excludes external map imagery and protected/API responses. Email-reminder
delivery is separately implemented but remains disabled until its provider and
scheduler are configured and verified.

## Documentation differences and follow-up validation

- Invitations and member revocation already have UI and SQL implementations.
  The checklist now calls for validating them with separate accounts.
- Concurrent editing still needs connected, multi-device validation.
- The README now reflects the current UI, which
  displays an invitation-required screen for users without membership. The
  creation RPC remains in migrations; the unused client factory was removed.
- The OpenAPI routes are archived design documents. Current Next.js API routes
  cover the retired reference-only Scripture response and reminder operations;
  workspace operations use the transactional Supabase contracts.
- The orientation-era tests mainly covered pure domain, migration, merge,
  parsing, and route behavior. Current database and browser suites add RLS and
  end-to-end fictional-workspace evidence; they still do not replace staging,
  production, physical-device or church-pilot verification.
- Before release work, validate account switching/cache isolation, sync after
  person-task changes, same-record conflicts, revocation while offline, backup
  completeness across the separate guide library, and real device installation.

The README identifies `neighborwalk-pilot.vercel.app` as the deployment and
`jhaney3s-projects/neighborwalk-pilot` as the Vercel project. That live configuration
was not inspected or modified during this setup.
