import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Coordinates } from "./domain";
import { getSupabaseBrowserClient, type Json } from "./supabase";

export const TERRITORY_PARCEL_RESULT_LIMIT = 12000;
export const TERRITORY_PARCEL_BUFFER_METERS = 35;

export type ParcelDetails = {
  id: number;
  countyFips: string;
  gislink: string;
  situsAddress: string | null;
  propertyClass: string | null;
  landUse: string | null;
  isResidential: boolean;
};

export type ParcelFeature = Feature<Polygon | MultiPolygon, ParcelDetails>;
export type ParcelFeatureCollection = FeatureCollection<Polygon | MultiPolygon, ParcelDetails>;

export type TerritoryParcelResult = {
  parcels: ParcelFeatureCollection;
  datasetRevision: string;
  totalCount: number;
  truncated: boolean;
};

function isParcelGeometry(value: unknown): value is Polygon | MultiPolygon {
  if (!value || typeof value !== "object") return false;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  return (geometry.type === "Polygon" || geometry.type === "MultiPolygon")
    && Array.isArray(geometry.coordinates);
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseParcelFeature(value: unknown): ParcelFeature | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    id?: unknown;
    type?: unknown;
    properties?: Record<string, unknown>;
    geometry?: unknown;
  };
  if (candidate.type !== "Feature" || !isParcelGeometry(candidate.geometry) || !candidate.properties) return null;
  const id = Number(candidate.properties.id ?? candidate.id);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return {
    type: "Feature",
    id,
    properties: {
      id,
      countyFips: typeof candidate.properties.countyFips === "string" ? candidate.properties.countyFips : "",
      gislink: typeof candidate.properties.gislink === "string" ? candidate.properties.gislink : "",
      situsAddress: asNullableString(candidate.properties.situsAddress),
      propertyClass: asNullableString(candidate.properties.propertyClass),
      landUse: asNullableString(candidate.properties.landUse),
      isResidential: candidate.properties.isResidential === true,
    },
    geometry: candidate.geometry,
  };
}

export function parseTerritoryParcelResponse(value: unknown): TerritoryParcelResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The parcel service returned an invalid response.");
  }
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.features)) throw new Error("The parcel service did not return parcel features.");
  const datasetRevision = typeof payload.datasetRevision === "string" ? payload.datasetRevision : "unknown";
  const totalCount = Number(payload.totalCount);
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) throw new Error("The parcel service returned an invalid total.");
  const features = payload.features.flatMap((feature) => {
    const parsed = parseParcelFeature(feature);
    return parsed ? [parsed] : [];
  });
  return {
    parcels: { type: "FeatureCollection", features },
    datasetRevision,
    totalCount,
    truncated: payload.truncated === true,
  };
}

export function territoryBoundarySignature(boundary: Coordinates[]) {
  return boundary.map(([longitude, latitude]) => `${longitude.toFixed(6)},${latitude.toFixed(6)}`).join(";");
}

function territoryPolygon(boundary: Coordinates[]): Polygon {
  if (boundary.length < 3) throw new Error("A territory needs at least three boundary points before parcels can load.");
  const first = boundary[0];
  const last = boundary.at(-1);
  const closed = first[0] === last?.[0] && first[1] === last?.[1]
    ? boundary
    : [...boundary, first];
  return { type: "Polygon", coordinates: [closed] };
}

export async function fetchParcelsForTerritory(boundary: Coordinates[]): Promise<TerritoryParcelResult | null> {
  const client = getSupabaseBrowserClient();
  if (!client) return null;
  const { data, error } = await client.rpc("parcels_for_territory_v1", {
    territory_geometry: territoryPolygon(boundary) as unknown as Json,
    buffer_meters: TERRITORY_PARCEL_BUFFER_METERS,
    result_limit: TERRITORY_PARCEL_RESULT_LIMIT,
  });
  if (error) throw error;
  return parseTerritoryParcelResponse(data);
}

export async function fetchParcelDatasetRevision(): Promise<string | null> {
  const client = getSupabaseBrowserClient();
  if (!client) return null;
  const { data, error } = await client.rpc("parcel_dataset_revision_v1");
  if (error) throw error;
  return typeof data === "string" ? data : null;
}
