# Correcting encounter history

Leaders can use **Data & health → Correct an encounter after review** while connected and signed in within the last 15 minutes. Share or recover pending device work first. Volunteers should ask a leader to review a mistake; ordinary field commands cannot rewrite any encounter.

1. Search by date, person, address or exact encounter ID. Search results are limited to the 100 most recent matches; refine the search for older records.
2. Review the original, previous corrections, and linked responsibilities.
3. Correct the outcome/context, or mark an entry **entered in error**. Give a short factual reason. Anonymous encounter reasons are visible to church members; keep private care details out of them.
4. Acknowledge that tasks and restrictions are unchanged, then save. If shared records changed, review again. If the response is interrupted, use **Retry preserved request** to retrieve the same receipt, not to create another correction.

Original outcome, context, actor, device, note, dates and person/location/outing links remain untouched. Each review appends its actor/time/reason and reviewed state. A later review can correct an earlier one, including restoring an entry marked in error; the full chain remains. This is not erasure or an automatic undo of related work.

Entered-in-error encounters remain in person/location history and accessible-record JSON, but are excluded from current location activity, outing counts and derived last contact. Corrected outcomes appear in current summaries. Original facts and each review remain visible in history.

## Responsibilities and privacy

- A correction never creates, completes, cancels, reassigns or relinks a task. Changing an outcome to “Follow-up requested” requires a separate, owned next step. Marking a duplicate encounter in error does not cancel a real promise.
- A correction never creates or lifts a contact restriction. Record or review these through contact preferences. A historical no-visit outcome can be corrected without lifting its independent restriction. A new no-visit request cannot be substituted into an ordinary encounter through this form.
- A correction cannot move history to another person, address, outing or date. For a wrong link, preserve this entry as entered in error and record the factual encounter separately. Sensitive information attached to the wrong person needs supervised privacy handling; an annotation is not removal of the disclosed information.
- Person-linked corrections inherit the original encounter's read permissions, including approved duplicate aliases and later accepted handoffs. Anonymous history remains shared within the church. Correction reasons must not broaden that disclosure.
- The record version, workspace revision, current leader role and live recent session are checked on the server. Direct table writes are not granted. A maximum of 100 reviews per encounter prevents unbounded record growth; exceeding that limit needs supervised operator review.

## Last contact and note categories

The profile's last-contact display is derived from accessible person-linked conversations, follow-up requests, declined conversations and recorded no-visit contacts across reviewed aliases. No-answer/inaccessible encounters, entered-in-error records, notes and task completion alone do not establish contact. It never borrows another household member's encounter or writes a derived date back into a profile.

When no qualifying encounter is available, an existing stored last-contact date is explicitly labelled **historical**. That retained value is not proof of a newly recorded conversation. Notes now allow General note, Conversation, Prayer and Milestone; selecting a category does not automatically change contact dates or faith/pathway fields.
