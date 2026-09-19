import { describe, expect, it } from "vitest";
import { createSeedData } from "../lib/seed";
import { changeWalkTargetCrew, targetCrewMemberIds } from "../lib/walk-crews";
import { stageWorkspaceChange } from "../lib/outreach-queue";

function walkData() {
  const data = createSeedData();
  const event = data.events[0];
  const territory = data.territories[0];
  return {
    ...data,
    assignments: [],
    walkTargets: [{
      id: "target-tonight",
      churchId: data.church.id,
      eventId: event.id,
      territoryId: territory.id,
      name: "Maple blocks",
      color: "#286c59",
      selectionKind: "whole_zone" as const,
      geometry: { type: "Polygon" as const, coordinates: [territory.boundary] },
      parcels: [],
      rosterState: "draft" as const,
    }],
  };
}

describe("event-day walk crews", () => {
  it("turns several people into a target-specific crew and one accountable assignment", () => {
    const changed = changeWalkTargetCrew(walkData(), "target-tonight", ["volunteer_erica", "volunteer_maya"], {
      assignmentId: "assignment-new",
      teamId: "team-new",
    });

    expect(changed.data.teams.find((team) => team.id === "team-new")).toMatchObject({
      eventId: changed.data.events[0].id,
      name: "Maple blocks crew",
      memberIds: ["volunteer_erica", "volunteer_maya"],
      status: "active",
    });
    expect(changed.data.assignments).toContainEqual(expect.objectContaining({
      id: "assignment-new",
      targetId: "target-tonight",
      assignedTeamId: "team-new",
      status: "assigned",
    }));
    expect(changed.data.assignments?.[0].assignedVolunteerId).toBeUndefined();
    expect(targetCrewMemberIds(changed.data, "target-tonight")).toEqual(["volunteer_erica", "volunteer_maya"]);
  });

  it("updates an accepted crew in place when attendance changes", () => {
    const first = changeWalkTargetCrew(walkData(), "target-tonight", ["volunteer_erica", "volunteer_maya"], {
      assignmentId: "assignment-new",
      teamId: "team-new",
    }).data;
    const accepted = { ...first, assignments: first.assignments?.map((assignment) => ({ ...assignment, status: "accepted" as const })) };
    const changed = changeWalkTargetCrew(accepted, "target-tonight", ["volunteer_erica", "volunteer_jordan"], {
      assignmentId: "unused-assignment",
      teamId: "unused-team",
    });

    expect(changed.teamId).toBe("team-new");
    expect(changed.data.assignments?.[0]).toMatchObject({ id: "assignment-new", assignedTeamId: "team-new", status: "accepted" });
    expect(changed.data.teams.find((team) => team.id === "team-new")?.memberIds).toEqual(["volunteer_erica", "volunteer_jordan"]);
  });

  it("supports a solo assignment and clearing the crew later", () => {
    const solo = changeWalkTargetCrew(walkData(), "target-tonight", ["volunteer_sam"], {
      assignmentId: "assignment-solo",
      teamId: "unused-team",
    });
    expect(solo.data.assignments?.[0]).toMatchObject({ assignedVolunteerId: "volunteer_sam", status: "assigned" });
    expect(solo.data.assignments?.[0].assignedTeamId).toBeUndefined();

    const cleared = changeWalkTargetCrew(solo.data, "target-tonight", [], {
      assignmentId: "unused-assignment",
      teamId: "unused-team",
    });
    expect(cleared.data.assignments?.[0].status).toBe("cancelled");
    expect(targetCrewMemberIds(cleared.data, "target-tonight")).toEqual([]);
  });

  it("rejects inactive or unknown people", () => {
    expect(() => changeWalkTargetCrew(walkData(), "target-tonight", ["volunteer-not-here"], {
      assignmentId: "assignment-new",
      teamId: "team-new",
    })).toThrow("active church members");
  });

  it("queues the event-scoped crew and its assignment in one connected change", () => {
    const base = walkData();
    const churchId = "00000000-0000-4000-8000-000000000001";
    const scope = { churchId, userId: "00000000-0000-4000-8000-000000000002" };
    base.church.id = churchId;
    base.sync = { mode: "connected", pending: [], commands: [], recordVersions: {}, serverRevision: 1 };
    const changed = changeWalkTargetCrew(base, "target-tonight", ["volunteer_erica", "volunteer_maya"], {
      assignmentId: "assignment-new",
      teamId: "team-new",
    }).data;
    const staged = stageWorkspaceChange(base, changed, scope);
    const operations = staged.sync.commands?.at(-1)?.command.operations ?? [];
    expect(operations.map((operation) => operation.entityType)).toEqual(["team", "assignment"]);
    expect(operations[0].record).toMatchObject({ eventId: base.events[0].id, memberIds: ["volunteer_erica", "volunteer_maya"] });
    expect(operations[1].record).toMatchObject({ targetId: "target-tonight", assignedTeamId: "team-new", status: "assigned" });
  });
});
