# Map-first zones verification

> Historical record. For the current iOS release status and requirements, see the [iOS release guide](../ios-release.md).

The original scoped local verification below passed, but subsequent user testing exposed generated map placeholders and missing real-county inventory. See the [Step 2 follow-up](map-data-loading-fix.md) for the current fix and outstanding residential-data dependency. The original results are historical workflow evidence, not proof of usable real-county planning or production readiness.

## Story under test

A leader chooses or draws a persistent zone, selects residential nightly targets visually, assigns each to one team/person, and reviews the map before Ready. Each volunteer accepts and opens the exact target; encounters update distinct-parcel coverage. Finished is a manual lifecycle action, independent of coverage. Replacement preserves history and requires fresh acceptance.

## Coordination

The initial three Sol implementation lanes handed off to Sol agents in the user's existing herdr session. Herdr lanes cover visual planning/imports, wizard/replacement/leader coverage, browser verification, and SQL behavior/security. Root integrates field context, target recording, lifecycle projection, and the durable replacement transaction.

## Verification results

- Coverage/field-resolution focused tests: 19 passing assertions from the independent Sol test lane.
- Operational projection tests: private encounter details need not be visible to count authorized residential coverage; parent counts dedupe by parcel and event; assigned-target-only views do not claim whole-parent accuracy.
- Root lifecycle/queue tests: Ready/acceptance freezes locally; completion does not create visits; replay reconstructs freeze; unaccepted/out-of-roster local encounters reject; replacement queues cancellation → new target → new assignment in one transaction with fresh acceptance.
- Final full repository ESLint, TypeScript and whitespace checks passed.
- Full unit suite after the final client fixes: 54 files, 277 tests passed (2026-09-12, 19:15 Central). Final full repository ESLint and `git diff --check` passed.
- Final frozen-source optimized Next build passed, including TypeScript, 20 generated static pages and offline assets. It includes the planning-cache gate, street endpoint fix, public copy, community-recorder guard, current-parent dataset identity gate and immutable snapshot maps.
- Fresh agent-browser desktop/mobile `/demo` gut-check passed: meaningful Home content, four navigation destinations, no Next error overlay, empty console/page-error collections. Screenshots are retained locally under `work/verification/`.
- Final owned Playwright batch: **11/11 passed in 1.0 minute** on the latest rebuilt artifact, including the final planner-identity/snapshot changes. It covers navigation/People/no-answer, checkpoint IDs and acceptance locks, drawing a persistent parent, whole-zone Ready, a usable street target, explicit exact-target fieldwork, target parcel stamps, below-100% Finish, repeat without copied assignments, and replacement/history/fresh acceptance. The demo field regression verifies zero authenticated parcel RPC requests.
- Connected readiness suite: **18/18 passed in 10.5 minutes, zero failures**. Session-revocation/account tests run separately from other connected stories using the same sandbox identities. This run preceded the final planner-identity/snapshot change and legacy-owner SQL compatibility correction; it is recorded against that preceding artifact rather than conflated with the final owned batch.
- Final isolated connected map-first story: **1/1 passed in 36.1 seconds** on the latest rebuilt preview and final local SQL. Real authenticated planning/street RPCs returned complete bounded datasets; the UI drew a four-corner open parent, selected its whole-zone target, assigned one person and saved Ready. Database assertions verified one Ready outing, unchanged open parent storage, one frozen geometry-matching target with the exact authoritative fixture roster, one assigned individual owner and an empty durable queue. The test restored its parcel inventory baseline in `finally`.
- Final authenticated SQL rollback suite and the complete `node scripts/test-database.mjs` runner passed. Scenarios exercise exact ownership/acceptance, transaction-final exclusivity, Ready/active frozen replacement and rollback, authoritative immutable encounter links, private-note-safe distinct/voided progress, outing-less parent progress, incomplete manifests, canonical street geometry, representative points and metric side/endcap boundaries.
- Local Supabase advisors returned no issues. Database lint exited 0; the SQL lane reviewed remaining baseline/renamed-function warnings. Installed local function definitions were checked against the final migration. No hosted SQL was changed.
- Clean migration replay in a plain PostgreSQL scratch database was not verified: that database lacked Supabase's pre-created `extensions` schema. Incremental local compilation and authenticated behavior are verified; this does not establish clean Supabase deployment/migration rehearsal.

## Verification distinctions

