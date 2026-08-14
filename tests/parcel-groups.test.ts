import { describe, expect, it } from "vitest";
import { createSeedData } from "../lib/seed";
import { dwellingsForParcel, parcelKey, parcelProgress } from "../lib/parcel-groups";
import { migrateNeighborWalkData } from "../lib/storage";
import { APP_SCHEMA_VERSION, neighborWalkDataSchema, type ParcelReference } from "../lib/domain";

const parcel: ParcelReference = { id: 42, countyFips: "47099", gislink: "LAW-00042" };

describe("parcel dwelling groups", () => {
  it("groups independent dwellings by the stable county and GIS parcel identity", () => {
    const seed = createSeedData();
    const properties = seed.properties.slice(0, 3).map((property, index) => ({
      ...property,
      id: `dwelling-${index}`,
      parcel: index < 2 ? parcel : { countyFips: "47099", gislink: "LAW-OTHER" },
      currentOutcome: index === 0 ? "conversation" as const : "unvisited" as const,
    }));

    const dwellings = dwellingsForParcel(properties, parcel);
    expect(parcelKey(parcel)).toBe("47099:LAW-00042");
    expect(dwellings.map((property) => property.id)).toEqual(["dwelling-0", "dwelling-1"]);
    expect(parcelProgress(dwellings)).toEqual({ total: 2, visited: 1, remaining: 1, percent: 50 });
  });

  it("upgrades older workspace snapshots without dropping locations or visit history", () => {
    const older = { ...createSeedData(), schemaVersion: 4 };
    const migrated = migrateNeighborWalkData(older);
    const parsed = neighborWalkDataSchema.parse(migrated);

    expect(parsed.schemaVersion).toBe(APP_SCHEMA_VERSION);
    expect(parsed.properties).toHaveLength(older.properties.length);
    expect(parsed.visits).toHaveLength(older.visits.length);
  });
});
