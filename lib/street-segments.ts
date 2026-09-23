import type { Feature, FeatureCollection, LineString, MultiLineString } from "geojson";
import type { Coordinates } from "./domain";
import { getSupabaseBrowserClient, type Json } from "./supabase";

export const OVERTURE_TRANSPORTATION_RELEASE = "2026-08-19.0";
export const OVERTURE_TRANSPORTATION_SOURCE = "Overture transportation";

export type StreetSegmentProperties = {
  id: string;
  name: string | null;
  roadClass: string;
  subclass: string | null;
  release: string;
  complete: boolean;
};
export type StreetSegmentFeature = Feature<LineString | MultiLineString, StreetSegmentProperties> & {
  displayGeometry?: LineString | MultiLineString;
};
export type StreetSegmentCollection = FeatureCollection<LineString | MultiLineString, StreetSegmentProperties> & {
  features: StreetSegmentFeature[];
  metadata?: { release: string; source?: string; complete: boolean; truncated: boolean; attribution: string; availability?: string };
};

export type StreetSegmentQuery = { boundary: Coordinates[]; signal?: AbortSignal; publicMap?: boolean };

function isPosition(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite)
    && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
}

function streetGeometry(value: unknown): LineString | MultiLineString | undefined {
  if (!value || typeof value !== "object") return undefined;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type === "LineString" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2 && geometry.coordinates.every(isPosition)) {
    return geometry as LineString;
  }
  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0
    && geometry.coordinates.every((line) => Array.isArray(line) && line.length >= 2 && line.every(isPosition))) {
    return geometry as MultiLineString;
  }
  return undefined;
}

export function parseStreetSegmentResponse(value: unknown): StreetSegmentCollection {
  if (!value || typeof value !== "object") throw new Error("The street service returned an invalid response.");
  const payload = value as { features?: unknown; release?: unknown; source?: unknown; complete?: unknown; truncated?: unknown; availability?: unknown };
  if (!Array.isArray(payload.features)) throw new Error("The street service did not return street sections.");
  const release = typeof payload.release === "string" ? payload.release.trim() : "";
  const complete = payload.complete === true && payload.truncated !== true && Boolean(release);
  const ids = new Set<string>();
  const features = payload.features.map((raw): StreetSegmentFeature => {
    if (!raw || typeof raw !== "object") throw new Error("The street service returned a malformed section.");
    const row = raw as Record<string, unknown>;
    const geometry = streetGeometry(row.geometry);
    const displayGeometry = row.display_geometry === undefined ? undefined : streetGeometry(row.display_geometry);
    if (!geometry || (row.display_geometry !== undefined && !displayGeometry)) throw new Error("The street service returned invalid section geometry.");
    const id = String(row.id ?? "");
    if (!id || ids.has(id)) throw new Error("The street service returned an invalid or duplicate section ID.");
    ids.add(id);
    return { type: "Feature", id, geometry, displayGeometry, properties: { id, name: typeof row.name === "string" ? row.name : null,
      roadClass: typeof row.road_class === "string" ? row.road_class : "unknown", subclass: typeof row.subclass === "string" ? row.subclass : null,
      release, complete } };
  });
  return { type: "FeatureCollection", features, metadata: { release,
    source: typeof payload.source === "string" ? payload.source : undefined,
    ...(typeof payload.availability === "string" ? { availability: payload.availability } : {}),
    complete, truncated: payload.truncated === true,
    attribution: "© OpenStreetMap contributors, Overture Maps Foundation" } };
}

export function streetSegmentLines(feature: StreetSegmentFeature): LineString[] {
  return feature.geometry.type === "LineString" ? [feature.geometry] : feature.geometry.coordinates.map((coordinates) => ({ type: "LineString", coordinates }));
}

export function streetSegmentDisplayLines(feature: StreetSegmentFeature): LineString[] {
  const geometry = feature.displayGeometry ?? feature.geometry;
  return geometry.type === "LineString" ? [geometry] : geometry.coordinates.map((coordinates) => ({ type: "LineString", coordinates }));
}

function territoryPolygon(boundary: Coordinates[]) {
  if (boundary.length < 3) throw new Error("A mapped parent zone needs at least three boundary points.");
  const first = boundary[0]; const last = boundary[boundary.length - 1];
  const ring = first[0] === last?.[0] && first[1] === last?.[1] ? boundary : [...boundary, first];
  return { type: "Polygon" as const, coordinates: [ring] };
}

export async function fetchStreetSegmentsForBoundary({ boundary, signal, publicMap = false }: StreetSegmentQuery): Promise<StreetSegmentCollection> {
  const client = getSupabaseBrowserClient();
  if (!client) return { type: "FeatureCollection", features: [], metadata: { release: "", complete: false, truncated: false, attribution: "© OpenStreetMap contributors, Overture Maps Foundation" } };
  const request = client
    .rpc(publicMap ? "public_map_streets_for_boundary_v1" : "street_segments_for_boundary_v1", { territory_boundary: territoryPolygon(boundary) as unknown as Json });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  return parseStreetSegmentResponse(data);
}

export const FICTIONAL_STREET_SEGMENTS: StreetSegmentCollection = { type: "FeatureCollection", metadata: { release: "demo", complete: true, truncated: false, attribution: "Fictional demo streets" }, features: [
  { type: "Feature", id: "demo-oak-1", properties: { id: "demo-oak-1", name: "Oak Street", roadClass: "residential", subclass: null, release: "demo", complete: true }, geometry: { type: "LineString", coordinates: [[-86.789, 36.157], [-86.786, 36.157]] } },
  { type: "Feature", id: "demo-oak-2", properties: { id: "demo-oak-2", name: "Oak Street", roadClass: "residential", subclass: null, release: "demo", complete: true }, geometry: { type: "LineString", coordinates: [[-86.786, 36.157], [-86.783, 36.157]] } },
  { type: "Feature", id: "demo-pine-1", properties: { id: "demo-pine-1", name: "Pine Avenue", roadClass: "residential", subclass: null, release: "demo", complete: true }, geometry: { type: "LineString", coordinates: [[-86.786, 36.155], [-86.786, 36.159]] } },
] };

export function fictionalStreetSegmentsForTerritory(center: Coordinates): StreetSegmentCollection {
  const [x, y] = center; const dx = .0025; const dy = .0018;
  return { type: "FeatureCollection", metadata: { release: "demo", complete: true, truncated: false, attribution: "Fictional demo streets" }, features: [
    { type:"Feature", id:"demo-main-west", properties:{ id:"demo-main-west",name:"Main Street",roadClass:"residential",subclass:null,release:"demo",complete:true }, geometry:{ type:"LineString",coordinates:[[x-dx,y],[x,y]] } },
    { type:"Feature", id:"demo-main-east", properties:{ id:"demo-main-east",name:"Main Street",roadClass:"residential",subclass:null,release:"demo",complete:true }, geometry:{ type:"LineString",coordinates:[[x,y],[x+dx,y]] } },
    { type:"Feature", id:"demo-cross", properties:{ id:"demo-cross",name:"Church Avenue",roadClass:"residential",subclass:null,release:"demo",complete:true }, geometry:{ type:"LineString",coordinates:[[x,y-dy],[x,y+dy]] } },
  ] };
}
