import { describe, expect, it } from "vitest";
import { deleteTeamRecord, deleteTerritoryRecord, neighborWalkDataSchema, type NeighborWalkData, type PendingMutation } from "../lib/domain";
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
  it("moves a territory without replacing concurrent encounters from another device", () => {
    const seed = connected(createSeedData());
    const source = seed.territories[0];
    const destination = seed.territories.find((territory) => territory.id !== source.id && territory.eventId === source.eventId)!;
    const lateVisit = { ...seed.visits[0], id: "late-remote-encounter", territoryId: source.id };
    const remote = { ...seed, visits: [...seed.visits, lateVisit] };
    const local = deleteTerritoryRecord(seed, source.id, destination.id);
    local.sync.pending = [{ ...pending("territory", source.id), operation: "delete", destinationTerritoryId: destination.id }];
    const merged = mergePendingWorkspaceChanges(remote, local);
    expect(merged.visits.find((visit) => visit.id === lateVisit.id)?.territoryId).toBe(destination.id);
    expect(merged.properties.filter((property) => property.territoryId === source.id)).toHaveLength(0);
    expect(merged.visits).toHaveLength(remote.visits.length);
  });

  it("cleans up team assignments during reconciliation", () => {
    const seed = connected(createSeedData());
    const team = seed.teams[0];
    seed.territories[0].assignedTeamId = team.id;
    seed.followUps[0].assignedTeamId = team.id;
    const local = deleteTeamRecord(seed, team.id);
    local.sync.pending = [{ ...pending("team", team.id), operation: "delete" }];
    const merged = mergePendingWorkspaceChanges(seed, local);
    expect(merged.territories.some((territory) => territory.assignedTeamId === team.id)).toBe(false);
    expect(merged.followUps.some((task) => task.assignedTeamId === team.id)).toBe(false);
  });

  it("refuses an unreconciled legacy bulk replacement without dropping its pending work", () => {
    const seed = connected(createSeedData());
    const local = { ...seed, visits: [], sync: { ...seed.sync, pending: [pending("data", seed.church.id)] } };
    expect(() => mergePendingWorkspaceChanges(seed, local)).toThrow("supervised recovery");
    expect(local.sync.pending).toHaveLength(1);
    expect(seed.visits.length).toBeGreaterThan(0);
  });

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

  it("merges resident records and leader-managed groups independently", () => {
    const seed = connected(createSeedData());
    const createdAt = "2030-08-13T12:05:00.000Z";
    const resident = {
      id: "resident_local",
      churchId: seed.church.id,
      propertyId: seed.properties[0].id,
      name: "Neighbor",
      faithStatus: "not_discussed" as const,
      discipleshipStage: "new_connection" as const,
      assignedVolunteerId: seed.preferences.activeVolunteerId,
      createdByVolunteerId: seed.preferences.activeVolunteerId,
      sharedWithVolunteerIds: [],
      sharedWithTeamIds: [],
      status: "active" as const,
      preferredContact: "none" as const,
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

  it("merges person notes independently so concurrent history is preserved", () => {
    const seed = connected(createSeedData());
    const resident = seed.residents[0];
    const remoteNote = {
      id: "person_note_remote",
      churchId: seed.church.id,
      residentId: resident.id,
      authorId: seed.volunteers[1].id,
      kind: "prayer" as const,
      body: "Remote prayer note",
      createdAt: "2030-08-13T12:04:00.000Z",
    };
    const localNote = {
      id: "person_note_local",
      churchId: seed.church.id,
      residentId: resident.id,
      authorId: seed.volunteers[2].id,
      kind: "conversation" as const,
      body: "Offline conversation note",
      createdAt: "2030-08-13T12:05:00.000Z",
    };
    const remote = { ...seed, personNotes: [remoteNote, ...seed.personNotes] };
    const local = {
      ...seed,
      personNotes: [localNote, ...seed.personNotes],
      sync: { mode: "connected" as const, pending: [pending("person_note", localNote.id)] },
    };

    const merged = mergePendingWorkspaceChanges(remote, local);

    expect(merged.personNotes.map((note) => note.id)).toContain(remoteNote.id);
    expect(merged.personNotes.map((note) => note.id)).toContain(localNote.id);
    expect(neighborWalkDataSchema.safeParse(merged).success).toBe(true);
  });

  it("merges protected person follow-ups without putting them in the shared task stream", () => {
    const seed = connected(createSeedData());
    const resident = seed.residents[0];
    const personFollowUp = {
      id: "followup_person_local",
      churchId: seed.church.id,
      propertyId: resident.propertyId,
      residentId: resident.id,
      dueAt: "2030-08-20T17:00:00.000Z",
      status: "scheduled" as const,
      note: "Send the reading plan and ask how the first week went.",
      history: [{
        id: "activity_person_local",
        action: "created" as const,
        note: "Send the reading plan and ask how the first week went.",
        dueAt: "2030-08-20T17:00:00.000Z",
        actorId: resident.assignedVolunteerId,
        createdAt: "2030-08-13T12:05:00.000Z",
      }],
      createdAt: "2030-08-13T12:05:00.000Z",
    };
    const local = {
      ...seed,
      followUps: [...seed.followUps, personFollowUp],
      sync: { mode: "connected" as const, pending: [pending("person_follow_up", personFollowUp.id)] },
    };

    const merged = mergePendingWorkspaceChanges(seed, local);

    expect(merged.followUps).toContainEqual(personFollowUp);
    expect(merged.sync.pending).toContainEqual(expect.objectContaining({
      entityType: "person_follow_up",
      entityId: personFollowUp.id,
    }));
    expect(neighborWalkDataSchema.safeParse(merged).success).toBe(true);
  });
});
