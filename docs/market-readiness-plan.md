# NeighborWalk: implementation and approval plan

Date: September 9, 2026

Status: proposed; all decisions and implementation packages below await approval

Evidence: [Comprehensive audit](market-readiness-audit.md)

Quick links: [Decisions](#1-recommended-decision) · [Work packages](#5-implementation-packages) · [Migration safeguards](#6-migration-and-rollout-safeguards) · [Release tests](#7-acceptance-tests-and-release-gates) · [Approval worksheet](#10-approval-worksheet)

## 1. Recommended decision

Build NeighborWalk into a focused church outreach-and-follow-up product, with a public marketing website and an installable mobile-friendly web app.

Retain Next.js, Supabase, MapLibre, IndexedDB, and the existing visual identity. Replace fragile whole-workspace coordination incrementally. Make the volunteer experience simpler while making permissions, recovery, and data handling more rigorous.

Recommended initial authorization: approve the product direction and **Packages 0–1** only. Package 0 approves the target design and validation plan; Package 1 establishes a safer baseline. Review its results and the migration design before authorizing Package 2. You can approve a broader sequence, but production migration, external spending, customer communications, and public release still need explicit checkpoints.

### Decisions for your review

| Decision | Recommended choice | What approving it changes |
| --- | --- | --- |
| D01: First customer | Small-to-midsize US churches organizing neighborhood outreach | Designs and tests focus on a specific buyer and volunteer context |
| D02: Core promise | Prepare outreach → record encounters → own the next step | Follow-through becomes the central workflow; maps and guides support it |
| D03: Person model | People do not require a home address | Enables encounters at meals, community events, and referrals without fake locations |
| D04: Faith/pathway fields | Optional, default off or secondary; preserve existing data | Removes unnecessary sensitive classification from the normal field flow |
| D05: Access policy | Leaders have explicitly disclosed access; owners/named collaborators get scoped access; creator identity alone does not imply permanent access after handoff | Requires a reviewed migration from today's creator-always-access policy; no silent historical access change |
| D06: Mobile strategy | Responsive PWA first, tested on actual iPhones and Android phones | No native rewrite until pilot evidence shows a specific limitation worth the cost |
| D07: Commercial entry | Assisted design-partner pilot, then church-level pricing | Avoids premature self-service billing/provisioning; does not authorize charging anyone now |
| D08: Content/providers | Confirm commercial licensing; use reference links if embedded ESV permission is unavailable | Avoids making paid launch depend on unresolved text licensing |
| D09: Growth scope | CSV exchange first; Planning Center integration and neighbor-request QR experiment after core validation | Keeps new integrations and intake channels from delaying reliability |
| D10: Data policy | Minimal encounter/contact data, durable scoped restrictions, explicit retention and recovery policies | Requires product-owner and appropriate legal/security review before release |

All are proposals, not assumed approvals. In particular, changing theological labels, contact-permission behavior, or who can see existing notes is a product-policy decision, not a routine refactor.

## 2. Definition of the first marketable product

### Included

- Church workspace with reliable invitation, authentication, roles, and account recovery.
- Leader onboarding that leads to a first outing.
- Reusable territories and teams; individual outings with dates, purpose, assignments, and debrief.
- Volunteer Today screen and an assigned map/list workflow.
- Quick encounter logging with minimum required data.
- Durable do-not-visit/contact restrictions and channel preferences.
- Address-optional people, clear owner, scoped sharing, and unified activity history.
- My/Team follow-up queues, due dates, completion, cancellation, rescheduling, and handoff.
- Account-scoped local storage, durable outbox, reliable refresh, and honest offline state.
- An optional prepared guide; embedded scripture only under an appropriate content arrangement.
- Safe export/recovery, audited administration, essential reporting, help, and support.
- Public website explaining the product, its actual capabilities, pilot/pricing, and trust policies.

### Explicitly excluded from the first release

Full church CRM replacement; giving/accounting; worship/service planning; child check-in; advanced safeguarding/clinical case management; public prayer social network; automated bulk SMS; complex workflow builder; national parcel ingestion; conversion scores; AI-generated assessments of neighbors; live volunteer surveillance; native apps; multi-church federation.

Excluding these is how the initial product stays understandable and supportable. Existing records are not to be deleted merely because a field or feature is hidden.

### The target operating loop

~~~text
Leader prepares outing and assignments
                ↓
Volunteer checks readiness and starts assigned work
                ↓
Encounter recorded, with optional person/contact request
                ↓
Next step assigned to a responsible person
                ↓
Owner accepts, completes, reschedules, or hands off
                ↓
Leader reviews exceptions and plans the next outing
~~~

Suppression, permissions, durable local saves, and sync recovery apply across the entire loop.

## 3. Target product behavior

### Today

Volunteer: my due/overdue tasks, next assignment, start/resume, and a plain-language save/sync indicator.

Leader: the same personal work plus unowned requests, unaccepted handoffs, inactive owners, unresolved sync errors, and upcoming outings. Do not substitute a wall of lifetime counters for these exceptions.

### Outreach

Outing creation: title, date/time/timezone, purpose, meeting point, leader contact, optional guide, and participating team assignments.

Outing lifecycle: draft → ready → active → completed → archived. Cancellation is explicit. Repeating an outing reuses areas/templates without duplicating people or erasing previous visit history.

Assignments: reusable territory/list plus an outing-specific team or volunteer. Start with leader assignment and simple acknowledgement. Prevent obvious overlaps online; warn about stale state offline instead of claiming perfect live coordination.

Field flow: select location from list/map → record outcome → optional follow-up → durable save → next. A no-answer record should not require a name, note, contact detail, faith label, or guided conversation.

Location handling: manual address entry independent of maps, unit/apartment support, correction, duplicates review, archive, and explicit location/person moves.

### People

Create a person with a name or useful identifying description; contact details and address are optional. Do not manufacture a person record when only an anonymous encounter is needed.

A person has an owner, status, contact preferences/restrictions, optional household/location, and relevant activity. Show exactly who can see the record. Separate “paused care tracking” from “do not contact.”

History should join permitted encounters, notes, task lifecycle events, ownership changes, and recorded preferences. Do not leak a restricted note through a supposedly harmless aggregate timeline.

Ownership transfer must explain what access changes and what tasks move. The leader has a fallback inbox when an owner is inactive, declines, or cannot be reached.

### Follow-ups

Keep one task model with optional links to a person, encounter, location, and outing. A task always has an accountable owner or a conspicuous unassigned state visible to the leader. Team assignment can aid coordination but must not obscure responsibility.

Required actions: accept if handoff is enabled, complete with optional note, cancel with reason, reschedule, reassign, and create a subsequent step. Make cancellation and completion history durable.

Use date-only tasks initially unless pilots need exact appointment times. Store/display their meaning in the church timezone; do not convert a calendar day through the volunteer's device timezone accidentally.

### Guides and reminders

Guides are optional, church-controlled preparation. Keep favorites and a clear precedence rule: outing assignment → personal preference → church default. Do not choose an unrelated event's group merely because it is marked active.

A prepared guide must be available after a cold offline reopen for the authorized user. If scripture cannot legally or technically be cached, state the limitation and retain usable guide text/references.

Replace the current installation exception with feature detection and platform instructions. Do not label an in-page Notification call as scheduled reminders. First add opt-in email digests with safe titles and protected deep links. Evaluate Web Push only after delivery behavior is tested on the supported mobile matrix.

### Website

Use separate public and authenticated routes, sharing brand/components where appropriate:

~~~text
/                         Public positioning and demo/pilot invitation
/how-it-works             Leader → volunteer → follow-up story
/pricing                  Pilot offer or approved commercial pricing
/trust                    Data practices and verified security claims
/help                     Onboarding, install, offline, support
/privacy /terms           Approved policy pages
/login /invite/...        Authentication and invitation handling
/app/today                Role-aware starting point
/app/outreach/...         Outings, assignment, map/list, debrief
/app/people/...           Directory and stable person URLs
/app/follow-ups/...       Personal/team work and task URLs
/app/settings/...         Account and permitted administration
~~~

These are proposed routes, not implemented endpoints. Keep all protected links authorized at the data boundary; possession of a URL is never sufficient permission.

## 4. Target data and sync architecture

This is a logical model for approval, not executable SQL. Validate exact columns, policies, migration steps, and indexes in Package 2. Do not apply the older database design document as a substitute.

### Data model

| Domain | Target relationship and responsibility |
| --- | --- |
| Church and memberships | One authoritative church profile; authenticated user membership with role/status; initial UI selects one workspace |
| Teams and team membership | Reusable church teams, separate from their participation in an outing |
| Territories | Reusable geographical area/list, optional geometry; archived without deleting historical encounters |
| Outings | Time-bound ministry activity with purpose, status, timezone, and optional guide version |
| Assignments | Links outings to territories/lists and responsible teams/volunteers |
| Locations/households | Distinguish geographical/site/unit identity from people; a location need not imply a named household |
| People | Optional location/household association, accountable owner, scoped access, optional pathway metadata |
| Encounters | Append-oriented record of what happened, by whom, where/through what context, and in which outing if applicable |
| Tasks and task activity | Due work plus immutable lifecycle entries; links are optional but internally consistent |
| Notes/sharing | Restricted content and explicit access relationships, not fields inside an ordinary shared snapshot |
| Contact restrictions | Person/property/channel scope; effective state, source, recorded actor/time, authorized correction |
| Guides/preferences | One authoritative library and deliberate offline cache; personal preferences separated from church data |
| Audit events | Server-derived actor and append-only operational history; no sensitive note content copied into logs |
| Command receipts/change feed | Idempotency, server versions, downloadable deltas, deletion and permission-change reconciliation |
| Notification/integration jobs | Transactional intent stored with work changes; external delivery outside database transactions |

Use tenant-consistent foreign keys and indexed access paths; do not allow a person in Church A to point to an outing, task owner, or location in Church B. Existing text IDs and UUIDs need a stable migration mapping rather than an indiscriminate ID rewrite.

JSON remains appropriate for bounded guide content/configuration. It should not be the sole authority for ordinary entities, cross-record permissions, or all church history.

### Proposed access rules

| Action | Volunteer | Owner / explicitly authorized collaborator | Leader |
| --- | --- | --- | --- |
| View ordinary assignments/encounters | Approved church/assignment scope | Same | Church scope |
| Record encounter | Own authenticated action in permitted scope | Same | Same, with audited corrections |
| Rewrite/delete others' history | No | No | Controlled correction/archive, not arbitrary replacement |
| See a restricted person/note | No access unless granted | Granted scope only | Explicitly disclosed leader policy |
| Manage task/person | Only when responsible and permitted | Owner manages; collaborator abilities explicitly defined | Reassign/resolve with audit |
| Record no-contact request | Yes, within permitted encounter context | Yes | Yes |
| Lift a no-contact restriction | No | No by default | Reasoned, auditable correction under approved policy |
| Export/restore/delete workspace data | No | No | Explicit privileged workflow and reauthentication |
| Change members, templates, retention | No | No | Approved administration workflow |

Do not conflate “may read,” “may add a note,” “may change ownership,” and “may export.” Test both permitted operations and denials directly against the database/API.

### Command and refresh protocol

1. Validate an action and resolve its authenticated church/user context.
2. Atomically persist the local change and immutable outbox command before reporting “saved on this device.”
3. Submit command ID, entity/version references, and the requested change.
4. Server checks membership, access, relationships, and restrictions; commits domain changes, audit, and receipt in one short transaction.
5. A retry with the same command ID returns the prior outcome instead of duplicating an encounter, note, or task.
6. Apply accepted server versions locally and acknowledge only those commands.
7. Independently download changes on manual refresh, focus/reconnect, and bounded foreground refresh. Use realtime invalidations where useful.
8. Reconcile deleted records and visibility changes; invalidate/rebuild authorized cache scope when access changes.
9. Classify permanent errors and conflicts for user/leader action; retry only transient failures automatically.

Recommended conflict rules:

- Independent encounters and notes: append and deduplicate by immutable ID.
- Task completion/reassignment and person ownership: expected-version check; surface meaningful conflicts.
- Do-not-contact: restrictive state wins over a stale task/assignment. Preserve historical facts about an encounter that occurred offline; stop subsequent prohibited action and flag the conflict.
- Territory/team administration: server transaction with all dependent changes.
- Deletion: tombstone or equivalent authoritative deletion record; stale clients cannot resurrect records.
- Bulk restore: separate privileged operation, never a normal merge command.

An offline permission cache is a bounded usability compromise, not live authorization. Define a freshness/unlock period and clear behavior after revocation becomes known. A denied queued change must remain recoverable to its legitimate author without leaking it into another account.

### Deliberate offline scope

Version 1 should guarantee prepared **records, task list, allowed person context, and guide text** under tested device conditions. Maps are available offline only to the extent deliberately prepared under a suitable provider agreement. Provide an address list fallback and display what is missing.

Do not promise background sync, full offline sign-in, indefinite retention on a browser that may evict storage, or immediate remote revocation on a disconnected phone.

## 5. Implementation packages

The estimates below are coarse planning ranges for a focused engineer working with product/design review. They are not quotes, delivery commitments, or estimates of how quickly an AI session will finish. Field trials, vendor permission, security/legal review, and customer scheduling add calendar time.

### Package 0 — Approve the shape of the product

Effort: roughly 0.5–1.5 engineering/design weeks, plus customer scheduling.

Dependencies: your decisions D01–D10; no production changes.

Deliver:

- Decision record for positioning, roles/privacy, retention, date semantics, and first-release exclusions.
- Low-fidelity clickable flows for leader first outing, volunteer encounter, and follow-up completion.
- Inventory of current hosted configuration to verify later with permission: backups, auth/email, headers, vendor keys/licenses, row limits, deployment environments.
- Research script and recruitment criteria for 5–8 church leaders and 8–12 volunteers across experience/age/phone types.
- Explicit data-preservation requirements and migration inventory.

Exit: you approve the navigation, core flow, privacy/access choices, and first pilot segment. Church outreach/recruitment is performed by you or separately authorized; preparing a script does not authorize contacting anyone.

### Package 1 — Establish a safer baseline

Effort: roughly 1–2 engineering weeks; uncertainty depends on containment strategy.

Addresses: B01–B08, B12–B15 containment; immediate I07/I12/I13 issues.

Work:

1. Preserve a reviewed baseline of the current dirty worktree; do not overwrite unrelated edits.
2. Add regression tests for the reproduced retention, DNV, territory merge, group cleanup, clean-device refresh, and install failures.
3. Patch the flagged dependency set compatibly; regenerate MapLibre workers and verify.
4. Correct standalone-task retention and durable-suppression behavior. If robust suppression requires the new schema, disable/clearly gate unsafe transitions until that schema is ready.
5. Add server-enforced containment for ordinary snapshot writes and restrict unsafe bulk operations. Document any temporary limits on volunteer actions.
6. Remove the clean-device sync early-success behavior; make freshness explicit.
7. Prevent loss of unsent mutations; introduce visible queue/storage error states and pre-mutation validation.
8. Partition/lock local state by account and church, with a tested pending-work path.
9. Fix installation feature detection and stop claiming closed-app reminder delivery.
10. Replace silent seed reset on invalid state with quarantine/recovery.
11. Establish CI for lint/types/tests/build, dependency checks, and local database permission smoke tests.
12. Verify production-header and scripture abuse-control design in staging; record content-license decision.

Likely files: package manifests/lockfile, map-worker preparation, domain/storage/sync/discipleship modules, main hook, auth gate, shared feedback, Settings, new migrations, and tests.

Exit: the reproduced regressions are caught and corrected or safely disabled; no blanket assurance of production readiness. Any remaining blocker is explicitly listed. Review the results before a migration tranche.

### Package 2 — Durable domain data and migration

Effort: roughly 3–5 engineering weeks; largest technical uncertainty.

Dependencies: Package 1 and approved access/retention model.

Addresses: B01–B12 structurally; I01–I08, I10/I14/I15 foundations.

Work:

1. Approve an architecture decision and exact schema/RLS/command contract.
2. Normalize ordinary locations, encounters, territories, teams, outings, and assignments incrementally, building on the protected-person work.
3. Separate people from required properties; add consistent optional relationships.
4. Implement atomic domain commands, durable outbox, receipts, version rules, deletion propagation, and independent refresh.
5. Add server audit, safe handoff, suppression, and dependent-change transactions.
6. Replace unpaginated reads with bounded, deterministic queries and complete export paths.
7. Unify guide library/local cache behavior and canonical church metadata.
8. Implement retention preview/job/reconciliation and complete same-church backup/restore.
9. Generate database types; reconcile design-only documentation with implementation.
10. Rehearse migration against production-shaped synthetic data and a separately authorized sanitized snapshot if available.

Likely new modules: domain commands/selectors, persistence/outbox/sync, server RPC interfaces, domain query hooks, generated database types, migration validation, and integration fixtures.

Exit: two-device, permission, restore, migration, scale, and offline failure tests pass; all migrated relationships/counts reconcile; old clients cannot overwrite the new schema.

### Package 3 — One coherent church workflow

Effort: roughly 3–5 engineering/design weeks.

Dependencies: stable Package 2 command interfaces; approved Package 0 flows.

Addresses: I01–I13 and the adoption gaps in audit sections 6–7.

Work:

- Real routes, deep links, and Today/Outreach/People/More navigation.
- Leader onboarding, reusable teams/territories, full outing lifecycle, assignments, and debrief.
- Volunteer map/list workflow, manual encounter/address entry, quick-save path, and clear next action.
- Address-optional people; deliberate duplicate/move/merge/archive flows.
- My/Team/unassigned follow-ups, accountable owner, handoff/backstop, and unified permitted history.
- Optional/configurable pathway UI; clear visibility/contact-preference controls.
- Contextual guides and explicit field-readiness preparation.
- Readable mobile typography, accessible dialogs, keyboard/list equivalents, status announcements, and tested form errors.
- Date-only/church-timezone behavior; separate coverage denominator and period.
- Address-only printable assignment lists, with map imagery only if licensed.

Exit: representative volunteers can complete the main flow unassisted; a church leader can prepare, run, and debrief a realistic outing without database work; both phone platforms have passed real-device checks.

### Package 4 — Controlled commercial pilot and website

Effort: roughly 2–4 engineering/design weeks, plus a 4–6 week observation period that can overlap stabilization.

Dependencies: no unresolved safety/data blockers; approved provider/privacy/support policies.

Work:

- Public website, honest screenshots/demo, product explanation, pilot/pricing offer, trust/help/contact, and approved policy pages.
- Separate fictional demo and live church onboarding; no sample records silently inserted into real work.
- Invitation delivery/recovery troubleshooting, support diagnostics, onboarding materials, and a leader quick-start.
- Opt-in privacy-preserving reminders/digests with delivery/retry/unsubscribe tests.
- Operational monitoring, incident runbook, access review, scheduled backup checks, and restore rehearsal.
- Pilot analytics without person/note content.
- Controlled CSV export/import workflow with duplicate review; formula-injection protection for spreadsheet exports.
- Manual pilot commercial administration first if appropriate; self-service billing only once pricing is validated.

Exit: 3–5 design-partner churches complete repeated outings/follow-up cycles; support and reliability are workable; pricing evidence exists; launch claims match verified capabilities.

### Package 5 — Evidence-led growth

Effort: estimate individual experiments after pilot evidence.

Dependencies: retained pilot churches and willingness to pay.

Choose at most one or two initially:

- Planning Center exchange for a specific selected-contact workflow.
- Neighbor-request QR intake with responsible inbox owner and abuse controls.
- Community-meal/service encounter template.
- Spanish field UI/content.
- Web Push or calendar integration.
- Multi-campus/multi-workspace membership when a paying use case requires it.
- Licensed additional geography or advanced routing when manual areas/list preparation becomes the bottleneck.

Native mobile should require a documented gap that materially blocks adoption or reliability and cannot be resolved acceptably in the web app. “An app sounds more marketable” is not enough.

### Planning envelope

Allow roughly **10–18 focused engineering/design weeks through a controlled paid-pilot candidate**, plus external reviews and field observation. Re-estimate after Package 1 and again after migration rehearsal. A small containment release can happen much sooner; it is not the same thing as a commercially dependable product.

If budget/time is tight, reduce breadth: one outreach template, one church per account in the UI, manual onboarding, address-list printing, reference-only scripture, CSV rather than ChMS integration, and email rather than push. Do not cut authorization, durable saves, suppression, or recovery.

## 6. Migration and rollout safeguards

The existing church data is more valuable than a cleaner schema.

1. Inventory entities, counts, identifiers, ownership, sharing, guide libraries/defaults, restrictions, and existing pending work.
2. Create and verify a recoverable server backup plus scoped export. Verify the backup actually restores.
3. Rehearse migration on disposable environments with current migrations and multiple historical app-schema versions.
4. Add new tables/constraints/commands without dropping old fields. Backfill using stable IDs or a recorded mapping.
5. Validate tenant identity, duplicates, orphan references, note authors, creator/owner identities, task history, dates, suppression, and guide content.
6. Compare old/new reads before switching a pilot church. Do not silently “repair” ambiguous records by assigning them to the first person or territory.
7. Cut over one workspace behind a controlled capability/version gate. Decide whether a brief write pause is safer than dual-write complexity.
8. Handle offline devices explicitly: import their old queued work through a compatibility path or require supervised reconciliation. Never discard it during an upgrade.
9. Reject incompatible old-client writes with a clear update/recovery message.
10. Monitor discrepancies and support needs, then expand gradually.
11. Remove legacy write paths only after a stable observation period and reconciled queues.

Rollback must account for writes made after cutover. Reverting a deployment is not sufficient if the previous app cannot understand the new schema. Prefer forward-compatible transitions; define a tested forward-repair or export/replay procedure where reverse migration would lose data.

No production migration, bulk deletion, field removal, or vendor key/configuration change is authorized by this document alone.

## 7. Acceptance tests and release gates

Treat these as executable scenarios, not a checklist to mark complete from source inspection.

### Security and privacy

- Church A cannot read or mutate Church B through direct table requests, RPC calls, import files, IDs, or deep links.
- A volunteer cannot replace/delete others' ordinary history or alter an audit event.
- Server actor identity cannot be spoofed through a payload.
- Owner, creator, collaborator, leader, inactive user, and uninvited account each match the approved permission matrix.
- Sharing removal, team deletion, ownership transfer, and member deactivation propagate without leaking stale content into a different account.
- Shared-browser sign-out/account switch cannot expose prior account data; unsent work has an explicit authorized recovery path.
- Suppression survives later ordinary encounters, concurrent edits, retention, event repetition, restore, and stale-device reconnect.
- User-facing “who can see this?” exactly matches access enforcement.
- No credentials, invite tokens, contact details, addresses, faith labels, or notes appear in product analytics/error telemetry.
- Dependency advisories are fixed or formally reviewed for non-applicability with an owner/date; production headers and public API limits are tested.

### Data integrity and sync

- Create 100 offline encounters, close the app, reopen, reconnect: each appears once and remains linked correctly.
- Queue more than 2,000 distinct changes including protected records and deletions: no silent loss.
- Two devices add encounters concurrently: both survive.
- Delete/archive a territory or team while another device saves work: no lost visit or orphan assignment.
- Complete a brand-new standalone task, reload, sync, run retention: the recent history remains.
- Move a person to another location with open tasks: later edits work and history remains meaningful.
- Fail between individual server writes: operation is atomic or recoverably replayed.
- Drop the response after a successful server commit: retry does not duplicate.
- A clean device's Sync Now downloads remote changes and updates its freshness indicator.
- A permanent permission error does not create an endless opaque retry loop.
- A deleted record is not resurrected by an old offline client.
- Local storage failure/quota/invalid schema leaves the draft recoverable and never reports “safely saved.”
- Read/export more rows than the configured API maximum: no silent truncation.
- Backup and restore reproduce counts, relationships, guide library/defaults, permissions, and applicable history; cross-church restores are rejected unless using an explicitly approved migration workflow.

### Field and mobile behavior

- Cold reopen offline shows the prepared assignment/list and guide, with honest missing-map/content indicators.
- Installation works or gives correct instructions without an exception when the prompt is unavailable.
- iPhone Safari and installed PWA, Android Chrome and installed PWA, and desktop Chrome/Firefox/Safari receive proportionate testing.
- Backgrounding, screen lock, app update, poor connectivity, and storage pressure do not produce false save confirmation.
- No-answer logging is approximately 10 seconds or less in the usability test; optional contact capture does not block it.
- A nontechnical volunteer can find their assignment, record an encounter, and locate a due task after brief onboarding.
- A non-map path exists for the essential workflow.
- Dialog focus, Escape, keyboard flow, form errors, screen-reader labels, 200% text enlargement, and narrow-screen layout pass manual review.
- Church timezone, DST boundaries, and a volunteer traveling to another timezone do not shift a date-only task.
- Coverage states whether it counts known locations, dwellings, parcels, or an incomplete dataset, and which outing/time window applies.

### Operational and commercial behavior

- New leader can reach a ready first outing in roughly 15 minutes with the guided setup and normal data entry, measured rather than asserted.
- Authentication/recovery/invitation email flows work with the configured production provider; expired/revoked/wrong-account links are understandable.
- Reminder delivery, retries, opt-out, inactive owners, and safe-link authorization are tested; no private detail appears on a lock screen by default.
- Support can investigate an error using a safe diagnostic ID without reading neighbor notes.
- A real restore drill meets the recovery objectives you approve before launch; do not advertise an SLA before measuring it.
- Subscription cancellation/export/offboarding is understandable if charging is enabled.
- Provider/content permissions and public legal/trust copy have been reviewed.
- Every public feature claim has a corresponding verified flow or clearly stated limitation.

The original 68 passing unit tests remain a baseline, not the release gate by themselves. Add browser, database/RLS, migration, two-client, and failure-injection coverage.

## 8. Church validation and pricing plan

### Research before feature expansion

Interview the outreach leader, a pastor/administrator who controls purchasing, and volunteers separately. Ask for the last actual outing, not opinions about an abstract app.

Questions:

- How did you select streets/households and assign people?
- What failed during the last outing?
- What happens when someone requests contact afterward?
- Who notices an uncompleted promise, and when?
- Which software already contains contacts?
- How often would this be used between outings?
- What information are you unwilling to store in an app?
- Who approves access, purchase, and vendor trust?
- What would make you return to paper?
- Would you pay for the demonstrated workflow now, and what budget would it replace?

Observe volunteers doing real tasks with fictional records. Test older/less technical participants, not only the leader who already likes technology.

### Design-partner pilot

Start with 3–5 churches willing to run at least two outings and the following week's follow-ups. Provide assisted setup and an agreed support channel. Use explicit data/ministry expectations and avoid importing a church's entire contact database.

Suggested decision signals, to agree before the pilot:

- At least 4 of 5 churches, if five participate, repeat the workflow without being continually prompted by the founder.
- Most participating volunteers can perform the core field action without help.
- Requested follow-ups are visibly assigned within the church's agreed interval.
- Leaders report less reconciliation effort, supported by before/after observation.
- No unexplained lost records, suppression failures, or access leaks.
- At least 3 churches express concrete willingness to continue at a stated price—not merely “this is nice.”
- Support time per church is sustainable.

These are directional product gates for a tiny sample, not statistical proof of product-market fit. If churches enjoy the map but do not return for follow-up, revisit the product before adding more map features.

### Pricing hypothesis

Test a simple church-level subscription, with volunteers included rather than punished by per-volunteer seat pricing. Compare willingness to pay around $29, $49, and $79 per month for the same clearly demonstrated core value; do not publish all three as invented feature tiers.

Start with one plan if possible, transparent fair-use constraints, an annual option only after retention is understood, and a trial long enough to include two normal outreach cycles. A short calendar trial may be meaningless for a church that goes out monthly.

Free products and free contact databases already exist; the [market comparison](market-readiness-audit.md#8-market-positioning-and-what-to-compete-on) is why the price must be justified by less coordination work and better follow-through, not by storing contacts.

Do not build automated billing before establishing that churches will pay. Manual pilot agreements/invoicing may be enough initially, if separately approved. Later billing requires church/account ownership, entitlements, failed-payment grace, cancellation, export, and retention behavior—not just a checkout button.

### Unit economics to measure

Track revenue per church against hosting/database, map/geocoding usage, email/push, licensed content/data, payment fees, and support/onboarding time.

~~~text
Monthly contribution per church
  = subscription revenue
    − allocated infrastructure and provider usage
    − payment costs
    − support/onboarding labor allocation
~~~

Obtain current provider quotes and measure actual pilot usage before setting margins or promising unlimited maps. Place cost alerts around geocoding, map loads, scripture requests, and unusually large exports. Do not charge or provision paid infrastructure without approval.

## 9. Ownership and approval checkpoints

| Responsibility | Owner to designate |
| --- | --- |
| Product scope, theology/pathway defaults, launch decision | You/product owner |
| Permissions, migration, sync, tests, dependency maintenance | Engineering owner |
| Field UX and accessibility testing | Product/design plus representative volunteers |
| Retention/notices/provider permissions | Product owner with qualified legal/vendor review |
| Church recruitment, training, and customer support | Pilot/customer-success owner |
| Production access, backups, incident response | Named operations owner |

At the end of each package, provide:

1. What changed and what was deliberately left alone.
2. Tests/evidence and unresolved risks.
3. Before/after workflow or migration examples.
4. Data/configuration impact and recovery approach.
5. The next approval required.

Suggested checkpoints:

- Approve direction and baseline hardening.
- Approve data/access/retention model before migrations.
- Approve volunteer/leader flows before broad UI implementation.
- Approve provider/licensing costs and production configuration separately.
- Approve one-church migration after rehearsal.
- Approve design-partner onboarding and any outbound communication.
- Approve paid/public release only after release gates and pilot review.

## 10. Approval worksheet

Nothing below is checked because this is your review copy.

- [x] Approve D01–D10 as written, or provide amendments.
- [x] Authorize Package 0: product decisions, prototypes, and research preparation.
- [x] Authorize Package 1: regression coverage and safer baseline.
- [x] Authorize Package 2 only after schema/permission/migration review.
- [x] Authorize Package 3 after core-flow review.
- [x] Authorize Package 4 after safety, operational, and content/license gates.
- [x] Keep Package 5 as separately approved experiments.
- [x] Confirm who approves production changes, paid services, external communications, and public release.

**My recommendation is to start with Packages 0–1, preserve the current work, and make reliability and a simpler volunteer experience the foundation of the commercial version.**
