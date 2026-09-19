import type { LineString, Polygon } from "geojson";
import type { Coordinates } from "./domain";
import { geometryContainsPoint } from "./geometry";

const EARTH_METERS = 6_371_008.8;

export function closeRing(points: Coordinates[]): Coordinates[] {
  if (!points.length) return [];
  const first = points[0];
  const last = points.at(-1);
  return first[0] === last?.[0] && first[1] === last?.[1] ? points : [...points, first];
}

function orientation(a: Coordinates, b: Coordinates, c: Coordinates) {
  return Math.sign((b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]));
}

function segmentsCross(a: Coordinates, b: Coordinates, c: Coordinates, d: Coordinates) {
  return orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b);
}

export function polygonSelfIntersects(points: Coordinates[]) {
  const ring = closeRing(points);
  for (let a = 0; a < ring.length - 1; a += 1) {
    for (let b = a + 1; b < ring.length - 1; b += 1) {
      if (Math.abs(a - b) <= 1 || (a === 0 && b === ring.length - 2)) continue;
      if (segmentsCross(ring[a], ring[a + 1], ring[b], ring[b + 1])) return true;
    }
  }
  return false;
}

export function polygonInsideBoundary(points: Coordinates[], boundary: Coordinates[]) {
  if (points.length < 3 || boundary.length < 3) return false;
  const parent: Polygon = { type: "Polygon", coordinates: [closeRing(boundary)] };
  return points.every((point) => geometryContainsPoint(parent, point));
}

export function polygonsOverlap(left: Coordinates[], right: Coordinates[]) {
  if (left.length < 3 || right.length < 3) return false;
  const leftPolygon: Polygon = { type: "Polygon", coordinates: [closeRing(left)] };
  const rightPolygon: Polygon = { type: "Polygon", coordinates: [closeRing(right)] };
  if (left.some((point) => geometryContainsPoint(rightPolygon, point)) || right.some((point) => geometryContainsPoint(leftPolygon, point))) return true;
  const a = closeRing(left); const b = closeRing(right);
  return a.slice(0, -1).some((start, ai) => b.slice(0, -1).some((other, bi) => segmentsCross(start, a[ai + 1], other, b[bi + 1])));
}

export function haversineMeters(a: Coordinates, b: Coordinates) {
  const radians = Math.PI / 180;
  const dLat = (b[1] - a[1]) * radians;
  const dLng = (b[0] - a[0]) * radians;
  const lat1 = a[1] * radians;
  const lat2 = b[1] * radians;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_METERS * Math.asin(Math.sqrt(value));
}

export function lineEndpoints(line: LineString): [Coordinates, Coordinates] {
  return [line.coordinates[0] as Coordinates, line.coordinates.at(-1) as Coordinates];
}

type StreetLine = { id: string; name?: string | null; geometry: LineString };

function normalizedStreetName(value?: string | null) {
  return value?.trim().toLocaleLowerCase().replaceAll(/\s+/g, " ") || null;
}

/** Expands only through endpoint-connected sections of the same named road. */
export function connectedStreetIds(seedId: string, streets: StreetLine[], toleranceMeters = 2) {
  const grouped = new Map<string, StreetLine[]>();
  for (const street of streets) grouped.set(street.id, [...(grouped.get(street.id) ?? []), street]);
  const seed = grouped.get(seedId);
  if (!seed) return [];
  const seedName = normalizedStreetName(seed[0].name);
  if (!seedName) return [seedId];
  const selected = new Set([seedId]);
  const queue = [seedId];
  while (queue.length) {
    const current = grouped.get(queue.shift()!)!;
    const endpoints = current.flatMap((part) => lineEndpoints(part.geometry));
    for (const [candidateId, candidate] of grouped) {
      if (selected.has(candidateId) || normalizedStreetName(candidate[0].name) !== seedName) continue;
      const other = candidate.flatMap((part) => lineEndpoints(part.geometry));
      if (endpoints.some((point) => other.some((next) => haversineMeters(point, next) <= toleranceMeters))) {
        selected.add(candidateId);
        queue.push(candidateId);
      }
    }
  }
  return [...selected];
}

export function streetsWithinMeters(seedId: string, streets: StreetLine[], meters = 100) {
  const seed = streets.find((street) => street.id === seedId);
  if (!seed) return [];
  return streets.filter((street) => lineEndpoints(seed.geometry).some((a) =>
    street.geometry.coordinates.some((value) => haversineMeters(a, value as Coordinates) <= meters))).map((street) => street.id);
}

