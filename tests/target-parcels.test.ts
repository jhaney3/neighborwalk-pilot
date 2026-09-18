import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParcelFeature, ParcelFeatureCollection } from "../lib/parcels";
import { fictionalStreetSegmentsForTerritory, streetSegmentLines } from "../lib/street-segments";
import { applyParcelSelectionOverrides, cacheCompletePlanningDataset, fictionalPlanningParcels, getCompletePlanningDataset, parcelInsideZone, parcelRepresentativePoint, parsePlanningParcelResponse, planningDatasetIdentity, planningParcelRoster, polygonParcelKeys, snapshotParcelFeatureCollection, STREET_PARCEL_CORRIDOR_METERS, streetParcelKeys, toggleParcelSelectionOverride } from "../lib/target-parcels";

function parcel(id: number, gislink: string, latitude: number, isResidential = true): ParcelFeature {
  const size = .0001;
  return { type: "Feature", id, properties: { id, countyFips: "47055", gislink, situsAddress: null, propertyClass: null, landUse: null, isResidential },
    geometry: { type: "Polygon", coordinates: [[[-.0001,latitude-size],[.0001,latitude-size],[.0001,latitude+size],[-.0001,latitude+size],[-.0001,latitude-size]]] } };
}

function parcelAt(id: number, gislink: string, longitude: number, latitude: number): ParcelFeature {
  const size = .00001;
  return { type: "Feature", id, properties: { id, countyFips: "47055", gislink, situsAddress: null, propertyClass: null, landUse: null, isResidential: true },
    geometry: { type: "Polygon", coordinates: [[[longitude-size,latitude-size],[longitude+size,latitude-size],[longitude+size,latitude+size],[longitude-size,latitude+size],[longitude-size,latitude-size]]] } };
}
afterEach(() => vi.unstubAllGlobals());
describe("target parcel snapshots", () => {
  it("keeps manual parcel toggles when automatic street suggestions recalculate", () => {
    const automatic = new Set(["47055:a", "47055:b"]);
    const withoutB = toggleParcelSelectionOverride(new Map(), "47055:b", automatic);
    expect([...applyParcelSelectionOverrides(automatic, withoutB)]).toEqual(["47055:a"]);
    expect([...applyParcelSelectionOverrides(new Set([...automatic, "47055:c"]), withoutB)]).toEqual(["47055:a", "47055:c"]);
    const withBAgain = toggleParcelSelectionOverride(withoutB, "47055:b", automatic);
    expect([...applyParcelSelectionOverrides(automatic, withBAgain)]).toEqual(["47055:a", "47055:b"]);
  });
  it("finds an interior representative point for a concave parcel", () => {
    const geometry = { type: "Polygon" as const, coordinates: [[[0,0],[3,0],[3,1],[1,1],[1,3],[0,3],[0,0]]] };
    expect(parcelRepresentativePoint(geometry)).not.toBeNull();
  });
  it("restores frozen parcel geometry for offline map display", () => {
    const frozenGeometry = { type:"Polygon", coordinates:[[[0,0],[1,0],[1,1],[0,0]]] };
    const moved = parcelAt(1, "a", 5, 5);
    moved.properties.situsAddress = "Current address";
    const result = snapshotParcelFeatureCollection([{ countyFips:"47055", gislink:"a", datasetRevision:"r", inclusionSource:"manual_add", geometry:frozenGeometry }],
      { type: "FeatureCollection", features: [moved, parcelAt(2, "not-in-roster", 6, 6)] });
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry).toEqual(frozenGeometry);
    expect(result.features[0].properties.situsAddress).toBe("Current address");
  });
  it("falls back to matching live geometry only for legacy rosters without a snapshot", () => {
    const current = parcelAt(1, "legacy", 5, 5);
    const result = snapshotParcelFeatureCollection([{ countyFips:"47055", gislink:"legacy", datasetRevision:"r", inclusionSource:"manual_add" }],
      { type: "FeatureCollection", features: [current] });
    expect(result.features.map((feature) => feature.geometry)).toEqual([current.geometry]);
  });
  it("keys planning completeness to both parent identity and boundary", () => {
    const boundary = [[0,0],[1,0],[1,1],[0,1]] as [number, number][];
    const identity = planningDatasetIdentity("parent-a", boundary);
    expect(identity).toBe(planningDatasetIdentity("parent-a", boundary));
    expect(identity).not.toBe(planningDatasetIdentity("parent-b", boundary));
    expect(identity).not.toBe(planningDatasetIdentity("parent-a", [[0,0],[2,0],[2,2],[0,2]]));
  });
  it("uses the planning RPC point-on-surface as authoritative membership", () => {
    const result = parsePlanningParcelResponse({ datasetRevision: "parcels-r1", complete: true, truncated: false, features: [{
      county_fips: "47055", gislink: "authoritative", representative_point: { type: "Point", coordinates: [.5, .5] },
      geometry: { type: "Polygon", coordinates: [[[2,2],[3,2],[3,3],[2,3],[2,2]]] },
    }] });
    expect(result.complete).toBe(true);
    expect(parcelInsideZone(result.parcels.features[0], [[0,0],[1,0],[1,1],[0,1]])).toBe(true);
    expect(parsePlanningParcelResponse({ datasetRevision: "parcels-r1", complete: true, truncated: true, features: [] }).complete).toBe(false);
  });
  it("gives demo parcels authoritative centers that produce a Church Avenue street roster", () => {
    const center: [number, number] = [-86.786, 36.157];
    const parcels = fictionalPlanningParcels(center);
    const churchAvenue = fictionalStreetSegmentsForTerritory(center).features.find((feature) => feature.properties.id === "demo-cross")!;
    const parent = [[center[0]-.004,center[1]-.003],[center[0]+.004,center[1]-.003],[center[0]+.004,center[1]+.003],[center[0]-.004,center[1]+.003]] as [number, number][];
    expect(Reflect.get(parcels.features[1].properties, "representativePoint")).toEqual([center[0]-.00015, center[1]-.00085]);
    expect([...streetParcelKeys(parcels, streetSegmentLines(churchAvenue), parent, 20, "both")]).toEqual(["47055:demo-2", "47055:demo-5"]);
  });
  it("marks reviewed additions outside the automatic scope as manual", () => {
    const parcels: ParcelFeatureCollection = { type: "FeatureCollection", features: [parcelAt(1, "auto", 0, 0), parcelAt(2, "added", .001, 0)] };
    const roster = planningParcelRoster(new Set(["47055:auto", "47055:added"]), new Set(["47055:auto"]), parcels, "r1", "street_auto");
    expect(roster.map(({ gislink, inclusionSource }) => [gislink, inclusionSource])).toEqual([
      ["auto", "street_auto"], ["added", "manual_add"],
    ]);
  });
  it("caches and reopens only an explicitly complete revisioned parent dataset", async () => {
    vi.stubGlobal("window", {});
    const boundary = [[0,0],[1,0],[1,1],[0,1]] as [number, number][];
    const streets = { type: "FeatureCollection" as const, features: [], metadata: {
      release: "streets-r1", source: "Overture transportation", complete: true, truncated: false, attribution: "fixture",
    } };
    const parcels: ParcelFeatureCollection = { type: "FeatureCollection", features: [parcelAt(1, "cached", .5, .5)] };
    await cacheCompletePlanningDataset("cache-parent", boundary, { streets, parcels, parcelRevision: "parcels-r1", streetComplete: true, parcelComplete: true });
    const cached = await getCompletePlanningDataset("cache-parent", boundary);
    expect(cached).toMatchObject({ complete: true, streetRevision: "streets-r1", parcelRevision: "parcels-r1" });
    expect(await getCompletePlanningDataset("cache-parent", [[0,0],[2,0],[2,2],[0,2]])).toBeNull();
  });
  it("suggests only residential representatives inside a polygon", () => {
    const parcels: ParcelFeatureCollection = { type: "FeatureCollection", features: [parcel(1, "inside", .0005), parcel(2, "outside", .002), parcel(3, "commercial", .0005, false)] };
    expect([...polygonParcelKeys(parcels, [[-.001,0],[.001,0],[.001,.001],[-.001,.001]])]).toEqual(["47055:inside"]);
  });
  it("applies left and right relative to canonical street direction and clips candidates to the parent", () => {
    const parcels: ParcelFeatureCollection = { type: "FeatureCollection", features: [parcel(1, "left", .0005), parcel(2, "right", -.0005), parcel(3, "outside-parent", .002)] };
    const line = { type: "LineString" as const, coordinates: [[-.001,0],[.001,0]] };
    const parent = [[-.002,-.001],[.002,-.001],[.002,.001],[-.002,.001]] as [number, number][];
    expect([...streetParcelKeys(parcels, [line], parent, 100, "left")]).toEqual(["47055:left"]);
    expect([...streetParcelKeys(parcels, [line], parent, 100, "right")]).toEqual(["47055:right"]);
    expect([...streetParcelKeys(parcels, [line], parent, 100, "both")]).toEqual(["47055:left", "47055:right"]);
  });
  it("selects an adjacent deep lot by parcel geometry instead of its distant representative point", () => {
    const deepLot = parcelAt(1, "deep-lot", 0, .00055);
    deepLot.geometry = { type: "Polygon", coordinates: [[[-.0001,.0001],[.0001,.0001],[.0001,.001],[-.0001,.001],[-.0001,.0001]]] };
    Reflect.set(deepLot.properties, "representativePoint", [0, .00055]);
    const parcels: ParcelFeatureCollection = { type: "FeatureCollection", features: [deepLot] };
    const line = { type: "LineString" as const, coordinates: [[-.001,0],[.001,0]] };
    const parent = [[-.002,-.001],[.002,-.001],[.002,.002],[-.002,.002]] as [number, number][];
    expect([...streetParcelKeys(parcels, [line], parent, STREET_PARCEL_CORRIDOR_METERS, "left")]).toEqual(["47055:deep-lot"]);
    expect([...streetParcelKeys(parcels, [line], parent, STREET_PARCEL_CORRIDOR_METERS, "right")]).toEqual([]);
  });
  it("uses flat canonical endpoints for one-sided corridors and round endpoints for both sides", () => {
    const parcels: ParcelFeatureCollection = { type: "FeatureCollection", features: [
      parcelAt(1, "past-left", .0012, .0001), parcelAt(2, "past-right", .0012, -.0001),
    ] };
    const line = { type: "LineString" as const, coordinates: [[-.001,0],[.001,0]] };
    const parent = [[-.002,-.002],[.002,-.002],[.002,.002],[-.002,.002]] as [number, number][];
    expect([...streetParcelKeys(parcels, [line], parent, 100, "left")]).toEqual([]);
    expect([...streetParcelKeys(parcels, [line], parent, 100, "right")]).toEqual([]);
    expect([...streetParcelKeys(parcels, [line], parent, 100, "both")]).toEqual(["47055:past-left", "47055:past-right"]);
  });
  it("retains one-sided round join behavior at an internal bend", () => {
    const parcels: ParcelFeatureCollection = { type: "FeatureCollection", features: [parcelAt(1, "inside-bend", .0011, -.0001)] };
    const bent = { type: "LineString" as const, coordinates: [[0,0],[.001,0],[.001,.001]] };
    const parent = [[-.001,-.001],[.002,-.001],[.002,.002],[-.001,.002]] as [number, number][];
    expect([...streetParcelKeys(parcels, [bent], parent, 30, "right")]).toEqual(["47055:inside-bend"]);
  });
});
