# Guide library reliability

Guides support fieldwork; they are optional and do not replace recorded encounters or owned next steps. Selection remains outing church guide → assigned-group church default → personal favorite → church fallback → own personal fallback. The displayed source describes the guide actually selected, including after a configured guide becomes unavailable.

## Complete reads

Connected reads page by guide UUID and group ID, 100 records per request. They continue until an empty page—not merely a short page—so a lower server row cap cannot silently truncate the library. Duplicate/overlapping cursors, invalid responses and interrupted requests reject the whole read.

Each collection is bounded at 20,000 records and 16 MiB of serialized row data to limit mobile memory consumption. Crossing either limit reports an incomplete read; it does not accept the first records as a complete library. These are safety bounds, not a tested capacity or recommended library size.

Every guide is validated for content, church and private owner. Favorites and group defaults must reference an accessible guide of the appropriate scope. Invalid rows/references are not silently filtered out of a successful result. Controlled, content-free messages explain when leader/operator review is needed; raw service diagnostics do not appear in the field UI.

The local library is replaced only after a complete read is accepted. A failed refresh keeps any previous saved copy available within the existing account/offline window. Leaders should resolve persistent invalid-content warnings rather than assume the saved copy is current. Do not repair such warnings by deleting database records or clearing browser storage.

## Content and accessibility

Coaching, suggested words, reminders and Scripture references are available in the editor and field reader. References do not silently fetch copyrighted passage text. Guide steps and location panels use labelled tabs, roving focus and matching keyboard orientation, with larger phone tap targets and contained step navigation.

## Still being completed

Paging is not a transaction-wide snapshot guarantee. Guide writes do not yet participate in the canonical workspace revision or an immutable, persisted retry journal. Concurrent edits, stale versions, interrupted saves, dependent outing/group references and deletion/archival semantics must be resolved before production release. Do not describe current guide editing as conflict-safe or exactly-once on the strength of complete-read tests.

Tests cover 1,007 guides and 1,007 group defaults with a simulated server cap below the requested page size, plus malformed content, tenant/owner violations, invalid choices, repeated cursors, errors after a successful page and read limits. Real local browser tests cover saved guide content/keyboard navigation and cold-offline guide reopening. These are separate from broad production-shaped load testing and actual-phone verification.
