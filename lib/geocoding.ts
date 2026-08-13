import type { Coordinates } from "./domain";
import { usableMapTilerKey } from "./map-config";

type GeocoderResponse = {
  address?: string;
  formattedAddress?: string;
  display_name?: string;
  features?: Array<{ place_name?: string; text?: string }>;
};

function firstAddress(value: GeocoderResponse) {
  return value.address
    || value.formattedAddress
    || value.display_name
    || value.features?.find((feature) => feature.place_name)?.place_name
    || value.features?.find((feature) => feature.text)?.text
    || null;
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
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Address lookup failed (${response.status})`);
  return firstAddress(await response.json() as GeocoderResponse);
}
