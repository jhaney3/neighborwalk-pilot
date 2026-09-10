# Guide library reliability

Guides support fieldwork; they are optional and do not replace recorded encounters or owned next steps. Selection remains outing church guide → assigned-group church default → personal favorite → church fallback → own personal fallback. The displayed source describes the guide actually selected, including after a configured guide becomes unavailable.

## Complete reads

Connected reads page by guide UUID and group ID, 100 records per request. They continue until an empty page—not merely a short page—so a lower server row cap cannot silently truncate the library. Duplicate/overlapping cursors, invalid responses and interrupted requests reject the whole read.

Each collection is bounded at 20,000 records and 16 MiB of serialized row data to limit mobile memory consumption. Crossing either limit reports an incomplete read; it does not accept the first records as a complete library. These are safety bounds, not a tested capacity or recommended library size.

Every active guide is validated for content, church, private owner and version. Active group defaults must reference an accessible church guide. Cleared choices keep a versioned row but do not select a guide; an archived personal favorite no longer overrides an available fallback. Deleted groups are excluded by an inner relationship filter. Invalid rows/references are not silently filtered out of a successful result. Controlled, content-free messages explain when leader/operator review is needed; raw read-service diagnostics do not appear in the field UI.

Guide changes now advance the canonical church revision under the same church lock as fieldwork. The reader checks that revision and authenticated identity before and after collecting pages. A changed revision retries the complete read, at most three times; repeated concurrent changes leave the previous copy intact with an explicit warning. This detects interleaved changes without claiming that independent HTTP requests share one database snapshot.

The local library is replaced only after a complete read is accepted. A failed refresh keeps any previous saved copy available within the existing account/offline window. Leaders should resolve persistent invalid-content warnings rather than assume the saved copy is current. Do not repair such warnings by deleting database records or clearing browser storage.

A known authorization denial is different from a content/network warning. Direct or wrapped permission errors and changed guide identity invalidate the matching account's prepared offline window and lock the visible workspace. This applies to initial loading, refresh, pending-request review and guide submission. Original authored work remains on the device; it is not transferred to a different account or cleared to resolve the denial.

## Content and accessibility

Coaching, suggested words, reminders and Scripture references are available in the editor and field reader. References do not silently fetch copyrighted passage text. Guide steps and location panels use labelled tabs, roving focus and matching keyboard orientation, with larger phone tap targets and contained step navigation.

## Transactional edits and interrupted requests

The connected editor captures the guide version when opened. Save/archive requests must match that version; a stale editor cannot overwrite another accepted edit. Personal favorites and group defaults also have compare-and-set versions, including after being cleared. Guide scope cannot change during an edit. Only an active leader can change church guides or group defaults; only the owner can change a personal guide or favorite. Every request checks the live session and server-derived actor. Browser table writes are revoked.

The exact request, client-generated guide ID and receipt ID are stored atomically in account/church-scoped IndexedDB **before** the network write. Device storage failure stops submission. A lost response leaves that original request available after reload; retry sends the same payload and receipt ID. The server returns the original receipt for a matching retry, and rejects reuse with different content. Successful receipts are retained in the author's local recovery history before the pending entry is cleared. A later receipt cannot replace a newer complete library revision.

While a request needs confirmation, new guide writes are disabled. Open Guides to refresh the shared library, retry the original, or explicitly preserve it as reviewed without resubmission. The last option does not undo a change that already reached the server; its original remains in recovery history. Own authored-device recovery exports include this journal, not another account's guides. There is no background guide-write queue or offline editing claim: prepared text remains readable offline, while library changes require a connection.

Church guide changes and group-default changes have content-free church audit entries. Private guide edits and personal favorites are not added to leader-visible activity. A successful server save followed by a failed local cache refresh is labelled as confirmed with a preparation warning, not presented as an unsaved create.

## Archive, defaults and historical boundaries

Connected removal is **archive**, not hard deletion or permanent erasure. Archival preserves the guide row, text and historical links. Current outings and current group defaults block archival until deliberately changed. Completed/cancelled/archived outings retain their historical guide ID; reopening one with an unavailable guide is rejected. Clearing a default/favorite preserves its version so a stale device cannot silently reinstate an old choice.

This is optimistic concurrency, not a complete immutable guide-edition archive. Outings currently link to a guide ID; they do not pin a historical text snapshot. Editing an active guide changes its current text for subsequent connected reads. For a stable outing script, prepare a separate church guide and avoid editing it during the outing. Full historical edition pinning and an archived-guide reader are not implemented, and existing historical text is not fabricated.

## Verification and remaining release evidence

Unit tests cover 1,007 guides and 1,007 group defaults with a simulated server cap below the requested page size, malformed content, identity/owner violations, invalid choices, repeated cursors, revision changes, read limits, immutable retry, competing device-journal writes, quota failure and newer-read protection. The rollback-only guide database suite covers receipts, versions, roles, session revocation, strict content, reference guards and archival preservation. Real local browser tests cover guide content/keyboard navigation, cold-offline reopening, an actual committed save with its response lost, a competing device edit, cleared favorites and retained archive records. Exact completed runs are recorded in the [execution ledger](rework-progress.md).

These checks do not establish broad production-shaped load capacity, physical-phone usability, production migration or complete disaster recovery. Invalid legacy content requires supervised review without deleting the original. The connected guide API and its matching application must be released together; do not deploy the direct-write revocation by itself.
