# Map-first zones and nightly targets

> Historical record. For the current iOS release status and requirements, see the [iOS release guide](../ios-release.md).

Approved implementation scope, 2026-09-12. This extends the simplicity pass; the existing When → Where → Who → Review structure stays.

## The simple model

A **zone** is the persistent neighborhood goal. A **target** is one team's bite of that zone for one outing. Targets remain in outing history, but are not a second library of reusable zones. One team can take the whole zone, or the leader can divide tonight's work visually.

- Where: choose a saved zone or draw and name one. Draw rectangles/polygons, or select actual street sections between intersections. Streets default to both sides, with an optional shaded side choice.
- Review suggested residential properties on the map; tap to include/exclude. No address-list construction in the normal planning flow.
- Who: give each colored target exactly one team or person. Resolve duplicate property ownership and unassigned work before Ready.
- Review: map, target names, owners, residential counts, and readiness. Assignment acceptance is preserved through retries.
- Fieldwork: open the exact accepted target. A parent-zone link cannot silently select one of several targets. “Finished for tonight” ends the assignment without manufacturing 100% coverage.

## Coverage and history

Each target saves its selected geography, source revisions, and reviewed residential-property roster. Freeze when the outing becomes Ready or an assignment is accepted, whichever happens first. Frozen changes require explicit cancellation/replacement and fresh acceptance; history is retained.

Team coverage counts distinct residential parcels with non-voided target-linked encounters during that outing. Apartments, multiple units, and repeat visits count once per parcel. Leader views show cumulative and tonight's coverage against the full parent inventory, not an average of target percentages. Missing/truncated inventory or incomplete visibility must never look like an authoritative percentage. Encounter parcel identity is snapshotted so later location edits cannot rewrite history.

## Technical boundaries

- First live geography: Giles (47055), Lawrence (47099), Lewis (47101), Wayne (47181), Tennessee.
- Streets come from a pinned, bounded Overture transportation import, independent of map style. Persist segment IDs, source revision, selected geometry and attribution. Do not query global Parquet from browsers.
- Street suggestions use a corridor up to 100 m, clipped to the parent zone. Ambiguous corners/parallel streets require map review. Polygon suggestions use residential parcel representative points.
- Database checks church/assignment permissions, valid contained geometry, residential membership, and exclusive active parcel ownership within an outing. Whole-zone and smaller targets in the same parent cannot coexist as active assignments.
- Existing locations remain parent-zone linked. New assignments reference targets; historical assignments without targets keep their behavior.
- Existing durable command queue, explicit rejected-work recovery, and checkpointed save IDs preserve offline work and prevent duplicate retries.
- Connected target creation/editing/replacement requires being online. Complete cached planning data remains available for review; accepted field encounters remain offline-durable. Replacement cancels the old assignment, creates the new target, and assigns its owner in one atomic queued transaction, with fresh acceptance required.
- No live tracking, routing optimizer, hosted database changes, deployment, or expansion to additional counties in this task.

## Implementation ownership and verification

Sol agents own storage/security, visual planning/street data, and wizard/workflow in parallel. Root owns app-shell integration, target field selection, coverage presentation, and coordination. A subsequent independent verification pass covers unit/SQL checks, optimized build and browser flows, including two teams in one zone, one whole-zone team, street sides, partial-save retries, offline encounters, permission boundaries, frozen targets, and incomplete inventories.