- Deterministic browser fixtures use a local empty map style so external tile availability cannot hide a workflow regression. They verify overlays/drawing and application behavior, not live basemap delivery.
- A fresh no-interception check confirmed HTTP 403 for the configured MapTiler style on localhost. Switching only the demo's runtime preference to supported OpenFreeMap rendered a real basemap, with no captured OpenFreeMap HTTP failures and visible attribution. Evidence: `work/verification/zones-openfreemap-real-basemap.png`. No credentials, environment files or provider settings were changed.
- One-sided street selection uses flat canonical line endpoints; both-side selection uses round endpoints. Client and server have focused regressions for this boundary so suggested parcels do not fail solely because of differing cap rules.
- A cancelled/declined target assignment or a partially saved target is not a community outing. Propertyless community recording requires no assignment history and no saved target for that outing.
- Browser verification found that the generic field-map parcel hooks still requested authenticated RPCs in the unauthenticated demo. The shell now enables those hooks only for connected map views; demo target maps use their persisted fictional parcel snapshots. The browser regression explicitly checks for unwanted parcel RPCs instead of filtering their console errors.
- A real fixture bug—not a click-coordinate issue—left the demo street corridor with no automatic parcels. Fictional rectangles now provide explicit interior centers; the regression proves the 20 m Church Avenue corridor selects `demo-2` and `demo-5`. Valid draft geometry permits parcel review even with zero automatic suggestions, and the reviewed roster preserves `manual_add` for deliberately included parcels outside automatic selection.
- Dataset completeness is tied to the current parent ID and exact boundary, so switching parents cannot reuse an old complete subset while a new request is pending. Cancelled requests cannot clear a newer result. Who/Review uses stored roster geometries; field maps retain saved geometry even when live geometry changes, with live display metadata and legacy missing-snapshot fallback covered by focused tests.

## Real street inventory

- The bounded pinned Overture `2026-08-19.0` extraction returned 11,323 source segments, split into 16,466 canonical connector-bounded sections.
- Publication to the existing local database at `127.0.0.1:54322` committed transactionally after schema freeze. The complete manifest has exactly Giles, Lawrence, Lewis and Wayne county FIPS; `expected_rows = imported_rows = 16,466`.
- Read-only verification found 16,466 distinct IDs, no invalid/empty geometry and no demo IDs. An authenticated bounded Giles RPC returned 63 real features, `complete=true`, `truncated=false`, and separate canonical/display geometry.
- Final focused map/importer tests: 23 passed, with focused ESLint clean. Downloads, verified DuckDB binary and generated import files remain in ignored `work/geodata/`; no system installation or hosted import occurred.
- This street import is not a residential-parcel import. The local sandbox initially contains 16 synthetic Illinois parcel fixtures and no Tennessee parcel inventory. The additional connected map-first browser story uses explicitly fictional Tennessee parcel fixtures through the real authenticated RPCs; it must not be presented as validation of real Tennessee parcel completeness.
- Root reran all ten local database suites after publication; all passed.
- The final server-side empty-roster guard also passed the full database runner: accepting an empty draft target or making its outing Ready rejects atomically, without retaining assignment acceptance or freeze timestamps. Incomplete draft saves and terminal history remain supported. Advisors remained clear.
- A connected-boundary regression exposed that stored territories use open corner lists. The final private parser closes boundaries only in memory and rejects invalid/degenerate/self-crossing polygons. Authenticated whole-zone and smaller-target saves against a stored four-corner parent passed, while stored JSON remained unchanged. Both bounded RPCs accept the legacy bare-array form. All ten database suites and advisors passed again; the helper is not directly executable by authenticated clients.
- Migration compatibility preserves the original at-least-one-owner rule for legacy target-less assignments, including a historical team plus named person. Exactly-one-owner applies only to new targeted assignments. Authenticated acknowledgement preserved both legacy owners and advanced the version; targeted dual-owner writes still rejected. The complete database runner, installed definitions and advisors passed after this correction, without rewriting historical ownership.

## Resolved final verification gate

- The first isolated connected run reached Ready, closed the dialog and drained the durable queue, then failed in its read-only verification query because PostgreSQL does not support `min(uuid)`. Casting the owner ID to text corrected the harness. The entire story then passed, including database assertions and cleanup; the earlier partial result was not counted as success.
- Independent post-test cleanup confirmed exactly 16 baseline parcels, zero Giles fixtures, zero connected test walks/zones and zero connected test targets/assignments.
- No scoped local verification gate remains open. Real Tennessee residential inventory, the localhost MapTiler restriction, clean Supabase migration rehearsal and the existing operational launch gates remain separate limits, not implicitly completed work.

No hosted migration, deployment, commit, or production data import is authorized or performed by this task.

## Subsequent authorized Lawrence parcel copy

The user later authorized fetching the existing hosted Supabase parcel inventory into the local sandbox. Publication committed with 25,754 Lawrence parcels (21,055 residential), unchanged EWKB and source fingerprint, and all 16 pre-existing non-Lawrence parcels preserved. A bounded public RPC returned 1,259 actual residential features with complete/nontruncated metadata. Hosted data was read-only. This resolves Lawrence's local inventory dependency, not the other counties or production deployment. The user requested no further tests; no real-parcel browser pass is claimed. See [the follow-up record](map-data-loading-fix.md).
