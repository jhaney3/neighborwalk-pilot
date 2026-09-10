import type { MultiPolygon, Polygon } from "geojson";
import type { Coordinates, NeighborWalkData, Property } from "./domain";
import { geometryContainsPoint, ringContainsPoint } from "./geometry";
import { parcelKey, propertyParcelKey } from "./parcel-groups";
import type { ParcelFeature, ParcelFeatureCollection } from "./parcels";

export type TerritoryCoverage = {
  total: number;
  touched: number;
  remaining: number;
  percent: number;
  basis: "residential_parcels" | "mapped_locations";
};

export type TerritoryCoverageById = Record<string, TerritoryCoverage>;

function ringArea(ring: number[][]) {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    twiceArea += x1 * y2 - x2 * y1;
  }
  return twiceArea / 2;
}

function ringCenter(ring: number[][]): Coordinates {
  let twiceArea = 0;
  let longitude = 0;
  let latitude = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    longitude += (x1 + x2) * cross;
    latitude += (y1 + y2) * cross;
  }
  if (Math.abs(twiceArea) < Number.EPSILON) {
    const points = ring.slice(0, -1).length ? ring.slice(0, -1) : ring;
    return [
      points.reduce((sum, point) => sum + point[0], 0) / Math.max(1, points.length),
      points.reduce((sum, point) => sum + point[1], 0) / Math.max(1, points.length),
    ];
  }
  return [longitude / (3 * twiceArea), latitude / (3 * twiceArea)];
}

function parcelCenter(geometry: Polygon | MultiPolygon) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const largest = polygons.reduce<number[][] | null>((current, polygon) => {
    if (!current || Math.abs(ringArea(polygon[0])) > Math.abs(ringArea(current))) return polygon[0];
    return current;
  }, null);
  return largest ? ringCenter(largest) : null;
}

function parcelIsInsideTerritory(parcel: ParcelFeature, boundary: Coordinates[]) {
  const center = parcelCenter(parcel.geometry);
  return Boolean(center && ringContainsPoint(center, boundary));
}

function mappedLocationCoverage(properties: Property[]): TerritoryCoverage {
  const touched = properties.filter((property) => property.currentOutcome !== "unvisited").length;
  return {
    total: properties.length,
    touched,
    remaining: properties.length - touched,
    percent: properties.length ? Math.round((touched / properties.length) * 100) : 0,
    basis: "mapped_locations",
  };
}

export function coverageForTerritory(
  data: Pick<NeighborWalkData, "territories" | "properties">,
  territoryId: string,
  parcels?: ParcelFeatureCollection,
): TerritoryCoverage {
  const territory = data.territories.find((candidate) => candidate.id === territoryId);
  const properties = data.properties.filter((property) => !property.mergedIntoId && property.territoryId === territoryId);
  if (!territory || !parcels) return mappedLocationCoverage(properties);

  const residentialParcels = parcels.features.filter((parcel) => (
    parcel.properties.isResidential && parcelIsInsideTerritory(parcel, territory.boundary)
  ));
  const touchedProperties = properties.filter((property) => property.currentOutcome !== "unvisited");
  const touchedParcelKeys = new Set(touchedProperties.flatMap((property) => {
    const key = propertyParcelKey(property);
    return key ? [key] : [];
  }));
  const unlinkedTouchedProperties = touchedProperties.filter((property) => !property.parcel);
  const touched = residentialParcels.filter((parcel) => (
    touchedParcelKeys.has(parcelKey(parcel.properties))
    || unlinkedTouchedProperties.some((property) => property.coordinates && geometryContainsPoint(parcel.geometry, property.coordinates))
  )).length;

  return {
    total: residentialParcels.length,
    touched,
    remaining: residentialParcels.length - touched,
    percent: residentialParcels.length ? Math.round((touched / residentialParcels.length) * 100) : 0,
    basis: "residential_parcels",
  };
}
