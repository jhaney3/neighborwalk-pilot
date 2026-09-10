# Session revocation and device work

Connected access requires an active church membership and a non-anonymous access token whose `session_id` still belongs to that user in `auth.sessions`. A deleted session, a passed `not_after` limit, or a missing/malformed/mismatched session ID fails closed. The private helper uses a pinned empty search path and does not expose the authentication table. Existing role, person-sharing and recent-leader-authentication checks remain in force.

This closes the normal JWT interval between sign-out and token expiry. Supabase documents why a still-signed token alone does not prove that its session remains live: [user sessions](https://supabase.com/docs/guides/auth/sessions). It is not a replacement for token signature/expiry verification by the API or provider-enforced session settings.

Historical church creation no longer grants settings access after membership ends. A revoked session cannot read its membership row through the old self-read shortcut. These authorization changes preserve the rows and historical attribution; they do not delete a person, note, task or original encounter.

## What happens on a device

- A confirmed permission denial during sync locks the visible workspace and invalidates its prepared offline window. Queued commands remain scoped to their original author and church, unchanged.
- A fresh sign-in by the same still-authorized account can reopen and submit that work using its original command IDs. Signing in as a different account does not adopt, display or submit the previous account's queue—even if the new account is a leader of the same church.
- Sign-out uses the current session only; it does not globally sign out every other device. A church membership suspension, by contrast, prevents that account's connected church access across devices.
- An already open offline workspace checks its 24-hour membership window periodically and on focus. Expiry hides records without erasing unsent work. Reconnection and a successful membership check are required to resume.

## Boundaries operators must understand

An offline device cannot learn of remote revocation until it reconnects. Prepared access therefore remains bounded by its prior check, not instant remote wiping. The window uses the device clock, not tamper-resistant hardware. Someone controlling the browser profile can inspect its stored records; OS/device encryption, access control and safe download handling remain necessary.

Deleting a session is not an account deletion, data-erasure request, or automatic cancellation of responsibilities. Reminder workers use their independent service-only membership/recipient checks and are not dependent on a recipient having an open interactive login. Email opt-out and membership suspension retain their separate effects.

Managed session timeout/single-session settings may be enforced at refresh or cleaned up asynchronously by Supabase. This helper verifies current session presence and `not_after`; do not advertise guarantees stronger than the configured provider behavior. There is no client-supplied bypass or test exception in the production function.

## Verification

`tests/session-revocation.sql` is rollback-only and runs against fixed loopback targets. It covers valid/replayed commands, malformed and mismatched claims, anonymous/expired/revoked sessions, direct-table and RPC denials, suspended-creator access, helper privileges and preserved records. The seven previous permission/workflow suites now use explicit fictional live sessions.

The isolated browser test revokes exactly one generated local session while its token is unexpired. It verifies another device remains authorized, zero writes from the revoked device, a retained queue, denied offline reopen, same-browser account isolation and exactly-once recovery after the original account signs in again. A separate clock-controlled test covers an already-open workspace passing the 24-hour limit. These are local Chromium results, not physical phone or production-provider certification.
