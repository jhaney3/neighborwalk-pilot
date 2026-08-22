import { describe, expect, it } from "vitest";
import { neighborWalkDataSchema, type NeighborWalkData, type PendingMutation } from "../lib/domain";
import { createSeedData } from "../lib/seed";
import { mergePendingWorkspaceChanges } from "../lib/workspace-sync";

function pending(entityType: PendingMutation["entityType"], entityId: string): PendingMutation {
  return {
    id: `mutation_${entityType}_${entityId}`,
    entityType,
    entityId,
    operation: "upsert",
    changedAt: "2026-08-13T12:05:00.000Z",
  };
}

function connected(data: NeighborWalkData): NeighborWalkData {
  return { ...data, sync: { ...data.sync, mode: "connected", pending: [] } };
}

describe("workspace synchronization", () => {
  it("layers an offline visit onto newer remote records without losing either device's work", () => {
    const seed = connected(createSeedData());
    const localProperty = seed.properties[0];
    const remoteProperty = seed.properties[1];
    const localVisit = {
      ...seed.visits[0],
      id: "visit_local_offline",
      propertyId: localProperty.id,
      outcome: "conversation" as const,
      recordedAt: "2030-08-13T12:05:00.000Z",
      deviceId: "phone_local",
    };
    const remoteVisit = {
      ...seed.visits[0],
      id: "visit_remote_newer",
      propertyId: remoteProperty.id,
      outcome: "no_answer" as const,
      recordedAt: "2030-08-13T12:03:00.000Z",
      deviceId: "phone_remote",
    };
    const local: NeighborWalkData = {
      ...seed,
      visits: [localVisit, ...seed.visits],
      properties: seed.properties.map((property) => property.id === localProperty.id
        ? { ...property, currentOutcome: localVisit.outcome, lastVisitedAt: localVisit.recordedAt, visitCount: property.visitCount + 1 }
        : property),
      sync: { mode: "connected", pending: [pending("visit", localVisit.id)] },
      updatedAt: localVisit.recordedAt,
    };
    const remote: NeighborWalkData = {
      ...seed,
      visits: [remoteVisit, ...seed.visits],
      properties: seed.properties.map((property) => property.id === remoteProperty.id
        ? { ...property, currentOutcome: remoteVisit.outcome, lastVisitedAt: remoteVisit.recordedAt, visitCount: property.visitCount + 1 }
        : property),
      updatedAt: remoteVisit.recordedAt,
    };

    const merged = mergePendingWorkspaceChanges(remote, local);

    expect(merged.visits.map((visit) => visit.id)).toContain(localVisit.id);
    expect(merged.visits.map((visit) => visit.id)).toContain(remoteVisit.id);
    expect(merged.properties.find((property) => property.id === localProperty.id)?.currentOutcome).toBe("conversation");
    expect(merged.properties.find((property) => property.id === remoteProperty.id)?.currentOutcome).toBe("no_answer");
    expect(merged.sync.pending).toEqual(local.sync.pending);
    expect(neighborWalkDataSchema.safeParse(merged).success).toBe(true);
  });

  it("uses the newest visit when two devices update the same location", () => {
    const seed = connected(createSeedData());
    const property = seed.properties[0];
    const remoteVisit = { ...seed.visits[0], id: "visit_remote", propertyId: property.id, outcome: "declined" as const, recordedAt: "2030-08-13T12:06:00.000Z" };
    const localVisit = { ...seed.visits[0], id: "visit_local", propertyId: property.id, outcome: "conversation" as const, recordedAt: "2030-08-13T12:05:00.000Z" };
    const remote = { ...seed, visits: [remoteVisit, ...seed.visits] };
    const local = { ...seed, visits: [localVisit, ...seed.visits], sync: { mode: "connected" as const, pending: [pending("visit", localVisit.id)] } };

    const merged = mergePendingWorkspaceChanges(remote, local);

    expect(merged.properties.find((candidate) => candidate.id === property.id)?.currentOutcome).toBe("declined");
    expect(merged.properties.find((candidate) => candidate.id === property.id)?.lastVisitedAt).toBe(remoteVisit.recordedAt);
  });

  it("preserves an explicit property deletion during reconciliation", () => {
    const seed = connected(createSeedData());
    const removed = seed.properties.find((property) => property.visitCount === 0) ?? seed.properties[0];
    const local = {
      ...seed,
      properties: seed.properties.filter((property) => property.id !== removed.id),
      sync: {
        mode: "connected" as const,
        pending: [{ ...pending("property", removed.id), operation: "delete" as const }],
      },
    };

    const merged = mergePendingWorkspaceChanges(seed, local);

    expect(merged.properties.some((property) => property.id === removed.id)).toBe(false);
  });

  it("merges permission-based resident records and leader-managed groups independently", () => {
    const seed = connected(createSeedData());
    const createdAt = "2030-08-13T12:05:00.000Z";
    const resident = {
      id: "resident_local",
      churchId: seed.church.id,
      propertyId: seed.properties[0].id,
      name: "Neighbor",
      faithStatus: "not_discussed" as const,
      preferredContact: "none" as const,
      consentToStore: true as const,
      consentToContact: false,
      consentRecordedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    };
    const team = {
      id: "team_local",
      churchId: seed.church.id,
      eventId: seed.preferences.activeEventId,
      name: "Team Local",
      memberIds: [],
      territoryIds: [],
      status: "ready" as const,
    };
    const local = {
      ...seed,
      residents: [resident],
      teams: [...seed.teams, team],
      sync: { mode: "connected" as const, pending: [pending("resident", resident.id), pending("team", team.id)] },
    };

    const merged = mergePendingWorkspaceChanges(seed, local);

    expect(merged.residents).toContainEqual(resident);
    expect(merged.teams).toContainEqual(team);
    expect(neighborWalkDataSchema.safeParse(merged).success).toBe(true);
  });
});
