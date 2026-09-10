# Safe local testing

Local development uses a separate Supabase database on this device. Production
is the hosted `neighborwalk` project; local and preview builds refuse its URL.

## Start and sign in

```bash
mise exec node@22 -- npm run sandbox:start
mise exec node@22 -- npm run dev
```

Open http://localhost:3000 and refresh any tab left open from the previous setup.
Use these **local-only test accounts**, not your production account:

| Account | Email | Password |
| --- | --- | --- |
| Leader | `leader@neighborwalk.test` | `NeighborWalk-test-123!` |
| Volunteer | `volunteer@neighborwalk.test` | `NeighborWalk-test-123!` |

The yellow test-workspace indicator identifies the isolated app. The initial
church, people, visit history, tasks, and guide are fictional. The 16 parcel
rectangles are explicitly labeled synthetic test parcels. Production data has
not been copied. Google sign-in is available on production; test accounts use
passwords. Local recovery/invitation emails are captured at
http://127.0.0.1:54324 instead of being delivered to real recipients.

`sandbox:start` preserves existing test records on subsequent runs. It updates
only the two Supabase values in ignored `.env.local`, preserving map-provider
settings. Starting after a reboot restarts the local services. On this Linux
device, the project uses a rootless Docker daemon without sudo, Docker-group
membership, or changes to the system Docker service. Its files live in ignored
`work/`; a working Docker installation, UID mappings, curl, tar, and psql are
prerequisites. The helper downloads pinned rootless binaries on first use.

## What provides the wall

- The database, auth users, credentials, and test workspace are separate from
  production. All exposed database services bind to `127.0.0.1`.
- Next.js refuses every remote database URL in local and preview builds.
  Production connections are allowed only for a Vercel production build.
  The browser client performs an additional check, including blocking a
  production build opened on localhost.
- A browser Content Security Policy allows the local database and approved map
  providers, and excludes the production Supabase endpoint.
- Test IndexedDB databases, auth sessions, workspace connection metadata,
  guide preferences, and device identifiers have separate names. Old local
  production caches and pending edits are not imported or deleted.
- Unit tests reject unmocked fetch and Node socket connections.
- Sandbox scripts use a fixed local database address and have no remote-link,
  push, merge, or production-reset command.

These protections prevent accidental production writes through this local app.
They do not restrict an administrator using the Supabase dashboard, an external
database client, or an agent's separately authorized management tools. MapTiler
requests still use the configured map-provider account.

## Verify, inspect, and stop

```bash
npm test
npm run sandbox:verify
npm run sandbox:status
npm run sandbox:stop
```

`sandbox:verify` signs in, reads parcels, saves a test snapshot, creates/edits/
deletes a temporary person, checks member privacy, and checks anonymous access.
All these requests use `127.0.0.1`; its temporary person is removed afterward.
Stopping retains test data. Studio is available at http://127.0.0.1:54323.

To inspect startup failures, use `work/runtime/supabase-start.log` and
`work/runtime/docker.log`. These ignored files can include local credentials;
do not publish them. Do not run remote migration or reset commands against the
production project as part of testing.

## Production and realistic test data

Keep the hosted URL and publishable key in Vercel's **Production** environment.
Do not copy them into local or Preview settings. Hosted preview testing would
need its own approved database and a corresponding explicit allowlist entry;
the current setup deliberately supports the local sandbox only.

Automatic approval review rejected copying production records during this setup.
Production records require a separately approved, one-way copy. The proposed
scope is church name, territories, property addresses/geometry, and parcel
geometry. People, contact details, notes, account credentials, and production
pending changes would be excluded; visits and outcomes would use fictional
fixtures. Any approved copy should use a read-only source and the fixed local
destination, with record counts and schema validation before activation.

One existing migration assumed a hosted-only `rls_auto_enable()` helper. Its
revoke is now conditional so the complete migration history can initialize a
fresh local database. The hosted function's permissions remain the same when
that migration runs; no migration was applied to production during this work.

## Verification on this device

- Lint, TypeScript, all 68 unit tests, and the optimized Next.js build passed.
- Replaying the migrations created a fresh local database successfully.
- `sandbox:verify` passed authenticated create/edit/delete operations, parcel
  reads, snapshot persistence, member privacy, and anonymous-access checks.
- Starting Next.js with the production database URL was rejected before the
  app could be served.
- Chromium confirmed that backend requests used only `127.0.0.1:54321`, storage
  used the sandbox namespace, and a production health request was blocked by
  Content Security Policy before connecting.
- A fictional visit recorded through the browser remained in the local
  database after reload. Desktop and phone screenshots were inspected.

Screenshots are in ignored `work/verification/sandbox-desktop.png` and
`sandbox-mobile.png`. This is local Chromium verification, not physical-device
testing or a production security audit.