function segmentIntersectionFraction(a: Coordinates, b: Coordinates, c: Coordinates, d: Coordinates) {
  const rx = b[0] - a[0]; const ry = b[1] - a[1];
  const sx = d[0] - c[0]; const sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-14) return null;
  const qx = c[0] - a[0]; const qy = c[1] - a[1];
  const along = (qx * sy - qy * sx) / denominator;
  const crossing = (qx * ry - qy * rx) / denominator;
  return along >= 0 && along <= 1 && crossing >= 0 && crossing <= 1 ? along : null;
}

function samePoint(left: Coordinates, right: Coordinates) {
  return Math.abs(left[0] - right[0]) < 1e-12 && Math.abs(left[1] - right[1]) < 1e-12;
}

function stablePoint(longitude: number, latitude: number): Coordinates {
  // Intersection arithmetic can leave sub-nanometre tails such as -9.99e-13.
  // Stable coordinates keep cache signatures and exact GeoJSON assertions deterministic.
  const stable = (value: number) => {
    const rounded = Math.round(value * 1e10) / 1e10;
    return rounded === 0 ? 0 : rounded;
  };
  return [stable(longitude), stable(latitude)];
}

/** Clips only the display/candidate copy. Saved street geometry remains canonical. */
export function clipLineToBoundary(line: LineString, boundary: Coordinates[]): LineString[] {
  const edge = closeRing(boundary);
  const pieces: Coordinates[][] = [];
  for (let index = 0; index < line.coordinates.length - 1; index += 1) {
    const start = line.coordinates[index] as Coordinates;
    const end = line.coordinates[index + 1] as Coordinates;
    const fractions = [0, 1];
    for (let side = 0; side < edge.length - 1; side += 1) {
      const fraction = segmentIntersectionFraction(start, end, edge[side], edge[side + 1]);
      if (fraction !== null) fractions.push(fraction);
    }
    const ordered = [...new Set(fractions.map((value) => Math.round(value * 1e12) / 1e12))].sort((a, b) => a - b);
    for (let at = 0; at < ordered.length - 1; at += 1) {
      const from = ordered[at]; const to = ordered[at + 1];
      const midpoint: Coordinates = [start[0] + (end[0] - start[0]) * ((from + to) / 2), start[1] + (end[1] - start[1]) * ((from + to) / 2)];
      if (!geometryContainsPoint({ type: "Polygon", coordinates: [edge] }, midpoint)) continue;
      const first = stablePoint(start[0] + (end[0] - start[0]) * from, start[1] + (end[1] - start[1]) * from);
      const last = stablePoint(start[0] + (end[0] - start[0]) * to, start[1] + (end[1] - start[1]) * to);
      const previous = pieces.at(-1);
      if (previous && samePoint(previous.at(-1)!, first)) previous.push(last);
      else pieces.push([first, last]);
    }
  }
  return pieces.filter((piece) => piece.length >= 2).map((coordinates) => ({ type: "LineString", coordinates }));
}

function offsetPoints(line: LineString, meters: number) {
  const coordinates = line.coordinates as Coordinates[];
  return coordinates.map((point, index): { left: Coordinates; right: Coordinates } => {
    const previous = coordinates[Math.max(0, index - 1)];
    const next = coordinates[Math.min(coordinates.length - 1, index + 1)];
    const latitudeRadians = point[1] * Math.PI / 180;
    const longitudeMeters = 111_320 * Math.max(.01, Math.cos(latitudeRadians));
    const latitudeMeters = 110_540;
    const dx = (next[0] - previous[0]) * longitudeMeters;
    const dy = (next[1] - previous[1]) * latitudeMeters;
    const length = Math.hypot(dx, dy) || 1;
    const leftX = -dy / length * meters;
    const leftY = dx / length * meters;
    return {
      left: [point[0] + leftX / longitudeMeters, point[1] + leftY / latitudeMeters],
      right: [point[0] - leftX / longitudeMeters, point[1] - leftY / latitudeMeters],
    };
  });
}

/** Produces a display ribbon relative to the canonical start-to-end direction. */
export function streetSidePolygons(lines: LineString[], side: "both" | "left" | "right", meters: number): Polygon[] {
  return lines.flatMap((line) => {
    if (line.coordinates.length < 2 || meters <= 0) return [];
    const offsets = offsetPoints(line, meters);
    const center = line.coordinates.map((point) => [point[0], point[1]] as Coordinates);
    const left = offsets.map((point) => point.left);
    const right = offsets.map((point) => point.right);
    const ring = side === "left" ? [...left, ...[...center].reverse(), left[0]]
      : side === "right" ? [...center, ...[...right].reverse(), center[0]]
        : [...left, ...[...right].reverse(), left[0]];
    return [{ type: "Polygon", coordinates: [ring] }];
  });
}

/** MapLibre positive line offsets are right of the canonical line direction. */
export function mapLineOffsetForSide(side: "both" | "left" | "right", pixels = 5) {
  return side === "left" ? -pixels : side === "right" ? pixels : 0;
}
