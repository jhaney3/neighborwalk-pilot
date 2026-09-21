# Opt-in next-step reminders

The reminder code and database support are deployed; **production sending and scheduling are not enabled or verified**. As of September 19, 2026, `/api/reminders/status` returns `available: false`. This is operational follow-up for consenting church members, not bulk neighbor messaging or marketing email.

## Product contract

- Nobody is enrolled by migration or by a leader. An active member opts in for their own church membership and verified account email in Settings. A changed email requires renewed consent.
- At most one job per membership and church-local calendar date. A run queues work during 09:00–17:59 in the church timezone, for owned scheduled tasks that are due or awaiting acceptance. Declined, completed, cancelled, inaccessible and contact-restricted tasks are excluded. Eligibility, membership, verified address and consent are checked again before sending.
- The message has a generic subject and protected own-work link. It does not include neighbor names, care notes, addresses, prayer details, church names, task counts or tracking pixels. No open/click events are retained. The email provider necessarily receives the consenting member's recipient address.
- Timing and arrival are not guaranteed. An in-flight message can arrive after a task changes or the member opts out. The signed-in app remains the source of current responsibility. This is not an emergency channel.
- The former open-page browser Notification feature is retired. Its old stored preference is preserved but no longer sends alerts. It did not provide dependable closed-app reminders.

## Safety and failure behavior

The private database tables are not readable/writable by browser roles. Own preference RPCs have live membership checks. The worker RPC is executable only by the service role and has a closed action set. The server-only service key cannot enter a browser bundle; local/preview configuration cannot point to the production Supabase host.

The worker claims at most ten jobs with five-minute exclusive leases and sends at most five concurrently. The endpoint uses an exact secret-bearing Authorization header and bounded database/provider requests. Duplicate cron invocations cannot claim the same live lease. No browser-facing general-purpose email endpoint exists.

Before a send, the exact envelope is persisted. A retry reuses that envelope and the same job-derived idempotency key, including after a lost provider response or a server crash before acknowledgement. [Resend retains idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys); automatic attempts stop conservatively at 23 hours or six attempts. Uncertain results are marked **unknown**, not delivered. The same local day does not create a replacement job with a fresh key. An operator must investigate uncertainty, not manually resend with another key.

Provider acceptance and delivery are separate states. Raw-body signed webhooks use the maintained provider verifier and timestamp window. Only event ID, provider message ID, type and timestamps are retained. An opaque job tag correlates a verified event even before the send response is acknowledged, so a lost response does not delay suppression. Unrelated provider messages are ignored. Duplicate events are idempotent; a late delivered event cannot override a bounce or complaint. Bounces/complaints suppress future reminder delivery to that user's same consented address. A member cannot clear the suppression for the same address from the browser.

Signed unsubscribe links reveal no member/church identifier beyond an opaque preference UUID. GET displays a confirmation without changing preferences, avoiding link-scanner opt-outs. POST supports the email one-click header and disables only that preference. The link remains useful even when new sending is disabled, provided database access and signing keys are retained. Do not log token-bearing URLs or request bodies in application telemetry.

## Owner-approved activation checklist

1. Approve commercial-compatible hosting, the operator/support identity, data handling and the email provider. Do not treat setting an approval environment flag as obtaining real policy/legal approval.
2. Confirm the deployed application/schema checkpoint, then complete the fresh backup, hosted-history reconciliation and authenticated production checks in [the release gates](production-checklist.md). The additive reminder migration enrolls no one and does not send email by itself.
3. Configure a verified sending domain with the provider's requested DNS records, a domain-scoped sending API key, a monitored sender/support address and appropriate provider retention/access. Use production-scoped server secrets only. Review sending quotas and [current provider limits](https://resend.com/docs/api-reference/rate-limit). A shared provider team may also have other senders; 429 errors are safely deferred, not bypassed.
4. Set `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `REMINDER_FROM_EMAIL`, `CRON_SECRET`, and independent `REMINDER_UNSUBSCRIBE_SECRET` (random, at least 32 characters). Set the canonical HTTPS `NEXT_PUBLIC_SITE_URL`, operator/support details and approved-policy flag. Do not export any of these secrets through a `NEXT_PUBLIC_` name.
5. Configure the signed webhook at `/api/reminders/webhook` for `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, and `email.suppressed`. Disable open/click tracking. Verify signed test events, invalid signature rejection, duplicate replay and storage-failure retry behavior.
6. With an explicitly consenting operator test account and fictional tasks, verify the actual mailbox, protected link, GET confirmation, one-click POST, bounce suppression, verified email change and local-day eligibility. Record evidence without message contents or recipient addresses in ordinary logs. Do not contact existing volunteers as an inferred test.
7. Only after verification set `NEIGHBORWALK_EMAIL_VERIFIED=true` and `NEIGHBORWALK_REMINDERS_ENABLED=true`. Settings exposes availability only when required configuration and policy gates are satisfied. These flags record an operator decision; they do not automatically verify DNS, delivery or a scheduler.
8. Configure an approved scheduler to invoke `GET /api/reminders/run` with `Authorization: Bearer <CRON_SECRET>`, initially hourly. Monitor capacity: ten processed jobs per invocation is a deliberate small-pilot bound; increase invocation frequency only after measuring queue age, quotas and cost. For example, an approved commercial Vercel plan can use `{"crons":[{"path":"/api/reminders/run","schedule":"0 * * * *"}]}` in `vercel.json`. **No active cron configuration is committed:** [Hobby permits only daily invocations](https://vercel.com/docs/cron-jobs/usage-and-pricing), and the existing team still requires a commercial-hosting decision.
9. Watch aggregate `accepted`, `delivered`, `retry`, `unknown`, `failed`, and suppression counts and oldest pending age; investigate a missed invocation or growing queue before enrolling more churches. Do not log recipient envelopes, provider error bodies, tokens or care data. Configure alerts through the approved operations channel; that external monitoring is not yet connected.

To pause, set `NEIGHBORWALK_REMINDERS_ENABLED=false` and pause the scheduler. Keep webhook and unsubscribe configuration available. Do not delete pending jobs or rotate idempotency keys to force a retry. Before rotating unsubscribe secrets, retain the prior secret in `REMINDER_UNSUBSCRIBE_PREVIOUS_SECRET`; retain support for older links or explicitly plan a longer key ring before another rotation.

Reminder payloads/recipient metadata require a reviewed retention/offboarding policy and inclusion in operational backups. This implementation does not silently erase them or claim the church's normal record export is a full infrastructure backup.

## Verification

`npm run test` includes template/privacy, configuration isolation, stable resend identity, provider failure classification, raw webhook signature/timestamp validation, token rotation, bounded bodies and route authorization tests. Unit tests block all real network traffic.

`npm run test:database` includes `tests/reminder-readiness.sql`: fictional records, rollback-only, hard-coded loopback connection. It covers default off, own/tenant/worker permissions, verified-email consent, exclusive leases, immutable payload retries, out-of-order duplicate webhook suppression, revoked membership, expired retry window, unsubscribe during a lease, declined/future/completed tasks and pending acceptance.

Actual production mailbox delivery, DNS, scheduler execution, provider quotas and operator monitoring remain launch gates, not simulated test results.
