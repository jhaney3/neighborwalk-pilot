import type { Coordinates } from "./domain";
import { usableMapTilerKey } from "./map-config";
import { nativeMapTilerHeaders } from "../mobile/map-requests";

type GeocoderResponse = {
  address?: string;
  formattedAddress?: string;
  display_name?: string;
  features?: GeocoderFeature[];
};

type GeocoderFeature = {
  id?: string;
  place_name?: string;
  matching_place_name?: string;
  text?: string;
  center?: unknown;
  geometry?: { type?: unknown; coordinates?: unknown };
  place_type?: unknown;
};

export type AddressSearchResult = {
  id: string;
  label: string;
  coordinates: Coordinates;
  type: "address" | "road" | "place";
  zoom: number;
};

type ForwardGeocodeOptions = {
  proximity?: Coordinates;
  signal?: AbortSignal;
};

function firstAddress(value: GeocoderResponse) {
  return value.address
    || value.formattedAddress
    || value.display_name
    || value.features?.find((feature) => feature.place_name)?.place_name
    || value.features?.find((feature) => feature.text)?.text
    || null;
}

function featureCoordinates(feature: GeocoderFeature): Coordinates | null {
  const value = Array.isArray(feature.center)
    ? feature.center
    : feature.geometry?.type === "Point" && Array.isArray(feature.geometry.coordinates)
      ? feature.geometry.coordinates
      : null;
  if (!value || value.length < 2) return null;
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
  return [longitude, latitude];
}

function resultType(feature: GeocoderFeature): AddressSearchResult["type"] {
  const types = Array.isArray(feature.place_type) ? feature.place_type : [];
  if (types.includes("address")) return "address";
  if (types.includes("road")) return "road";
  return "place";
}

export function parseAddressSearchResults(value: unknown): AddressSearchResult[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as GeocoderResponse).features)) return [];
  return (value as GeocoderResponse).features!.flatMap((feature, index) => {
    const coordinates = featureCoordinates(feature);
    const label = feature.matching_place_name || feature.place_name || feature.text;
    if (!coordinates || !label?.trim()) return [];
    const type = resultType(feature);
    return [{
      id: feature.id || `address-${coordinates.join("-")}-${index}`,
      label: label.trim(),
      coordinates,
      type,
      zoom: type === "address" ? 18 : type === "road" ? 16.5 : 13.5,
    }];
  });
}

export async function forwardGeocode(query: string, options: ForwardGeocodeOptions = {}): Promise<AddressSearchResult[]> {
  const normalizedQuery = query.trim();
  const mapTilerKey = usableMapTilerKey(process.env.NEXT_PUBLIC_MAPTILER_KEY);
  if (normalizedQuery.length < 3 || !mapTilerKey) return [];

  const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(normalizedQuery)}.json`);
  url.searchParams.set("key", mapTilerKey);
  url.searchParams.set("country", "us");
  url.searchParams.set("language", "en");
  url.searchParams.set("types", "address,road,place,postal_code");
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("fuzzyMatch", "true");
  url.searchParams.set("limit", "6");
  if (options.proximity) url.searchParams.set("proximity", options.proximity.join(","));

  const response = await fetch(url, {
    headers: { accept: "application/json", ...nativeMapTilerHeaders(url.toString()) },
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`Address search failed (${response.status})`);
  return parseAddressSearchResults(await response.json());
}

export async function reverseGeocode(coordinates: Coordinates): Promise<string | null> {
  const endpoint = process.env.NEXT_PUBLIC_GEOCODER_URL;
  const mapTilerKey = usableMapTilerKey(process.env.NEXT_PUBLIC_MAPTILER_KEY);
  if (!endpoint && !mapTilerKey) return null;

  const url = endpoint
    ? new URL(endpoint)
    : new URL(`https://api.maptiler.com/geocoding/${coordinates[0]},${coordinates[1]}.json`);
  if (endpoint) {
    url.searchParams.set("lat", String(coordinates[1]));
    url.searchParams.set("lng", String(coordinates[0]));
  } else {
    url.searchParams.set("key", mapTilerKey!);
    url.searchParams.set("types", "address");
    url.searchParams.set("limit", "1");
  }
  const response = await fetch(url, { headers: { accept: "application/json", ...nativeMapTilerHeaders(url.toString()) } });
  if (!response.ok) throw new Error(`Address lookup failed (${response.status})`);
  return firstAddress(await response.json() as GeocoderResponse);
}
