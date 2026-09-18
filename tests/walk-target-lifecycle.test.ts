import { describe, expect, it } from "vitest";
import { createSeedData } from "../lib/seed";
import { assertWalkTargetDoesNotOverlap, projectWalkTargetLifecycle, replaceWalkTarget } from "../lib/walk-target-lifecycle";
import { stageWorkspaceChange, reconcileOutreachWorkspace } from "../lib/outreach-queue";
import { recordEncounter } from "../lib/encounters";

function fixture() {
  const data = createSeedData();
  data.church.id = "00000000-0000-4000-8000-000000000001";
  data.updatedAt = "2026-09-12T12:00:00Z";
  data.events[0].status = "draft";
  const property = data.properties[0];
  property.parcel = { countyFips: "47055", gislink: "parcel" };
  data.walkTargets = [{ id: "target", churchId: data.church.id, eventId: data.events[0].id, territoryId: property.territoryId!, name: "Tonight", color: "#286c59", selectionKind: "polygon", geometry: { type: "Polygon", coordinates: [[[-87, 35], [-86, 35], [-86, 36], [-87, 35]]] }, parcels: [{ ...property.parcel, datasetRevision: "test", inclusionSource: "manual_add" }], rosterState: "draft" }];
  data.assignments = [{ id: "assignment", churchId: data.church.id, eventId: data.events[0].id, territoryId: property.territoryId!, targetId: "target", assignedVolunteerId: data.preferences.activeVolunteerId, status: "assigned" }];
  return data;
}

