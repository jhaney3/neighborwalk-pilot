# Audit delivery status

> Historical record. For the current iOS release status and requirements, see the [iOS release guide](../ios-release.md).

Updated September 11, 2026. This is an acceptance map for the [original audit](market-readiness-audit.md) and [approved plan](market-readiness-plan.md), not a replacement scope or a production-readiness certificate. Exact commits, failures and completed checks are in the [execution ledger](rework-progress.md).

## Bottom line

The earlier improvements were deployed first, then the rework branch was created. The rework implements a substantially different, coherent workflow around **turning neighborhood conversations into personal follow-through**: prepare → encounter → owned next step → accepted handoff/completion → leader review. The differentiated offer is respectful fieldwork and accountable follow-through, not a full church-management suite or spiritual scoring.

The rework is **not complete, production-deployed, commercially approved, or validated by real church pilots**. Existing production data has not been migrated. Local preservation and encrypted restore drills are verified within their documented scopes. Fresh complete production recovery, operational ownership and external release decisions remain outstanding.

“Branch implementation” below means implemented code with regression evidence for specified flows; it does not mean every release acceptance case or production gate has passed.

## Audit blockers

| ID | Branch implementation / current boundary |
| --- | --- |
| B01 — Broad history rewrites | Legacy bulk writes revoked; server-authorized, atomic normalized commands and retained audit. Must deploy with compatible app and reconciled old devices. |
| B02 — Durable restrictions | Independent restrictions enforced by the server; later encounters do not lift them; reviewed correction preserves history. Person/location follow-up composers also block restricted channels before submission. |
| B03 — Retention and recent work | Recent resolution timestamps and linked responsibility protected; reviewed server archival has an exact manifest. Approved erasure policy/operation is still separate. |
| B04 — Administrative merges | Reviewed moves and duplicate aliases preserve original history; reusable-group cleanup is centralized. Remaining concurrent archive/failure matrix still required. |
| B05 — Clean-device refresh | Sync downloads remote state even without queued changes; complete reads preserve pending work. New work during a download is not reported as fully shared. |
| B06 — Split transactions/queue loss | Atomic commands, version checks, original receipts, untruncated immutable outbox and persisted recovery. Guide changes now use their own equally durable request journal. |
| B07 — Shared-browser isolation | Account/church/environment storage, one writer, session revocation and original-author recovery; actual supported-phone repetitions remain. |
| B08 — False save feedback | Persistence precedes acknowledgement; failed storage retains input; server confirmation is distinct from device save. Failure-injection regressions exist. |
| B09 — Divergent relationships | Tenant/link checks, reviewed moves, accepted care handoffs and explicit task responsibility. Historical links are retained, not rewritten indiscriminately. |
| B10 — Incomplete reads | Complete bounded keyset reads, typed denial, same-account/revision checks, invalid-response rejection and no partial-cache publication. Mixed-entity/50-volunteer load testing remains. |
| B11 — Recovery scope | Encrypted consistent operator capture and isolated exact-data restore, plus authored device recovery. Fresh full production capture, off-site custody, managed/provider recovery and tenant operational restoration are not complete. |
| B12 — Invalid state becomes demo | Corrupt/future/cross-account state is preserved or quarantined; explicit fictional demo remains separate. No silent live-to-demo write fallback. |
| B13 — Dependencies | Patched dependencies and clean-install/dependency-audit CI. Must recheck exact release; a historical clean audit is not a permanent assurance. |
| B14 — Production hardening | Local/hosted test foundation, session security and headers implemented; configured HTTPS map/geocoder origins are represented in CSP and unsupported runtime map origins are rejected. Monitoring, staging/cutover, live delivery, operator runbooks and runtime verification remain open. |
| B15 — Licensing | Reference-only Scripture, no automatic map-imagery caching, address-list printing fallback. Map/geography/provider licensing and actual printing still need review. |

## Integration findings

