import { afterEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => vi.fn(() => true));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: native } }));
import { nativeMapTilerHeaders, nativeMapTilerRequest } from "../mobile/map-requests";
import type { ResourceType } from "maplibre-gl";

afterEach(() => { native.mockReturnValue(true); vi.unstubAllGlobals(); });

describe("native MapTiler requests", () => {
  it("leaves worker tile headers to WebKit to avoid a rejected CORS preflight", () => {
    const url = "https://api.maptiler.com/tiles/v4/15/8434/12952.pbf?key=fictional";
    expect(nativeMapTilerRequest(url, "Tile" as ResourceType)).toEqual({ url });
  });
  it("identifies native HTTP requests without impersonating the website origin", () => {
    vi.stubGlobal("navigator", { userAgent: "WebKit test" });
    expect(nativeMapTilerHeaders("https://api.maptiler.com/maps/streets-v4/style.json?key=fictional"))
      .toEqual({ "User-Agent": "WebKit test SendMe-iOS/app.neighborwalk.ios" });
  });
  it("keeps the WebView's already appended identity", () => {
    vi.stubGlobal("navigator", { userAgent: "WebKit SendMe-iOS/app.neighborwalk.ios" });
    expect(nativeMapTilerHeaders("https://api.maptiler.com/tiles/v4/tiles.json"))
      .toEqual({ "User-Agent": "WebKit SendMe-iOS/app.neighborwalk.ios" });
  });
  it("leaves website requests unchanged", () => {
    native.mockReturnValue(false);
    expect(nativeMapTilerHeaders("https://api.maptiler.com/maps/streets-v4/style.json")).toEqual({});
  });
  it.each(["https://api.maptiler.com.example.test/maps", "https://another.example.test/maps", "http://api.maptiler.com/maps", "https://user:password@api.maptiler.com/maps", "https://api.maptiler.com:8443/maps", "/maps"])("does not alter another provider or unsafe URL: %s", (url) => {
    expect(nativeMapTilerHeaders(url)).toEqual({});
  });
});