describe("local target lifecycle mirrors authoritative side effects", () => {
  it("freezes at Ready and never unfreezes after downgrading an outing", () => {
    const data = fixture();
    data.events[0].status = "ready";
    const ready = projectWalkTargetLifecycle(data);
    expect(ready.walkTargets[0]).toMatchObject({ rosterState: "frozen", frozenAt: data.updatedAt });
    ready.events[0].status = "draft";
    ready.updatedAt = "2026-09-13T12:00:00Z";
    expect(projectWalkTargetLifecycle(ready).walkTargets[0].frozenAt).toBe(data.updatedAt);
  });
  it("freezes on acceptance and preserves a partial roster when manually finished", () => {
    const data = fixture();
    data.assignments![0].status = "accepted";
    const accepted = projectWalkTargetLifecycle(data);
    expect(accepted.walkTargets[0].rosterState).toBe("frozen");
    accepted.assignments![0].status = "completed";
    const finished = projectWalkTargetLifecycle(accepted);
    expect(finished.walkTargets[0].finishedAt).toBe(data.updatedAt);
    expect(finished.visits).toEqual(data.visits);
    expect(finished.walkTargets[0].parcels).toEqual(data.walkTargets[0].parcels);
  });
  it("queues the assignment only and reconstructs freeze after offline reconciliation", () => {
    const base = fixture();
    const next = { ...base, assignments: base.assignments!.map((assignment) => ({ ...assignment, status: "accepted" as const })) };
    const scope = { churchId: base.church.id, userId: "00000000-0000-4000-8000-000000000002" };
    const local = projectWalkTargetLifecycle(stageWorkspaceChange(base, next, scope));
    expect(local.sync.commands?.at(-1)?.command.operations.map((op) => op.entityType)).toEqual(["assignment"]);
    expect(reconcileOutreachWorkspace(base, local).walkTargets[0].rosterState).toBe("frozen");
  });
  it("rejects unaccepted and outside-roster local target visits before saving", () => {
    const data = fixture();
    const input = { targetId: "target", eventId: data.events[0].id, propertyId: data.properties[0].id, outcome: "no_answer" as const };
    expect(() => recordEncounter(data, input, data.preferences.activeVolunteerId, "device")).toThrow("Accept");
    data.assignments![0].status = "accepted";
    expect(recordEncounter(data, input, data.preferences.activeVolunteerId, "device").visits[0].targetParcel).toEqual(data.properties[0].parcel);
    data.properties[0].parcel!.gislink = "outside";
    expect(() => recordEncounter(data, input, data.preferences.activeVolunteerId, "device")).toThrow("roster");
  });
  it("replaces in one ordered command, preserving history and requiring fresh acceptance", () => {
    const data = fixture();
    data.events[0].status = "ready";
    data.assignments![0].status = "accepted";
    const base = projectWalkTargetLifecycle(data);
    const original = structuredClone(base.walkTargets[0]);
    const owner = { assignedVolunteerId: base.preferences.activeVolunteerId };
    const changed = replaceWalkTarget(base, "assignment", { ...original, name: "Replacement" }, owner, { targetId: "new-target", assignmentId: "new-assignment" });
    const scope = { churchId: base.church.id, userId: "00000000-0000-4000-8000-000000000002" };
    const staged = projectWalkTargetLifecycle(stageWorkspaceChange(base, changed, scope));
    expect(staged.sync.commands!.at(-1)!.command.operations.map((op) => [op.entityType, op.entityId, op.record?.status])).toEqual([
      ["assignment", "assignment", "cancelled"], ["target", "new-target", undefined], ["assignment", "new-assignment", "assigned"],
    ]);
    expect(staged.walkTargets.find((target) => target.id === "target")).toEqual(original);
    expect(staged.walkTargets.find((target) => target.id === "new-target")?.rosterState).toBe("frozen");
    expect(base.assignments![0].status).toBe("accepted");
    expect(staged.visits).toEqual(base.visits);
  });
  it("rejects replacement overlap with a sibling while allowing reuse of its own old parcel", () => {
    const data = fixture();
    const input = { ...data.walkTargets[0] };
    const owner = { assignedVolunteerId: data.preferences.activeVolunteerId };
    expect(() => replaceWalkTarget(data, "assignment", input, owner, { targetId: "new", assignmentId: "new-a" })).not.toThrow();
    data.walkTargets.push({ ...input, id: "sibling" });
    data.assignments!.push({ ...data.assignments![0], id: "sibling-a", targetId: "sibling" });
    expect(() => replaceWalkTarget(data, "assignment", input, owner, { targetId: "new", assignmentId: "new-a" })).toThrow("overlaps");
    data.walkTargets[1].parcels = [{ ...input.parcels[0], gislink: "different" }];
    expect(() => replaceWalkTarget(data, "assignment", { ...input, selectionKind: "whole_zone" }, owner, { targetId: "new", assignmentId: "new-a" })).toThrow("whole-zone");
  });
  it("rejects a second local target with the same outing parcel", () => {
    const data = fixture();
    const input = { ...data.walkTargets[0], id: undefined, name: "Second target" };
    expect(() => assertWalkTargetDoesNotOverlap(data, input)).toThrow("already included");
    expect(() => assertWalkTargetDoesNotOverlap(data, input, "target")).not.toThrow();
    data.assignments![0].status = "cancelled";
    expect(() => assertWalkTargetDoesNotOverlap(data, input)).not.toThrow();
  });
  it("keeps parcel geometry on device without duplicating it in the immutable wire command", () => {
    const data = fixture();
    data.walkTargets[0].parcels[0].geometry = { ...data.walkTargets[0].geometry };
    data.walkTargets[0].parcels[0].representativePoint = [-86.8, 35.1];
    const base = { ...data, walkTargets: [], assignments: [] };
    const scope = { churchId: base.church.id, userId: "00000000-0000-4000-8000-000000000002" };
    const staged = stageWorkspaceChange(base, data, scope);
    const targetOperation = staged.sync.commands!.at(-1)!.command.operations.find((op) => op.entityType === "target");
    expect(targetOperation?.record?.parcels).toEqual([{ countyFips: "47055", gislink: "parcel", datasetRevision: "test", inclusionSource: "manual_add" }]);
    expect(reconcileOutreachWorkspace(base, staged).walkTargets[0].parcels).toEqual(data.walkTargets[0].parcels);
  });
});
