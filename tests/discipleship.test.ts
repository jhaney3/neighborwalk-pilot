import { describe, expect, it } from "vitest";
import {
  personInsertForCreator,
  userIdForVolunteer,
  volunteerIdForUser,
  withAuthenticatedVolunteer,
  withSnapshotDiscipleship,
  withoutSnapshotDiscipleship,
} from "../lib/discipleship";
import { createSeedData } from "../lib/seed";

describe("protected discipleship records", () => {
  it("keeps person follow-ups visible after a shared snapshot is saved", () => {
    const local = createSeedData();
    const snapshot = withoutSnapshotDiscipleship(local);
    const restored = withSnapshotDiscipleship(snapshot, local);

    expect(local.followUps.some((task) => task.residentId)).toBe(true);
    expect(restored.followUps).toHaveLength(local.followUps.length);
    expect(new Set(restored.followUps.map((task) => task.id))).toEqual(new Set(local.followUps.map((task) => task.id)));
    expect(restored.residents).toEqual(local.residents);
    expect(restored.personNotes).toEqual(local.personNotes);
    expect(snapshot.followUps.every((task) => !task.residentId)).toBe(true);
    expect(withSnapshotDiscipleship(restored, local).followUps).toEqual(restored.followUps);
  });

  it("converts authenticated users to stable volunteer identifiers", () => {
    const userId = "fc77fe56-7784-4b60-9be8-3005bb250c6b";
    expect(userIdForVolunteer(volunteerIdForUser(userId))).toBe(userId);
    expect(userIdForVolunteer("volunteer_demo")).toBeNull();
  });

  it("adds the signed-in member to older volunteer directories", () => {
    const data = createSeedData();
    const userId = "fc77fe56-7784-4b60-9be8-3005bb250c6b";
    const connected = withAuthenticatedVolunteer(data, {
      churchId: data.church.id,
      userId,
      role: "volunteer",
      email: "volunteer@example.org",
      displayName: "Current Volunteer",
    });

    expect(connected.volunteers.find((volunteer) => volunteer.id === volunteerIdForUser(userId))).toMatchObject({
      name: "Current Volunteer",
      email: "volunteer@example.org",
      active: true,
    });
  });

  it("forces a new person to begin with the authenticated creator as owner", () => {
    const data = createSeedData();
    const userId = "fc77fe56-7784-4b60-9be8-3005bb250c6b";
    const insert = personInsertForCreator(data.residents[0], data.church.id, userId);

    expect(insert.created_by).toBe(userId);
    expect(insert.assigned_to).toBe(userId);
  });

  it("never puts people, their notes, person tasks, or related audit details in the shared snapshot", () => {
    const data = createSeedData();
    const resident = data.residents[0];
    const note = data.personNotes[0];
    const personFollowUp = data.followUps.find((followUp) => followUp.residentId === resident.id)!;
    const snapshot = withoutSnapshotDiscipleship({
      ...data,
      audit: [
        { id: "person_audit", action: "resident.updated", entityType: "resident", entityId: resident.id, actorId: data.preferences.activeVolunteerId, createdAt: data.updatedAt, summary: "Person updated" },
        { id: "task_audit", action: "follow_up.created", entityType: "person_follow_up", entityId: personFollowUp.id, actorId: data.preferences.activeVolunteerId, createdAt: data.updatedAt, summary: "Person follow-up planned" },
        ...data.audit,
      ],
      sync: {
        ...data.sync,
        pending: [
          { id: "person_pending", entityType: "resident", entityId: resident.id, operation: "upsert", changedAt: data.updatedAt },
          { id: "note_pending", entityType: "person_note", entityId: note.id, operation: "upsert", changedAt: data.updatedAt },
          { id: "task_pending", entityType: "person_follow_up", entityId: personFollowUp.id, operation: "upsert", changedAt: data.updatedAt },
        ],
      },
    });

    expect(snapshot.residents).toEqual([]);
    expect(snapshot.personNotes).toEqual([]);
    expect(snapshot.followUps.some((followUp) => followUp.residentId)).toBe(false);
    expect(snapshot.audit.some((entry) => ["resident", "person_note", "person_follow_up"].includes(entry.entityType))).toBe(false);
    expect(snapshot.sync.pending.some((item) => ["resident", "person_note", "person_follow_up"].includes(item.entityType))).toBe(false);
  });
});
