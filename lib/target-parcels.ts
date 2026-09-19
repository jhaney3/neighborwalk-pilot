import type { LineString, MultiPolygon, Polygon } from "geojson";
import { openDB, type IDBPDatabase } from "idb";
import type { Coordinates } from "./domain";
import { storageKey } from "./environment";
import { geometryContainsPoint } from "./geometry";
import type { ParcelFeature, ParcelFeatureCollection } from "./parcels";
import type { StreetSegmentCollection } from "./street-segments";
import { getSupabaseBrowserClient, type Json } from "./supabase";
import type { WalkTargetParcel } from "./walk-targets";

const PLANNING_CACHE_DATABASE = storageKey("neighborwalk-planning-cache");
const PLANNING_CACHE_STORE = "parent-datasets";
export const STREET_PARCEL_CORRIDOR_METERS = 20;
let planningCachePromise: Promise<IDBPDatabase> | null = null;

export type CompletePlanningDataset = {
  streets: StreetSegmentCollection;
  parcels: ParcelFeatureCollection;
  parcelRevision: string;
  streetComplete: true;
  parcelComplete: true;
};

export type CachedPlanningDataset = CompletePlanningDataset & {
  key: string;
  parentTerritoryId: string;
  boundarySignature: string;
  complete: true;
  streetRevision: string;
  cachedAt: number;
};

function planningDatabase() {
  if (typeof window === "undefined") throw new Error("Planning data caching is available in the browser only.");
  planningCachePromise ??= openDB(PLANNING_CACHE_DATABASE, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(PLANNING_CACHE_STORE)) database.createObjectStore(PLANNING_CACHE_STORE, { keyPath: "key" });
    },
  });
  return planningCachePromise;
}

function planningBoundarySignature(boundary: Coordinates[]) {
  return boundary.map(([longitude, latitude]) => `${longitude.toFixed(7)},${latitude.toFixed(7)}`).join(";");
}

export function planningDatasetIdentity(parentTerritoryId: string, boundary: Coordinates[]) {
  return `${parentTerritoryId}:${planningBoundarySignature(boundary)}`;
}

export async function getCompletePlanningDataset(parentTerritoryId: string, boundary: Coordinates[]) {
  const cached = await (await planningDatabase()).get(PLANNING_CACHE_STORE, planningDatasetIdentity(parentTerritoryId, boundary)) as CachedPlanningDataset | undefined;
  if (!cached || cached.complete !== true || cached.streetComplete !== true || cached.parcelComplete !== true
    || cached.boundarySignature !== planningBoundarySignature(boundary)
    || !cached.streetRevision || !cached.parcelRevision
    || cached.streets.metadata?.complete !== true || cached.streets.metadata.release !== cached.streetRevision) return null;
  return cached;
}

export async function cacheCompletePlanningDataset(parentTerritoryId: string, boundary: Coordinates[], dataset: CompletePlanningDataset) {
  const streetRevision = dataset.streets.metadata?.release;
  if (!streetRevision || !dataset.parcelRevision || dataset.streets.metadata?.complete !== true) {
    throw new Error("Only complete revisioned planning data can be cached.");
  }
  const boundarySignature = planningBoundarySignature(boundary);
  const cached: CachedPlanningDataset = { ...dataset, key: planningDatasetIdentity(parentTerritoryId, boundary), parentTerritoryId,
    boundarySignature, complete: true, streetRevision, cachedAt: Date.now() };
  await (await planningDatabase()).put(PLANNING_CACHE_STORE, cached);
}

export function fictionalPlanningParcels(center: Coordinates): ParcelFeatureCollection {
  const [longitude, latitude] = center;
  return { type: "FeatureCollection", features: Array.from({ length: 6 }, (_, index): ParcelFeature => {
    const column = index % 3; const row = Math.floor(index / 3);
    const left = longitude - .0022 + column * .0015; const bottom = latitude - .00135 + row * .0015;
    const representativePoint: Coordinates = [left + .00055, bottom + .0005];
    return { type: "Feature", id: index + 1, properties: { id: index + 1, countyFips: "47055", gislink: `demo-${index + 1}`,
      situsAddress: `${101 + index} Main Street`, propertyClass: "residential", landUse: "residential", isResidential: true,
      representativePoint }, geometry: { type: "Polygon", coordinates: [[[left,bottom],[left+.0011,bottom],[left+.0011,bottom+.001],[left,bottom+.001],[left,bottom]]] } } as ParcelFeature;
  }) };
}

