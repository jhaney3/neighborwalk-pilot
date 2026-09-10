import { describe, expect, it } from "vitest";
import { changeFollowUp, createFollowUp } from "../lib/follow-ups";

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
});
