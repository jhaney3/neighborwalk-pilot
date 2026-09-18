import { describe, expect, it } from "vitest";
import { clipLineToBoundary, connectedStreetIds, haversineMeters, mapLineOffsetForSide, polygonInsideBoundary, polygonSelfIntersects, polygonsOverlap, streetSidePolygons, streetsWithinMeters } from "../lib/planning-geometry";

const street = (id: string, coordinates: [number, number][], name = "Main Street") => ({ id, name, geometry: { type: "LineString" as const, coordinates } });
describe("walk target geometry", () => {
  it("rejects crossing and out-of-zone polygons", () => {
    expect(polygonSelfIntersects([[0,0],[2,2],[0,2],[2,0]])).toBe(true);
    expect(polygonInsideBoundary([[1,1],[2,1],[2,2]], [[0,0],[3,0],[3,3],[0,3]])).toBe(true);
    expect(polygonInsideBoundary([[1,1],[4,1],[2,2]], [[0,0],[3,0],[3,3],[0,3]])).toBe(false);
  });
  it("detects overlapping nightly areas", () => {
    expect(polygonsOverlap([[0,0],[2,0],[2,2],[0,2]], [[1,1],[3,1],[3,3],[1,3]])).toBe(true);
    expect(polygonsOverlap([[0,0],[1,0],[1,1],[0,1]], [[2,2],[3,2],[3,3],[2,3]])).toBe(false);
  });
  it("finds connected sections and nearby suggestions", () => {
    const streets = [street("a", [[0,0],[0.001,0]]), street("b", [[0.001,0],[0.002,0]]), street("different-road", [[0.002,0],[0.003,0]], "Cross Street"), street("c", [[1,1],[1.001,1]])];
    expect(connectedStreetIds("a", streets)).toEqual(["a", "b"]);
    expect(streetsWithinMeters("a", streets, 120)).toContain("b");
    expect(haversineMeters([0,0],[0.001,0])).toBeGreaterThan(100);
  });
  it("keeps canonical geometry separate from its parent-clipped display pieces", () => {
    const canonical = street("crossing", [[-1,.5],[2,.5]]).geometry;
    expect(clipLineToBoundary(canonical, [[0,0],[1,0],[1,1],[0,1]])).toEqual([
      { type: "LineString", coordinates: [[0,.5],[1,.5]] },
    ]);
    expect(canonical.coordinates).toEqual([[-1,.5],[2,.5]]);
  });
  it("uses canonical direction consistently for left/right shading and MapLibre offsets", () => {
    const line = street("eastbound", [[0,0],[.001,0]]).geometry;
    const left = streetSidePolygons([line], "left", 20)[0].coordinates[0];
    const right = streetSidePolygons([line], "right", 20)[0].coordinates[0];
    expect(Math.max(...left.map((point) => point[1]))).toBeGreaterThan(0);
    expect(Math.min(...right.map((point) => point[1]))).toBeLessThan(0);
    expect(mapLineOffsetForSide("left")).toBe(-5);
    expect(mapLineOffsetForSide("right")).toBe(5);
  });
});
