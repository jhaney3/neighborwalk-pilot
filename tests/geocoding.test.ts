import { afterEach, describe, expect, it, vi } from "vitest";
import { forwardGeocode, parseAddressSearchResults, reverseGeocode } from "../lib/geocoding";

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

describe("forwardGeocode", () => {
  it("searches MapTiler for addresses near the active territory", async () => {
    process.env.NEXT_PUBLIC_MAPTILER_KEY = "test-maptiler-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [{
          id: "address.208-laurel",
          place_name: "208 W Laurel Drive, Lawrence, Tennessee 38464, United States",
          center: [-87.397677, 35.258903],
          place_type: ["address"],
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(forwardGeocode("W LAUREL DR 208, 000, TN", { proximity: [-87.3977, 35.2589] })).resolves.toEqual([{
      id: "address.208-laurel",
      label: "208 W Laurel Drive, Lawrence, Tennessee 38464, United States",
      coordinates: [-87.397677, 35.258903],
      type: "address",
      zoom: 18,
    }]);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(decodeURIComponent(requestedUrl.pathname)).toContain("W LAUREL DR 208, 000, TN.json");
    expect(requestedUrl.searchParams.get("country")).toBe("us");
    expect(requestedUrl.searchParams.get("proximity")).toBe("-87.3977,35.2589");
  });

  it("drops malformed geocoder features", () => {
    expect(parseAddressSearchResults({ features: [
      { id: "bad", place_name: "Nowhere", center: [999, 999], place_type: ["address"] },
      { id: "road", place_name: "West Laurel Drive", center: [-87.397, 35.259], place_type: ["road"] },
    ] })).toEqual([{
      id: "road",
      label: "West Laurel Drive",
      coordinates: [-87.397, 35.259],
      type: "road",
      zoom: 16.5,
    }]);
  });
});
