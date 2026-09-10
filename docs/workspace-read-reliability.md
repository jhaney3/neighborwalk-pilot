# Complete workspace refreshes

A successful refresh means all currently permitted rows were read coherently; it must not mean that the first page happened to load. This applies to ordinary refresh, conflict comparison, administration previews and exports, and initial connected loading.

## Read contract

- Each of fourteen record collections uses the database's deterministic keyset cursor and requests 500 rows. The client continues through an **empty terminal page**. A short page can reflect a smaller server cap and is not accepted as proof of completion.
- Null responses, overlapping IDs, missing record envelopes, invalid/unsafe versions and wrong-church records reject the read. Source record content still passes the full domain schema before publication. No invalid row is silently removed to manufacture a successful result.
- At most four collection requests run concurrently. A failure stops scheduling additional collections and cancels subsequent pages of the other readers; requests already in flight may finish but cannot produce a successful partial workspace.
- The complete attempt shares a limit of 100,000 rows and 64 MiB of serialized row data. Exceeding either refuses the whole refresh and preserves the previous copy. These are reviewed safety bounds, **not** measured phone capacity, a guaranteed browser-memory ceiling, or a reason to delete church history. SDK parsing and temporary mapping allocations also consume memory.
- Before and after all pages, the response must match the original account and church. Canonical revision, settings version and role must remain consistent. Interleaved changes retry the entire attempt, at most three times. Repeated changes produce an explicit error, never a mixed-version publication.
- Server permission errors retain their typed authorization code so existing session-denial handling invalidates cached access. A wrong account/church response is treated as an authorization failure. Invalid/incomplete content does not become sample data or overwrite the previous device state.

The database remains the authorization boundary. Client validation is additional containment, not a substitute for live-session checks and row-level security. These independent HTTP requests do not share a PostgreSQL snapshot; revision checks detect supported interleaved writes, which must continue to advance the canonical revision. Uncoordinated direct operator writes are not a supported editing path.

## Verification and limits

Unit tests read 25,000 fictional records under a 137-row simulated server cap and confirm the final empty page. They also exercise four-request concurrency, global row/byte limits, later-page permission failure, malformed/foreign rows, changed revisions/settings, changed identities before/after reading, and stopping other readers after a failure. Existing real local browser workflows use this same pipeline; exact completed results are in the [execution ledger](rework-progress.md).

The 25,000-record test validates complete pagination. It is **not** a mixed production-shaped database benchmark, 50 simultaneous volunteers, lower-end phone responsiveness, or actual field testing. The audit's multi-entity load fixture, supported physical phones and release-specific staging/cutover remain required evidence. Libraries have their own [guide read/write contract](guide-library-reliability.md).

If a device exceeds the limit or repeatedly cannot refresh, keep its pending work and saved copy intact. Use the authored recovery export and a supervised operator review; do not clear browser storage or restore arbitrary JSON over the shared church.
