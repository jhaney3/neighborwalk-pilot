# Church-readiness rework

Approved by the product owner on September 9, 2026. The original audit and plan remain the acceptance contract; this ledger records execution, not a substitute scope.

## Release checkpoints

- Existing improvements committed and pushed to `main`: `d94d17c6a24075e6cc657759b676dba988789a97`.
- Vercel production deployment `dpl_C4sMrQ52ewYiZdrAyMF3YCc9qjho`: READY; public URL returned HTTP 200.
- Rework branch: `rework/church-ready-neighborwalk`, created after production verification.
- Baseline checks: lint, TypeScript, 68 tests / 14 files, optimized production build all passed.
- No production database mutations performed yet.

## Approved product decisions

D01–D10 in the [plan](market-readiness-plan.md#1-recommended-decision) are approved for implementation. The core promise is **turn neighborhood conversations into personal follow-through**. Keep the PWA, optional guides, maps with a list alternative, address-optional people, owned next steps, minimal data, and explicit restrictions. No full church-management replacement, bulk messaging, native rewrite, or inferred religious scoring.

Historical fields and access must be preserved during additive migration. Creator access changes require explicit migration disclosure and reconciliation, not silent removal. Package 5 remains evidence-led: approval does not make unvalidated experiments prerequisites for the core release.

## Work-package status

| Package | Status | Evidence / next gate |
| --- | --- | --- |
| 0 — Product decisions and preservation | Core preservation complete; external decisions open | Production checkpoint published; scoped backup restored and compared; commercial hosting/operator details still needed |
| 1 — Safer baseline | In progress | Dependency patches and regression fixes next |
| 2 — Durable domain, permissions and migration | Not complete | Additive schema, transactional commands, migration and failure tests required |
| 3 — Coherent church workflow | Not complete | Routes, outings, Today, people/tasks, accessibility and mobile verification required |
| 4 — Website and controlled pilot | Not complete | Website, operational tools, approved provider/support policies and external pilot gates required |
| 5 — Evidence-led growth | Deferred by approved sequencing | Select experiments after core/pilot evidence |

## Data preservation

Private local directory outside Git: `/home/jhaney/Work/neighborwalk-backup-20260909` (directory mode 700; sensitive files mode 600).

Exports contain all ten church application tables, authentication identities/users, hosted migration statements, schema metadata, constraints, functions, policies and indexes. The church export is one consistent SQL statement. No storage objects exist. The 66,252 reference parcels are not included in this scoped export and must not be changed or removed on the strength of this backup. CLI backup credentials were unavailable; the authorized connected database tool supplied the scoped export.

Restore rehearsal completed in `neighborwalk_rehearsal_20260909`, a separate local PostgreSQL database not served by the app’s Supabase API. All 12 exported application/identity tables restored with matching counts and full-record comparisons. This is a verified scoped logical restore, not a full managed-project backup: active sessions, infrastructure settings, reference parcels and provider configuration are outside its scope. One failed verification-script patch emitted account identity metadata into the tool transcript; subsequent private artifact operations catch and suppress diagnostic bodies. Backup files remain outside Git with restricted permissions.

## Implementation evidence so far

- Next 16.3.4 / MapLibre 6.4.1 patched; production and development dependency audits report zero vulnerabilities. A compatible npm 12 invocation resolved the npm 10 dependency-resolution bug. Vitest 4.1.11 passes.
- 92 tests / 20 files pass, including retention, durable do-not-visit summaries, concurrent territory moves, team cleanup, legacy bulk-write refusal, account storage separation, invalid-data quarantine, a 2,501-item queue round trip, install feature detection, headers, service-worker cache boundaries, immutable commands, serialized storage, quota failure, work queued during a receipt, and church-calendar dates.
- Lint/types passed after the client integration. Optimized production build passed outside the process sandbox; the sandboxed TypeScript subprocess could not return its configuration. Rerun all checks on the final release.
- Local browser snapshot and protected-person direct writes are revoked. The connected hook now reads the normalized API and sends transactional commands. **Do not deploy the containment migration without its compatible application release.** Production remains on the published checkpoint.
- Normalized schema, preservation backfill, RLS read API, bounded keyset pagination, versioned transactional command API and idempotent receipts implemented locally. Database regression tests pass for cross-church/role denials, 1,001-record pagination, malformed commands, reused-ID conflicts, atomic rollback, server-authoritative actors, restriction precedence, handoff acceptance/task transfer, former-creator access removal, and audited restriction corrections.
- Schema 11 makes person/location links and coordinates optional. Queued payloads and device state persist together before UI acknowledgement; rejected/conflicting commands remain for review. Legacy unsent work and pre-upgrade storage are retained for supervised recovery; recovery controls remain to be built.
- Browser-to-database verification with fictional local records passed: create person without address; plan owned/date-only follow-up; complete with care note and next step. Confirmed one completed task, one care note and one linked next step on the server. Browser forms wait for device persistence and retain input on failure.
- Local map provider returns HTTP 403. Verified the new address-list fallback exposes saved locations/restrictions, manual entry and print controls. Actual printing, offline reopen and physical-device checks remain outstanding. Do not report the local map as healthy.
- Next.js generated repository AGENTS.md/CLAUDE.md instructions; the relevant bundled Next.js guide was read before further changes.
- Routed Today, Outreach, People, Follow-ups, Guides and Recovery now preserve a single workspace store during navigation. Mobile navigation is Today / Outreach / People / More. Historical root bookmarks and authentication callbacks have compatibility entry points.
- Added reusable address lists without fabricated map geometry; preparation, assignment acknowledgement, readiness transitions, debrief and repeated outing drafts. Local database tests cover readiness prerequisites, duplicate assignment rejection, null-coordinate rejection and volunteer acknowledgement boundaries.
- Browser-to-database fictional fieldwork passed: prepared outing → address-only list → named assignment → acceptance → ready → manual address → encounter plus owned task linked to the same outing. No map tiles were needed.
- Recovery now compares selected fields with shared records, queues a new immutable transaction only after preserving an account-scoped archive, and keeps later changes behind a held transaction. Legacy work can be exported and archived for supervised manual reconciliation. Cross-account archive denial and failed-archive/no-publish tests pass; live browser conflict exercise remains.
- The public home, how-it-works, pricing, trust, help, pilot, privacy and terms pages are implemented, with separate login/demo routes, robots and sitemap. Desktop/phone-sized homepage and isolated demo navigation were checked. No fabricated testimonials, finalized prices or automatic billing. Pilot enrollment is closed by default; policies are explicitly drafts pending approval.
- Current optimized production build passes with all website routes and the authenticated app shell. Latest completed full lint/type/unit check passed 109 tests / 24 files (subsequent changes must be checked again).
- Read-only reference checks: [FTC data-minimization and retention guidance](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business) and [Supabase backup scope](https://supabase.com/docs/guides/platform/backups) informed policy caveats; no legal compliance or full-backup guarantee is asserted.
- Embedded scripture replaced with reference links; automatic external-map caching removed. Native dialogs now provide focus containment/Escape behavior; browser verification pending.

## External launch gates — do not claim these are implemented or verified

- Current Vercel team is Hobby. [Its terms restrict that plan to personal, noncommercial use](https://vercel.com/docs/plans/hobby). Commercial-compatible hosting requires an owner-approved billing change or hosting decision.
- Public operator identity, support email, privacy/terms approval and a support commitment are awaiting owner details.
- Production auth/email delivery and any additional reminder provider require configuration and delivery verification. No unsupported reminder claims or invented delivery success.
- Embedded commercial ESV use and offline/printed map imagery require appropriate permission; reference-only scripture and address-list printing are the initial fallback.
- Actual iPhone/Android field testing, church recruitment, interviews, repeated pilot use, willingness-to-pay evidence and legal review cannot be replaced by automated tests.

## Verification policy

Each audit blocker must gain a regression test, a server-enforced fix where applicable, and a recorded result. A passing build is not a production-readiness claim. Record unresolved gates explicitly; do not mark packages complete because their documentation exists.
