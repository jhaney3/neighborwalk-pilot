import { describe, expect, it } from "vitest";
import type { NeighborWalkData, Outcome, Property } from "../lib/domain";
import type { ParcelFeature, ParcelFeatureCollection } from "../lib/parcels";
import { buildAddressWorksheet, targetAddressEntries } from "../lib/target-address-list";

function parcel(id: number, gislink: string, address: string): ParcelFeature {
  return { type: "Feature", id, properties: { id, countyFips: "47055", gislink, situsAddress: address, propertyClass: "residential", landUse: "residential", isResidential: true },
    geometry: { type: "Polygon", coordinates: [[[id,0],[id + .5,0],[id + .5,.5],[id,0]]] } };
}

function property(id: string, gislink: string, unit?: string, currentOutcome: Outcome = "conversation"): Property {
  return { id, churchId: "church", territoryId: "area", address: "10 Oak Lane", unit, parcel: { countyFips: "47055", gislink },
    currentOutcome, visitCount: 1, createdAt: "2026-09-13T00:00:00.000Z", updatedAt: "2026-09-13T00:00:00.000Z", source: "map" };
}

describe("nightly target address list", () => {
  it("includes untouched target parcels as unvisited alongside saved locations", () => {
    const parcels: ParcelFeatureCollection = { type: "FeatureCollection", features: [parcel(1, "saved", "10 Oak Lane"), parcel(2, "untouched", "12 Oak Lane")] };
    const entries = targetAddressEntries([property("saved-location", "saved")], parcels);
    expect(entries.map((entry) => [entry.kind, entry.address])).toEqual([["saved", "10 Oak Lane"], ["parcel", "12 Oak Lane"]]);
  });

  it("keeps multiple saved dwellings on one parcel without adding a duplicate parcel row", () => {
    const parcels: ParcelFeatureCollection = { type: "FeatureCollection", features: [parcel(1, "apartments", "10 Oak Lane")] };
    const entries = targetAddressEntries([property("apt-a", "apartments", "A"), property("apt-b", "apartments", "B")], parcels);
    expect(entries.map((entry) => entry.kind)).toEqual(["saved", "saved"]);
    expect(entries.map((entry) => entry.unit)).toEqual(["A", "B"]);
  });

  it("keeps stable numbering and paginates three unsplit records per Letter page", () => {
    const parcels: ParcelFeatureCollection = { type: "FeatureCollection", features: Array.from({ length: 38 }, (_, index) => parcel(index + 1, `parcel-${index + 1}`, `${index + 1} Oak Lane`)) };
    const pages = buildAddressWorksheet(targetAddressEntries([], parcels), { visits: [], eventId: "walk" });
    expect(pages).toHaveLength(13);
    expect(pages.map((page) => page.rows.length)).toEqual([3,3,3,3,3,3,3,3,3,3,3,3,2]);
    expect(pages[0].rows.map((row) => row.sequenceLabel)).toEqual(["01", "02", "03"]);
    expect(pages.at(-1)?.rows.map((row) => row.sequenceLabel)).toEqual(["37", "38"]);
  });

  it("marks current-walk visits and active location restrictions as non-writable records", () => {
    const visited = property("visited", "visited");
    const restricted = property("restricted", "restricted", undefined, "do_not_visit");
    const visit: NeighborWalkData["visits"][number] = { id: "visit", churchId: "church", eventId: "walk", targetId: "target", propertyId: visited.id,
      volunteerId: "volunteer", outcome: "conversation", recordedAt: "2026-09-13T01:00:00.000Z", deviceId: "device" };
    const [page] = buildAddressWorksheet(targetAddressEntries([visited, restricted]), { visits: [visit], eventId: "walk", targetId: "target" });
    expect(page.rows.map(({ recordedThisWalk, restricted: blocked }) => ({ recordedThisWalk, blocked }))).toEqual([
      { recordedThisWalk: true, blocked: false },
      { recordedThisWalk: false, blocked: true },
    ]);
  });
});