| ID | Delivered direction / remaining boundary |
| --- | --- |
| I01 — Outings | Routed lifecycle, reusable areas/groups, assignment acknowledgement, readiness, debrief and repeat drafts. Completion is unavailable before acceptance in both UI and transactional SQL. Real leader preparation-time/usability measurement remains. |
| I02 — People without a property | Address-optional people and community encounters; deliberate location association. Assisted first-church operational provisioning remains unfinished. |
| I03 — Responsibility | Named owners, My/Team/leader exception views, task acceptance/decline and accepted care handoffs. Real leader backstop operation remains to validate. |
| I04 — Shared history | Permission-filtered notes, encounters, corrections and task lifecycle; derived last contact uses qualifying encounters and labels legacy dates. |
| I05 — Sharing and creator access | Visible sharing explanations, live membership checks, disclosed historical creator access and removal on accepted handoff. Privacy/operating policy still requires approval. |
| I06 — Reusable groups | Stable groups with outing assignments and central cleanup; active guide defaults exclude deleted groups. Broader concurrent deletion/held-queue cases remain. |
| I07 — Restrictions and tasks | Independent channel restrictions and server-side effects, including protected responsibilities unavailable to the initiating volunteer. Follow-up entry checks the person’s applicable channel and retains factual encounter history instead of conflating it with permission to contact again. |
| I08 — Guide cache/library | Unified account-scoped prepared library, coherent complete reads, captured versions, durable retries and safe archives. No immutable historical edition pinning. |
| I09 — Hidden content | Coaching/reminders are editable and visible in fieldwork; General/Conversation/Prayer/Milestone notes are available. No existing content erased to simplify the UI. |
| I10 — Calendar meaning | Real date-only validation and church-timezone display; unit tests cover calendar edge cases. Supported-device/travel field checks remain. |
| I11 — Coverage confidence | Leader work focuses on known saved locations and outing activity instead of misleading lifetime-as-today coverage. Larger parcel-source confidence/performance and licensing work remain. |
| I12 — Install/reminders | Feature-detected install guidance, honest offline preparation, opt-in email implementation. Production provider/scheduler and delivery evidence are not supplied. |
| I13 — Save/freshness | Device/shared states and recovery details are distinct; queues survive tested failures. Remaining update/background/storage-eviction matrix still required. |
| I14 — Church metadata | Canonical relational settings and derived presentation, with transactional version/revision checks; the legacy direct `churches` update policy/grant is revoked and the preserved snapshot is not dual-written. |
| I15 — Competing design contracts | Current architecture/types/migrations documented; old SQL/OpenAPI explicitly archived. README no longer presents the old design or single deploy command as a safe release. Retired snapshot-merge/direct-discipleship modules and their self-only tests have been removed. |

## September 11 completed-work audit

Page-specific Luna reviews covered every public page plus the distinct demo Today,
Outreach, People, Follow-ups, Locations, Guides, Groups & members, Settings,
Recovery, community-entry and fieldwork surfaces; the connected Data & health and
invitation boundaries received separate safe reviews. Remediation fixed unreadable
microcopy/navigation badges, invalid ARIA on generic containers, missing control
labels/selected state, a stacked mobile-filter cascade, the narrow recovery action,
the mobile location sheet, list-to-map territory continuity, Settings’ demo recovery
escape, misleading guide/assignment actions, active-outing community entry,
church-timezone follow-up minima, restricted follow-up scheduling, map-provider CSP
mismatch and sitemap omissions. Transactional regression coverage now also protects
settings versioning and assignment acknowledgement. The
[execution ledger](rework-progress.md) records verification. No
production deployment, provider change or church-data mutation was part of this audit.

## Remaining engineering is not just paperwork

- Controlled first-church/verified-first-leader provisioning and explicit paused/archived-person semantics, supervised correction/erasure/offboarding.
- Privacy-safe operational monitoring and alerting, incident/access/lost-device/recovery procedures with named operators.
- Mixed-entity production-shaped load and concurrent-user testing; complete service-worker update/held-queue/archival failure matrix.
- Actual iPhone/Android installation/offline/backgrounding and proportionate desktop coverage; screen-reader/200%/keyboard/printing verification.
- Fresh production backup, hosted migration-history reconciliation, isolated staging, existing-device pending-work reconciliation and coordinated application/schema cutover.

Historical guide editions and archived-guide reading are explicit limitations; retain the prepared current-guide promise without pretending a version number stores old text. Full ChMS integration, self-service billing, bulk SMS, native rewrite, national parcels and speculative AI remain out of the initial scope unless pilot evidence justifies them.

## Owner inputs and external evidence required

1. An owner-only database connection file outside Git for fresh production capture; provide its **path**, not the password in chat. Format and recovery boundaries: [database recovery](../database-recovery.md).
2. Commercial-compatible hosting/staging decision, legal operator/jurisdiction, support address/commitment and approved policies.
3. Approved sender/domain/provider and production authentication/reminder delivery configuration; no paid activation is implied by the rework request.
4. Off-site destination/key-custody owner, recovery objectives and coordination with existing devices.
5. Authorized real-device testers/design partners, repeated pilot use and willingness-to-pay evidence. The prepared [pilot kit](../church-pilot-kit.md) is not completed research.

Use [production release gates](production-checklist.md) for the final decision. Do not open enrollment or call the app production-ready merely because a branch checkpoint passes CI.
