# Account deletion operations

Jacob Haney is the SendMe deletion operator. The public request/support address
is `jacobbhaney@icloud.com`. The in-app process states a 30-day completion
deadline and email confirmation. The user has accepted personal responsibility
for handling requests. Read [the release guide](ios-release.md) for the current
activation and rehearsal status; this procedure alone is not evidence of a
completed deletion.

## Review the queue

Check the queue each working day and before a planned absence. In-app requests
are stored in a private database table; they do **not** currently send an email
alert to the operator. Do not rely on the support inbox to discover them.

After `npx supabase login`, run from this checkout:

```sh
npx supabase db query --linked --project-ref llhrbtlkcneldgrhkwpf --file scripts/sql/account-deletion-queue.sql --output json
```

This uses the authenticated Supabase Management API, without a database
password. It reads request references, deadlines and Apple revocation dates,
not names or personal content. The same SQL can be run in the project's SQL
Editor. A successful empty result means no pending requests at that moment.

For one request, run this read-only SQL in the same project's SQL Editor,
replacing the placeholder with the request UUID from the queue:

```sql
select private.account_deletion_inventory('REQUEST_UUID'::uuid);
```

The inventory discovers foreign-key references. It does not find every name,
email address, UUID in JSON/arrays, free-text mention or independently exported
copy. Do not publish its output or include personal records in ordinary email.

## Process a request

1. Match the in-app receipt to the authenticated account using the private
   queue and Auth Users. An unauthenticated email is a request for assistance,
   not sufficient authority to erase someone else's account. Do not ask for a
   password or sign-in code. Securely record the verified completion address
   before deleting Auth, including an Apple relay address where applicable.
2. Record the receipt, deadline, affected churches and the smallest necessary
   processing checklist in operator-controlled storage outside the repository.
   Resolve last-leader ownership and ongoing responsibilities with the church
   without disclosing unrelated private notes. Do not postpone the request
   indefinitely because it belongs to the last leader.
3. Review the inventory and associated personal data: membership, assignments,
   encounters and notes, guides, recipient-addressed invitations, reminder and
   push records, snapshots, audit/history, migration receipts, UUID arrays,
   storage and offline/exported copies. Erase or irreversibly de-identify the
   requester's associated personal data, including their shared personal
   content. Retain unrelated church records only after verifying they contain
   no personal data belonging to the requester. Archiving is not erasure.
4. Prepare an exact, account-scoped erasure plan and rehearse it against an
   isolated copy with fictional data first. Several current foreign keys use
   RESTRICT/NO ACTION; simply pressing Delete User can fail or leave other
   stored personal data. Do not disable constraints, replace the user UUID
   with another person's identity, or bulk-delete an entire church as a shortcut.
5. For an Apple identity, verify successful authorization revocation and that
   no later Apple authorization has occurred. The deployed function's receipt
   records a successful earlier revocation, not a guarantee about future
   sign-ins. Complete any required reauthorization/revocation before erasure.
6. Apply the reviewed erasure, revoke active sessions, and delete the Auth
   account through the supported administrative operation. The request row
   cascades on Auth deletion; its disappearance alone is not proof of complete
   erasure. Keep the minimal completion receipt separately from account data.
7. Verify denied access from the former session and check remaining references,
   shared content and recovery copies. Prevent older pending/offline records
   from reintroducing erased data. Ask the requester to remove their local
   copies; server deletion cannot remotely wipe a disconnected device.
8. Email the verified address with the completion date and request reference,
   the scope completed, actual backup expiration and any specific legally
   required exception. Verify successful delivery, including Apple Hide My
   Email. Sending this message is an explicit operator action; the app does not
   currently send it automatically.

Do not claim a legal retention exception just because erasure is inconvenient.
An actual legal requirement needs its scope, reason and end date documented.

## Backups and restoration

Manual production backup copies have a maximum retention of 30 days from
creation, enforced by Jacob Haney. The existing copy is on the operator's other
personal laptop and has not been inspected here. Check its date and additional
copies before certifying enforcement. The published process must distinguish
live erasure within 30 days from backup expiry up to 30 days later. Supabase
remains on Free; no managed backup subscription was purchased. Database backups
exclude stored object files. Independent exports require separate handling.

Before restoring any older recovery point, preserve and reapply deletions
completed since that point, verify them in isolation, and only then resume
service. Keep the minimum deletion ledger for as long as a retained recovery
point could reintroduce the erased data. Do not put contact details, account
UUIDs, deletion ledgers or backup keys in Git.

## Acceptance rehearsal

Use a dedicated fictional account and church. Exercise a normal member and a
last-leader case with encounters, tasks, guides, invitations, histories and
offline work. Prove the request, queue review, Apple revocation where relevant,
actual erasure, denied old-session access, surviving unrelated records and
completion-email delivery. Record only anonymized evidence in the release
guide. Manual processing is acceptable only when the operator can actually
complete this workflow within the disclosed time.

References: [Apple account deletion requirements](https://developer.apple.com/support/offering-account-deletion-in-your-app/),
[Supabase backups](https://supabase.com/docs/guides/platform/backups).
