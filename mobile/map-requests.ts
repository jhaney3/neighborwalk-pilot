import { Capacitor } from "@capacitor/core";
import type { RequestTransformFunction } from "maplibre-gl";

// Match the dedicated native MapTiler key's allowed User-Agent. The website
// keeps its own origin-restricted key; no Origin or Referer is impersonated.
const APP_AGENT = "SendMe-iOS/app.neighborwalk.ios";

export function nativeMapTilerHeaders(value: string): Record<string, string> {
  if (!Capacitor.isNativePlatform()) return {};
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {};
  }
  if (url.protocol !== "https:" || url.hostname !== "api.maptiler.com"
    || url.username || url.password || url.port) return {};
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  // CapacitorHttp uses URLSession and doesn't inherit appendUserAgent. Supply
  // it explicitly there; WebKit/worker requests use the appended WebView agent.
  return { "User-Agent": agent.includes(APP_AGENT) ? agent : `${agent} ${APP_AGENT}`.trim() };
}

// Vector tiles load in MapLibre's Web Worker, outside CapacitorHttp. Let
// WebKit send its configured agent there: setting User-Agent in fetch headers
// triggers a CORS preflight that MapTiler does not allow.
export const nativeMapTilerRequest: RequestTransformFunction = (url, type) => ({
  url,
  ...(type === "Tile" ? {} : { headers: nativeMapTilerHeaders(url) }),
});
