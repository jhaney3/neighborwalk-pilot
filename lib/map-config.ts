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

function configuredMapStyleOrigin(): string | null {
  try {
    const configured = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim();
    return configured ? new URL(configured).origin : null;
  } catch {
    return null;
  }
}

export function isSupportedMapStyleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    return local || url.protocol === "https:" && (
      url.hostname === "tiles.openfreemap.org"
      || url.hostname === "api.maptiler.com"
      || url.hostname.endsWith(".maptiler.com")
      || url.origin === configuredMapStyleOrigin()
    );
  } catch {
    return false;
  }
}

export function isOpenFreeMapStyle(value: string): boolean {
  try {
    return new URL(value).hostname === "tiles.openfreemap.org";
  } catch {
    return false;
  }
}
