import { describe, expect, it } from "vitest";
import { parcelKey, walkTargetSchema, type WalkTarget } from "../lib/walk-targets";

const target: WalkTarget = {
  id: "target-one", churchId: "church", eventId: "outing", territoryId: "zone", name: "Maple tonight", color: "#286c59",
  selectionKind: "polygon", geometry: { type: "Polygon", coordinates: [[[-87, 35], [-86.9, 35], [-86.9, 35.1], [-87, 35]]] },
  parcels: [{ countyFips: "47055", gislink: "parcel-1", datasetRevision: "2026-09-12", inclusionSource: "polygon_auto" }],
  rosterState: "draft",
};

describe("nightly walk target contract", () => {
  it("keeps parent, outing, geometry and reviewed parcel identity together", () => {
    expect(walkTargetSchema.parse(target)).toEqual(target);
    expect(parcelKey(target.parcels[0])).toBe("47055:parcel-1");
  });

  it("requires directed street metadata for street targets", () => {
    expect(walkTargetSchema.safeParse({ ...target, selectionKind: "streets", geometry: { type: "MultiLineString", coordinates: [[[-87, 35], [-86.9, 35]]] } }).success).toBe(false);
  });

  it("requires frozen history to have a timestamp", () => {
    expect(walkTargetSchema.safeParse({ ...target, rosterState: "frozen" }).success).toBe(false);
  });
});
