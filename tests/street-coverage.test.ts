import { describe, expect, it } from "vitest";
import type { ParcelFeatureCollection } from "../lib/parcels";
import type { StreetSegmentCollection } from "../lib/street-segments";
import { coveredStreetIds } from "../lib/street-coverage";

const square = (x: number, y: number, d = 0.00005) => ({ type: "Polygon" as const, coordinates: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]] });
const parcels = (points: [number, number][]): ParcelFeatureCollection => ({ type: "FeatureCollection", features: points.map(([x, y], index) => ({ type: "Feature", geometry: square(x, y), properties: { id: index, countyFips: "47099", gislink: `p${index}`, situsAddress: null, propertyClass: null, landUse: null, isResidential: true } })) });
const street = (id: string, coordinates: [number, number][]) => ({ type: "Feature" as const, id, geometry: { type: "LineString" as const, coordinates }, properties: { id, name: id, roadClass: "residential", subclass: null, release: "r", complete: true } });
const streets = (...features: ReturnType<typeof street>[]) => ({ type: "FeatureCollection", features, metadata: { release: "r", complete: true, truncated: false, attribution: "" } }) as unknown as StreetSegmentCollection;

describe("coveredStreetIds", () => {
  const homes = parcels([[-87.3, 35.2001], [-87.299, 35.2001], [-87.298, 35.2001], [-87.3, 35.21], [-87.299, 35.21]]);
  const lines = streets(street("main", [[-87.301, 35.2], [-87.297, 35.2]]), street("oak", [[-87.301, 35.2099], [-87.298, 35.2099]]));

  it("marks a street when most homes along it were visited", () => {
    expect([...coveredStreetIds(lines, homes, new Set(["47099:p0", "47099:p1", "47099:p2", "47099:p3"]))]).toEqual(["main"]);
  });

  it("marks nothing without visits", () => {
    expect(coveredStreetIds(lines, homes, new Set()).size).toBe(0);
  });
});
