# Reviewed duplicate records

Leaders use **Data & health → Combine reviewed duplicates** while connected and signed in within the last 15 minutes. Share or recover pending fieldwork before administration. This is a deliberate correction tool, not an automatic matching service.

## Review procedure

1. Confirm with appropriate church knowledge that this is the same person or dwelling. A shared name or telephone number is not proof. Never combine different apartment units or household members.
2. Choose the original record to preserve and the record whose current details should remain in use. Review both columns. The chosen current record keeps its name, contact details, location metadata, tracking status, and optional pathway fields. Restrictions override less restrictive preferences.
3. Resolve blockers. People must have the same accepted active owner, no pending handoff, the same current location, and matching explicit sharing/legacy-creator access. Use the normal reviewed move and accepted handoff workflows first where needed. Different addresses/units require a separate factual correction, not a forced combination.
4. Preview the exact affected IDs and versions. Current people and open tasks move as listed. Tasks prohibited by the combined restrictions are cancelled. Other open tasks are not deduplicated automatically.
5. Record a factual reason, acknowledge the effects, and type the displayed confirmation. If anything changes after preview, refresh and review again. A response interruption leaves an immutable administration request on that same device/account; retry it to retrieve the original receipt.
6. Review the remaining open tasks and close any truly redundant task with its own reason. Do not assume similar tasks represent the same promise.

## What is preserved

- The original profile/location stays in the database as a read-only historical alias. Original names, contact details, geometry, parcel reference, ownership metadata, and source details are not discarded. Prior tracking status and update timestamp are additionally recorded in the combination audit.
- Historical encounters, notes, and resolved tasks keep their original IDs, links, dates, and contents. The current person's timeline joins only that person's permitted record family, never everyone at an address.
- Current directories, maps, selectors, coverage counts, and people/location CSV exports omit aliases. Old links resolve to the current record; accessible-record JSON retains the aliases. Import duplicate checks also consider original names and contact details.
- Active restrictions move with a retained origin link. Two independently recorded requests remain two independently reviewable restrictions. Lifting one cannot lift the other or reopen cancelled tasks.
- Private history follows the current canonical profile's access, including later accepted handoffs. Combining does not implicitly broaden explicit sharing.
- The server transaction records actor, reason, source/target IDs and previous versions, affected counts, and a retry-safe receipt. All actions share the church revision lock.

## Incorrect combinations and support

There is no automatic undo. Do not combine records to experiment with the tool. If a mistake is discovered, stop further changes to the affected records, preserve a fresh private backup and relevant immutable receipts, and ask the designated operator for a supervised correction. Review later tasks, restrictions, sharing changes, and handoffs before deciding which links can safely be restored. Never restore an entire old database over new church work to undo one combination, or clear a restriction merely to repair an identity link.

The current UI supports preserved history, not permanent erasure or full database backup/restore. See the release ledger for those separate operational gates. No production combination or production migration was performed during implementation.

## Verification

`tests/duplicate-readiness.sql` is rollback-only and uses fictional records: recent leader authority, mismatched sharing/owners/units, pending handoffs, stale review tokens, exactly-once receipts, unchanged historical rows, independent restriction lifts, original-link access after accepted handoffs, chained aliases, and legacy blanket no-contact flags. The ordinary task/move suites remain required because this workflow shares their transaction implementation.

`tests/record-aliases.test.ts` verifies safe resolution, unavailable/cyclic targets, permission-filtered history, current-record exports, duplicate import detection, and restriction precedence. The isolated browser scenario exercises both combinations through the UI, original-person navigation, preserved note/profile values, the current location selector, and the task's database links. Automated Chromium and phone-sized layout checks do not establish real-device field readiness.
