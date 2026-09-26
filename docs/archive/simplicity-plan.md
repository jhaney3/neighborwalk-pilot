# NeighborWalk simplicity pass

> Historical record. For the current iOS release status and requirements, see the [iOS release guide](../ios-release.md).

Approved September 12, 2026. Complete this pass before resuming the remaining
[market-readiness work](market-readiness-plan.md). Preserve the current visual
identity, existing data, permissions, and release safeguards.

The later approved [map-first zones plan](map-first-zones-plan.md) supersedes
address-list creation in the normal walk wizard. Legacy lists and field fallbacks
remain; new plans use persistent zones and visually selected nightly targets.

## Everyday experience

- Home points to the next relevant walk and requested follow-ups. Leaders can
  plan a walk; exceptions appear only when something needs attention.
- Walks guides preparation through When → Where → Who → Review. Saved groups
  are optional. Choose/create an address list inline or use an existing area.
  Extra preparation fields are secondary; timezone defaults to the church.
- Fieldwork opens the selected assigned area on the map, with a List switch.
  Coordinate-free lists retain a useful list fallback. Multiple applicable
  areas require a choice; assignment acceptance remains explicit.
- Record what happened first. No answer needs no person or note. Requested
  follow-up reveals the person/contact/date controls. Restrictions and honest
  device-save/sharing status remain visible.
- People combines relationships and follow-ups. Needs follow-up is the default,
  with All people alongside it. Named tasks group under the person; the profile
  reuses task actions and permitted history. Address-only tasks show Name not
  known and remain tasks without fictitious person records.
- More holds groups/members, areas, guides, settings, administration and device
  recovery. Both desktop and mobile use Home, Walks, People, More.
- Website/help tells the same story: Plan a walk. Meet your neighbors. Remember
  to follow up. The sample remains the primary entry; pilot disclosures remain.

## Compatibility and delivery

Keep existing person/task URLs and person/scope filters functional. Preserve
history and legacy address-only tasks; this pass does not automatically relink
them. Reuse the current command/storage boundary without schema or access-policy
changes. Checkpoint saved draft/list/assignment IDs so partial setup retries do
not duplicate work.

Three Sol Codex agents in the existing herdr session own People, Walks, and
website changes. The coordinator owns Home, navigation, integration, and final
verification. Preserve pre-existing uncommitted work; no production deployment
or hosted database mutation is part of this pass.

## Acceptance

Exercise leader preparation without a pre-created group, volunteer assignment
selection, map/list recording, no answer, named and unnamed follow-ups, multiple
tasks per person, task actions, restrictions, deep links, reload/Back, demo and
empty states. Run lint, typecheck, unit tests, build and relevant browser/database
regressions; inspect narrow layout and keyboard focus. Verify offline durability
and partial-failure behavior. Have the product owner try the fictional workflow
before resuming feature expansion; automated checks do not establish usability.
