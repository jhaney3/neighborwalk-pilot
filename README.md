# NeighborWalk

NeighborWalk is a mobile-first progressive web app for respectful neighborhood outreach. Volunteers can work from a real interactive map, record one objective outcome per visit, schedule permission-based follow-ups, and use a church-approved conversation guide. Leaders can define territories and see operational coverage without ranking residents, conversations, or volunteers.

The deployed build works immediately in device-only mode with fictional sample data. Records persist in IndexedDB, field actions work offline, and the app can be installed from a supported browser. Connect the documented backend contract before using it as a shared multi-user system.

## Included

- MapLibre neighborhood map with house/location markers, outcome filters, address search, geolocation, and tappable building detection
- leader-drawn territory boundaries with assignment and coverage summaries
- visit history, objective notes, do-not-revisit status, and consent-gated return visits
- follow-up queue with overdue/today/upcoming filters, rescheduling, completion, and cancellation
- editable, church-approved conversation guide with sample words and Scripture references
- leader dashboard for territories, teams, coverage, outcomes, and audit activity
- offline device storage, ordered writes, validated import/export, retention enforcement, and a service worker
- installable PWA manifest, responsive desktop/mobile layouts, reduced-motion support, and device notifications
- optional sync and reverse-geocoding adapters controlled by environment variables
- production PostgreSQL/PostGIS schema with constraints, indexes, and row-level security
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
| `NEXT_PUBLIC_API_BASE_URL` | Enables connected mode and sends sync requests to `/v1/sync`. |
| `NEXT_PUBLIC_GEOCODER_URL` | Same-origin or trusted proxy endpoint used for reverse address lookup. |
| `NEXT_PUBLIC_SITE_URL` | Canonical production origin used for metadata. |

Without `NEXT_PUBLIC_API_BASE_URL`, NeighborWalk intentionally stays in device-only mode. The Settings screen labels the identity picker as a demo preview so it cannot be mistaken for real authorization.

When `NEXT_PUBLIC_MAPTILER_KEY` is configured, new installs use MapTiler Streets and existing version-3 installs migrate once from a bundled OpenFreeMap style. Users can still choose another layer afterward. MapTiler supplies streets and building footprints, not legal parcel boundaries; a separate parcel provider is required for a Zillow-style parcel overlay.

## Backend handoff

The two implementation contracts are:

- [`docs/database/postgres.sql`](docs/database/postgres.sql): PostgreSQL 16 + PostGIS tables, constraints, indexes, retention-ready timestamps, immutable visit policies, and role-aware RLS.
- [`docs/api/openapi.yaml`](docs/api/openapi.yaml): the HTTP interface expected by the client.

For every authenticated database transaction, the API must verify the external session, resolve it to `public.users.id`, then execute `SET LOCAL app.user_id = '<internal bigint id>'` before church-scoped queries. Use a non-owner application role so forced row-level security remains effective. Administrative membership provisioning and privacy erasure should run through separate, narrowly privileged server jobs.

The sync endpoint receives idempotent mutation IDs plus a validated snapshot. The server remains authoritative: it must validate church membership, roles, object ownership, note limits, follow-up consent, and public IDs before applying anything. Never trust the device-only role selector or client-supplied church/user identifiers.

## Data and privacy model

NeighborWalk records addresses because the workflow is location-based, but it deliberately excludes resident names, phone numbers, emails, demographic labels, receptiveness scores, conversion tracking, and volunteer leaderboards. Notes are optional, character-limited, and described as objective operational context.

Ordinary visit history and audit entries expire according to the church retention setting. Active follow-up source records remain until resolved; do-not-revisit instructions persist so future volunteers can honor the resident's request. Leaders should establish a documented deletion process and legal basis appropriate to their jurisdiction before collecting live data.

Exported backups are readable JSON and can contain sensitive ministry records. Store them in approved encrypted storage and delete obsolete copies.

## Deployment status

The current Sites deployment is private and installable as a PWA. Its authentication gate protects access to the site, while shared user identity, church membership, and authorization become authoritative only after the backend is connected. See [`docs/production-checklist.md`](docs/production-checklist.md) before a live canvassing rollout.
