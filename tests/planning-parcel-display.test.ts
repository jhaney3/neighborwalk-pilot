import { describe, expect, it } from "vitest";
import type { ParcelFeatureCollection } from "../lib/parcels";
import { planningParcelDisplayCollection } from "../lib/target-parcels";

const parcels: ParcelFeatureCollection = {
  type: "FeatureCollection",
  features: ["visited", "open"].map((gislink, index) => ({
    type: "Feature" as const,
    id: index + 1,
    properties: { id: index + 1, countyFips: "47099", gislink, situsAddress: null, propertyClass: "residential", landUse: "residential", isResidential: true },
    geometry: { type: "Polygon" as const, coordinates: [[[-87, 35], [-86.99, 35], [-86.99, 35.01], [-87, 35.01], [-87, 35]]] },
  })),
};

describe("planning parcel display state", () => {
  it("marks previously visited parcels without selecting them for tonight", () => {
    const displayed = planningParcelDisplayCollection(parcels, new Set(), new Set(), new Set(["47099:visited"]));
    expect(displayed.features[0].properties).toMatchObject({ chosen: false, claimed: false, previouslyVisited: true });
    expect(displayed.features[1].properties).toMatchObject({ chosen: false, claimed: false, previouslyVisited: false });
  });

  it("keeps target-selection state independent from historical visit state", () => {
    const displayed = planningParcelDisplayCollection(parcels, new Set(["47099:visited"]), new Set(), new Set(["47099:visited"]));
    expect(displayed.features[0].properties).toMatchObject({ chosen: true, previouslyVisited: true });
  });
});
