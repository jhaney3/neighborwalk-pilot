import type { ParcelFeatureCollection } from "./parcels";
import { streetSegmentLines, type StreetSegmentCollection } from "./street-segments";
import { parcelSelectionPoint, STREET_PARCEL_CORRIDOR_METERS, targetParcelKey } from "./target-parcels";

const METERS_PER_DEGREE = 111_320;

function metersToSegment([px, py]: [number, number], [ax, ay]: number[], [bx, by]: number[], scale: number) {
  const [x, y, x1, y1, x2, y2] = [px * scale, py, ax * scale, ay, bx * scale, by];
  const dx = x2 - x1, dy = y2 - y1;
  const t = dx || dy ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) * METERS_PER_DEGREE;
}

/** Streets whose homes have mostly been visited on earlier walks, so the
 * planner can draw them dashed. A street needs at least two homes along it;
 * "mostly" is 80% or more. */
export function coveredStreetIds(streets: StreetSegmentCollection, parcels: ParcelFeatureCollection, visited: ReadonlySet<string>, corridorMeters = STREET_PARCEL_CORRIDOR_METERS) {
  const covered = new Set<string>();
  if (!visited.size) return covered;
  const homes = parcels.features.flatMap((parcel) => {
    if (!parcel.properties.isResidential) return [];
    const point = parcelSelectionPoint(parcel);
    return point ? [{ point, visited: visited.has(targetParcelKey(parcel.properties)) }] : [];
  });
  if (!homes.length) return covered;
  const scale = Math.cos(homes[0].point[1] * Math.PI / 180);
  const pad = corridorMeters / METERS_PER_DEGREE;
  for (const street of streets.features) {
    const lines = streetSegmentLines(street);
    const coordinates = lines.flatMap((line) => line.coordinates);
    if (!coordinates.length) continue;
    const xs = coordinates.map(([x]) => x), ys = coordinates.map(([, y]) => y);
    const [west, east, south, north] = [Math.min(...xs) - pad / scale, Math.max(...xs) + pad / scale, Math.min(...ys) - pad, Math.max(...ys) + pad];
    let near = 0, done = 0;
    for (const home of homes) {
      const [x, y] = home.point;
      if (x < west || x > east || y < south || y > north) continue;
      const close = lines.some((line) => line.coordinates.slice(1).some((end, index) => metersToSegment(home.point, line.coordinates[index], end, scale) <= corridorMeters));
      if (!close) continue;
      near += 1;
      if (home.visited) done += 1;
    }
    if (near >= 2 && done / near >= 0.8) covered.add(String(street.properties.id));
  }
  return covered;
}
