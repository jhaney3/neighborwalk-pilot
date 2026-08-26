import { describe, expect, it } from "vitest";
import { isTerritoryParcelCacheFresh, PARCEL_CACHE_MAX_AGE_MS } from "../lib/parcel-cache";
import {
  mergeParcelFeatureCollections,
  parseTerritoryParcelResponse,
  parseVisibleParcelRows,
  territoryBoundarySignature,
  viewportKey,
} from "../lib/parcels";

describe("territory parcel loading", () => {
  it("parses the territory response and preserves cache metadata", () => {
    const result = parseTerritoryParcelResponse({
      datasetRevision: "2026-08-13T23:24:23Z",
      totalCount: 1,
      truncated: false,
      features: [{
        type: "Feature",
        id: 17,
        properties: {
          id: 17,
          countyFips: "47099",
          gislink: "example-17",
          situsAddress: "116 W Gaines Street",
          propertyClass: "Residential",
          landUse: "Single family",
          isResidential: true,
        },
        geometry: {
          type: "Polygon",
          coordinates: [[[-87.34, 35.24], [-87.33, 35.24], [-87.33, 35.25], [-87.34, 35.24]]],
        },
      }],
    });

    expect(result.datasetRevision).toBe("2026-08-13T23:24:23Z");
    expect(result.totalCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.parcels.features[0].properties).toMatchObject({
      id: 17,
      countyFips: "47099",
      isResidential: true,
    });
  });

  it("rejects malformed responses instead of caching them", () => {
    expect(() => parseTerritoryParcelResponse({ totalCount: 1, features: "not-an-array" })).toThrow();
    expect(() => parseTerritoryParcelResponse({ totalCount: -1, features: [] })).toThrow();
  });

  it("changes the cache key when a territory boundary changes", () => {
    const original = territoryBoundarySignature([[-87.34, 35.24], [-87.33, 35.24], [-87.33, 35.25]]);
    const edited = territoryBoundarySignature([[-87.34, 35.24], [-87.32, 35.24], [-87.33, 35.25]]);
    expect(original).not.toBe(edited);
  });

  it("refreshes only after the twelve-hour cache window", () => {
    const cachedAt = Date.UTC(2026, 7, 13, 12);
    expect(isTerritoryParcelCacheFresh(cachedAt, cachedAt + PARCEL_CACHE_MAX_AGE_MS - 1)).toBe(true);
    expect(isTerritoryParcelCacheFresh(cachedAt, cachedAt + PARCEL_CACHE_MAX_AGE_MS)).toBe(false);
  });
});

describe("visible parcel loading", () => {
  it("parses viewport RPC rows and keeps county identity", () => {
    const parcels = parseVisibleParcelRows([{
      id: 5144,
      county_fips: "47099",
      gislink: "050079A A 04000",
      situs_address: "W LAUREL DR 208, 000, TN",
      property_class: "00 RESIDENTIAL",
      land_use: null,
      is_residential: true,
      geometry: { type: "Polygon", coordinates: [[[-87.398, 35.258], [-87.397, 35.258], [-87.397, 35.259], [-87.398, 35.258]]] },
    }]);
    expect(parcels.features[0].properties).toMatchObject({
      id: 5144,
      countyFips: "47099",
      situsAddress: "W LAUREL DR 208, 000, TN",
      isResidential: true,
    });
  });

  it("deduplicates territory and viewport parcel results", () => {
    const parcel = parseVisibleParcelRows([{
      id: 5144,
      county_fips: "47099",
      gislink: "050079A A 04000",
      situs_address: "W LAUREL DR 208, 000, TN",
      property_class: null,
      land_use: null,
      is_residential: true,
      geometry: { type: "Polygon", coordinates: [[[-87.398, 35.258], [-87.397, 35.258], [-87.397, 35.259], [-87.398, 35.258]]] },
    }]);
    expect(mergeParcelFeatureCollections(parcel, parcel).features).toHaveLength(1);
  });

  it("requests viewport parcels only at parcel-detail zoom", () => {
    expect(viewportKey({ minLatitude: 35.25, minLongitude: -87.4, maxLatitude: 35.27, maxLongitude: -87.38, zoom: 14 })).toBeNull();
    expect(viewportKey({ minLatitude: 35.25, minLongitude: -87.4, maxLatitude: 35.27, maxLongitude: -87.38, zoom: 18 })).toBe("-87.40000:35.25000:-87.38000:35.27000");
  });
});
