# NeighborWalk: product and codebase audit

> Historical record. For the current iOS release status and requirements, see the [iOS release guide](../ios-release.md).

Date: September 9, 2026

Status: review proposal only; no application changes authorized or implemented

Companion: [Implementation and approval plan](market-readiness-plan.md)

Quick links: [Evidence](#2-scope-method-and-evidence-limits) · [Release findings](#4-release-blocking-and-high-priority-technical-findings) · [Integration gaps](#5-features-that-exist-but-are-not-integrated-well) · [Keep/cut/add](#9-keep-cut-extend-add) · [New ideas](#10-additions-worth-testing-beyond-the-current-idea)

## 1. Executive judgment

NeighborWalk has a credible product inside it, but it is not ready to sell as a dependable church system.

The strongest product is **a simple outreach-to-follow-up workspace for churches**: help a leader prepare an outing, help volunteers record encounters respectfully, and make sure a real person owns each promised next step. The map supports that promise; it is not the promise itself.

Today, the product is several useful tools joined around a shared document: territory mapping, visit logging, a small people database, follow-up tasks, conversation guides, and leader administration. The joins are where many of the problems live. Examples include person tasks disappearing during retention, church guides not following the offline workflow, people requiring a mapped address, and concurrent administrative changes overwriting volunteer work.

My recommendation:

1. Preserve the useful stack, visual identity, mapping work, and domain helpers.
2. Fix authorization, data integrity, offline account isolation, and dependency advisories before expanding real-world use.
3. Organize the app around one complete ministry workflow, not six equally prominent feature areas.
4. Separate people, households/locations, reusable territories, and individual outings.
5. Launch with assisted onboarding for a small group of churches, a credible public website, and clear support expectations.
6. Add integrations and new ministry modes only when field use demonstrates demand.

Do not begin with a new map engine, native mobile rewrite, large feature marketplace, AI ministry analytics, or a full church-management system.

### Working commercial assumptions

Until you choose otherwise, this plan assumes US small-to-midsize churches, roughly 50–500 attendees with 5–50 participating outreach volunteers; one church workspace initially; a church-paid subscription; and neighborhood outreach followed by personal follow-up as the initial use case. Those numbers are a proposed design target, not validated market research. Geography, denomination, purchasing authority, budget, and the dominant outreach style still need customer validation.

### Readiness by area

| Area | Judgment | Why |
| --- | --- | --- |
| Product concept | Worth pursuing, positioning needs focus | Real coordination problem; maps and contact databases alone are already available elsewhere |
| Visual identity | Preserve and refine | Distinctive, consistent styling; field readability is much weaker than presentation |
| Volunteer workflow | Incomplete | No clear outing lifecycle or reliable personal work queue |
| Church administration | Pilot-level | Invitations and roles exist; onboarding, event management, handoffs, recovery, and operational support are incomplete |
| Data reliability | Release blocker | Reproduced retention and concurrent-merge failures |
| Security and privacy | Release blocker | Reproduced excessive volunteer write authority; account-cache concerns; flagged dependencies |
| Offline/mobile | Partial capability, overstated promise | Local records and some caches exist; not a fully prepared field session or background reminder system |
| Website and commercial operation | Largely missing | Login screen is not a marketing website; billing, support, trust, and acquisition flows are absent |

## 2. Scope, method, and evidence limits

Reviewed the current working tree on branch refactor/simplify-neighborwalk, based on commit 0fad092, including its substantial pre-existing uncommitted changes. This is an audit of what is on disk, not just the last commit or the deployed website.

Coverage included:

- Next application entry points, authentication gate, every primary view, map/property interactions, and shared UI.
- Domain schemas, migrations, seed data, local persistence, sync/merge code, person permissions, guides, geocoding, geometry, parcel loading/caching, and coverage calculations.
- All 18 Supabase migrations, including later policies that supersede earlier ones.
- Unit tests, package/configuration files, service worker/manifest, local sandbox tooling, parcel importer, and existing documentation/design proposals.
- Local production-build browser checks at desktop and 390 × 844 mobile dimensions, using the documented fictional sandbox.
- Focused executable domain/sync probes, a rolled-back local database authorization probe, and current dependency-advisory lookup.
- Primary-source market comparisons and provider terms, checked September 9, 2026.

Excluded third-party dependency source except where needed for diagnostics, generated build/worker artifacts, and container data. Existing documentation was treated as context, not proof of implementation.

I did not change production, deploy, contact churches/vendors, send invitations, purchase services, or implement fixes. Browser navigation used local test state; the database write-permission probe was rolled back. Audit documents are the only intended repository additions.

This is not a penetration-test certification, full accessibility conformance evaluation, real-device field trial, production restore drill, or legal opinion. Hosted configuration, production row limits, vendor agreements, backups, email deliverability, traffic, and customer behavior remain unverified.

### Verification results

| Check | Result |
| --- | --- |
| ESLint | Passed |
| TypeScript | Passed |
| Unit tests | 68 passed across 14 test files |
| Production build | Passed when rerun with the local execution permissions it needed |
| Initial restricted build attempt | Environment-related TypeScript configuration subprocess failure; not counted as an application defect |
| Production dependency audit | Four flagged packages: two critical, one high, one moderate; applicability discussed below |
| Local authenticated browser | Main views loaded; fictional people and work records were visible |
| Mobile layout sample | No page-wide overflow in the sampled view; typography and information hierarchy remain substantial usability concerns |
| Local map | MapTiler style request returned HTTP 403; cause not established and no claim made that production has the same failure |
| Install button | Reproduced unhandled TypeError when the install prompt was unavailable |

### Reproduced integrity and permission cases

| Case | Expected | Actual |
| --- | --- | --- |
| Retain a newly completed person task with no source visit | Recent task remains in history | Task removed by retention |
| Ordinary visit after a do-not-revisit record | Suppression remains until an explicit authorized correction | Current outcome becomes no-answer |
| Delete territory while another device adds a visit | Transfers and new visit both survive | Transfers survive; concurrent remote visit is lost |
| Delete group during a concurrent merge | All associated assignments cleared | A territory still refers to the deleted group |
| Ordinary volunteer directly updates shared snapshot | Cannot erase church-wide visit/location history | Database accepted removal of all visits, properties, and audit entries in the local transaction |

For the last case, the fictional workspace had 9 visits and 16 properties. Under the authenticated volunteer role, the update returned 0 visits and 0 properties. The transaction ended with ROLLBACK. This proves an intra-church authorization gap, not cross-church access or production exploitation.

## 3. What is worth keeping

There is substantial useful work here:

- Next.js, React, TypeScript, Supabase, IndexedDB, and MapLibre are a reasonable foundation. No evidence justifies changing frameworks.
- Zod-based domain validation and pure helpers make important behavior testable.
- Unit tests explicitly block accidental external network access.
- Production/local environment isolation is deliberate and useful.
- The map already dynamically imports MapLibre, has a same-origin worker arrangement, location search, territory drawing, parcel grouping, and useful geometry handling.
- Parcel data is deliberately limited to location/site information rather than importing property-owner profiles.
- People, person notes, and person follow-ups have been moved out of the broadly shared snapshot into protected database tables. This is the right direction.
- Invitations are hashed, expiring, single-use, and email-bound. Later migrations revoke client workspace creation; provisioning is intentionally controlled.
- Follow-ups already have dated lifecycle history, completion, cancellation, rescheduling, and subsequent-task support.
- Conversation guides support church/personal scope, favorites, and group defaults.
- The visual language is coherent, with responsive adaptations, focus styles, reduced-motion CSS, installation metadata, and social-preview assets.
- Existing review and production-checklist documents acknowledge that the app is a pilot.

The recommendation is an incremental product and reliability rebuild, not throwing everything away.

## 4. Release-blocking and high-priority technical findings

Severity here means product release priority, not a formal CVSS score. “Reproduced” means exercised locally; “source-confirmed” means directly evident in the code; “risk” means a credible failure path that needs targeted verification.

### B01 — Volunteers can rewrite ordinary church-wide history

**Blocker · reproduced.** [Role guard](../../supabase/migrations/20260816090000_add_member_invitations_and_role_guards.sql), [latest protected-person migration](../../supabase/migrations/20260829231758_protect_discipleship_people.sql), [initial snapshot policies](../../supabase/migrations/20260812233000_initial_neighborwalk.sql).

Active membership limits which church snapshot a user can access. The volunteer guard also protects leader-only top-level settings. However, the allowed ordinary-data keys include properties, visits, follow-ups, and audit. A volunteer may replace those arrays wholesale. UI restrictions on deleting locations/history do not constrain direct database requests.

Consequences: another volunteer's visits can be erased, outcomes forged, suppression removed, and the client-generated audit rewritten. Protected person tables do not repair the ordinary-record problem.

Required direction: authorized server-side domain operations, actor identity derived from authentication, row-level relationships and update rules, and append-only audit events. As containment, restrict dangerous snapshot transitions before the full migration. Do not “fix” this solely with disabled buttons.

### B02 — Do-not-revisit is an outcome, not a durable protection

**Blocker · reproduced and source-confirmed.** [Visit recording](../../lib/use-neighborwalk.ts), [retention and summaries](../../lib/domain.ts), the historical snapshot-merge side effects (retired during the rework), and [property drawer](../../components/PropertyDrawer.tsx).

The latest visit determines the current property outcome. A later ordinary visit can therefore supersede do-not-visit. The drawer warns about suppression but does not make it an independently enforced state. Bulk clearing removes the underlying records. Client-side task cancellation can only operate on tasks loaded for that user.

Separate durable “do not visit/contact” records from encounter outcomes. Define property, person, and channel scope; distinguish a declined conversation from a request never to return. Require an authorized, reasoned correction to lift suppression. Enforce it on the server, in offline reconciliation, imports, assignments, and contact actions. Preserve the minimum necessary suppression information when ordinary history expires, subject to an approved policy.

### B03 — Retention drops recently resolved standalone tasks

**Blocker · reproduced.** [enforceRetention](../../lib/domain.ts#L543), [load/replace behavior](../../lib/storage.ts#L198), [retention action](../../lib/use-neighborwalk.ts#L1102).

A task survives only if it is scheduled or its source visit survives. Completed or cancelled tasks without a source visit are removed regardless of how recently they were resolved. Standalone person follow-ups are a normal feature, so this is not just malformed data.

Automatic local retention and server persistence are also different mechanisms. Loading trimmed local data does not itself issue protected-row deletions, while a leader's explicit purge can. Records can disappear locally without having been purged centrally.

Use the task's own lifecycle dates for retention; define cancellation timestamps; run an auditable server retention process with deletion propagation. Decide policies separately for encounters, completed tasks, notes, archived people, suppression, and backups. Active people and their notes currently have no time-based expiry merely because a church retention setting exists.

### B04 — Administrative merges discard or orphan work

**Blocker · reproduced.** [Territory deletion](../../lib/use-neighborwalk.ts), [group deletion](../../lib/use-neighborwalk.ts), and the historical snapshot-merge implementation (retired during the rework).

Territory deletion queues both a territory mutation and a whole-data mutation. The latter returns the entire local workspace during a conflict merge, losing concurrent remote changes. This is different from losing the territory transfers themselves: those transfers are preserved by the wholesale replacement.

Group deletion queues only the group mutation, even though its local helper also clears territory and follow-up assignments. The merge does not reproduce all of those side effects.

Make deletion/reassignment atomic domain operations with explicit dependent changes, version checks, and conflict behavior. Replace destructive whole-workspace merging for ordinary administration. Archive territories by default so historical event context survives.

### B05 — “Sync now” does not refresh a clean device

**High · source-confirmed.** [runSync](../../lib/use-neighborwalk.ts#L1126), [retry effects](../../lib/use-neighborwalk.ts#L1223), [settings status](../../components/SettingsView.tsx).

With no pending local mutations, runSync returns success before fetching anything. There is no independent polling or realtime refresh path for the main workspace. Focus/visibility behavior primarily retries pending writes.

A volunteer who is only reading can remain stale while others are working. “Changes synchronized” can mean only “nothing to upload.”

Separate upload, download, and freshness status. Refresh on explicit sync, focus, reconnect, and a bounded foreground interval; realtime can accelerate invalidation but must not be the only recovery path. Show when remote data was last checked, not just when local writes completed.

### B06 — Sync is not transactional across its storage models

**Blocker for expansion · source-confirmed risks.** Historical direct protected writes and snapshot sync orchestration (both retired during the rework), plus the then-current pending-mutation caps.

Protected person/note/task writes happen before the snapshot revision-checked update. A later failure can leave only part of an operation committed. Protected record updates do not have the snapshot's optimistic revision check. Same-record edits can overwrite each other. Client queues are truncated to the last 2,000 entries, which can discard the only pending command for a distinct protected record or deletion.

There are helpful pieces—stable IDs, a single in-flight sync promise, deduplication in some paths, and retry backoff—but not a durable command protocol.

Move toward an IndexedDB outbox with immutable command IDs, authenticated transactional processing, server receipts, per-entity version/conflict rules, deletion tombstones, bounded retries, and actionable permanent-error states. Never silently truncate unsent work. Avoid promising that a disconnected device can immediately learn about revocation or another team's new visit.

### B07 — Local data is environment-scoped, not account/workspace-scoped

**Privacy blocker until resolved · source-confirmed risk, no cross-account exploit demonstrated.** [Primary cache](../../lib/storage.ts#L16), [connection and fallback paths](../../lib/use-neighborwalk.ts#L80), [sign-out gate](../../components/SupabaseGate.tsx#L65).

The main IndexedDB record uses a single “primary” key. Connection metadata checks the user ID, which is helpful, but the underlying data remains one shared environment-local document. Sign-out does not remove or lock that cached document. Offline fallback restores cached membership/role without a defined expiry.

Partition all protected caches, preferences, queues, and guide data by environment + user + church. Verify provenance before using cached records. Define shared-device sign-out, pending-change recovery, offline unlock duration, lost-device behavior, and role revocation. Never silently delete unsynced work as a privacy shortcut; offer a clear resolution path. Browser storage is not equivalent to an encrypted pastoral-care vault.

### B08 — Success feedback is not tied to durable valid saves

**High · source-confirmed.** [save queue](../../lib/use-neighborwalk.ts#L378), [person editor](../../components/PeopleView.tsx#L352), [app callbacks](../../app/NeighborWalkApp.tsx).

Many actions return an ID or no result immediately, including paths that decline to change state. Calling UI code closes forms or clears text without waiting for durable persistence. The person editor checks presence of a contact field but does not run complete email validation before inserting into state. Its email input is not being submitted through a native form-validation flow.

Zod validation during asynchronous persistence can reject the entire document after the UI already accepted the edit. Storage failures are mainly exposed in Settings, while other UI can continue saying changes are safe.

Return structured validation/persistence results. Validate before state mutation, preserve failed drafts, distinguish “saving,” “saved on this device,” “uploaded,” and “could not save,” and surface errors where the action happened.

### B09 — Relationships can diverge between people, tasks, and locations

**High · source-confirmed risk.** [Person updates](../../lib/use-neighborwalk.ts), [protected task rules](../../supabase/migrations/20260830023113_integrate_person_followups.sql), [location deletion](../../lib/use-neighborwalk.ts#L509).

A person can move to another property while existing tasks retain the old property ID. Protected task writes require their property to match the person, making later task updates fail. Property IDs in protected tables are text references to records inside JSON, not relational foreign keys. A volunteer's deletion check sees only the protected people available to that volunteer.

Use real relational constraints and deliberate move/merge/archive operations. A user lacking access to a person's identity should still be prevented from deleting a referenced location without being told who the hidden person is.

### B10 — Reads can silently return incomplete protected data

**High · source-confirmed, production threshold unverified.** Historical unpaginated discipleship loading (retired during the rework), [local API configuration](../../supabase/config.toml).

People, notes, and tasks are each fetched with an unpaginated select-all query. Supabase documents a default maximum of 1,000 returned rows; actual hosted configuration was not inspected. The local sandbox allows 12,000, so local testing can conceal a lower hosted limit. [Supabase query-limit documentation](https://supabase.com/docs/reference/python/select).

Implement paginated, deterministically ordered reads with completeness checks, incremental changes, and bounded field projections. Test above both configured row limits. A backup or “all people” view must never silently represent a partial read as complete.

### B11 — Backup/restore is not a complete, tenant-safe recovery system

**High · source-confirmed.** [export/import format](../../lib/storage.ts#L216), [import orchestration](../../lib/use-neighborwalk.ts#L1049), [creator enforcement](../../supabase/migrations/20260830164500_enforce_person_creator_ownership.sql).

The JSON export includes the app document, not the separately stored guide library, favorites, and group defaults. Import replaces local persistence before a connected-workspace compatibility review and queues a whole-data replacement. It lacks a tenant-identity preview, dependency reconciliation, and comprehensive dry run. New protected-person inserts enforce the importing user as creator/initial owner, so this is not a faithful historical-identity restore mechanism.

Treat portable export, same-church restore, and migration to a different church as different operations. Add manifest/version/counts, scope labels, private-data warnings, preflight validation, encrypted-storage guidance, a recoverable checkpoint, and a controlled server restore path. Verify every entity and setting after restoration.

### B12 — Corrupt or future local state can silently become sample data

**High · source-confirmed.** [loadNeighborWalkData](../../lib/storage.ts#L185).

Invalid stored data is copied under an “invalid_…” recovery key, then the primary record is replaced with fictional seed data. Preserving the original is good, but there is no equivalent visible quarantine/recovery workflow. A schema mismatch or corruption can therefore look like a reset or wrong workspace.

Show a recoverable “data needs repair/newer app” state. Do not replace a church's working cache with a demo. Keep demo data explicitly separate from live church setup.

### B13 — Dependency advisories require a deliberate patch pass

**Release gate · live advisory match; exploitation not demonstrated.** [Package manifest](../../package.json), [lockfile](../../package-lock.json).

The production dependency audit flagged:

| Installed package | Registry severity | Applicability and proposed action |
| --- | --- | --- |
| MapLibre GL 6.3.0 | Critical | Attribution sanitization issue affects versions through 6.4.0. This app adds an attribution control and consumes third-party styles, so the affected surface matters. Patch to a verified fixed version, regenerate workers, and retest map interactions. |
| Next.js 16.3.1 | Critical | Two advisories: Windows-hosted RCE and AVIF image-optimization RCE. The local audit host is Linux, so the Windows condition does not apply here. No next/image imports or custom remote image patterns were found; AVIF exploitability was not demonstrated. Upgrade the affected framework regardless. |
| sharp 0.35.3 | High | Transitive image-processing advisory; update through a compatible fixed dependency set and check the resolved lockfile. |
| baseline-browser-mapping 2.10.30 | Moderate | Invalid-input process termination; no user-controlled production call path established. Patch and record applicability. |

The maintainers identify MapLibre 6.4.1 and Next 16.3.3 as fixed versions for the cited issues; recheck versions when implementation starts. These are dependency findings, not proof that NeighborWalk has been compromised. [MapLibre advisory](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579), [Next Windows advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [Next AVIF advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4), [sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c).

Do not run a blind force-upgrade across the repository. Preserve the current baseline and verify authentication, service-worker updates, worker assets, maps, and production builds after a reviewed patch set.

### B14 — Production hardening and operational evidence are incomplete

**High · source-confirmed omissions; hosted settings unverified.** [Next configuration](../../next.config.ts), [scripture endpoint](../../app/api/scripture/route.ts), [production checklist](production-checklist.md).

The application configuration adds a sandbox CSP but returns no application-defined production security headers. Hosting may supply some headers; that was not verified. The scripture endpoint has input validation, a server-only key, and a timeout, but no application authentication or rate limiting.

Add an explicitly tested production security-header policy, API abuse controls, safe error reporting, redacted operational logs, dependency monitoring, and auth/email delivery checks. Add documented incident response, support escalation, backup restoration, and migration rollback/forward-repair procedures. Prefer narrowly scoped support access with audit; never unrestricted browsing of church notes.

No committed CI workflow or full browser/database permission suite was found. The existing sandbox verification is useful but does not substitute for adversarial role and two-device tests.

### B15 — Licensing needs to be a product requirement

**Commercial launch gate · provider terms verified; existing agreements unknown.**

The embedded ESV API's general terms specify non-commercial use and define that restriction broadly enough that a subscription product needs a licensing decision. They also restrict retained text and require attribution. Confirm an applicable agreement, use reference links, or select properly licensed content before selling or adding offline scripture packs. [Crossway API conditions](https://api.esv.org/).

MapTiler permits temporary personal end-user caching under its published terms but restricts bulk downloading/export usage absent additional agreement. A deliberate offline tile pack or printable map cannot be assumed permitted just because browser caching already works. Confirm the license for each planned map/offline/print capability. [MapTiler Cloud terms](https://www.maptiler.com/terms/cloud/).

Document parcel provenance, permitted use, update cadence, deletion/correction handling, and supported counties. Do not assume the current Tennessee ingestion work means nationwide address coverage.

## 5. Features that exist but are not integrated well

| ID | Existing pieces | What does not connect | Recommendation |
| --- | --- | --- | --- |
| I01 | Events, active event selector, event IDs on visits/teams/territories | No complete create/edit/close/repeat outing workflow. Switching events does not consistently reset territory/detail context. Mobile exposes less event control. | Reusable territories and teams; explicit outing lifecycle; event-scoped assignments and summaries |
| I02 | People database and location drawer | Every person requires a saved property; new people default to the first location. No first-person creation in an empty workspace. | Address-optional people, optional households, encounter source, deliberate location linking |
| I03 | Person owner and follow-up queue | A person's owner implicitly owns tasks, while location tasks are group-assigned/unassigned. No unified My/Team/unassigned queue or accepted handoff. | Named task accountability with leader backstop; ownership-transfer policy |
| I04 | People notes and task/visit history | “One clear history” shows notes, while encounters and task lifecycle remain elsewhere. Last-contact field is not maintained consistently. | Unified, permission-filtered activity timeline; derive last contact from qualifying events |
| I05 | Person sharing and role-based access | Creator retains access after reassignment; leaders also have access. “Private by default” does not fully explain that. | Explicit “Who can see this?” display and deliberate creator-access policy |
| I06 | Groups used for assignments, sharing, and guide defaults | Groups are event-bound despite reusable wording; deletion does not reconcile all sharing/default references. | Stable teams plus outing-specific membership/assignments; cleanup enforced centrally |
| I07 | Visit outcome, DNV warning, follow-up cancellation | A safety restriction is mixed with visit history and can be overwritten; private unseen tasks cannot be cancelled locally. | Durable suppression independent of outcomes; server-side enforcement |
| I08 | Church/personal guide library and offline app state | Connected guide reads/writes are not persisted into the same offline library path; fallback can resurrect a legacy guide. | One versioned library/cache contract; explicit offline-ready assigned guide |
| I09 | Guide coaching/reminder fields and several note kinds | Stored fields are hidden or not editable; note composer always creates a general note. | Either expose a simple useful control or deprecate after checking existing content |
| I10 | Follow-up dates and church timezone | Date creation/display largely uses device-local behavior, including fixed 5 p.m. conversions; timezone setting is not consistently applied. | Decide date-only vs timed tasks; use church timezone consistently and test DST/travel |
| I11 | Parcel-based coverage, dwelling counts, manual locations | A parcel is not necessarily one door; one touched dwelling can represent a touched parcel. Truncation metadata is not reflected in confidence. | Separate known doors, attempted doors, conversations, and incomplete denominator |
| I12 | PWA install and reminder controls | Install crashes without a prompt; notifications run only while app code is active, not a durable closed-app schedule. | Honest capability states, platform instructions, scheduled digests first, opt-in push later |
| I13 | Optimistic UI and sync indicators | Local save, upload completion, and remote freshness are conflated; small-screen status hides useful information. | Persistent, plain-language save/freshness indicator and recoverable queue details |
| I14 | Church profile in JSON plus relational church table | Profile edits update the snapshot, not all authoritative church metadata. | One canonical church profile with derived presentation state |
| I15 | Detailed SQL/OpenAPI design documents | Proposed normalized schema and API are not the deployed implementation; routes such as the proposed API do not exist. | Mark design-only clearly; replace with one approved architecture and generated/verified contracts |

Sources: [app shell](../../app/NeighborWalkApp.tsx), [main hook](../../lib/use-neighborwalk.ts), [people](../../components/PeopleView.tsx), [follow-ups](../../components/FollowUpsView.tsx), [guide library](../../lib/conversation-guides.ts), [coverage](../../lib/territory-coverage.ts), [parcel hook](../../lib/use-territory-parcels.ts), [future database design](../database/postgres.sql), [future API design](../api/openapi.yaml).

## 6. What churches actually need from the workflow

### Before an outing

A leader should be able to create or repeat an outing, choose its purpose and time, select a reusable area, assign volunteers in pairs/groups, choose an optional guide, review restrictions, and share a simple invitation.

The current app starts too far downstream: it assumes an event, territory, and collection of mapped locations already make sense. It has editing tools, but not a guided route to “we are ready for Saturday.”

Add a setup checklist, assignment preview, list-based door/address entry, printable address-only packets, and a readiness summary. “Download for this outing” must verify the actual records/guides needed—not imply that a handful of cached tiles is full offline preparation.

### During an outing

A volunteer should land on “My assignment,” not church-wide administration. The main action should take seconds:

- Select the next location or add an encounter without a home address.
- Record no answer, conversation, declined, inaccessible, or do-not-revisit.
- If a next step was requested, capture the minimum details and a responsible owner/due date.
- Save locally with clear confirmation; continue to the next item.

Keep the guide optional and available in context. Do not require a name, religious category, or relationship stage to record a conversation. Use named accounts for accountability, but explore a time-limited, invitation-bound field session for occasional volunteers; no anonymous access to church data.

Provide a map/list toggle. The list must remain usable without WebGL, a tile provider, or precision tapping. Simple assignment status can reduce duplicated effort; offline devices cannot guarantee live mutual exclusion, so show freshness and reconcile overlaps respectfully.

### After an outing

A leader needs a debrief queue: requested follow-ups with no owner, unaccepted handoffs, overdue work, unresolved sync problems, and a summary of encounters for that outing.

A volunteer needs “My next steps,” contact preferences, a short record of the last interaction, and one clear completion action. Finishing a task should leave durable history and optionally create the next task.

This is the repeat-use loop that can make a subscription worthwhile. A church that only uses a map on occasional Saturdays is a weaker customer than a church that relies on the app to keep promises during the following week.

## 7. UX, accessibility, and information architecture

The current design looks cohesive, but much of the operational text is exceptionally small. CSS includes 6–10px labels, metadata, notes, and controls; the sampled mobile Settings view had rendered 7–10px text. This is a practical problem outdoors and for volunteers with weaker vision, not merely aesthetic preference.

Recommended redesign:

- Use a readable field scale: typically 16px primary form/body text and 13–14px supporting text, with restrained dense desktop exceptions.
- Aim for 44–48px field-action targets as a usability target, while auditing actual WCAG requirements and exceptions separately.
- Use fewer simultaneous cards/filters on mobile. People should open to a directory or explicit selected deep link, not automatically hide the directory behind an arbitrary first profile.
- Adopt accessible dialogs with focus entry/trapping/restoration, Escape handling, unique labels, and appropriate background behavior. The shared Modal currently declares dialog semantics without managing that behavior.
- Add labels to icon-only/placeholder-only controls, reliable status announcements, and keyboard equivalents for map-dependent tasks.
- Test zoom, text enlargement, contrast, screen-reader flow, errors, keyboard navigation, reduced motion, daylight use, and smaller phones. Reduced-motion CSS alone does not handle map camera operations marked essential.
- Keep the current palette and character; spend less space on decorative statistics and more on the next action.

WCAG 2.2's AA pointer target criterion uses a 24px minimum with defined exceptions; the larger field targets above are a proposed product standard, not a claim that WCAG universally requires 44px. [W3C target-size explanation](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum).

### Proposed navigation

Mobile: **Today · Outreach · People · More**

- Today: personal follow-ups, upcoming assignment, important save/error state; leaders also see exceptions.
- Outreach: current/recent outings, map/list, assignments, start/resume/debrief.
- People: search, minimal profiles, relationship history, next steps.
- More: guides, help, account; leaders get team/workspace administration and reports.

Desktop can expose those administration/reporting destinations directly in a sidebar. Follow-ups remain a first-class route/view linked from Today and People, not buried or deleted.

Use real routes and stable record URLs. Browser Back, refresh, copied task links, and invitation redirects should work. The current single-route state-driven view switching is inadequate for reminders, customer support, and team handoffs. Keep map interaction client-side; do not impose a blanket server-rendering rewrite on offline field state.

## 8. Market positioning and what to compete on

The market is not empty. These are vendor-reported capabilities, not hands-on comparative test results:

| Alternative | What it already offers | Implication |
| --- | --- | --- |
| SWAPP | Territory mapping, assignment, mobile outreach records, follow-up workflows | “A church outreach map” is not a sufficient differentiator. [SWAPP outreach](https://swapp.church/features/outreach/) |
| BLESS | Church prayer/outreach tools plus paid mapping/new-mover/community capabilities | Church leaders can already find ministry-specific mapping products. [BLESS church tools](https://www.theblessapp.com/churchtools) |
| Planning Center People | Free people database, forms, workflows, communication tools, and mobile access | Avoid charging mainly for a weaker second contact database. [Planning Center People](https://www.planningcenter.com/people) |
| Prayer Walkr | Free prayer walking with teams and mapping | A prayer-walk-only pivot faces a credible free alternative. [Prayer Walkr](https://prayerwalkr.com/) |
| Spreadsheets, paper, and group messages | Flexible, familiar coordination with no new procurement | The app must save setup/debrief effort without making volunteers do more administration |

Proposed positioning: **“Help your church turn neighborhood conversations into personal follow-through.”**

Supporting promises to earn through testing:

- First outing can be organized without a technical administrator.
- A new volunteer can learn the field workflow in a few minutes.
- Work remains safe through a connectivity interruption.
- Every requested next step has a visible owner.
- Contact restrictions are respected and private notes stay appropriately restricted.
- Leaders can see what needs attention without ranking people's spirituality.

Start with one primary church segment and a few configurable ministry templates. Do not attempt to satisfy every denomination and every ministry structure with a workflow builder before finding repeat users.

Planning Center offers an API and integration ecosystem. Begin with a controlled CSV exchange; build an OAuth integration only after pilot churches identify a concrete transfer need. Import/export selected contacts and follow-up outcomes with explicit field ownership and opt-in sharing—not automatic bulk replication of prayer notes or faith labels. [Planning Center integrations](https://www.planningcenter.com/integrations), [developer documentation announcement](https://www.planningcenter.com/changelog/integrations-api/improved-developer-documentation-site).

## 9. Keep, cut, extend, add

“Cut” means remove from the first commercial experience or deprecate deliberately, not delete church data without migration and approval.

| Area | Decision | Rationale |
| --- | --- | --- |
| Map and territory tools | Keep, simplify field use | Useful context and differentiation when joined to assignments |
| Ordinary encounter logging | Extend | Make quick, trustworthy, event-scoped, and address-optional |
| Follow-ups | Make central | Strongest recurring church value |
| Minimal people profiles | Keep, remodel | Preserve relationship continuity without building a full CRM |
| Mandatory map/property association | Cut | Excludes meals, community events, visitors, referrals, and people without stable housing |
| Fixed faith labels and numbered relationship rail | Make optional; default off/collapsed | Sensitive, tradition-specific, not necessary to keep a promise |
| Guides | Keep as optional contextual resource | Helpful to new volunteers; does not need equal top-level prominence |
| Hidden coaching/reminder fields | Resolve or deprecate | Avoid content stored forever but never used |
| Whole-workspace replacement for routine edits | Replace | Unacceptable concurrent-write blast radius |
| “Clear sample or outreach data” in routine settings | Replace with separate demo/reset/archive workflows | Too easy to confuse practice reset with real-data destruction |
| “Private,” “safe,” and “offline-ready” claims without precise states | Rewrite | Marketing and UI must reflect proven guarantees |
| Parcel-heavy nationwide expansion | Defer | Data operations and licensing are not the initial customer outcome |
| Closed-app reminders | Add deliberately | Real retention mechanism; start with privacy-preserving digests |
| Event lifecycle and reusable assignments | Add now | Turns existing features into an outing |
| Search/list/print workflows | Add now | Works for nontechnical volunteers and map/provider failures |
| Church onboarding, website, help, support | Add before selling | These are core product functions, not launch decoration |
| Full giving/accounting/services/child check-in | Do not build | Different market and risk profile; complement the church's existing system |
| AI classification of neighbors or conversion likelihood | Do not build | Trust risk and distraction; no validated customer need |
| Native iOS/Android apps | Defer | First prove mobile-web field workflow and platform limits with real devices |

## 10. Additions worth testing beyond the current idea

These are experiments, not all approved development scope.

| Idea | Why it could matter | Smallest useful test | Stop/defer condition |
| --- | --- | --- | --- |
| Neighbor-request QR card | Lets the neighbor request prayer, information, a visit, or help on their own terms | One church-branded request form feeding an owner/due-date inbox, with abuse controls | Church cannot staff replies; requests add unowned work |
| Community encounter mode | Makes the same product useful at meals, service projects, and neighborhood events | Address-optional encounter + optional contact + next step | Pilot churches only need door visits and find extra modes confusing |
| Print-first volunteer packets | Allows participation without requiring everyone to master a phone | Address/assignment checklist with record IDs and later reconciliation; no private notes | Leaders do not use it or reconciliation doubles their work |
| Accepted handoffs | Prevents “I thought someone else was doing it” | Assign → accept/decline → leader backstop | Acceptance adds delay without reducing missed follow-ups |
| Simple service referral | Connects an expressed need with an approved ministry/service contact | Human-approved referral and follow-up status, not a clinical case-management system | Church expects crisis/medical/social-work obligations the product cannot support |
| Ministry templates | Serves different church traditions without hard-coded theology | A few leader-selected purpose/outcome/guide presets | Configuration becomes harder than the current workflow |
| Spanish field interface | May materially improve participation in the right pilot churches | Professionally reviewed core field labels and guide content | No bilingual design partner or translation maintenance capacity |
| Lightweight calendar export | Fits existing volunteer habits | Private personal due-date/event feed with safe titles | Privacy or stale-status confusion exceeds usefulness |

Do not add public prayer feeds, shared cross-church person databases, volunteer GPS surveillance, demographic scoring, children’s profiles, or automated outreach messaging by default. These change the trust and operational model and need separate justification.

## 11. Commercial website and church onboarding

The existing root page is an authentication gateway. Metadata, icons, and an attractive login card do not constitute a marketable website.

Proposed public pages:

- Home: buyer, problem, clear outcome, three-step workflow, real product images, demo/pilot invitation.
- How it works: leader preparation, volunteer field experience, follow-up loop.
- Use cases: begin with neighborhood outreach; add community events only if supported.
- Pricing/pilot: transparent church-level price or explicit design-partner offer; explain volunteer limits, support, cancellation, and data export.
- Trust/privacy: who sees what, provider categories, retention/export/deletion, shared-device cautions, and security contact. Publish only verified claims.
- Help/contact: quick-start guide, install instructions for actual supported platforms, offline limitations, and a human support route.
- Terms, privacy notice, content/provider attribution, and accessibility contact.

No invented testimonials, fabricated impact statistics, “works everywhere offline,” or app-store badges before native distribution exists.

Onboarding should produce a real first outing, not an empty dashboard:

1. Approved church workspace and leader account.
2. Church name/timezone and a small purpose/template choice.
3. First outing and one area/list.
4. Two volunteer invitations and one practice task.
5. Test-device preparation, optional guide, and a visible readiness check.
6. First outing debrief and next-step assignment.

Keep assisted provisioning during the design-partner stage. Self-service signup, trials, billing, workspace creation, abuse prevention, cancellation, and offboarding should be designed together later.

## 12. Engineering maintainability and scale

The largest risk is cross-domain coordination, not a shortage of abstraction.

- Split the roughly 1,325-line state hook into storage/outbox, workspace/bootstrap, domain-command, and guide modules behind explicit interfaces.
- Separate the app shell, routing, map workflow, and editors. Preserve pure domain helpers and type inference.
- Reformat dense JSX/CSS where it obscures intent. Avoid a cosmetic global rewrite competing with reliability work.
- Generate database types from applied migrations; hand-maintained table types with empty relationship metadata invite drift.
- Keep one authoritative schema/API description. The proposed SQL/OpenAPI documents must not be executed as though they represent the current system.
- Introduce bounded query hooks and per-record updates instead of persisting the entire workspace for every preference change.
- Load active/nearby territory parcels first; the current all-territory loading pattern and per-territory 12,000-feature response ceiling need measured limits and truncation warnings.
- Make duplicate address/unit detection, person merge, history-preserving moves, and archive behavior explicit.
- Add import fixtures for malformed geometries, missing source fields, duplicated parcel identities, upstream changes, and county refreshes. The importer reads substantial archives into memory; batching database writes does not make the input path streaming.
- Treat the hard-coded production/localhost separation as a safety feature to evolve into explicitly approved local/staging/production environments. Do not weaken it broadly to make preview deployments work.

Suggested initial scale fixtures—not measured capacity promises: 10,000 locations, 25,000 encounters, 2,500 people, 10,000 notes, 5,000 tasks, 50 simultaneous volunteers, and a substantial offline queue. Test lower-end phones and partial downloads. Adjust targets to pilot usage before optimizing speculative national scale.

## 13. Operating, privacy, and support model

Churches will entrust the product with contact details and potentially sensitive prayer or religious information. Good intentions and “church only” access do not eliminate the need for a deliberate policy.

Decisions to make before broader use:

- What is appropriate to store, and what should be explicitly discouraged?
- Are religious categories needed at all? Keep them optional, self-described, and excluded from analytics/integration by default.
- Who can view sensitive notes: all leaders, designated care leaders, owner, creator, named team members?
- Should a creator retain access forever after reassignment?
- How does a church respond to correction, access, no-contact, deletion, or lost-device requests?
- What is retained to honor no-contact while minimizing historical detail?
- What happens to a person's assigned work when a volunteer leaves?
- What support access is permitted and how is it approved/audited?
- What is the incident contact and recovery expectation?

The code intentionally removed its earlier in-app consent fields. Do not blindly restore that old flow. Approve a simple operational contact-permission/restriction model and have qualified counsel review notices and jurisdiction-specific obligations. The product should capture a neighbor's request and preferences without claiming that a checkbox resolves every legal issue.

Instrument service health without recording names, addresses, note bodies, prayer text, faith status, invite tokens, or session credentials in analytics. Aggregate operational metrics can answer whether the product works without measuring spiritual worth.

Useful metrics: church activated; first outing completed; requested follow-ups assigned within the agreed window; due tasks completed; unowned/overdue work; failed/local-only saves; sync lag; second-outing use; support burden; trial-to-paid conversion.

## 14. Final recommendation

Proceed, but change the center of gravity.

NeighborWalk should be a dependable way for a church to organize outreach and follow through with neighbors. The first commercial version should feel smaller and clearer to a volunteer even while the underlying permissions, data model, recovery, and operations become stronger.

The [approval plan](market-readiness-plan.md) defines the proposed target model, implementation packages, acceptance tests, migration safeguards, commercial experiments, and decisions that need your approval before work begins.
