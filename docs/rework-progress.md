# Church-readiness rework

Approved by the product owner on September 9, 2026. The original audit and plan remain the acceptance contract; this ledger records execution, not a substitute scope.

## Release checkpoints

- Existing improvements committed and pushed to `main`: `d94d17c6a24075e6cc657759b676dba988789a97`.
- Historical pre-rework Vercel deployment `dpl_C4sMrQ52ewYiZdrAyMF3YCc9qjho`: READY; public URL returned HTTP 200.
- Rework branch `rework/church-ready-neighborwalk` was created after that verification. PR #2 later merged it to `main` at `f620979b58b5fa59eb9bbb43cc4343be87faa1b5`.
- PR #3 merged the tested prior-visit planner overlay. Production now tracks `14b117485bd8c100f743bbf495d8bf99bb679a88`; Vercel reported deployment success and the public site/demo returned HTTP 200.
- GitHub Actions run `35461832264` passed the quality and database jobs for the exact production merge, including clean install, lint, types, unit tests, optimized build, local migrations/database suites, sandbox verification, dependency audit and Chromium browser regressions.
- Read-only production checks confirmed the new public GIS RPC and `outreach_outing_participants`, the table introduced by the final checked-in migration. Exact hosted migration-history reconciliation and authenticated production workflow checks remain open.
- Separate iOS development branch `codex/neighborwalk-ios` currently points to `5046a8a30528747f7b7706bbdf7b4dcf5eb15974`, two commits beyond the deployed web merge. It adds a bundled Capacitor/Xcode client and two undeployed migrations. It is not merged, signed, in TestFlight or submitted to Apple; the live web release remains `main`.
- GitHub Actions run `34446494932` passed both quality and database jobs for `1c337c0`, including clean `npm ci`, full verification, dependency audit, clean Supabase startup, database regressions and normalized sandbox verification. Browser regressions are added in the subsequent checkpoint.
- GitHub Actions run `34450072005` passed both jobs for `0d2c075`, including the new isolated Chromium browser job and its 100-entry offline round trip.
- Baseline checks: lint, TypeScript, 68 tests / 14 files, optimized production build all passed.

The chronological entries below record what was true at each checkpoint. Statements such as “no production deployment occurred” remain historical evidence for that dated checkpoint; the current deployment state is the one recorded above.

## Approved product decisions

