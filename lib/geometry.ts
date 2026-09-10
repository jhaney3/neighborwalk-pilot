import type { Geometry } from "geojson";
import type { Coordinates } from "./domain";

export function ringContainsPoint(point: Coordinates, ring: number[][]) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [currentLng, currentLat] = ring[current];
    const [previousLng, previousLat] = ring[previous];
    const intersects = (currentLat > point[1]) !== (previousLat > point[1])
      && point[0] < ((previousLng - currentLng) * (point[1] - currentLat)) / (previousLat - currentLat) + currentLng;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function polygonAtPoint(geometry: Geometry | undefined, point: Coordinates) {
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates]
    : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  return polygons.find((polygon) => polygon.length > 0
    && ringContainsPoint(point, polygon[0])
    && !polygon.slice(1).some((hole) => ringContainsPoint(point, hole)));
}

export function geometryContainsPoint(geometry: Geometry, point: Coordinates) {
  return Boolean(polygonAtPoint(geometry, point));
}
