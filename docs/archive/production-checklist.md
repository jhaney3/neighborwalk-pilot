# NeighborWalk release gates

> Historical record. For the current iOS release status and requirements, see the [iOS release guide](../ios-release.md).

At the time of this checklist, the church-readiness rework was not a production-approved release. It superseded an earlier connected-pilot checklist. [Rework progress](rework-progress.md) records the associated commits and test evidence; this archived checklist does not establish today's deployment state.

## Deployment recorded at the time

The pre-rework changes were pushed first and deployed at commit `d94d17c6a24075e6cc657759b676dba988789a97`. Vercel deployment `dpl_C4sMrQ52ewYiZdrAyMF3YCc9qjho` was verified READY. The rework lives on `rework/church-ready-neighborwalk`. No rework production database migration or rework production deployment has been performed.

## Gate 1 — preserve and rehearse the live church

- [ ] Obtain the existing production database credential through a private operator-owned configuration file. Never paste it into chat, code, app environment variables or shell arguments. Do not reset it incidentally.
- [ ] Capture a fresh encrypted application-database bundle and verify an isolated restore using [database recovery](../database-recovery.md). The earlier partial preserved production export excludes 66,252 reference parcels and is not a complete backup.
- [ ] Verify managed recovery/PITR, off-site copies, separate key custody, root/provider secrets, storage objects, recovery time and acceptable data-loss window. A logical database bundle does not cover every hosted setting.
- [ ] Reconcile the hosted project's historical migrations with the repository. Rehearse the exact additive sequence and field/relationship reconciliation against the fresh copy; do not blindly push or relabel migrations.
- [ ] Collect/reconcile pending work on existing devices. A server backup cannot preserve unsent phone-only changes. Preserve originals before retiring the legacy writer.
- [ ] Validate staged foreign keys and a production-shaped scale fixture, permission boundaries and restore workflows on the exact candidate.
- [ ] Use isolated staging with its own approved database/configuration. Never point a preview deployment at production to bypass the environment guard.

Implemented foundations include normalized tenant-scoped commands, immutable outbox/receipts, complete keyset reads for the core workspace, version conflicts held for review, accepted handoffs, independent restrictions, audited administration/moves/duplicates/corrections, and local preservation/recovery drills. These are not evidence that a live cutover has happened.

## Gate 2 — operator, policies and commercial hosting

- [ ] Approve the legal operator name, jurisdiction, support email, response commitment and escalation owner.
- [ ] Approve privacy/terms, church/operator responsibilities, permitted information, retention/erasure and backup exceptions, safeguarding, access reviews, correction requests and incident response with appropriate advice.
- [ ] Select commercial-compatible hosting. The currently inspected Vercel team is Hobby; its [noncommercial restriction](https://vercel.com/docs/plans/hobby) must be resolved by an owner-approved hosting/billing decision.
- [ ] Replace policy drafts with actually approved content. Do not merely enable an approval flag around unchanged draft text.
- [ ] Verify supported geography, parcel provenance/update terms and map-provider origin/key/attribution. The configured public key's style request returned 403 with the local origin and 200 with production-origin headers; this is not a complete live map/tile/geocoder or licensing verification. Manual address/list use works independently; do not market national parcel coverage.

Public enrollment stays closed until these gates are met. Do not claim legal compliance, guaranteed deliverability, validated prices, testimonials or pilot results that do not exist.

## Gate 3 — authentication, delivery and operations

- [ ] Verify production Site URL, exact redirects, invitation fragment handling, account recovery and every offered sign-in provider using separate authorized accounts.
- [ ] Configure trusted production auth SMTP and verify actual invitation/recovery delivery. Test expired, wrong-account and suspended-membership paths; neither an SDK success nor a local mail inbox proves production delivery.
- [ ] Activate opt-in reminders only after the provider/domain, signed webhooks, scheduler, opt-out, retry/unknown outcomes and monitoring pass [email reminder activation](../email-reminders.md). No real reminder provider or scheduler has been activated by the rework.
- [ ] Configure redacted error/availability monitoring, delivery failures, backup-age alerts, restore-drill scheduling and an operator escalation route. Never log care notes, neighbor details, authorization headers, invitation fragments or raw provider bodies.
- [ ] Rehearse first-church/first-leader provisioning, access removal, lost-device response, offboarding, privacy requests and recovery with named operators. No broad uploaded-JSON overwrite is available.
- [ ] Verify platform/runtime settings on the exact release, including Node version, security headers, dependency checks, production secrets and deployment rollback/forward-repair procedure.

## Gate 4 — real field usability and failure handling

- [ ] Run lint, types, unit tests, all database suites, browser regressions and advisors on the exact release commit. Record hosted CI, deployment and schema checkpoints.
- [ ] Complete [browser readiness](browser-readiness.md) on actual supported iPhones and Android phones: installation, cold offline reopen, 100 saved encounters, screen lock, reconnection, auth expiry/revocation and account switching.
- [ ] Verify build updates with pending work and multiple clients, storage eviction/quota failures, held conflicts and concurrent archive/handoff/restriction changes. Deterministic browser network simulations are not physical-device airplane-mode tests.
- [ ] Test keyboard navigation, focus return, screen readers, 200% text enlargement, reduced motion, narrow layouts, form errors, denied location access and real printing.
- [ ] Verify the transactional guide API, coherent bounded reads and retained retry/cache behavior on the exact application/schema release. Resolve remaining integration/scale gaps in the execution ledger. Outings currently reference current guide text, not immutable historical editions; do not promise edition pinning.
- [ ] Have representative nontechnical volunteers complete preparation → encounter → owned next step → handoff/completion without coaching from the implementer.

The offline promise is prepared app assets, permitted cached records/tasks and saved guide text, with a bounded previously verified account. It is not offline sign-in, indefinite authorization, licensed map-region downloads, automatic background synchronization or guaranteed closed-app push. Scripture is reference-only; the old endpoint returns 410 without contacting a provider. Printing uses address lists, not unlicensed map imagery.

## Gate 5 — controlled commercial pilot and release decision

- [ ] Agree the initial buyer, assisted onboarding process, scope, success measures and actual price hypothesis with design partners.
- [ ] Recruit 3–5 churches through owner-approved outreach; complete repeated outings and follow-up cycles over the audit's proposed 4–6 week observation period.
- [ ] Collect consented, content-free usability/reliability/support and willingness-to-pay evidence. Activity counts are not spiritual scores or measures of a neighbor's value.
- [ ] Resolve safety/data blockers before widening access. Keep growth experiments (full ChMS integration, bulk SMS, native apps, extra geography) out of the launch scope unless evidence justifies them.
- [ ] Record explicit operator release approval, support coverage, recovery checkpoints, policy versions and truthful website claims. Then deploy the exact approved application/schema pair and verify production end to end.

Real church adoption, legal review, billing/provider authority and physical-device evidence cannot be manufactured by code or automated tests. None of these boxes is checked merely because its runbook exists.
