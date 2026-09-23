import { describe, expect, it } from "vitest";
import { assignFollowUp, changeFollowUp, createFollowUp, respondToFollowUp } from "../lib/follow-ups";
import { createSeedData } from "../lib/seed";

const now = "2026-09-08T12:00:00.000Z";
const tomorrow = "2026-09-09T17:00:00.000Z";
const input = { churchId: "church", propertyId: "property", dueAt: tomorrow, note: "Return visit", assignedTeamId: "team" };

describe("follow-up lifecycle", () => {
  it("records a location task's assignment and dated creation history", () => {
    const task = createFollowUp(input, "volunteer", now);
    expect(task).toMatchObject({ ...input, status: "scheduled", createdAt: now });
    expect(task.history).toEqual([expect.objectContaining({ action: "created", actorId: "volunteer", createdAt: now, dueAt: tomorrow, note: input.note })]);
  });

  it("keeps person tasks with the person's owner when creating a subsequent task", () => {
    const task = createFollowUp({ ...input, residentId: "person", parentFollowUpId: "previous" }, "owner", now);
    expect(task.assignedTeamId).toBeUndefined();
    expect(task.residentId).toBe("person");
    expect(task.parentFollowUpId).toBe("previous");
  });

  it("reschedules, then completes a task without changing its earlier history", () => {
    const original = createFollowUp(input, "volunteer", now);
    const dueAt = "2026-09-10T17:00:00.000Z";
    const rescheduled = changeFollowUp(original, { action: "rescheduled", dueAt, note: "Requested Thursday" }, "leader", tomorrow);
    const completed = changeFollowUp(rescheduled, { action: "completed", note: "Visited" }, "volunteer", dueAt);

    expect(original.dueAt).toBe(tomorrow);
    expect(original.history).toHaveLength(1);
    expect(rescheduled).toMatchObject({ status: "scheduled", dueAt });
    expect(completed).toMatchObject({ status: "completed", dueAt, completionNote: "Visited", completedAt: dueAt });
    expect(completed.history.map((entry) => entry.action)).toEqual(["created", "rescheduled", "completed"]);
    expect(completed.history.map((entry) => entry.actorId)).toEqual(["volunteer", "leader", "volunteer"]);
  });

  it("records a cancellation reason and leaves resolved tasks unchanged", () => {
    const original = createFollowUp(input, "volunteer", now);
    const cancelled = changeFollowUp(original, { action: "cancelled", note: "Location marked do not revisit." }, "volunteer", tomorrow);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.history.at(-1)?.note).toBe("Location marked do not revisit.");
    expect(changeFollowUp(cancelled, { action: "completed" }, "volunteer", tomorrow)).toBe(cancelled);
    expect(original.status).toBe("scheduled");
  });

  it("treats the owner's own completion or reschedule as acceptance, but not someone else's", () => {
    const task = createFollowUp(input, "volunteer", now);
    for (const acceptance of ["pending", "declined", undefined] as const) {
      expect(() => changeFollowUp({ ...task, acceptance }, { action: "completed" }, "leader", now)).toThrow("must accept");
      expect(() => changeFollowUp({ ...task, acceptance }, { action: "rescheduled", dueAt: tomorrow }, "leader", now)).toThrow("must accept");
      const completed = changeFollowUp({ ...task, acceptance }, { action: "completed" }, "volunteer", now);
      expect(completed).toMatchObject({ status: "completed", acceptance: "accepted" });
      expect(completed.history.map((item) => item.action)).toEqual(["created", "accepted", "completed"]);
      expect(changeFollowUp({ ...task, acceptance }, { action: "cancelled", note: "No longer requested." }, "leader", now).status).toBe("cancelled");
    }
  });

  it("requires an active owner and records reassignment/acceptance without rewriting history", () => {
    const seed = createSeedData();
    const leader = { ...seed.volunteers[0], id: "leader", role: "leader" as const, active: true };
    const volunteer = { ...leader, id: "volunteer", role: "volunteer" as const };
    const inactive = { ...volunteer, id: "inactive", active: false };
    const task = createFollowUp({ ...input, id: "task" }, leader.id, now);
    const data = { ...seed, volunteers: [leader, volunteer, inactive], followUps: [task] };
    expect(() => assignFollowUp(data, "missing", volunteer.id, leader.id, now)).toThrow("no longer open");
    expect(() => assignFollowUp(data, task.id, inactive.id, leader.id, now)).toThrow("active church member");
    expect(() => assignFollowUp(data, task.id, volunteer.id, volunteer.id, now)).toThrow("Only a church leader");
    const assigned = assignFollowUp(data, task.id, volunteer.id, leader.id, now);
    expect(assigned.followUps[0].acceptance).toBe("pending");
    expect(() => respondToFollowUp(assigned, task.id, "accepted", leader.id, now)).toThrow("responsible person");
    const declined = respondToFollowUp(assigned, task.id, "declined", volunteer.id, now);
    const accepted = respondToFollowUp(declined, task.id, "accepted", volunteer.id, now);
    expect(accepted.followUps[0].history.map((entry) => entry.action)).toEqual(["created", "reassigned", "declined", "accepted"]);
    expect(task.history).toHaveLength(1);
    expect(respondToFollowUp(accepted, task.id, "accepted", volunteer.id, now)).toBe(accepted);
    expect(() => respondToFollowUp({ ...accepted, followUps: [{ ...accepted.followUps[0], status: "completed" }] }, task.id, "declined", volunteer.id, now)).toThrow("no longer open");
  });
});
