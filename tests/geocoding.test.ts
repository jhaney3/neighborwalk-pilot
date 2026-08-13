import { afterEach, describe, expect, it, vi } from "vitest";
import { reverseGeocode } from "../lib/geocoding";

const originalMapTilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const originalGeocoderUrl = process.env.NEXT_PUBLIC_GEOCODER_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_MAPTILER_KEY = originalMapTilerKey;
  process.env.NEXT_PUBLIC_GEOCODER_URL = originalGeocoderUrl;
  vi.unstubAllGlobals();
});

describe("reverseGeocode", () => {
  it("uses MapTiler address results when no custom geocoder is configured", async () => {
    process.env.NEXT_PUBLIC_GEOCODER_URL = "";
    process.env.NEXT_PUBLIC_MAPTILER_KEY = "test-maptiler-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [{ place_name: "116 W Gaines Street, Lawrenceburg, Tennessee 38464, United States" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reverseGeocode([-87.33474, 35.2423])).resolves.toBe(
      "116 W Gaines Street, Lawrenceburg, Tennessee 38464, United States",
    );
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.pathname).toContain("/-87.33474,35.2423.json");
    expect(requestedUrl.searchParams.get("types")).toBe("address");
    expect(requestedUrl.searchParams.get("limit")).toBe("1");
  });

  it("keeps a configured geocoder endpoint as the preferred source", async () => {
    process.env.NEXT_PUBLIC_GEOCODER_URL = "https://example.test/reverse";
    process.env.NEXT_PUBLIC_MAPTILER_KEY = "test-maptiler-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ address: "25 Public Square, Lawrenceburg, TN" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reverseGeocode([-87.33474, 35.2423])).resolves.toBe("25 Public Square, Lawrenceburg, TN");
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.origin).toBe("https://example.test");
    expect(requestedUrl.searchParams.get("lat")).toBe("35.2423");
    expect(requestedUrl.searchParams.get("lng")).toBe("-87.33474");
  });
});
