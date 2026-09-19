# NeighborWalk

**Turn neighborhood conversations into personal follow-through.** NeighborWalk is a mobile-first app and website for churches coordinating respectful outreach: prepare an outing, record an encounter, assign an owned next step, and follow through together. It is not a church-management replacement or a system for scoring neighbors, beliefs, conversions, or volunteers.

## Release status

The church-readiness rework is on `rework/church-ready-neighborwalk` and is **not yet approved or deployed to production**. The previous improvements were deployed first at `d94d17c6a24075e6cc657759b676dba988789a97`; production remains that checkpoint. No rework migration has changed the live church database.

See the [audit delivery matrix](docs/audit-delivery-status.md) for implemented features and gaps, the [execution ledger](docs/rework-progress.md) for exact test results, and the [release gates](docs/production-checklist.md) for what remains. Fresh production recovery, controlled staging/cutover, commercial hosting, operator policies/support, real email delivery, physical-phone testing and church-pilot evidence are not replaced by a passing build. Enrollment stays closed pending those decisions.

## Implemented on the rework branch

- Today / Outreach / People / More navigation, direct links, reusable groups/areas, outing preparation, assignment acceptance, readiness and debrief.
- Map and address-list fieldwork, manual locations, and community encounters that do not require an address or named person.
- Address-optional people, named task responsibility, date-only due dates, accepted handoffs, leader backstops and permission-filtered history.
- Independent contact restrictions, retained corrections, reviewed person/location moves and duplicate aliases that preserve original records.
- Optional church/private guides with coaching, reminders and Scripture references; complete/coherent reads, captured-version edits, durable request recovery and reference-safe archives.
- Transactional tenant-scoped database commands, immutable device outbox and server receipts, held conflicts, account isolation and live-session checks.
- Prepared offline app assets, permitted cached records/tasks and saved guide text within a bounded previously verified account window.
- Reviewed CSV exchange, audited administration and local encrypted database capture/isolated-restore tooling.
- Public positioning, how-it-works, pricing/pilot explanation, trust/help and explicitly draft policy pages; a separate fictional demo and prepared leader/volunteer pilot material.
- Opt-in privacy-preserving email-reminder implementation, disabled until provider/scheduler/delivery verification. This is not a claim of active email, background synchronization or closed-app push.

Outings currently reference a guide's current text, not immutable historical editions. Archival is not permanent erasure. People are visible to their responsible owner, church leaders and explicitly authorized recipients; historical creator access is disclosed and ends at an accepted handoff. Scripture is reference-only. Maps require connectivity and appropriate provider permission; address-list work does not require map tiles.

## Run safely locally

Use Node **22.x** and the isolated Supabase development stack. From this repository:

```sh
npm ci
npm run sandbox:start
npm run dev
```

Use the fictional accounts in [safe local testing](docs/sandbox.md). Local and preview builds refuse production database connections. Do not bypass that guard or copy production credentials into `.env.local`. A separately approved staging configuration remains a release requirement. The explicit demo uses fictional device-only data; real accounts require an invitation and active church membership.

```sh
npm run verify
npm run test:database
npm run test:browser
```

The browser suite starts its own optimized local server and uses only fictional loopback services. Run the build before browser tests; do not rebuild while that suite is running. See [browser readiness](docs/browser-readiness.md) for boundaries and the still-required physical-device matrix.

## Architecture and configuration

The current source of truth is the checked-in `supabase/migrations/` sequence, generated [database types](lib/database.types.ts), transactional clients and their regression tests. The historical `docs/database/postgres.sql` and `docs/api/openapi.yaml` are **archived design proposals**, not the current schema or deployed REST API. Never apply them to the live church.

The normalized rework and its compatible application must be released together: it revokes legacy bulk snapshot and direct guide/protected-record writes. Existing snapshots and historical records are preserved for reconciliation, not replaced with seed data. See [current architecture](docs/current-architecture.md), [workspace reads](docs/workspace-read-reliability.md), [guide reliability](docs/guide-library-reliability.md) and [session security](docs/session-security.md).

`npm run sandbox:start` prepares ignored local settings. `.env.example` lists configuration names, not permission to activate a production service. Browser publishable keys and restricted map keys are public by design; never substitute a secret/service-role key or prefix server secrets with `NEXT_PUBLIC_`. Verify production auth URLs, provider callbacks and SMTP delivery under the release runbook before inviting real users.

## Preservation, operations and pilot

[Database recovery](docs/database-recovery.md) distinguishes authored device recovery, sensitive reviewed exports, encrypted operator database bundles and managed-project recovery. Private backup files and credentials stay outside Git with restricted permissions. A server backup cannot capture unsent phone-only work, and a logical database archive does not include every provider setting or storage object file.

[Email activation](docs/email-reminders.md) and the [church pilot kit](docs/church-pilot-kit.md) describe prepared workflows and their outstanding verification. The [original audit](docs/market-readiness-audit.md) and [approved plan](docs/market-readiness-plan.md) remain the acceptance contract. Follow [production release gates](docs/production-checklist.md); a standalone production-deploy command is not a safe cutover procedure for this branch.
