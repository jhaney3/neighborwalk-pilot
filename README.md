# NeighborWalk

**Turn neighborhood conversations into personal follow-through.** NeighborWalk is a mobile-first app and website for churches coordinating respectful outreach: prepare an outing, record an encounter, assign an owned next step, and follow through together. It is not a church-management replacement or a system for scoring neighbors, beliefs, conversions, or volunteers.

## Release status

The church-readiness rework was merged to `main` in PR #2, followed by the prior-visit planner overlay in PR #3. Production currently tracks merge commit `14b117485bd8c100f743bbf495d8bf99bb679a88`; its Vercel deployment completed successfully, the public site and fictional demo return HTTP 200, and the production Supabase project exposes contracts from the final checked-in migration. The exact hosted migration-history ledger still needs operator-authenticated reconciliation with the repository.

A separate native iOS application is implemented on `codex/neighborwalk-ios` at `5046a8a30528747f7b7706bbdf7b4dcf5eb15974`. It is a bundled Capacitor/Xcode client that shares workspace/domain code and the Supabase backend; it is not a remote wrapper around the website. It has not been merged to `main`, signed for distribution, uploaded to TestFlight/App Store, or activated with its two additional production migrations. See the branch's [iOS checkpoint](https://github.com/jhaney3/neighborwalk-pilot/blob/codex/neighborwalk-ios/docs/RESUME-IOS.md) and [release guide](https://github.com/jhaney3/neighborwalk-pilot/blob/codex/neighborwalk-ios/docs/ios-release.md).

See the [audit delivery matrix](docs/audit-delivery-status.md) for implemented features and gaps, the [execution ledger](docs/rework-progress.md) for exact test results, and the [release gates](docs/production-checklist.md) for what remains. The deployed application/schema pair is a technical release, not approval for open or commercial enrollment. Fresh complete production recovery, hosted-history reconciliation, isolated staging, commercial hosting, operator policies/support, real email delivery, broader accessibility/device evidence and church-pilot validation remain open. Enrollment stays closed pending those decisions.

## Implemented in the current release

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

## iOS development checkpoint

The iOS branch includes a native project, bundled workspace, Apple/Google authentication bridges, custom auth/invitation links, native share/export and AirPrint, haptics, app-switcher privacy protection, a privacy manifest, simulator UI coverage and an unsigned archive checkpoint. Its account-deletion-request and flexible-invitation migrations are additive but not deployed.

Before TestFlight/App Store release, fix the branch's full-sandbox database seed failure, run the dedicated iOS CI workflow, rehearse/deploy the two migrations, configure signing and Apple/Google callbacks, host/test invitation Universal Links, implement actual deletion fulfillment and Apple-token revocation, finalize policies/support disclosures, complete signed physical-device/iPad/accessibility testing and resolve TestFlight findings. The live website on `main` is unaffected by the iOS branch's failed Vercel preview.

## Run safely locally

Use Node **22.x** and the isolated Supabase development stack. From this repository:

```sh
npm ci
npm run sandbox:start
npm run dev
```

Use the fictional accounts in [safe local testing](docs/sandbox.md). Local and preview builds refuse production database connections. Do not bypass that guard or copy production credentials into `.env.local`. A separately approved staging configuration remains an operational requirement before wider enrollment. The explicit demo uses fictional device-only data; real accounts require an invitation and active church membership.

```sh
npm run verify
npm run test:database
npm run test:browser
```

The browser suite starts its own optimized local server and uses only fictional loopback services. Run the build before browser tests; do not rebuild while that suite is running. See [browser readiness](docs/browser-readiness.md) for boundaries and the still-required physical-device matrix.

## Architecture and configuration

The current source of truth is the checked-in `supabase/migrations/` sequence, generated [database types](lib/database.types.ts), transactional clients and their regression tests. The historical `docs/database/postgres.sql` and `docs/api/openapi.yaml` are **archived design proposals**, not the current schema or deployed REST API. Never apply them to the live church.

The deployed application expects the normalized schema that revokes legacy bulk snapshot and direct guide/protected-record writes. Production read-only checks confirm the newer public GIS contract and the final outing-participant table are present. Existing snapshots and historical records remain preserved for reconciliation, not replaced with seed data. See [current architecture](docs/current-architecture.md), [workspace reads](docs/workspace-read-reliability.md), [guide reliability](docs/guide-library-reliability.md) and [session security](docs/session-security.md).

The iOS client has an independent build/release path but shares these authorization and domain contracts. Future database changes must remain backward compatible with the deployed website and installed iOS versions. Do not merge the iOS UI into the website merely to release its reviewed backend migrations.

`npm run sandbox:start` prepares ignored local settings. `.env.example` lists configuration names, not permission to activate a production service. Browser publishable keys and restricted map keys are public by design; never substitute a secret/service-role key or prefix server secrets with `NEXT_PUBLIC_`. Verify production auth URLs, provider callbacks and SMTP delivery under the release runbook before inviting real users.

## Preservation, operations and pilot

[Database recovery](docs/database-recovery.md) distinguishes authored device recovery, sensitive reviewed exports, encrypted operator database bundles and managed-project recovery. Private backup files and credentials stay outside Git with restricted permissions. A server backup cannot capture unsent phone-only work, and a logical database archive does not include every provider setting or storage object file.

[Email activation](docs/email-reminders.md) and the [church pilot kit](docs/church-pilot-kit.md) describe prepared workflows and their outstanding verification. The [original audit](docs/market-readiness-audit.md) and [approved plan](docs/market-readiness-plan.md) remain the acceptance contract. Follow [production release gates](docs/production-checklist.md); a successful application deployment does not by itself close recovery, operations, policy, provider or pilot gates.
