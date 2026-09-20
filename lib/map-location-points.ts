import type { FeatureCollection, Point } from "geojson";
import { outcomeMeta, type Property } from "./domain";

/** Build the colored location dots shared by map-based planning views. */
export function mapLocationPointCollection(properties: readonly Property[], compact = false): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: properties.flatMap((property) => {
      if (!property.coordinates || property.mergedIntoId) return [];
      const visited = property.currentOutcome !== "unvisited";
      const statusColor = outcomeMeta[property.currentOutcome].color;
      return [{
        type: "Feature" as const,
        properties: {
          propertyId: property.id,
          outcome: property.currentOutcome,
          statusColor,
          outlineColor: visited ? statusColor : "#315c50",
          visited,
          compact,
        },
        geometry: { type: "Point" as const, coordinates: property.coordinates },
      }];
    }),
  };
}
