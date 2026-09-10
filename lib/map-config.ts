export const OPENFREEMAP_BRIGHT_URL = "https://tiles.openfreemap.org/styles/bright";

const MAPTILER_STREETS_PATH = "https://api.maptiler.com/maps/streets-v4/style.json";
const MAPTILER_KEY_PLACEHOLDERS = new Set([
  "YOUR_MAPTILER_KEY",
  "PASTE_YOUR_MAPTILER_KEY_HERE",
]);

export function usableMapTilerKey(value: string | undefined): string | null {
  const key = value?.trim();
  if (!key || MAPTILER_KEY_PLACEHOLDERS.has(key) || key.length < 10) return null;
  return key;
}

export function mapTilerStyleUrlForKey(value: string | undefined): string | null {
  const key = usableMapTilerKey(value);
  if (!key) return null;
  return `${MAPTILER_STREETS_PATH}?key=${encodeURIComponent(key)}`;
}

export const MAPTILER_STREETS_URL = mapTilerStyleUrlForKey(process.env.NEXT_PUBLIC_MAPTILER_KEY);
export const MAP_STYLE_CONFIGURATION_REVISION = MAPTILER_STREETS_URL ? 1 : 0;

export const DEFAULT_MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim()
  || MAPTILER_STREETS_URL
  || OPENFREEMAP_BRIGHT_URL;

export function isOpenFreeMapStyle(value: string): boolean {
  try {
    return new URL(value).hostname === "tiles.openfreemap.org";
  } catch {
    return false;
  }
}