function rings(geometry: Polygon | MultiPolygon): number[][][] {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

/** Returns a deterministic point inside a parcel without treating a bbox/vertex as authoritative. */
export function parcelRepresentativePoint(geometry: Polygon | MultiPolygon): Coordinates | null {
  const outer = rings(geometry).find((ring) => ring.length >= 4);
  if (!outer) return null;
  const center: Coordinates = [outer.reduce((sum, point) => sum + point[0], 0) / outer.length, outer.reduce((sum, point) => sum + point[1], 0) / outer.length];
  if (geometryContainsPoint(geometry, center)) return center;
  for (let index = 0; index < outer.length - 1; index += 1) {
    const midpoint: Coordinates = [(outer[index][0] + outer[index + 1][0]) / 2, (outer[index][1] + outer[index + 1][1]) / 2];
    for (const weight of [.01, .05, .15, .3, .5]) {
      const candidate: Coordinates = [midpoint[0] + (center[0] - midpoint[0]) * weight, midpoint[1] + (center[1] - midpoint[1]) * weight];
      if (geometryContainsPoint(geometry, candidate)) return candidate;
    }
  }
  return null;
}

function validPoint(value: unknown): Coordinates | null {
  const coordinates = value && typeof value === "object" && !Array.isArray(value)
    ? (value as { type?: unknown; coordinates?: unknown }).type === "Point" ? (value as { coordinates?: unknown }).coordinates : undefined
    : value;
  return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.slice(0, 2).every(Number.isFinite)
    ? [Number(coordinates[0]), Number(coordinates[1])] : null;
}

/** Uses the server point-on-surface when present; old/demo parcel payloads retain a safe fallback. */
export function parcelSelectionPoint(parcel: ParcelFeature): Coordinates | null {
  const authoritative = validPoint(Reflect.get(parcel.properties, "representativePoint"));
  return authoritative ?? parcelRepresentativePoint(parcel.geometry);
}

export function parcelInsideZone(parcel: ParcelFeature, boundary: Coordinates[]) {
  const point = parcelSelectionPoint(parcel);
  const first = boundary[0]; const last = boundary.at(-1);
  const ring = first && (first[0] !== last?.[0] || first[1] !== last?.[1]) ? [...boundary, first] : boundary;
  return Boolean(point && geometryContainsPoint({ type: "Polygon", coordinates: [ring] }, point));
}

export type PlanningParcelResult = {
  parcels: ParcelFeatureCollection;
  datasetRevision: string;
  complete: boolean;
  truncated: boolean;
  availability?: string;
};

function parcelGeometry(value: unknown): Polygon | MultiPolygon | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  return (candidate.type === "Polygon" || candidate.type === "MultiPolygon") && Array.isArray(candidate.coordinates)
    ? candidate as Polygon | MultiPolygon : null;
}

export function parsePlanningParcelResponse(value: unknown): PlanningParcelResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The planning parcel service returned an invalid response.");
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.features)) throw new Error("The planning parcel service did not return parcel features.");
  const datasetRevision = typeof payload.datasetRevision === "string" ? payload.datasetRevision.trim() : "";
  const features = payload.features.map((raw, index): ParcelFeature => {
    if (!raw || typeof raw !== "object") throw new Error("The planning parcel service returned a malformed parcel.");
    const row = raw as Record<string, unknown>;
    const geometry = parcelGeometry(row.geometry);
    const point = validPoint(row.representative_point);
    const countyFips = typeof row.county_fips === "string" ? row.county_fips : "";
    const gislink = typeof row.gislink === "string" ? row.gislink : "";
    if (!geometry || !point || !/^\d{5}$/.test(countyFips) || !gislink) throw new Error("The planning parcel service returned incomplete parcel identity or geometry.");
    const id = index + 1;
    return { type: "Feature", id, geometry, properties: { id, countyFips, gislink, situsAddress: null,
      propertyClass: "residential", landUse: "residential", isResidential: true, representativePoint: point } } as ParcelFeature;
  });
  const truncated = payload.truncated === true;
  const complete = payload.complete === true && !truncated && Boolean(datasetRevision);
  return { parcels: { type: "FeatureCollection", features }, datasetRevision, complete, truncated,
    ...(typeof payload.availability === "string" ? { availability: payload.availability } : {}) };
}

function parentPolygon(boundary: Coordinates[]) {
  if (boundary.length < 3) throw new Error("A mapped parent zone needs at least three boundary points.");
  const first = boundary[0]; const last = boundary.at(-1);
  return { type: "Polygon" as const, coordinates: [first[0] === last?.[0] && first[1] === last?.[1] ? boundary : [...boundary, first]] };
}

