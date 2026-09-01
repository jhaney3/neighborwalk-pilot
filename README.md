# NeighborWalk

NeighborWalk is a mobile-first progressive web app for respectful neighborhood outreach. Volunteers can work from a real interactive map, record one objective outcome per visit, schedule follow-ups, and use a church-approved conversation guide. Leaders can define territories and see operational coverage without ranking residents, conversations, or volunteers.

The app remains offline-first with IndexedDB and an installable service worker. When Supabase is configured, members sign in with Google or email and password, then synchronize a church workspace protected by grants and row-level security.

## Included

- MapLibre neighborhood map with house/location markers, outcome filters, address search, geolocation, and tappable building detection
- leader-drawn territory boundaries with assignment and coverage summaries
- visit history, objective notes, do-not-revisit status, and scheduled return visits
- unified follow-up task queue for location visits and person care, with overdue/today/upcoming filters, notes, rescheduling, completion, and cancellation
- searchable, private-by-default discipleship directory with a named owner for every person, explicit team/member sharing, dated follow-up plans, and one visible note history
- editable, church-approved conversation guide with sample words and Scripture references
- leader dashboard for territories, teams, coverage, outcomes, and audit activity
- offline device storage, ordered writes, validated import/export, retention enforcement, and a service worker
- installable PWA manifest, responsive desktop/mobile layouts, reduced-motion support, and device notifications
- Supabase Google, email/password, recovery, and optional one-time-link authentication with revision-aware workspace synchronization
- production PostgreSQL/PostGIS migrations with explicit grants, row-level security, and a parcel-ready spatial index
- OpenAPI 3.1 contract for bootstrap, sync, map data, visits, follow-ups, and reverse geocoding

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Then open the local URL shown in the terminal. The app seeds fictional Grace Harbor data the first time it opens.

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run verify
```

## Configuration

Copy `.env.example` to `.env.local` for local development. MapTiler browser keys are visible to visitors by design, so use a dedicated key restricted to the deployed and local origins. Never put server secrets in variables prefixed with `NEXT_PUBLIC_`.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_MAPTILER_KEY` | Protected browser key used to build the MapTiler Streets style URL automatically. Paste only the key value. |
| `NEXT_PUBLIC_MAP_STYLE_URL` | MapLibre-compatible style JSON URL. Defaults to OpenFreeMap Bright. |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-safe Supabase project API URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Modern browser-safe Supabase publishable key. Never substitute a secret or service-role key. |
| `NEXT_PUBLIC_GEOCODER_URL` | Same-origin or trusted proxy endpoint used for reverse address lookup. |
| `NEXT_PUBLIC_SITE_URL` | Canonical production origin used for metadata. |

Without both Supabase variables, NeighborWalk intentionally stays in device-only demo mode. With them, the app requires Google or email sign-in and offers the first verified user a clean Lawrenceburg church workspace.

When `NEXT_PUBLIC_MAPTILER_KEY` is configured, new installs use MapTiler Streets and existing version-3 installs migrate once from a bundled OpenFreeMap style. Users can still choose another layer afterward. MapTiler supplies streets and building footprints, not legal parcel boundaries; a separate parcel provider is required for a Zillow-style parcel overlay.

## Supabase backend

### Google sign-in setup

NeighborWalk's Google button uses Supabase's hosted OAuth callback. Complete these provider settings once:

1. In Google Auth Platform, create an OAuth client with application type **Web application**.
2. Add the production app origin under **Authorized JavaScript origins**: `https://neighborwalk-pilot.vercel.app`.
3. Add the Supabase callback under **Authorized redirect URIs**: `https://llhrbtlkcneldgrhkwpf.supabase.co/auth/v1/callback`.
4. Configure the Google consent screen scopes `openid`, `userinfo.email`, and `userinfo.profile`.
5. In Supabase, open **Authentication > Sign In / Providers > Google**, enable the provider, and paste the Google Client ID and Client Secret.
6. In Supabase **Authentication > URL Configuration**, set the Site URL to `https://neighborwalk-pilot.vercel.app` and add the exact redirect `https://neighborwalk-pilot.vercel.app/` to Redirect URLs. Add the local development origin separately when testing Google sign-in locally.

