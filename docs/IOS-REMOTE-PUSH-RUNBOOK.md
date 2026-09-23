# iOS remote push deployment runbook

The repository now contains the complete server-side APNs path. Nothing in
this runbook has been deployed. Apple signing material, the production bundle
identifier, Supabase project access, and the scheduler activation remain human
release steps.

## Delivery contract

The native app registers one opaque APNs token per installation with:

```ts
supabase.rpc("register_apns_device", {
  target_installation_id: "<lowercase UUID>",
  target_device_token: "<lowercase hexadecimal APNs token>",
  target_environment: "sandbox" | "production",
})
```

The call requires a non-anonymous, non-expired Supabase Auth session and an
active church membership. It returns `device_id` and `registered_at`. A new
session or refreshed APNs token should call the same RPC again. The server
atomically moves a token between accounts/installations and cancels queued work
for the previous binding.

Before sign-out, call:

```ts
supabase.rpc("unregister_apns_device", {
  target_installation_id: "<same UUID>",
})
```

It returns `true` when the caller's device existed, otherwise `false`. Server
delivery also validates the bound `auth.sessions` row and account status, so a
missed sign-out callback, revoked session, deleted/banned account, or inactive
church membership cannot keep receiving notifications.

Walk invitations and follow-ups assigned/reassigned by someone else enqueue one
row per active device; self-created follow-ups do not generate a redundant
assignment alert. Reassignment, decline, cancellation, logical deletion, physical
deletion, or membership removal invalidates open rows, including active leases.
Event/source identifiers are one-way hashes. The queue has no neighbor name,
address, church name, notes, meeting point, or other ministry content.

The APNs JSON is limited to fixed generic copy and fixed routing metadata:

```json
{
  "aps": {
    "alert": {
      "title": "Walk invitation",
      "body": "You have a new walk invitation in NeighborWalk."
    },
    "sound": "default"
  },
  "source": "neighborwalk-remote-push-v1",
  "path": "/app/outreach/<opaque-id>"
}
```

Follow-ups use `New follow-up`, `A follow-up was assigned to you in
NeighborWalk.`, and `/app/followups/<opaque-id>`. Both the database and Edge
Function reject other copy or paths. APNs IDs and collapse IDs remain stable
across retries. Invalid/410 tokens are retired, transient responses use bounded
backoff, stale acknowledgements are rejected, and network requests have an
eight-second timeout. Failed/delivered outbox rows and inactive tokens are kept
for at most 30 days, then removed by the worker.

## Human setup

1. In Apple Developer, enable Push Notifications for the production App ID and
   create an APNs token-signing key. Record its Key ID and Team ID; download the
   `.p8` file once and store it in the organization's secret manager. Confirm
   `APNS_TOPIC` exactly matches the signed iOS bundle identifier.
2. Confirm the Xcode target has the Push Notifications entitlement and the
   release provisioning profile includes it. Development builds use APNs
   `sandbox`; TestFlight/App Store builds use `production`.
3. Link the intended Supabase project, inspect the migration plan, and apply
   `20260922024213_add_apns_push_delivery.sql` through the normal release
   pipeline. Do not paste or execute it in an unrelated project.
4. Create an ignored `.env.push.local` on the release operator's machine. Copy
   only the base64 body between the `.p8` PEM header/footer into
   `APNS_PRIVATE_KEY_PKCS8_BASE64`—do not base64-encode the PEM text itself.

```dotenv
APNS_TEAM_ID=ABCDEFGHIJ
APNS_KEY_ID=KLMNOPQRST
APNS_PRIVATE_KEY_PKCS8_BASE64=<base64 DER body from AuthKey_*.p8>
APNS_TOPIC=<production bundle identifier>
PUSH_WORKER_SECRET=<at least 32 cryptographically random characters>
```

5. Set secrets and deploy the function. `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` are supplied by the Edge Function environment;
   never put either the service-role value or APNs private key in the app,
   `NEXT_PUBLIC_*`, logs, source control, or scheduler SQL.

```sh
node_modules/.bin/supabase secrets set --env-file .env.push.local
node_modules/.bin/supabase functions deploy push-delivery --no-verify-jwt
```

JWT verification is disabled only at the gateway because this is a server
worker, not a user endpoint. The function itself accepts only `POST` with
`Authorization: Bearer <PUSH_WORKER_SECRET>`, while its database worker RPCs
are executable only by `service_role`.

6. Enable Supabase Cron and `pg_net`, save the same worker secret in Supabase
   Vault, and schedule a server-side `POST` to
   `https://<project-ref>.supabase.co/functions/v1/push-delivery` every minute.
   Build the Authorization header from `vault.decrypted_secrets` at execution
   time. Do not embed the secret literal in the cron command. See the current
   [Supabase scheduled Edge Function guide](https://supabase.com/docs/guides/functions/schedule-functions)
   and [Vault guide](https://supabase.com/docs/guides/database/vault).
7. Invoke the function once with an empty queue and confirm HTTP 200. Then use
   two internal test accounts and physical iPhones to verify sandbox and
   production independently: new invitation, initial follow-up assignment,
   reassignment, decline/cancel before delivery, notification tap navigation,
   sign-out/session revocation, and APNs-token rotation. Never use real neighbor
   details in release validation.
8. Restore the approved public production values in ignored
   `mobile/.env.production.local`, including:

```dotenv
NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED=true
NEXT_PUBLIC_APNS_ENVIRONMENT=production
```

   Run `npm run ios:release:prepare`. That command and the Xcode Release build
   phase reject a sample bundle or one that does not declare production APNs.
   Development-signed device builds use `sandbox`; TestFlight and App Store
   builds use `production`. No APNs key or worker secret belongs in this file.

Apple's provider API requirements are documented in
[Sending notification requests to APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)
and [Establishing a token-based connection to APNs](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns).

## Verification and operations

Run before deployment:

```sh
node scripts/rehearse-migration.mjs
npx vitest run tests/apns-delivery.test.ts
node_modules/.bin/supabase db advisors --local
npm run typecheck
```

The migration rehearsal uses an isolated loopback database and rolls back all
fixtures. It covers real Auth session binding, anonymous/revoked access,
cross-account unregister, reassignment/decline/cancel/delete invalidation,
lease races, membership removal, token rejection, retention, generic payloads,
and migration preservation.

Operational dashboards should expose counts only—never token values or app
paths. Alert on old ready rows, exhausted failures, and a sustained backlog:

```sql
select status,event_kind,count(*)
from private.apns_outbox
group by status,event_kind
order by status,event_kind;

select count(*) as ready_older_than_five_minutes
from private.apns_outbox
where status in ('pending','retry') and available_at<now()-interval '5 minutes';
```

Rotate `PUSH_WORKER_SECRET` in both Edge secrets and Vault together. Rotate the
Apple `.p8` key by deploying the new Key ID/key secret first, validating a
physical-device delivery, then revoking the old key in Apple Developer.

Include the APNs token and opaque installation identifier in the App Store
privacy-label review as linked app-functionality data. Notification copy must
remain generic; APNs delivery is at-least-once and cannot be guaranteed.