export async function fetchPlanningParcelsForBoundary(boundary: Coordinates[], options: { publicMap?: boolean; signal?: AbortSignal } = {}): Promise<PlanningParcelResult> {
  const client = getSupabaseBrowserClient();
  if (!client) return { parcels: { type: "FeatureCollection", features: [] }, datasetRevision: "", complete: false, truncated: false };
  const request = client
    .rpc(options.publicMap ? "public_map_parcels_for_boundary_v1" : "planning_parcels_for_boundary_v1", { territory_boundary: parentPolygon(boundary) as unknown as Json });
  const { data, error } = await (options.signal ? request.abortSignal(options.signal) : request);
  if (error) throw error;
  return parsePlanningParcelResponse(data);
}

export function targetParcelKey(parcel: Pick<ParcelFeature["properties"], "countyFips" | "gislink">) {
  return `${parcel.countyFips}:${parcel.gislink}`;
}

export function applyParcelSelectionOverrides(automaticIds: ReadonlySet<string>, overrides: ReadonlyMap<string, boolean>) {
  const selected = new Set(automaticIds);
  for (const [id, included] of overrides) {
    if (included) selected.add(id);
    else selected.delete(id);
  }
  return selected;
}

export function toggleParcelSelectionOverride(overrides: ReadonlyMap<string, boolean>, id: string, automaticIds: ReadonlySet<string>) {
  const next = new Map(overrides);
  const automatic = automaticIds.has(id);
  const included = overrides.get(id) ?? automatic;
  const toggled = !included;
  if (toggled === automatic) next.delete(id);
  else next.set(id, toggled);
  return next;
}

export function planningParcelRoster(
  selectedIds: Set<string>,
  automaticIds: Set<string>,
  parcels: ParcelFeatureCollection,
  datasetRevision: string,
  automaticSource: Exclude<WalkTargetParcel["inclusionSource"], "manual_add">,
): WalkTargetParcel[] {
  return parcels.features.flatMap((parcel): WalkTargetParcel[] => {
    const key = targetParcelKey(parcel.properties);
    if (!parcel.properties.isResidential || !selectedIds.has(key)) return [];
    return [{ countyFips: parcel.properties.countyFips as WalkTargetParcel["countyFips"], gislink: parcel.properties.gislink,
      datasetRevision, inclusionSource: automaticIds.has(key) ? automaticSource : "manual_add",
      geometry: parcel.geometry as unknown as Record<string, unknown>, representativePoint: parcelSelectionPoint(parcel) ?? undefined }];
  });
}

export function polygonParcelKeys(parcels: ParcelFeatureCollection, boundary: Coordinates[]) {
  return new Set(parcels.features.filter((parcel) => parcel.properties.isResidential && parcelInsideZone(parcel, boundary))
    .map((parcel) => targetParcelKey(parcel.properties)));
}

function pointToSegment(point: Coordinates, start: Coordinates, end: Coordinates) {
  const latitudeRadians = point[1] * Math.PI / 180;
  const longitudeMeters = 111_320 * Math.max(.01, Math.cos(latitudeRadians));
  const latitudeMeters = 110_540;
  const dx = (end[0] - start[0]) * longitudeMeters;
  const dy = (end[1] - start[1]) * latitudeMeters;
  const px = (point[0] - start[0]) * longitudeMeters;
  const py = (point[1] - start[1]) * latitudeMeters;
  const lengthSquared = dx * dx + dy * dy;
  const rawAlong = lengthSquared ? (px * dx + py * dy) / lengthSquared : 0;
  const along = Math.max(0, Math.min(1, rawAlong));
  const nearestX = dx * along; const nearestY = dy * along;
  return { distance: Math.hypot(px - nearestX, py - nearestY), cross: dx * py - dy * px, rawAlong };
}

function insideDirectedCorridor(point: Coordinates, line: LineString, corridorMeters: number, side: "both" | "left" | "right") {
  let nearest: { distance: number; cross: number; rawAlong: number; segment: number } | undefined;
  const lastSegment = line.coordinates.length - 2;
  for (let index = 0; index <= lastSegment; index += 1) {
    const candidate = { ...pointToSegment(point, line.coordinates[index] as Coordinates, line.coordinates[index + 1] as Coordinates), segment: index };
    if (!nearest || candidate.distance < nearest.distance) nearest = candidate;
  }
  if (!nearest || nearest.distance > corridorMeters) return false;
  if (side === "both") return true;
  // The authoritative one-sided metric buffer has flat caps at the complete
  // directed LineString endpoints. Clamping is retained at internal vertices,
  // which preserves the buffer's normal join behavior around bends.
  if ((nearest.segment === 0 && nearest.rawAlong < 0) || (nearest.segment === lastSegment && nearest.rawAlong > 1)) return false;
  return side === "left" ? nearest.cross > 0 : nearest.cross < 0;
}

