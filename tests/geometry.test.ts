import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import { geometryContainsPoint, polygonAtPoint } from "../lib/geometry";

const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const hole = [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]];
const polygon: Polygon = { type: "Polygon", coordinates: [outer, hole] };

describe("map and coverage geometry", () => {
  it("excludes courtyards and points outside a parcel", () => {
    expect(geometryContainsPoint(polygon, [1, 1])).toBe(true);
    expect(geometryContainsPoint(polygon, [5, 5])).toBe(false);
    expect(geometryContainsPoint(polygon, [11, 1])).toBe(false);
  });

  it("selects the correct building from a multipolygon", () => {
    const other = outer.map(([lng, lat]) => [lng + 20, lat]);
    expect(polygonAtPoint({ type: "MultiPolygon", coordinates: [polygon.coordinates, [other]] }, [21, 1])).toEqual([other]);
  });

  it("tolerates absent and non-polygon features", () => {
    expect(polygonAtPoint(undefined, [1, 1])).toBeUndefined();
    expect(geometryContainsPoint({ type: "Point", coordinates: [1, 1] }, [1, 1])).toBe(false);
    expect(geometryContainsPoint({ type: "Polygon", coordinates: [] }, [1, 1])).toBe(false);
  });
});
