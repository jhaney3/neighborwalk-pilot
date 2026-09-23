import { describe, expect, it } from "vitest";
import { createSeedData } from "../lib/seed";
import { assignmentToAccept, fieldWalkArea, fieldWalkAssignment, homeWalk } from "../lib/home-walk";
import type { NeighborWalkData } from "../lib/domain";
import type { WalkTarget } from "../lib/walk-targets";

function walkTarget(data: NeighborWalkData, id: string, eventId = "mine", territoryId = data.territories[0].id, overrides: Partial<WalkTarget> = {}): WalkTarget {
  return {
    id,
    churchId: data.church.id,
    eventId,
    territoryId,
    name: id,
    color: "#286c59",
    selectionKind: "polygon",
    geometry: { type: "Polygon", coordinates: [[[-87, 35], [-86.9, 35], [-86.9, 35.1], [-87, 35]]] },
    parcels: [{ countyFips: "47055", gislink: `${id}-parcel`, datasetRevision: "overture-2026-09-12", inclusionSource: "polygon_auto" }],
    rosterState: "frozen",
    frozenAt: "2026-09-12T13:00:00.000Z",
    ...overrides,
  };
}

function fixture() {
  const data = createSeedData();
  const actor = data.volunteers[0].id;
  data.events = [
    { ...data.events[0], id: "unrelated", status: "active", startsAt: "2026-09-12T12:00:00Z", endsAt: "2026-09-12T23:00:00Z" },
    { ...data.events[0], id: "mine", status: "ready", startsAt: "2026-09-12T14:00:00Z", endsAt: "2026-09-12T23:00:00Z" },
  ];
  data.outingParticipants = [{ id: "invitation", churchId: data.church.id, eventId: "mine", volunteerId: actor, status: "going" }];
  data.assignments = [{ id: "assignment", churchId: data.church.id, eventId: "mine", territoryId: data.territories[0].id, assignedVolunteerId: actor, status: "accepted" }];
  return { data, actor };
}
describe("personal Home and field context", () => {
  it("shows the volunteer their walk rather than the first active church event", () => {
    const { data, actor } = fixture();
    expect(homeWalk(data, actor, false).outing?.id).toBe("mine");
    expect(homeWalk(data, actor, true).outing?.id).toBe("unrelated");
  });
  it("does not ask leaders to RSVP to the walks they manage", () => {
    const { data, actor } = fixture();
    expect(homeWalk(data, actor, true).responseOutings).toEqual([]);
    expect(homeWalk(data, actor, false).responseOutings).toHaveLength(1);
  });
  it("offers resume only after check-in with a single available target", () => {
    const { data, actor } = fixture();
    data.events[1].status = "active";
    data.outingParticipants[0].status = "checked_in";
    data.assignments![0].status = "assigned";
    expect(homeWalk(data, actor, false).resumable?.id).toBe("assignment");
    data.outingParticipants[0].status = "going";
    expect(homeWalk(data, actor, false).resumable).toBeUndefined();
    data.outingParticipants[0].status = "not_going";
    expect(homeWalk(data, actor, false).outing?.id).toBe("mine");
    expect(homeWalk(data, actor, false).participant?.status).toBe("not_going");
  });
  it("keeps the invitation on Home independently of target reassignment", () => {
    const { data, actor } = fixture();
    data.outingParticipants[0].status = "not_going";
    data.assignments!.push({ ...data.assignments![0], id: "replacement", assignedVolunteerId: data.volunteers[1].id, status: "assigned" });
    data.assignments![0].status = "cancelled";
    expect(homeWalk(data, actor, false).outing?.id).toBe("mine");
  });
  it("lists one personal response for every invited walk", () => {
    const { data, actor } = fixture();
    data.outingParticipants.push({ ...data.outingParticipants[0], id: "other-invitation", eventId: "unrelated", status: "invited" });
    const responseOutings = homeWalk(data, actor, false).responseOutings;
    expect(responseOutings.map(({ outing }) => outing.id)).toEqual(["unrelated", "mine"]);
    expect(responseOutings.map(({ participant }) => participant.id)).toEqual(["other-invitation", "invitation"]);
  });
  it("requires explicit selection when several assigned areas exist", () => {
    const { data, actor } = fixture();
    data.assignments!.push({ ...data.assignments![0], id: "second", territoryId: data.territories[1].id });
    expect(fieldWalkArea(data, "mine", actor, false)).toBeUndefined();
    expect(fieldWalkArea(data, "mine", actor, false, data.territories[1].id)?.id).toBe(data.territories[1].id);
    expect(fieldWalkArea(data, "mine", actor, false, "unrelated-area")).toBeUndefined();
  });
  it("rejects closed walks and unaccepted or unrelated assignments", () => {
    const { data, actor } = fixture();
    expect(fieldWalkArea(data, "unrelated", actor, false)).toBeUndefined();
    data.assignments![0].status = "assigned";
    expect(fieldWalkArea(data, "mine", actor, false)).toBeUndefined();
    data.assignments![0].status = "accepted";
    data.events[1].status = "completed";
    expect(fieldWalkArea(data, "mine", actor, false)).toBeUndefined();
  });
  it("includes team work until the walk is explicitly closed", () => {
    const { data, actor } = fixture();
    data.teams[0].memberIds = [actor];
    data.assignments![0].assignedVolunteerId = undefined;
    data.assignments![0].assignedTeamId = data.teams[0].id;
    expect(fieldWalkArea(data, "mine", actor, false)?.id).toBe(data.territories[0].id);
    expect(homeWalk(data, actor, false).outing?.id).toBe("mine");
    expect(homeWalk(data, actor, false).responseOutings[0]?.outing.id).toBe("mine");
    data.events[1].status = "completed";
    expect(homeWalk(data, actor, false).outing).toBeUndefined();
    expect(homeWalk(data, actor, false).responseOutings).toHaveLength(0);
  });

  it("requires an explicit target when two accepted targets share one parent zone", () => {
    const { data, actor } = fixture();
    const territoryId = data.territories[0].id;
    const first = walkTarget(data, "target-one");
    const second = walkTarget(data, "target-two");
    data.walkTargets = [first, second];
    data.assignments = [
      { ...data.assignments![0], id: "first-assignment", targetId: first.id },
      { ...data.assignments![0], id: "second-assignment", targetId: second.id },
    ];

    expect(fieldWalkAssignment(data, "mine", actor, false, territoryId)).toBeUndefined();
    expect(fieldWalkArea(data, "mine", actor, false, territoryId)).toBeUndefined();
    expect(fieldWalkAssignment(data, "mine", actor, false, territoryId, second.id)?.id).toBe("second-assignment");
    expect(fieldWalkArea(data, "mine", actor, false, territoryId, second.id)?.id).toBe(territoryId);
  });

  it("denies a target belonging to another outing", () => {
    const { data, actor } = fixture();
    const territoryId = data.territories[0].id;
    const foreign = walkTarget(data, "foreign-target", "unrelated");
    data.walkTargets = [foreign];
    data.assignments = [{ ...data.assignments![0], targetId: foreign.id }];

    expect(fieldWalkAssignment(data, "mine", actor, false, territoryId, foreign.id)).toBeUndefined();
  });

  it("requires check-in or legacy acceptance while allowing leaders to open assigned targets", () => {
    const { data, actor } = fixture();
    const territoryId = data.territories[0].id;
    const accepted = walkTarget(data, "accepted-target");

    data.walkTargets = [accepted];
    data.assignments = [{ ...data.assignments![0], targetId: accepted.id, status: "assigned" }];

    expect(fieldWalkAssignment(data, "mine", actor, false, territoryId, accepted.id)).toBeUndefined();
    data.outingParticipants[0].status = "checked_in";
    expect(fieldWalkAssignment(data, "mine", actor, false, territoryId, accepted.id)?.id).toBe("assignment");
    expect(fieldWalkAssignment(data, "mine", actor, true, territoryId, accepted.id)?.id).toBe("assignment");
  });

  it("denies a cancelled target assignment", () => {
    const { data, actor } = fixture();
    const territoryId = data.territories[0].id;
    const accepted = walkTarget(data, "accepted-target");
    data.walkTargets = [accepted];
    data.assignments = [{ ...data.assignments![0], targetId: accepted.id, status: "cancelled" }];

    expect(fieldWalkAssignment(data, "mine", actor, false, territoryId, accepted.id)).toBeUndefined();
  });

  it("denies a target already marked finished", () => {
    const { data, actor } = fixture();
    const territoryId = data.territories[0].id;
    const finished = walkTarget(data, "finished-target", "mine", territoryId, { finishedAt: "2026-09-12T20:00:00.000Z" });
    data.walkTargets = [finished];
    data.assignments = [{ ...data.assignments![0], targetId: finished.id, status: "accepted" }];

    expect(fieldWalkAssignment(data, "mine", actor, false, territoryId, finished.id)).toBeUndefined();
  });

  it("resolves the exact accepted target and offers Home resume for it", () => {
    const { data, actor } = fixture();
    const territoryId = data.territories[0].id;
    const accepted = walkTarget(data, "accepted-target");
    data.events[1].status = "active";
    data.outingParticipants[0].status = "checked_in";
    data.walkTargets = [accepted];
    data.assignments = [{ ...data.assignments![0], targetId: accepted.id, status: "accepted" }];

    expect(fieldWalkAssignment(data, "mine", actor, false, territoryId, accepted.id)?.id).toBe("assignment");
    expect(fieldWalkArea(data, "mine", actor, false, territoryId, accepted.id)?.id).toBe(territoryId);
    expect(homeWalk(data, actor, false).resumable?.targetId).toBe(accepted.id);
  });

  it("acknowledges a check-in crew assignment when its member opens the walk", () => {
    const { data, actor } = fixture();
    const target = walkTarget(data, "crew-target");
    data.events[1].status = "active";
    data.outingParticipants[0].status = "checked_in";
    data.walkTargets = [target];
    data.teams = [{ ...data.teams[0], id: "crew", memberIds: [actor] }];
    data.assignments = [{ id: "assignment", churchId: data.church.id, eventId: "mine", territoryId: target.territoryId, targetId: target.id, assignedTeamId: "crew", status: "assigned" }];

    const assignment = fieldWalkAssignment(data, "mine", actor, false, target.territoryId, target.id);
    expect(assignmentToAccept(data, assignment, actor)?.id).toBe("assignment");
    expect(assignmentToAccept(data, assignment, data.volunteers[1].id)).toBeUndefined();
    expect(assignmentToAccept(data, { ...assignment!, status: "accepted" }, actor)).toBeUndefined();
  });
});
