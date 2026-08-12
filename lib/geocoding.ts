import type { Coordinates } from "./domain";

export async function reverseGeocode(coordinates: Coordinates): Promise<string | null> {
  const endpoint = process.env.NEXT_PUBLIC_GEOCODER_URL;
  if (!endpoint) return null;
  const url = new URL(endpoint);
  url.searchParams.set("lat", String(coordinates[1]));
  url.searchParams.set("lng", String(coordinates[0]));
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Address lookup failed (${response.status})`);
  const value = await response.json() as { address?: string; formattedAddress?: string; display_name?: string };
  return value.address || value.formattedAddress || value.display_name || null;
}