function crossProduct(a: Coordinates, b: Coordinates, c: Coordinates) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(point: Coordinates, start: Coordinates, end: Coordinates) {
  const epsilon = 1e-12;
  return Math.abs(crossProduct(start, end, point)) <= epsilon
    && point[0] >= Math.min(start[0], end[0]) - epsilon && point[0] <= Math.max(start[0], end[0]) + epsilon
    && point[1] >= Math.min(start[1], end[1]) - epsilon && point[1] <= Math.max(start[1], end[1]) + epsilon;
}

function lineSegmentsIntersect(a: Coordinates, b: Coordinates, c: Coordinates, d: Coordinates) {
  const abC = crossProduct(a, b, c); const abD = crossProduct(a, b, d);
  const cdA = crossProduct(c, d, a); const cdB = crossProduct(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return pointOnSegment(c, a, b) || pointOnSegment(d, a, b) || pointOnSegment(a, c, d) || pointOnSegment(b, c, d);
}

function segmentDistanceMeters(a: Coordinates, b: Coordinates, c: Coordinates, d: Coordinates) {
  if (lineSegmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointToSegment(a, c, d).distance, pointToSegment(b, c, d).distance,
    pointToSegment(c, a, b).distance, pointToSegment(d, a, b).distance);
}

function parcelIntersectsStreetCorridor(parcel: ParcelFeature, line: LineString, corridorMeters: number, side: "both" | "left" | "right") {
  const parcelRings = rings(parcel.geometry);
  if (side === "both") {
    if (line.coordinates.some((point) => geometryContainsPoint(parcel.geometry, point as Coordinates))) return true;
    return parcelRings.some((ring) => ring.slice(0, -1).some((start, parcelIndex) =>
      line.coordinates.slice(0, -1).some((lineStart, lineIndex) => segmentDistanceMeters(
        start as Coordinates, ring[parcelIndex + 1] as Coordinates,
        lineStart as Coordinates, line.coordinates[lineIndex + 1] as Coordinates,
      ) <= corridorMeters)));
  }
  return parcelRings.some((ring) => ring.slice(0, -1).some((point, index) => {
    const next = ring[index + 1];
    const midpoint: Coordinates = [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2];
    return insideDirectedCorridor(point as Coordinates, line, corridorMeters, side)
      || insideDirectedCorridor(midpoint, line, corridorMeters, side);
  }));
}

/** Selects residential parcel geometry intersecting the parent-clipped street corridor. */
export function streetParcelKeys(
  parcels: ParcelFeatureCollection,
  lines: LineString[],
  parentBoundary: Coordinates[],
  corridorMeters: number,
  side: "both" | "left" | "right",
) {
  const selected = new Set<string>();
  for (const parcel of parcels.features) {
    if (!parcel.properties.isResidential || !parcelInsideZone(parcel, parentBoundary)) continue;
    if (!lines.some((line) => parcelIntersectsStreetCorridor(parcel, line, corridorMeters, side))) continue;
    selected.add(targetParcelKey(parcel.properties));
  }
  return selected;
}

export function snapshotParcelFeatureCollection(roster: WalkTargetParcel[], live?: ParcelFeatureCollection): ParcelFeatureCollection {
  const liveByIdentity = new Map((live?.features ?? []).map((feature) => [targetParcelKey(feature.properties), feature]));
  const frozen = new Map<string, ParcelFeature>();
  for (const parcel of roster) {
    const identity = `${parcel.countyFips}:${parcel.gislink}`;
    const current = liveByIdentity.get(identity);
    const storedGeometry = parcelGeometry(parcel.geometry);
    const geometry = storedGeometry ?? current?.geometry;
    if (!geometry) continue;
    const id = frozen.size + 1;
    frozen.set(identity, { type: "Feature", id, geometry, properties: { ...(current?.properties ?? {}), id,
      countyFips: parcel.countyFips, gislink: parcel.gislink, situsAddress: current?.properties.situsAddress ?? null,
      propertyClass: current?.properties.propertyClass ?? null, landUse: current?.properties.landUse ?? null, isResidential: true,
      representativePoint: parcel.representativePoint ?? (current ? parcelSelectionPoint(current) ?? undefined : undefined) } } as ParcelFeature);
  }
  return { type: "FeatureCollection", features: [...frozen.values()] };
}
