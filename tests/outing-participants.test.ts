import { describe, expect, it } from "vitest";
import { createSeedData } from "../lib/seed";
import { changeOutingCheckIn, changeOutingRoster, respondToOutingInvitation } from "../lib/outing-participants";
import { stageWorkspaceChange } from "../lib/outreach-queue";

function fixture() {
  const data = createSeedData();
  data.outingParticipants = [];
  data.events[0].status = "ready";
  return data;
}

describe("outing invitations and attendance", () => {
  it("invites people before any target assignment exists and preserves their responses", () => {
    const data = fixture();
    const eventId = data.events[0].id;
    const invited = changeOutingRoster(data, eventId, ["volunteer_maya", "volunteer_jordan"], (id) => `invite-${id}`);
    expect(invited.assignments).toHaveLength(data.assignments?.length ?? 0);
    expect(invited.outingParticipants.map((participant) => participant.volunteerId)).toEqual(["volunteer_maya", "volunteer_jordan"]);
    expect(invited.outingParticipants.every((participant) => participant.status === "invited")).toBe(true);

    const responded = respondToOutingInvitation(invited, "invite-volunteer_maya", "volunteer_maya", "going");
    const expanded = changeOutingRoster(responded, eventId, ["volunteer_maya", "volunteer_jordan", "volunteer_sam"], (id) => `invite-${id}`);
    expect(expanded.outingParticipants.find((participant) => participant.volunteerId === "volunteer_maya")?.status).toBe("going");
  });

  it("checks in invitees and walk-ins without changing target crews", () => {
    const initial = fixture();
    const data = changeOutingRoster(initial, initial.events[0].id, ["volunteer_maya"], (id) => `invite-${id}`);
    const checkedIn = changeOutingCheckIn(data, data.events[0].id, ["volunteer_maya", "volunteer_sam"], (id) => `walk-in-${id}`);
    expect(checkedIn.outingParticipants).toEqual(expect.arrayContaining([
      expect.objectContaining({ volunteerId: "volunteer_maya", status: "checked_in" }),
      expect.objectContaining({ volunteerId: "volunteer_sam", status: "checked_in" }),
    ]));
    expect(checkedIn.assignments).toEqual(data.assignments);
    expect(() => changeOutingRoster(checkedIn, data.events[0].id, ["volunteer_sam"], (id) => `invite-${id}`))
      .toThrow("Remove a person from check-in");
  });

  it("lets only the invited person record their response", () => {
    const initial = fixture();
    const data = changeOutingRoster(initial, initial.events[0].id, ["volunteer_maya"], (id) => `invite-${id}`);
    expect(() => respondToOutingInvitation(data, "invite-volunteer_maya", "volunteer_sam", "going"))
      .toThrow("not assigned to you");
  });

  it("stages a connected roster as participant operations, not target assignments", () => {
    const data = fixture();
    const churchId = "00000000-0000-4000-8000-000000000001";
    data.church.id = churchId;
    data.sync = { mode: "connected", pending: [], commands: [], recordVersions: {}, serverRevision: 1 };
    const next = changeOutingRoster(data, data.events[0].id, ["volunteer_maya", "volunteer_jordan"], (id) => `invite-${id}`);
    const staged = stageWorkspaceChange(data, next, { churchId, userId: "00000000-0000-4000-8000-000000000002" });
    const operations = staged.sync.commands?.at(-1)?.command.operations ?? [];
    expect(operations.map((operation) => operation.entityType)).toEqual(["participant", "participant"]);
    expect(operations.every((operation) => operation.record?.targetId === undefined)).toBe(true);
  });
});