D01–D10 in the [plan](market-readiness-plan.md#1-recommended-decision) are approved for implementation. The core promise is **turn neighborhood conversations into personal follow-through**. Keep the PWA, optional guides, maps with a list alternative, address-optional people, owned next steps, minimal data, and explicit restrictions. The owner later authorized the separate iOS client now tracked as Package 4A; full church-management replacement, bulk messaging, native Android/additional native clients, and inferred religious scoring remain outside the core scope.

Historical fields and access must be preserved during additive migration. Creator access changes require explicit migration disclosure and reconciliation, not silent removal. Package 5 remains evidence-led: approval does not make unvalidated experiments prerequisites for the core release.

## Work-package status

| Package | Status | Evidence / next gate |
| --- | --- | --- |
| 0 — Product decisions and preservation | Core preservation implemented; external decisions open | Deployed checkpoint published; scoped backup restored and compared; fresh complete production recovery and commercial hosting/operator details still needed |
| 1 — Safer baseline | Released and CI-verified; operational verification incomplete | Patched dependencies, regression coverage, scoped storage and clean-install/database/browser CI jobs passed on the production merge; authenticated runtime, monitoring and recovery evidence remain |
| 2 — Durable domain, permissions and migration | Implemented and deployed; reconciliation still open | Twenty-five additive rework migrations (43 repository migrations total) are represented by the live schema; restored-record fields/relationships and staged FKs passed rehearsal; fresh backup, hosted-history reconciliation, legacy-device review and remaining failure/scale matrix still required |
| 3 — Coherent church workflow | Core workflow implemented and deployed; not complete | Routed outings, map/list field flow, community encounters, people/tasks, restrictions, reviewed moves/duplicates/encounter corrections and permitted history; archival/offboarding semantics, broader accessibility/device evidence and remaining integration work remain |
| 4 — Website and controlled pilot | Website deployed; enrollment remains closed | Public site, demo, CSV exchange, admin review, leader setup guide and opt-in reminder implementation are live; provider activation, operations, owner details, commercial hosting and external pilot gates remain |
| 4A — Native iOS client | Development checkpoint implemented; release incomplete | Bundled Capacitor/Xcode workspace, native auth/link/share/print integrations, simulator tests and unsigned archive are recorded on `codex/neighborwalk-ios`; database CI, two backend migrations, signing/providers, deletion fulfillment, physical-device matrix, TestFlight and App Review remain |
| 5 — Evidence-led growth | Deferred by approved sequencing | Select experiments after core/pilot evidence |

## Data preservation

Private local directory outside Git: `/home/jhaney/Work/neighborwalk-backup-20260909` (directory mode 700; sensitive files mode 600).

Exports contain all ten church application tables, authentication identities/users, hosted migration statements, schema metadata, constraints, functions, policies and indexes. The church export is one consistent SQL statement. No storage objects exist. The 66,252 reference parcels are not included in this scoped export and must not be changed or removed on the strength of this backup. CLI backup credentials were unavailable; the authorized connected database tool supplied the scoped export.

Restore rehearsal completed in `neighborwalk_rehearsal_20260909`, a separate local PostgreSQL database not served by the app’s Supabase API. All 12 exported application/identity tables restored with matching counts and full-record comparisons. This is a verified scoped logical restore, not a full managed-project backup: active sessions, infrastructure settings, reference parcels and provider configuration are outside its scope. One failed verification-script patch emitted account identity metadata into the tool transcript; subsequent private artifact operations catch and suppress diagnostic bodies. Backup files remain outside Git with restricted permissions.

## Implementation evidence so far

- Next 16.3.4 / MapLibre 6.4.1 patched; production and development dependency audits report zero vulnerabilities. A compatible npm 12 invocation resolved the npm 10 dependency-resolution bug. Vitest 4.1.11 passes.
- 92 tests / 20 files pass, including retention, durable do-not-visit summaries, concurrent territory moves, team cleanup, legacy bulk-write refusal, account storage separation, invalid-data quarantine, a 2,501-item queue round trip, install feature detection, headers, service-worker cache boundaries, immutable commands, serialized storage, quota failure, work queued during a receipt, and church-calendar dates.
- Lint/types passed after the client integration. Optimized production build passed outside the process sandbox; the sandboxed TypeScript subprocess could not return its configuration. Rerun all checks on the final release.
- Local browser snapshot and protected-person direct writes are revoked. The connected hook reads the normalized API and sends transactional commands. The containment migration and compatible application are now deployed together; future schema/application changes must preserve that paired-release boundary.
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

### September 10 — reviewed administration and complete encounter paths

- Community meals, service, referrals and other non-door encounters no longer require a fabricated address/person. Browser-to-database verification confirmed one anonymous community-meal encounter with one owned next step and no location/person. Person-linked conversation notes use the protected note model instead of being dropped or copied into shared encounter text.
- Canonical real calendar dates, required new-person descriptions, accountable follow-up links, cancellation reasons and note limits have client and server checks. Task links open the exact record, and leader unowned/declined queues have working URLs.
- Independent person/location/channel restrictions can be recorded; a leader can correct one with a reason and retained history. Server-side cancellation honors the affected channel. Lifting an all-contact restriction clears only the old blanket flag after the last applicable restriction, never resurrecting cancelled tasks. Permission-filtered person history joins notes, encounters, task lifecycle, handoffs and restrictions.
- Recovery exports default to only immutable changes authored by the same account. A live recently authenticated leader is required for a whole-workspace recovery export, with an audit entry. Existing originals remain preserved; legacy recovery is supervised, not blindly merged.
- Data & health now provides recent-authentication confirmation, minimal CSV exports with spreadsheet formula protection, reviewed create-only CSV import (100 rows/2 MB), duplicate detection, exact-plan older-record archival and recorded migration-issue review. It explicitly distinguishes archival from permanent erasure and accessible-record exports from full backups. Archival receipts retain an exact record/version manifest.
- Administration requests are immutable and account-scoped in IndexedDB before submission, retried with the same server receipt ID, and archived locally before the pending entry is cleared. Sign-out warns about pending administration as well as fieldwork. A reviewed original is preserved even when not resubmitted.
- Fictional CSV browser test: a duplicate row was disabled, one deliberately selected row imported as one address-optional owned person, and one server audit was recorded. No browser errors. Export, archival and failure injection remain to be exercised in the browser; database tests cover their permission/atomicity behavior.
- Groups & members replaced the misleading lifetime-as-today coverage panel. Leader setup describes the first outing; reusable areas report saved locations rather than complete census coverage. Membership changes require an explicit reviewed reason, expected current access and a sign-in within 15 minutes. Invitations are bounded, hashed, email-matched and audited; successful acceptance can be retried without duplicate membership or reactivating suspended users. No access action rewrites the legacy snapshot. Access changes advance the workspace revision under the same church lock as field commands.
- Local database regressions pass for suspended/cross-church/volunteer/stale-review denials, immediate connected access removal, preserved responsibilities, wrong-account invitation refusal, recent-auth checks, repeated acceptance/revocation, safe access audit and unchanged legacy snapshot. Member and invitation lists use complete keyset paging with a before/after revision check.
- The private restored production export passed the rollback-only rehearsal through all eleven migrations: 35 unchanged baseline rows, two preserved people, 83 normalized locations, 83 encounters, seven tasks and three explicit historical review flags. These are aggregate checks plus full protected-record projections, not yet a complete field-by-field reconciliation of every ordinary historical relationship. The rehearsal rolls back all changes; the private original restore is unchanged.
- Local sandbox seeding/verifying now uses the normalized command API. A separate namespaced seed check rolls back fictional fixtures without changing existing test accounts or records. CI has a local Supabase/database regression job; a hosted CI run is still pending.
- Location-dialog browser verification passed after rendering settled: focus begins inside the native dialog, reverse tab remains contained, Escape closes it, and focus returns to the exact location launcher. Other dialogs, 200% enlargement and actual phones still require the broader review.
- Checkpoint verification: lint, TypeScript, all 123 unit tests / 29 files and the optimized build passed; all three local database regression scripts passed individually. Local Supabase security advisors found no warning/error issues after migration 11. The revised leader screen renders correctly with the fictional roster; actual browser access mutation/recovery and the remaining release matrix are not yet complete.

### September 10 — invitation privacy and reproducible offline verification

- `/invite#invite=…` now carries new invitation secrets in a fragment rather than a request query. Session-scoped preservation happens before URL scrubbing; legacy query links remain usable. Safe post-sign-in task/person destinations preserve approved filters without carrying tokens or arbitrary redirect URLs. Invalid-link browser testing confirmed explicit dismissal restores an existing workspace without altering church records.
- Locked/revoked workspaces explicitly hide the old read cache and offer safe sign-out plus recovery of only the same signed-in account's authored transactions and administration journal. Legacy copies without reliable authorship stay preserved for supervised recovery. Ordinary recovery now exposes the same authored journal download.
- Added fixed-localhost browser regressions with no remote-target override, no outbound third-party requests and no traces containing account tokens. Two-device concurrency, dropped success response and quota failure passed. The first cache-cleared cold-offline test found a real missing-app-assets failure.
- Fixed that failure with build-specific static-asset precaching, anonymous app-shell requests, normal non-forced worker activation and explicit preparation/update status. Protected view navigation now uses native History integration with the persistent workspace and does not require network-only RSC navigation.
- Cold guide reopen plus 100 offline encounters, close/reopen and reconnect passed: 100 durable local entries, zero server entries while disconnected, exactly 100 after sharing. All three browser scenarios passed together again after the preparation indicator/navigation changes and anonymous-precache hardening. The new browser CI job still needs its first hosted run.
- Latest full verification passed 131 unit tests / 30 files, lint, types and optimized build. The generated app-asset manifest is about 2.9 MiB uncompressed and has a reviewed-growth limit. Actual phones, authentication expiry, update transitions and other remaining gates are listed in [browser readiness](browser-readiness.md); this is not a complete production-readiness claim.

### September 10 — bounded offline identity, tab coordination and task history

- Reproduced the expired-access-token cold-offline failure. The explicit **Open prepared offline workspace** path selects only the same locally retained account and a membership check less than 24 hours old, after the auth service cannot be reached. It never manufactures an authenticated session, returns tokens, or authorizes server calls. Reconnection still uses real authentication and transactional permission checks.
- Known API access denial invalidates the cached membership window even if the browser reports itself offline. Cross-tab session removal hides records without deleting authored work. Sign-out now targets the current Supabase session, not all of a volunteer’s devices. Sign-in actions handle rejected SDK promises and restore usable controls.
- Found a same-browser multi-tab queue overwrite risk during review. An exclusive browser-managed account lock now allows one live workspace writer per account/profile. The other tab explains how to close the original and retry; crashes release the browser lock. No unsafe fallback is used in unsupported browsers. Separate devices continue to collaborate through the server.
- All seven browser regressions passed together: the original three, expired-session offline save/reconnect, simulated API denial followed by offline lockout, cross-tab session removal with preserved work, and tab handover retaining both offline entries. The development Strict Mode workspace also opened normally without browser errors. Subsequent worker route-boundary hardening has unit coverage; its hosted verification is pending.
- Follow-up acceptance is now required before completion/rescheduling, including server enforcement. Owners may reaccept declined work; leaders may cancel or assign it. Current cancellation reasons, immutable historical links, open-only task creation, valid subsequent-step parents and preserved resolved history have database regressions. Assignment/acceptance changes add local history and reject missing/inactive/resolved targets.
- The eighth browser scenario passed: a leader assigned a real fictional task, the volunteer declined and then accepted it, and only then completed it; database state and the available controls matched each step. A community/person regression also keeps the encounter address-free while linking its task to the person’s current saved location.
- Full verification passed 140 unit tests / 32 files, lint, types and optimized build. All four local database suites passed. Local security/performance advisors found no warning/error issues after migration 12. The private rollback-only rehearsal passed through all twelve migrations with unchanged protected-record projections and aggregate counts; broader historical reconciliation remains a separate gate.

### September 10 — historical reconciliation and person-location continuity

- Extended the private migration rehearsal beyond counts: every mapped ordinary record field, group member identity, outing assignment, historical task-activity field and protected task link/timestamp passed comparison with the original. Verified one outing, one group, one area, 83 locations, 83 encounters, five ordinary tasks, two protected tasks and 11 task activities. The two staged parent-task/group-guide foreign keys validated successfully inside the rehearsal transaction. All changes rolled back.
- The three existing migration review flags are task-owner exceptions: three open legacy tasks had no individual owner recorded. They remain visible for a church leader to assign; no owner was invented. Original snapshots, legacy links and identity records remain preserved. This verifies the captured backup, not a claim that production cannot change before cutover or that every legacy display summary is canonical.
- A person-location change now previews its effect and requires explicit acknowledgement. The queue mirrors the server’s move of open tasks and predicts their version before a later queued edit. It does not rewrite immutable transactions, resolved task locations, historical encounters or location restrictions. Unit and rollback-only SQL tests confirm move → next edit uses the correct version, including replay after a lost receipt. The visible move flow still needs browser verification and richer audited correction handling.
- CI run `34452002846` passed quality/database setup but failed the multi-tab browser scenario because one request escaped CDP’s simulated disconnected state. The queue itself was preserved. Added a context-wide request-abort boundary alongside CDP offline mode; the zero-server-writes assertion was retained. All eight browser scenarios then passed together locally with that boundary. Hosted verification of the fix is pending.
- Latest full verification passes 141 unit tests / 32 files, lint, types and the optimized build. A 390-pixel Today view was visually checked; this does not replace actual-phone, screen-reader or 200% checks.
- Hosted run `34453143023` reproduced the same multi-tab network-simulation failure despite request routing. Service-worker-controlled pages can bypass browser request interception. Added a per-tab fetch transport failure boundary, retained CDP/routing and every zero-server-write assertion, and added assertions before/after tab handover. The targeted scenario passed five consecutive local runs; the next hosted run must confirm it. This is a deterministic transport-failure fixture, not evidence of physical-device airplane-mode behavior.

### September 10 — opt-in reminders and provider-safe delivery

- CI `34454068051` passed the strengthened eight-scenario offline/workflow browser suite. All nine scenarios now pass locally, including real local preference opt-in/reload/opt-out under a fictional availability response; the actual sender remains disabled.
- Added a server-only, service-role-only bounded delivery worker and private preferences/jobs/minimal event metadata. Consent is per active member and verified email, not leader-controlled. Changed addresses need renewed consent. Eligibility excludes inaccessible, restricted, declined and resolved work.
- Generic reminder messages contain a protected own-work link and signed opt-out, not neighbor/church names, addresses, care notes, prayer details or counts. Removed the unreliable open-page Notification behavior without deleting its old stored preference.
- Immutable envelopes and job-derived provider idempotency keys survive a lost send response; leases and a six-attempt/23-hour ceiling prevent unsafe indefinite retries. Accepted, delivered, failed and unknown are distinct. Verified, job-correlated webhooks handle duplicates and early/out-of-order events, suppressing bounced/complaining recipients. GET unsubscribe is scanner-safe; POST disables only the signed membership preference.
- Full verification passes 158 unit tests / 33 files, lint, types and optimized build. The fifth rollback-only database suite passes self/tenant/service-role boundaries, verified consent, immutable retries, early/duplicate webhook events, access revocation, attempt/age ceilings, private-person visibility, contact restrictions, changed-address consent and opt-out during a lease. The private thirteen-migration reconciliation remains PASS with the same protected-record and historical-field checks.
- The private-person test initially used the wrong actor because the production creator-protection trigger correctly assigns new records to auth.uid(); the fixture now creates it as a distinct account and verifies access denial. No real records were involved.
- Added [email activation and operations guidance](email-reminders.md) and safe example environment settings. No provider resource, production secret, scheduler, DNS record, external email or production database change was made. Real delivery, scheduled invocation and monitoring are explicitly unverified owner/provider gates.

### September 10 — audited person-location changes

- Reminder checkpoint `33ed6a9` passed hosted CI `34456436379`, including all nine browser scenarios. No provider or production activation was performed.
- A person-location move now requires an explicit acknowledgement and a 3–500 character reason. The reason travels in immutable command metadata, not an editable profile field. The server preserves previous/current location IDs and versions, actor and open-task count in the permission-filtered profile audit and appends a factual activity to each moved open task.
- Resolved task locations, historical encounters and location restrictions are not moved. Replaying a receipt cannot duplicate the activity. Legacy queued moves lacking a reason must be reviewed; their payload is not silently rewritten.
- The new browser scenario passed: create a fictional person and task, choose another location, verify reason/acknowledgement requirements, save, view the reason in history and confirm the open task's location in the database. The previous nine scenarios are not being described as newly rerun by this targeted check.
- Full verification passed 159 unit tests / 33 files, lint, types and optimized build. All five database suites and the fourteen-migration private preservation rehearsal passed. The combined ten-scenario hosted browser run is pending this checkpoint's push.

### September 10 — reviewed duplicates and preserved historical identity

- The ten-scenario hosted run `34457473063` passed at audited-move checkpoint `0146c36`.
- Added leader-only, recently authenticated previews and exact-token/revision duplicate combinations for people and locations. Each requires a factual reason, acknowledgement, and typed confirmation. Sharing, pending handoffs, responsibility, apartment-unit differences, and mismatched current links block unsafe combinations.
- Source records remain read-only aliases with original details. Historical notes, encounters, and resolved tasks retain their original links and timestamps; current people/tasks move only as reviewed. Active restrictions keep independent IDs and origin links, including conservative preservation of a legacy blanket no-contact flag.
- Old person/location links resolve to the current record. Directories, selectors, maps, coverage, and current CSV exports exclude historical aliases. Original contact values still participate in import duplicate detection; accessible-record JSON retains them. Person history joins only the permitted canonical family, and later accepted handoffs update access to that whole family.
- The complete regression run found and fixed a function-name-qualified parameter in the preceding audited-move wrapper. This illustrates why record-preservation checks alone are not workflow verification.
- All six database suites and the fifteen-migration private preservation rehearsal passed: 35 unchanged original rows, two preserved people, 83 locations/encounters, seven tasks, three explicitly flagged unowned historical tasks, and two staged relationship constraints validated inside the rollback. Local database advisors reported no warning/error issues.
- Lint, types, all 165 unit tests / 34 files, and the optimized build passed. The complete eleven-scenario local browser run passed, including duplicate person/location combinations, offline replay, access removal, and cross-tab protection. The final rebuilt duplicate scenario also passed at 390-pixel width, including both preview tables without horizontal page overflow, original-person navigation, and an unavailable deep link with a working return to People.
- Usage and preservation/incorrect-combination limitations are documented in [reviewed duplicates](duplicate-review.md). No production database mutation or rework deployment occurred.

### September 10 — encrypted operator backup and isolated recovery drill

- Duplicate checkpoint `f44125c` passed hosted CI `34461985625`, including all eleven browser scenarios.
- Added read-only, consistent-snapshot application-database capture across six declared schemas, including reference parcels and authentication when present. Archives stream through authenticated encryption; keys, credentials and bundles must remain private and outside Git. Interrupted producers, wrong sources, unreviewed extensions, malformed metadata, changed manifests/ciphertext and wrong keys are rejected.
- Restore accepts only a trusted archive and creates a newly named local database, never overwriting production or the app database. Exact row digests, counts, columns, RLS policies and extension versions are compared. Provider settings, root keys, storage objects, off-site custody and actual sign-in are separate, unverified recovery requirements.
- The final one-command local drill restored 53 tables / 11,873 records into `nw_restore_20260910102354_7167bd96`; all six rollback-only permission/workflow suites passed against the restored copy. It performed no writes to the source database. Earlier failed local targets remain quarantined; none was promoted.
- All 173 unit tests / 35 files, lint and standalone type checking passed. The optimized build passed outside the restricted execution sandbox; two sandboxed attempts failed while parsing output from the TypeScript child process. No compiler checks were disabled.
- [Database recovery](database-recovery.md) documents key custody, scope, exact commands and production cutover gates. This tooling does not turn the earlier partial production export into a fresh complete backup. The production database credential, managed/off-site recovery and migration-history reconciliation remain outstanding.

### September 10 — encounter corrections and connected person history

- Backup checkpoint `c94b7d1` passed hosted CI `34466113046`, including all eleven previous browser scenarios.
- Connected, recently authenticated leaders can append factual outcome/context corrections or mark an encounter entered in error. Original fields, actor/device/time, notes and relationships remain unchanged. Version/revision checks reject stale reviews; immutable administration receipts prevent duplicate corrections after a lost response. Tasks and restrictions never change implicitly.
- Entered-in-error records remain in permitted history but do not count toward current location/outing activity or derived last contact. Person history displays each reviewed change and the original facts. Last contact uses only qualifying person-linked encounters across permitted aliases; a stored legacy date is explicitly labelled historical. No derived profile date is queued or written.
- Exposed the existing General, Conversation, Prayer and Milestone note categories. Notes and completion alone do not automatically establish contact or update faith/pathway fields.
- Lint, types, all 177 unit tests / 36 files and the optimized build passed. All seven rollback-only database suites and the sixteen-migration private preservation rehearsal passed; the same 35 original rows and historical field/relationship reconciliation remain intact. Local advisors found no warning/error issues.
- All twelve local browser scenarios passed together. The new 390-pixel correction scenario commits a correction, deliberately loses its response, retries the preserved request and verifies exactly one review, unchanged original outcome and one still-open promised task. Profile history, derived last contact and Prayer note selection matched the database; the review did not overflow the page width.
- The updated local encrypted capture restored 53 tables / 12,335 records with matching row digests, columns/RLS policies and extension versions into `nw_restore_20260910104149_f25ce745`. All seven permission/workflow suites passed against that restored copy. Counts are fictional local records, not production.
- [Encounter corrections](encounter-corrections.md) documents permissions, privacy and preserved responsibilities. The outdated [production checklist](production-checklist.md) now separates verified branch work from fresh backup/cutover, legal/operator/hosting/provider, actual-device and church-pilot gates. The reference-only Scripture compatibility endpoint was rechecked: it already returns 410 without a provider call; it is not a remaining live ESV proxy.
- No production database mutation or rework deployment occurred. Local migration history still represents the pre-rework baseline because additive SQL is iterated directly; fresh hosted CI applies the complete checked-in sequence. Do not squash the tested additive sequence into a duplicate generated migration or mistake this local history for production's history.

### September 10 — usable field guides and prepared pilot material

- Encounter-correction checkpoint `5992450` passed hosted CI `34467603301`, including all twelve browser scenarios.
- Connected each guide's existing coaching and reminder fields to both the editor and fieldwork reader. Guide source labels now describe the guide actually selected, including fallback after an unavailable outing/group guide. Saving/deleting prevents edits or dismissal during the operation; backend guide concurrency and retry safety remain separate work.
- Guide steps and location-drawer tabs now use labelled panels, roving focus and orientation-appropriate arrow/Home/End keyboard navigation. Phone controls have larger tap targets, readable supporting text and contained horizontal step navigation. Inspected the final 390-pixel fieldwork screenshot with coaching, suggested words and reminders visible.
- Lint, types and all 181 unit tests / 37 files passed. The optimized build and final guide plus 100-command cold-offline browser scenarios passed. All thirteen local browser scenarios passed together before the final guide-source-label and step-bar containment refinements; the complete hosted run for this checkpoint is still pending its push.
- Prepared the [church pilot kit](church-pilot-kit.md): leader/volunteer orientation, a focused demonstration, respectful weekly review, proposed content-free evaluation and explicit stop/offboarding boundaries. No interviews, completed church pilots, approved pricing, support operation or permanent-erasure workflow are implied by this material.
- No production database mutation or rework deployment occurred.

### September 10 — live sessions, account isolation and bounded offline access

- Guide checkpoint `5c9ceef` passed hosted CI `34469492638`, including all thirteen browser scenarios then present.
- The shared private authorization predicate now checks the actual matching, non-expired Supabase session in addition to the non-anonymous identity. Existing church/role/person guards inherit this check; interactive callers cannot read authentication sessions. Removed the historical church-creator read bypass after membership ends and gated self-membership/author shortcuts. No historical rows or attribution were deleted.
- Added an eighth rollback-only database suite for missing/malformed/mismatched/expired/anonymous/deleted sessions, RLS/RPC/receipt-replay denials, private helper grants and suspended creators. All eight suites passed against the updated isolated restore; the seven existing suites also passed directly on the sandbox. Updated fictional fixtures and seeding to use live sessions instead of weakening the production predicate.
- The real browser revocation scenario deleted exactly its generated local session while the token was still unexpired. A second device stayed authorized; the revoked device made zero writes and kept its pending encounter. A different account in that same browser saw no pending transaction and could not submit the original author's work. Fresh sign-in by the original account shared the original transaction exactly once. A separate clock-controlled test passed while-open 24-hour expiry, preserved queue and successful online recovery.
- Lint, types, all 181 unit tests / 37 files and the optimized build passed. The seventeen-migration private preservation rehearsal retained the same 35 original rows and historical fields/relationships; both staged constraints validated inside rollback. Local database advisors found no warning/error issues. All fifteen local browser scenarios passed together in 4.5 minutes; hosted verification of this checkpoint is pending its push.
- Encrypted local capture restored 53 tables / 13,172 records into `nw_restore_20260910111747_06b0a14c`, with exact row digests, columns/RLS and extension checks. All eight permission/workflow suites passed on the restored copy; no source writes were performed. These are fictional local records, not a fresh production backup.
- [Session security](session-security.md) documents the distinction between connected revocation and offline cached access, device-clock limitations, current-session sign-out, suspended membership and preserved responsibility. No production database mutation or rework deployment occurred.

### September 10 — complete bounded guide-library reads

- Session checkpoint `cf35f83` passed hosted CI `34470934308`, including all fifteen browser scenarios and all eight database suites.
- Replaced single-query guide/group-default loading with keyset paging through an empty terminal page. Short server-clamped pages are not mistaken for completion. Repeated IDs, errors, invalid responses and explicit device size/count limits reject the collection rather than silently accepting a partial library.
- Malformed guide content, wrong church/private ownership and unavailable favorites/group references now fail visibly; a failed refresh does not replace the saved library. Reference validation uses a map rather than repeated full-library scans. Only controlled content-free messages reach the field interface.
- Added large-library tests for 1,007 guides and 1,007 defaults under a smaller simulated server cap, plus cursor/error/size, malformed/reference/access and diagnostic-redaction regressions. All 190 unit tests / 39 files, lint, types and optimized build passed. Both final guide and 100-command cold-offline browser scenarios passed; the complete fifteen-scenario hosted run is pending this checkpoint's push.
- [Guide library reliability](guide-library-reliability.md) distinguishes complete bounded reads from the still-open canonical revision, competing-edit, persisted-retry and dependent-reference work. No new migration or production mutation occurred in this read-only pipeline checkpoint.

### September 10 — transactional guide library and retained recovery

- Complete-read checkpoint `1bb4438` passed hosted CI `34471745794`, including all fifteen browser scenarios and eight database suites then present.
- Added the eighteenth additive migration for guide, favorite and group-default versions; guide writes now share the canonical church revision and lock. Read-before/read-after revision and identity checks retry concurrent library changes without accepting mixed pages. Cleared defaults retain versions, deleted groups are excluded, and archived favorites use an available fallback.
- Replaced direct guide CRUD with a strict, live-session-authorized transactional API. The editor submits its captured version; stale edits are rejected. The exact account-scoped request is saved before network submission and retained across lost responses/reload. Receipt replay does not duplicate creation; successful or explicitly reviewed originals remain in local recovery history. Private guide/favorite changes do not expose their activity or contents in church audit.
- Connected removal now archives rather than deletes. Current outing/group dependencies block archival; closed historical links and content remain. Clearing personal favorites is available in Guides. Separate demo guides remain in the fictional namespace after reload; a real-account connection failure cannot fall through to demo writes.
- All sixteen local browser scenarios passed together in 5.2 minutes. Final lint, types, 201 unit tests / 40 files and the optimized build passed after the quota regression and recovery-button spacing refinement; the final guide-write scenario passed again with a geometric spacing assertion and an inspected 390-pixel screenshot. It covered lost-response replay, competing-device edit rejection, favorite clearing and archive preservation. Hosted verification of the exact checkpoint follows its push.
- All nine database suites passed on an encrypted isolated restore of 53 tables / 14,771 fictional local records (`nw_restore_20260910123423_06eec2cc`); matching row digests, columns/RLS and extensions, no source writes. Eighteen-migration private preservation retained the same 35 original rows and historical relationships; both staged constraints validated inside rollback. Local advisors reported no issues.
- [Guide library reliability](guide-library-reliability.md) documents retry/review, captured versions, prepared caches, defaults and archives. Historical guide-edition pinning is not implemented; an outing currently references a guide's current text. No production database mutation or rework deployment occurred.

### September 10 — bounded complete workspace reads

- Transactional-guide checkpoint `96338c1` passed hosted CI `34478082682`, including all sixteen browser scenarios and all nine database suites.
- Replaced short-page termination in the main workspace pipeline with an empty terminal-page requirement. Null/malformed/foreign rows, unsafe versions and overlapping IDs reject the entire read. Permission errors retain their type so cached authorization is invalidated correctly.
- Limited collection concurrency to four, with a shared 100,000-row / 64-MiB serialized-data guard and cancellation after failure. Every initial load, synchronization, conflict comparison and administration read checks its original account/church before and after paging, along with revision/settings version/role coherence. The previous saved copy is not replaced by an incomplete read.
- Eight additional workspace tests cover 25,000 fictional records under a 137-row server cap, aggregate limits, concurrency, identity/revision changes, malformed rows and interrupted reads. The first full browser run exposed a coalesced-sync scheduling gap: work saved during a refresh remained queued while the pass reported success, delaying its retry until the periodic poll. The completion predicate now checks that the queue is actually empty; both the original two-device test and a clock-controlled delayed-read regression passed. All seventeen local browser scenarios then passed together in 6.3 minutes.
- A final authorization review also connected direct/wrapped guide-service denials and changed identities to offline-window invalidation, including initial reads, refresh, submission and pending-request review. Authored work remains preserved. The workspace denial recheck now rejects a successful response for a different account/church, not only an explicit service error. Final lint, types, all 210 unit tests / 41 files and the optimized build passed. Five targeted browser regressions passed together: guide saves/archives, two devices/lost response, delayed refresh and both workspace/guide denial followed by cold offline reopen. The complete eighteen-scenario run and hosted verification follow this checkpoint's push.
- Replaced the obsolete README's snapshot, privacy, notification and one-command-deployment claims with current branch behavior and release boundaries. Marked the historical SQL/OpenAPI files as archived proposals and added [current architecture](current-architecture.md). Removed the unused ESV key example; no live environment variables or provider keys were changed.
- Added an [audit delivery matrix](audit-delivery-status.md) mapping B01–B15 and I01–I15 to branch implementation and explicit gaps. Production was rechecked: original deployment `dpl_C4sMrQ52ewYiZdrAyMF3YCc9qjho`, exact `d94d17c6` commit, READY and HTTP 200. No rework production deployment occurred.
- Read-only map-provider check: the configured local public key returned 403 for the local origin and 200 for production-origin headers on the app's Streets v4 style endpoint. No keys, provider settings or church data were changed. This narrows the local symptom but does not prove live browser tiles/geocoding or provider/content licensing.
- [Workspace read reliability](workspace-read-reliability.md) documents the bounds and explicitly separates these tests from the still-required mixed-entity load/physical-phone benchmark. No migration or production mutation was added by this checkpoint.

### September 11 — completed-work audit and remediation

- Page-specific Luna reviews covered every public route and the distinct Today, Outreach, fieldwork, Locations, People, Follow-ups, Guides, Groups & members, Settings, Recovery, community-encounter, invitation and connected-administration boundaries. Reviews used both source inspection and the optimized local build; stale reports from a server whose `.next` output had been replaced were discarded and rerun against the current build.
- Accessibility and responsive fixes remove invalid ARIA from generic containers, restore a focusable skip-link target, label search/tracking/import controls, expose selected directory state, retain `main` landmarks during loading, enlarge operational microcopy and touch targets, repair the narrow follow-up filters/property sheet/recovery actions and improve mobile navigation contrast. The changed fieldwork and community-encounter dialogs passed keyboard, focus, narrow-width and automated accessibility checks.
- Workflow fixes require assignment acceptance before completion, preserve a selected address-list territory when returning to the map, keep demo recovery navigation inside the demo, use state-aware guide actions, expose community encounters from an active outing, use the church timezone for follow-up date minima and prevent person follow-up tasks that conflict with an applicable contact restriction. Factual encounter history remains recordable; a restriction is not silently lifted or rewritten.
- The nineteenth additive migration removes the legacy direct church-settings update path, keeps settings in the versioned/audited command stream, protects assignment acknowledgement in SQL and revokes inherited execution on superseded private helpers. Regression coverage checks the direct-update denial, both version increments, audit creation and the acknowledgement boundary.
- Configured supported map/geocoder origins are represented in production CSP, unsupported runtime map-style origins are rejected, OpenFreeMap sprite requests are allowed, and the public sitemap now derives from the route registry so Privacy and Terms remain included. Obsolete snapshot-merge and unused connected-discipleship implementations/tests were removed; historical developer documents now defer to the current architecture instead of presenting the prior design as live behavior.
- Final local lint, TypeScript, all 202 unit tests / 42 files, the optimized 20-route build, offline-manifest generation, sandbox verification and all nine rollback-only database suites passed. Database lint reported no errors; reviewed existing warnings are limited to dynamic-SQL analysis, retired fail-closed parameters and implicit literal casts in exercised functions. Full browser results are recorded in [browser readiness](browser-readiness.md).
- No production deployment, hosted database mutation, provider activation or real church-data change occurred. The existing staging, device, operator, legal, provider and pilot gates below remain open.

### September 12 — simplicity pass before further feature expansion

- Implemented the approved [simplicity plan](simplicity-plan.md) with three Sol
  Codex agents in the existing herdr session and coordinator integration.
- Desktop and mobile now share Home, Walks, People, More. Home chooses personal
  assignments and requested follow-ups, with exception notices only when needed.
- People combines Needs follow-up and All people, groups tasks by person, keeps
  unnamed address-only work actionable, and embeds shared task actions in profiles.
  Existing person/task links remain usable. Secondary actions and filters are
  disclosed when needed; calendar-day labels retain their intended date.
- Walk setup guides When → Where → Who → Review, with direct volunteer selection,
  optional groups, inline address lists, and checkpointed saves. Fieldwork requires
  the selected walk's applicable area and preserves assignment acceptance.
- Website and help use the same simpler workflow. Existing access, data, offline
  command, and production-release boundaries remain in place; no new migration
  or production deployment was performed for this pass.
- Final integration checks pass: lint, TypeScript, 224 unit tests in 45 files,
  nine local database suites, optimized build, and all 24 browser scenarios
  across the full run and focused test-only reruns. [Verification notes](simplicity-verification.md)
  record the exact coverage and remaining limits. Product-owner practice with
  the fictional workflow remains the usability checkpoint before feature expansion.

### September 12 — map-first zones and nightly targets

- Implemented the approved [map-first zones plan](map-first-zones-plan.md)
  with Sol lanes coordinated in the existing herdr session. When → Where →
  Who → Review stays; a saved or newly drawn zone is the lasting goal, and
  colored polygons, rectangles, street sections or a whole-zone target define
  one team's work for the night. Address-list construction is not required.
- Each target has one team or person, an immutable reviewed parcel roster,
  explicit acceptance and its own field map. Coverage dedupes apartments and
  repeat visits; manual Finish does not imply 100%. Atomic replacement keeps
  the old history and requires fresh acceptance. Repeat copies preparation,
  not old targets or assignments.
- Server checks enforce ownership, parcel/whole-zone exclusivity, authoritative
  geometry and parcel identities, frozen history and nonempty accepted/ready
  rosters. Complete cached planning data supports review; new connected
  planning requires connectivity, while accepted field records remain durable
  offline. Privacy-safe progress does not reveal private care notes.
- A bounded pinned Overture import loaded 16,466 real connector-bounded street
  sections for the four approved Tennessee counties into the local sandbox.
  Manifest counts, geometry validity and authenticated bounded RPC reads passed.
  All ten local database regression suites passed after import.
- Scoped local verification is complete: 277 unit tests, all ten database suites,
  optimized build, 11 final-artifact zone/simplicity browser tests and the isolated
  connected draw → assign → Ready story passed. The 18 connected-readiness tests
  passed on the preceding artifact; [verification notes](map-first-zones-verification.md)
  distinguish artifacts, discovered fixes and external limits. The existing MapTiler key rejects
  localhost; a runtime-only OpenFreeMap demo preference rendered a real basemap.
  No credentials, hosted database, deployment, commit or production import changed.

### September 12 — Step 2 real-data follow-up

- User testing exposed generated planner geometry and missing Tennessee parcel
  inventory despite the prior fixture-based workflow checks. Removed runtime
  placeholder candidates, separated real street/parcel loading, and connected
  parent-zone drawing to viewport parcel requests.
- Public GIS-only reads now support the sample workspace without exposing church
  data. Real Lawrenceburg street selection is browser-verified; 287 unit tests,
  11 SQL suites, build, 11 deterministic browser scenarios and one unmocked GIS
  scenario passed. [Follow-up evidence](map-data-loading-fix.md) records distinctions.
- User subsequently authorized a read-only copy from hosted Supabase. Local
  Lawrence publication now contains 25,754 original parcels (21,055 residential),
  with matching source fingerprint and existing sandbox records preserved.
  The bounded public RPC returns complete real inventory. No further tests were
  run at the user's request; real-parcel browser verification is not claimed.

## Remaining engineering and operating work

- Guide library: complete/coherent bounded reads, captured-version writes, immutable retry and reference-safe archives are implemented. Historical edition pinning/archived reading and broad capacity/phone evidence remain distinct limitations. Field selection retains outing → assigned-group default → personal favorite → church fallback.
- Person archival/paused/tracking-state semantics and supervised correction/erasure/offboarding; distinguish soft archive from permanent deletion and preserve independent restrictions/backups as required by approved policy.
- First-church/verified-first-leader provisioning with empty normalized records, live sign-in/delivery, operator runbooks and privacy-safe monitoring/alerts. [Church pilot kit](church-pilot-kit.md) prepares sessions and evaluation; it does not implement or verify those operational services.
- Production-shaped scale and the remaining failure matrix: concurrent archive/conflict recovery and service-worker build transitions with pending clients; repeat tested session revocation/account switching and while-open offline expiry on actual supported phones; complete 200%/screen reader and printing.
- Fresh complete production backup, off-site/key custody, hosted-history reconciliation, isolated staging, existing-device reconciliation and authenticated post-deployment app/schema verification. Public read-only checks confirm the latest application/schema surface, but no database password or new paid-provider authority has been supplied.
- iOS: repair the branch's sandbox seed/database CI regression; run dedicated iOS CI; rehearse/deploy its two additive migrations; complete provider/link setup, deletion fulfillment, signing, signed physical-device/iPad/accessibility tests, TestFlight and App Review preparation.

## External launch gates — do not claim these are implemented or verified

- Current Vercel team is Hobby. [Its terms restrict that plan to personal, noncommercial use](https://vercel.com/docs/plans/hobby). Commercial-compatible hosting requires an owner-approved billing change or hosting decision.
- Public operator identity, support email, privacy/terms approval and a support commitment are awaiting owner details.
- Production auth/email delivery and any additional reminder provider require configuration and delivery verification. No unsupported reminder claims or invented delivery success.
- Embedded commercial ESV use and offline/printed map imagery require appropriate permission; reference-only scripture and address-list printing are the initial fallback.
- Actual iPhone/Android field testing, church recruitment, interviews, repeated pilot use, willingness-to-pay evidence and legal review cannot be replaced by automated tests.
- The iOS source checkpoint is not Apple approval. Apple Developer/App Store authority, production provider changes, deletion operations and submission remain separately controlled external actions.

## Verification policy

Each audit blocker must gain a regression test, a server-enforced fix where applicable, and a recorded result. A passing build is not a production-readiness claim. Record unresolved gates explicitly; do not mark packages complete because their documentation exists.
