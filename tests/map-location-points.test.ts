import { describe, expect, it } from "vitest";
import type { Property } from "../lib/domain";
import { mapLocationPointCollection } from "../lib/map-location-points";

function property(id: string, outcome: Property["currentOutcome"], coordinates?: Property["coordinates"], mergedIntoId?: string): Property {
  return {
    id,
    churchId: "church",
    territoryId: "zone",
    address: `${id} Oak Lane`,
    coordinates,
    currentOutcome: outcome,
    visitCount: outcome === "unvisited" ? 0 : 1,
    createdAt: "2026-09-19T12:00:00.000Z",
    updatedAt: "2026-09-19T12:00:00.000Z",
    source: "map",
    mergedIntoId,
  };
}

describe("planning map location dots", () => {
  it("uses the main map outcome colors and omits locations without a current point", () => {
    const collection = mapLocationPointCollection([
      property("talked", "conversation", [-87, 35]),
      property("open", "unvisited", [-87.01, 35.01]),
      property("missing", "no_answer"),
      property("merged", "follow_up", [-87.02, 35.02], "talked"),
    ]);

    expect(collection.features).toHaveLength(2);
    expect(collection.features[0].properties).toMatchObject({ outcome: "conversation", statusColor: "#4d977e", outlineColor: "#4d977e", visited: true });
    expect(collection.features[1].properties).toMatchObject({ outcome: "unvisited", statusColor: "#ffffff", outlineColor: "#315c50", visited: false });
  });
});
