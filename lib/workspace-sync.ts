import type {
  AuditEntry,
  FollowUp,
  NeighborWalkData,
  PendingMutation,
  Property,
  Visit,
} from "./domain";

type Identified = { id: string };

function latestMutations(pending: PendingMutation[]) {
  const latest = new Map<string, PendingMutation>();
  for (const item of pending) latest.set(`${item.entityType}:${item.entityId}`, item);
  return [...latest.values()];
}

function applyEntityMutations<T extends Identified>(
  remote: T[],
  local: T[],
  mutations: PendingMutation[],
  entityType: PendingMutation["entityType"],
) {
  const merged = new Map(remote.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));
  for (const item of mutations) {
    if (item.entityType !== entityType) continue;
    if (item.operation === "delete") {
      merged.delete(item.entityId);
      continue;
    }
    const localItem = localById.get(item.entityId);
    if (localItem) merged.set(item.entityId, localItem);
  }
  return [...merged.values()];
}

function mergeAudit(remote: AuditEntry[], local: AuditEntry[], mutations: PendingMutation[]) {
  const changedEntities = new Set(mutations.map((item) => `${item.entityType}:${item.entityId}`));
  const merged = new Map(remote.map((entry) => [entry.id, entry]));
  for (const entry of local) {
    if (changedEntities.has(`${entry.entityType}:${entry.entityId}`)) merged.set(entry.id, entry);
  }
  return [...merged.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 1000);
}

function mergeVisitSideEffects(
  properties: Property[],
  visits: Visit[],
  followUps: FollowUp[],
  affectedPropertyIds: Set<string>,
) {
  const visitsByProperty = new Map<string, Visit[]>();
  for (const visit of visits) {
    if (!affectedPropertyIds.has(visit.propertyId)) continue;
    const grouped = visitsByProperty.get(visit.propertyId) ?? [];
    grouped.push(visit);
    visitsByProperty.set(visit.propertyId, grouped);
  }

  const nextProperties = properties.map((property) => {
    if (!affectedPropertyIds.has(property.id)) return property;
    const propertyVisits = (visitsByProperty.get(property.id) ?? [])
      .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
    const latest = propertyVisits[0];
    if (!latest) {
      return { ...property, currentOutcome: "unvisited" as const, visitCount: 0, lastVisitedAt: undefined };
    }
    return {
      ...property,
      currentOutcome: latest.outcome,
      lastVisitedAt: latest.recordedAt,
      visitCount: propertyVisits.length,
      updatedAt: property.updatedAt > latest.recordedAt ? property.updatedAt : latest.recordedAt,
    };
  });

  const doNotVisitProperties = new Set(nextProperties
    .filter((property) => affectedPropertyIds.has(property.id) && property.currentOutcome === "do_not_visit")
    .map((property) => property.id));
  const nextFollowUps = followUps.map((followUp) => (
    doNotVisitProperties.has(followUp.propertyId) && followUp.status === "scheduled"
      ? { ...followUp, status: "cancelled" as const }
      : followUp
  ));

  return { properties: nextProperties, followUps: nextFollowUps };
}

export function mergePendingWorkspaceChanges(remote: NeighborWalkData, local: NeighborWalkData): NeighborWalkData {
  const mutations = latestMutations(local.sync.pending);
  if (!mutations.length) return remote;
  if (mutations.some((item) => item.entityType === "data")) {
    return { ...local, sync: { ...local.sync, mode: "connected" } };
  }

  let properties = applyEntityMutations(remote.properties, local.properties, mutations, "property");
  const visits = applyEntityMutations(remote.visits, local.visits, mutations, "visit")
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
  let followUps = applyEntityMutations(remote.followUps, local.followUps, mutations, "follow_up");
  followUps = applyEntityMutations(followUps, local.followUps, mutations, "person_follow_up");
  const residents = applyEntityMutations(remote.residents, local.residents, mutations, "resident");
  const residentIds = new Set(residents.map((resident) => resident.id));
  const personNotes = applyEntityMutations(remote.personNotes, local.personNotes, mutations, "person_note")
    .filter((note) => residentIds.has(note.residentId))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const territories = applyEntityMutations(remote.territories, local.territories, mutations, "territory");
  const guide = applyEntityMutations(remote.guide, local.guide, mutations, "guide")
    .sort((left, right) => left.order - right.order);

  const affectedPropertyIds = new Set<string>();
  const remoteVisitById = new Map(remote.visits.map((visit) => [visit.id, visit]));
  const localVisitById = new Map(local.visits.map((visit) => [visit.id, visit]));
  for (const item of mutations) {
    if (item.entityType !== "visit") continue;
    const propertyId = localVisitById.get(item.entityId)?.propertyId ?? remoteVisitById.get(item.entityId)?.propertyId;
    if (propertyId) affectedPropertyIds.add(propertyId);
  }

  if (affectedPropertyIds.size) {
    const mergedFollowUps = new Map(followUps.map((followUp) => [followUp.id, followUp]));
    for (const followUp of local.followUps) {
      if (affectedPropertyIds.has(followUp.propertyId)) mergedFollowUps.set(followUp.id, followUp);
    }
    const sideEffects = mergeVisitSideEffects(properties, visits, [...mergedFollowUps.values()], affectedPropertyIds);
    properties = sideEffects.properties;
    followUps = sideEffects.followUps;
  }

  let teams = applyEntityMutations(remote.teams, local.teams, mutations, "team");
  for (const item of mutations) {
    if (item.entityType !== "territory") continue;
    teams = teams.map((team) => ({
      ...team,
      territoryIds: team.territoryIds.filter((territoryId) => territoryId !== item.entityId),
    }));
    if (item.operation === "delete") continue;
    const territory = local.territories.find((candidate) => candidate.id === item.entityId);
    if (!territory?.assignedTeamId) continue;
    teams = teams.map((team) => team.id === territory.assignedTeamId
      ? { ...team, territoryIds: [...team.territoryIds, territory.id] }
      : team);
  }

  const church = mutations.some((item) => item.entityType === "settings") ? local.church : remote.church;
  const newestUpdatedAt = local.updatedAt > remote.updatedAt ? local.updatedAt : remote.updatedAt;
  return {
    ...remote,
    church,
    territories,
    teams,
    properties,
    visits,
    followUps,
    residents,
    personNotes,
    guide,
    audit: mergeAudit(remote.audit, local.audit, mutations),
    preferences: local.preferences,
    sync: { ...local.sync, mode: "connected" },
    updatedAt: newestUpdatedAt,
  };
}
