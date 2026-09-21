import { describe, expect, it } from "vitest";
import { lawrenceburgDemoParcelResult, lawrenceburgDemoStreets } from "../lib/demo-planning";
import type { Coordinates } from "../lib/domain";
import { DEMO_CENTER } from "../lib/seed";

function boundary(center: Coordinates, dx = 0.0047, dy = 0.0034): Coordinates[] {
  return [
    [center[0] - dx, center[1] - dy],
    [center[0] + dx, center[1] - dy],
    [center[0] + dx, center[1] + dy],
    [center[0] - dx, center[1] + dy],
  ];
}

describe("bundled Lawrenceburg demo planning data", () => {
  it("provides a complete Lawrence County parcel and street inventory", () => {
    const area = boundary(DEMO_CENTER);
    const parcels = lawrenceburgDemoParcelResult(area);
    const streets = lawrenceburgDemoStreets(area);

    expect(parcels).toMatchObject({ complete: true, truncated: false });
    expect(parcels.datasetRevision).toContain("lawrenceburg-demo-parcels");
    expect(parcels.parcels.features).toHaveLength(35);
    expect(parcels.parcels.features.every((parcel) => parcel.properties.countyFips === "47099" && parcel.properties.isResidential)).toBe(true);
    expect(new Set(parcels.parcels.features.map((parcel) => parcel.properties.gislink)).size).toBe(35);
    expect(streets.features).toHaveLength(8);
    expect(streets.metadata).toMatchObject({ complete: true, truncated: false });
  });

  it("bundles parcel coverage for all three Lawrenceburg demo neighborhoods", () => {
    const allNeighborhoods = boundary([DEMO_CENTER[0], DEMO_CENTER[1] + 0.0025], 0.018, 0.0085);
    expect(lawrenceburgDemoParcelResult(allNeighborhoods).parcels.features).toHaveLength(105);
  });

  it("does not invent parcels outside the bundled Lawrenceburg neighborhoods", () => {
    expect(lawrenceburgDemoParcelResult(boundary([-86.5, 36.2])).parcels.features).toHaveLength(0);
  });
});
