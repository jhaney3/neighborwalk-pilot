import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { getSupabaseBrowserClient } from "./supabase";

export const PARCEL_RESULT_LIMIT = 3000;

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

export type ParcelBounds = {
  minLat: number;
  minLong: number;
  maxLat: number;
  maxLong: number;
};

function isParcelGeometry(value: unknown): value is Polygon | MultiPolygon {
  if (!value || typeof value !== "object") return false;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  return (geometry.type === "Polygon" || geometry.type === "MultiPolygon")
    && Array.isArray(geometry.coordinates);
}

export async function fetchParcelsInView(bounds: ParcelBounds): Promise<ParcelFeatureCollection | null> {
  const client = getSupabaseBrowserClient();
  if (!client) return null;
  const { data, error } = await client.rpc("parcels_in_view_v2", {
    min_lat: bounds.minLat,
    min_long: bounds.minLong,
    max_lat: bounds.maxLat,
    max_long: bounds.maxLong,
    result_limit: PARCEL_RESULT_LIMIT,
  });
  if (error) throw error;

  const features = data.flatMap((row): ParcelFeature[] => {
    if (!isParcelGeometry(row.geometry)) return [];
    return [{
      type: "Feature",
      id: row.id,
      properties: {
        id: row.id,
        countyFips: row.county_fips,
        gislink: row.gislink,
        situsAddress: row.situs_address,
        propertyClass: row.property_class,
        landUse: row.land_use,
        isResidential: Boolean(row.is_residential),
      },
      geometry: row.geometry,
    }];
  });
  return { type: "FeatureCollection", features };
}