Do not put the Google Client Secret in a `NEXT_PUBLIC_` environment variable or commit it to this repository. It belongs only in the Supabase provider configuration.

### Production email and password setup

NeighborWalk uses Google as the quickest sign-in path and email/password as the dependable alternative. A routine password sign-in does not send an email. Account confirmation, password recovery, and the optional one-time-link fallback do send email.

Supabase's built-in email sender is best-effort and currently limited to two messages per hour, so it is not suitable for a live rollout. Before inviting real users, configure a custom SMTP provider under **Authentication > Email > SMTP Settings** and test account confirmation and recovery from the production origin. Keep email confirmation enabled. Existing magic-link users can sign in once and choose **Settings > Account and access > Set or change password**.

For the small no-domain pilot, use a dedicated Gmail account with `smtp.gmail.com`, port `465`, the full Gmail address as both sender and username, and a Google App Password after enabling 2-Step Verification. Never use or store the account's normal Google password in Supabase. Supabase warns that personal-email SMTP is not designed for higher-volume transactional delivery, so move to a domain-backed transactional provider before a broader public rollout.

SMS is intentionally not enabled as the default workaround. Supabase phone login requires a separately configured SMS provider and incurs a message on each OTP login; it is useful only if the ministry decides that the added provider cost and phone-number lifecycle risks are worthwhile.

The applied database source is stored in `supabase/migrations/`. It creates:

- church workspaces and authenticated memberships
- an offline-first workspace snapshot with optimistic revision checks
- a privacy-minimized parcel table and bounding-box RPC for Lawrence County data
- explicit Data API grants and tenant-scoped RLS policies
- protected discipleship people, note, and follow-up tables whose RLS grants access only to creators, assigned owners, explicit shares, and church leaders

`docs/database/postgres.sql` and `docs/api/openapi.yaml` preserve the more normalized future backend design. The connected pilot currently uses the smaller Supabase schema so the existing offline document can synchronize without discarding field functionality.

## Data and records model

NeighborWalk records addresses because the workflow is location-based and can store person details supplied for follow-up. People are private to the person who added them and their assigned discipleship owner unless explicitly shared with a group or church member; leaders can oversee every record. The person who adds a record becomes its initial discipleship owner. Each active person may include a non-numeric relationship stage, dated tasks in the unified follow-up queue, and one chronological note history visible from both the profile and its follow-ups. Stages provide shared ministry context; they are not scores. The app deliberately excludes receptiveness scores, conversion tallies, and volunteer leaderboards. Notes are optional, character-limited, and described as care context. Approval and retention records are maintained outside the app.

Ordinary visit history and audit entries expire according to the church retention setting. Active follow-up source records remain until resolved; do-not-revisit instructions persist so future volunteers can honor the resident's request. Leaders should establish a documented deletion process and legal basis appropriate to their jurisdiction before collecting live data.

Exported backups are readable JSON and can contain sensitive ministry records. Store them in approved encrypted storage and delete obsolete copies.

## Deployment status

The canonical production PWA is deployed through the linked GitHub repository and Vercel project at [neighborwalk-pilot.vercel.app](https://neighborwalk-pilot.vercel.app). Make application changes in this repository; Vercel owns production and preview builds. The public app shell requires its own Google or Supabase email sign-in; PostgreSQL grants and row-level security protect workspace and parcel records after authentication.

Vercel project: `jhaney3s-projects/neighborwalk-pilot`. Production and Preview both contain the browser-safe MapTiler and Supabase variables listed above. Deployment Protection is disabled so volunteers do not encounter a separate Vercel login screen. To publish the linked workspace again:

```bash
npx vercel deploy --prod --yes --scope jhaney3s-projects
```

See [`docs/production-checklist.md`](docs/production-checklist.md) before a live canvassing rollout.
