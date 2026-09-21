# Current production architecture

This describes the church-readiness application/schema pair deployed from `main`. PR #2 released the rework and PR #3 released the prior-visit planner overlay at merge commit `14b117485bd8c100f743bbf495d8bf99bb679a88`. The Vercel deployment completed successfully, and read-only production checks confirm contracts from the latest checked-in schema. The [execution ledger](rework-progress.md) records the evidence and the [release gates](production-checklist.md) distinguish this technical deployment from approval for wider enrollment.

The separate `codex/neighborwalk-ios` branch at `5046a8a30528747f7b7706bbdf7b4dcf5eb15974` adds a bundled Capacitor/Xcode client that reuses the workspace/domain layer and shared Supabase backend. It is an implemented development checkpoint, not a deployed App Store client. Its two additional migrations, provider/link configuration and deletion operations are not active in production.

## Authoritative contracts

| Boundary | Current source / behavior |
| --- | --- |
| Schema, grants, RLS, migrations | `supabase/migrations/`; additive normalized records preserve legacy snapshots/history |
| Typed database interface | `lib/database.types.ts`, generated from the applied local schema |
| Interactive identity | Supabase Auth plus matching live session and active membership; shared private guards, no creator bypass after membership ends |
| Workspace read | `outreach_workspace_info` + `outreach_read_records`; fourteen permitted collections, account/revision checks and complete bounded keyset reads |
| Field writes | `outreach_apply_command`; server-derived actor, tenant/relationship/version checks, atomic transaction and original receipt |
| Reviewed administration | `outreach_admin_action` and `outreach_update_member`; bounded reviewed requests, role/recent-authentication checks where required, retained audits |
| Guide library | `outreach_guide_state` + `outreach_guide_action`; versioned coherent reads, immutable request journal, safe archives and private-owner controls |
| Reminders | Self-only `outreach_reminder_preference`; restricted worker plus `/api/reminders/*` routes; provider activation remains gated |
| Browser persistence | Account/church/environment-scoped IndexedDB, immutable outbox, a single live writer per account/browser profile, preserved reviewed originals |
| Offline app shell | Build-pinned anonymous assets; no protected API responses, auth secrets or map imagery in the service-worker cache |
| Native iOS checkpoint | Bundled React workspace in Capacitor/Xcode; shared domain/Supabase contracts, native auth/link/share/print integrations; independent signing/TestFlight/App Store release path |

The migration SQL is authoritative for exact request fields, permissions and error conditions; clients and database suites exercise those contracts. The RPC inventory above is a map, not an alternative manually maintained API schema. The old SQL/OpenAPI design proposals in `docs/database/` and `docs/api/` use a different identity model and fictional REST routes. They are marked archived and must not be executed or used to generate a production client.

## Domain and synchronization

Church settings, reusable groups/areas, outings/assignments, locations, encounters, tasks/activity, restrictions, audit and migration issues are relational. Existing protected people and notes retain their visibility boundary. Tasks can link to a person, place, encounter and outing without requiring all of them. Date-only tasks use the church calendar. Derived displays do not authorize mutations or rewrite original encounter facts.

A field action validates its draft, persists the immutable command with device state, then reports device-save success. Connected submission checks server versions and permissions in one transaction. A matching receipt settles only that command; conflicts stay held for reviewed recovery. A lost response is retried with the original ID, not a new create. The complete remote read is reconciled with still-pending device work. Local save, shared confirmation and preparation freshness are distinct states.

Guide and reviewed-administration journals are separate from fieldwork but remain scoped to the same author/church. Their operations require a connection; they are not silently simulated as demo edits when connectivity fails. Guide archives, duplicate aliases and reviewed corrections preserve original records. None constitutes permanent erasure or automatic undo.

## Deliberate boundaries and outstanding work

- The main hook still coordinates several domains; continue extracting cohesive modules when it reduces risk, not with a cosmetic rewrite during release hardening.
- Large complete downloads have explicit safety limits; production-shaped mixed-entity/concurrent-user and lower-end phone performance remain unverified.
- Historical guide editions, supervised permanent erasure/offboarding and first-church/verified-first-leader operational provisioning are not completed features.
- Actual supported phones, service-worker build transitions with pending devices, accessibility/printing, monitored production delivery and recovery need release-specific evidence.
- The iOS source exists, but signed physical-device authentication/invitations, its two additive migrations, hosted invitation handoff, deletion fulfillment, TestFlight and App Review remain open. Keep future backend changes compatible with both web and installed iOS clients.
- Local, staging and production must stay isolated. The latest schema is present in production, but the historical hosted migration ledger still needs operator-authenticated reconciliation with the repository before the next schema change. Verify it against a fresh private production restore; never solve a history difference with a blind reset, duplicate schema application or preview-to-production connection.
