# Step 2 real map data follow-up

> Historical record. For the current iOS release status and requirements, see the [iOS release guide](../ios-release.md).

## User-reported problem

The sample planner displayed six generated parcel rectangles and intersecting generated streets over a real basemap. Moving to a Lawrence County zone did not load actual inventory. Prior workflow tests used fictional parcels and did not establish a usable real-county planning experience.

## Confirmed causes

- `demo` bypassed both inventory RPCs and generated shapes at the chosen center.
- `ParentZoneCreator` did not pass parcels or connect its viewport callback to an inventory loader.
- A shared request failure could erase both street and parcel layers.
- The local database has 16 Illinois sample parcels and **zero parcels in all four approved Tennessee counties**. The downtown Lawrenceburg bounding box `[-87.345,35.235]–[-87.325,35.255]` contains **502 imported real street sections**, but zero residential parcels.
- The authenticated GIS RPCs correctly reject unauthenticated requests; removing the demo branch alone would not fix access.

## Fix scope

- Remove generated planning candidates. Load real GIS through separate bounded public-map read APIs for device-only mode, retaining the existing authenticated APIs for connected workspaces.
- Public map APIs expose static geometry/identities only, not church records, visits, private notes, ownership or base-table access.
- Load street and parcel layers independently; keep available streets visible and inspectable when parcels are unavailable.
- Require complete live inventory and a nonempty residential roster before creating a target. Cached data stays review-only.
- Load visible parcels while drawing a parent zone, with loading/unavailable states and retry. Preserve current-parent identity and cancellation guards.

## Initial data dependency (superseded by authorized hosted copy)

The official [Tennessee Comptroller parcel download](https://comptroller.tn.gov/office-functions/pa/gisredistricting/redistricting-and-land-use-maps/parcel-data.html) requires a human request. No supplied `Lawrence.zip` was found by the source lane. An authorized official county archive with assessment `CLASS`/`LANDUSE` is needed to import verified residential inventory.

The public boundary service has Lawrence geometry but lacks residential classification; it must not be imported as if every parcel were residential. The smaller TNMAP view is also incomplete. No contact form was submitted, restricted source accessed, or invented parcel imported.

Suggested destination for the unchanged official archive: `work/geodata/downloads/Lawrence.zip`. The existing privacy-filtering importer excludes owner names, mailing details, valuations and sales. Any import must remain local, preserve existing records and validate source completeness before publication.

The new private parcel-release manifest is per county: importing Lawrence does not require importing the other three counties first. Publication records the source/release, county boundary, and matching expected/imported counts. Anonymous map reads remain unavailable without that validated publication. Public road names are retained for street selection; parcel ownership and private outreach records are not exposed.

## Verification

- Full unit suite: 56 files, 287 tests passed.
- Full TypeScript and focused changed-file ESLint passed; whitespace checks passed.
- Optimized build passed; fresh-session browser gut-check passed on the refreshed local preview at port 3013.
- New public-map SQL rollback suite and the ten existing database suites passed. The new suite is included in the standard database runner.
- Actual anonymous RPC check returned 502 real Lawrenceburg street sections with complete Overture metadata; parcels returned `missing_inventory`, `complete=false`, and zero features.
- Eleven deterministic browser regressions passed after moving fictional inventory into explicit test-only network fixtures. This includes the new-zone creator's viewport parcel request. Runtime application code no longer generates those candidates.
- The separate unmocked Lawrence GIS browser regression passed. Its slightly different boundary `[-87.35,35.23]–[-87.33,35.25]` returned 377 real street sections; the rendered count matched the response, real names were preserved, and selecting a returned Public Square segment produced actual nearby-street suggestions. Missing parcel data was explicit and target creation stayed blocked.
- Desktop/mobile evidence: `work/verification/zones-lawrence-real-streets-missing-parcels-{desktop,mobile}.png`. The basemap style is intercepted for deterministic rendering; the Lawrence GIS API/data are not mocked. Root inspected the desktop result.
- Final test-file lint, full TypeScript and whitespace checks passed. A test-only unsupported county code and incorrect expected count were corrected; these failed attempts were not counted as passing evidence.

These checks preceded the user's authorization to copy the existing hosted Lawrence inventory. They do not establish real-parcel workflow verification. No hosted database or deployment changes are included.

## Authorized hosted inventory copy

The existing NeighborWalk Supabase project contains 25,754 Lawrence County parcels, including 21,055 residential records. A read-only export copied the original EWKB geometry, GIS identity, classification, source timestamps and situs address; no church records or property-owner details were requested. The hosted content fingerprint was unchanged before and after the export: `9463dad3c23e08da2bf5b4331e90b682`.

The local-only importer validates that fingerprint before publication, preserves existing non-Lawrence records, and uses real TIGER county coverage. Its manifest identifies the source honestly as `NeighborWalk hosted parcel snapshot`, not a newly inspected official archive. Export files remain ignored and access-restricted under `work/geodata/hosted-lawrence-2026-09-12/`.

The user explicitly requested no further tests. The prepared real-parcel browser regression has not been run against this copy; import integrity checks are not browser verification.

Local publication committed successfully: 25,754 Lawrence rows (21,055 residential), 25,754 unique identities, zero invalid geometries, matching source fingerprint, and all 16 existing non-Lawrence parcels preserved. The bounded Lawrenceburg public RPC returned 1,259 residential features with `available`, `complete=true`, and `truncated=false`. All 46 parcel/Census edge discrepancies remain faithfully stored; the TIGER publication boundary was not expanded. Hosted Supabase was unchanged.
