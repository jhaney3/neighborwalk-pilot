import type { NeighborWalkData, Visit } from "./domain";
import { indexCurrentRecords } from "./record-aliases";
import { reviewedEncounter } from "./encounter-history";

/** Derived displays never become the authority for contact restrictions.
 * Historical do-not-visit encounters remain history after an approved lift. */
export function projectOutreachWorkspace(data: NeighborWalkData, pendingRestrictedLocations = new Set<string>()): NeighborWalkData {
  const summaries = new Map<string, { count: number; latest: Visit; latestOrdinary?: Visit }>();
  const locations = indexCurrentRecords(data.properties);
  for (const original of data.visits) {
    const visit = reviewedEncounter(original);
    if (visit.voided) continue;
    const propertyId = visit.propertyId ? locations.get(visit.propertyId)?.id : undefined;
    if (!propertyId) continue;
    const summary = summaries.get(propertyId) ?? { count: 0, latest: visit };
    summary.count += 1;
    if (visit.recordedAt > summary.latest.recordedAt) summary.latest = visit;
    if (visit.outcome !== "do_not_visit" && (!summary.latestOrdinary || visit.recordedAt > summary.latestOrdinary.recordedAt)) summary.latestOrdinary = visit;
    summaries.set(propertyId, summary);
  }
  const restrictedLocations = new Set(pendingRestrictedLocations);
  for (const restriction of data.restrictions ?? []) if (restriction.active && restriction.propertyId && ["all", "visit"].includes(restriction.channel)) restrictedLocations.add(restriction.propertyId);
  const assignments = (data.assignments ?? []).filter((a) => a.eventId === data.preferences.activeEventId && !["declined", "cancelled"].includes(a.status));
  const areaGroups = new Map(assignments.map((a) => [a.territoryId, a.assignedTeamId]));
  const groupAreas = new Map<string, string[]>();
  for (const a of assignments) if (a.assignedTeamId) groupAreas.set(a.assignedTeamId, [...(groupAreas.get(a.assignedTeamId) ?? []), a.territoryId]);
  return { ...data,
    properties: data.properties.map((p) => {
      const summary = summaries.get(p.id);
      return { ...p, visitCount: summary?.count ?? 0, lastVisitedAt: summary?.latest.recordedAt,
        currentOutcome: restrictedLocations.has(p.id) ? "do_not_visit" : summary?.latestOrdinary?.outcome ?? "unvisited" };
    }),
    territories: data.territories.map((t) => ({ ...t, assignedTeamId: areaGroups.get(t.id) })),
    teams: data.teams.map((t) => ({ ...t, territoryIds: groupAreas.get(t.id) ?? [] })),
  };
}
