import type { LineString, Polygon } from "geojson";
import type { Coordinates } from "./domain";
import { geometryContainsPoint } from "./geometry";
import type { ParcelFeature } from "./parcels";
import { clipLineToBoundary, closeRing } from "./planning-geometry";
import { DEMO_CENTER } from "./seed";
import type { StreetSegmentCollection, StreetSegmentFeature } from "./street-segments";
import type { PlanningParcelResult } from "./target-parcels";

export const LAWRENCEBURG_DEMO_PARCEL_REVISION = "lawrenceburg-demo-parcels-2026-09";
const LAWRENCEBURG_DEMO_STREET_REVISION = "lawrenceburg-demo-streets-2026-09";
const LAWRENCE_COUNTY_FIPS = "47099";

type DemoCluster = {
  key: string;
  center: Coordinates;
  streets: string[];
  avenues: string[];
};

const CLUSTERS: DemoCluster[] = [
  { key: "crockett", center: DEMO_CENTER, streets: ["Berger Street", "Gaines Street", "Crockett Street", "Waterloo Street", "Taylor Street"], avenues: ["Mahr Avenue", "Military Avenue", "First Avenue"] },
  { key: "westside", center: [DEMO_CENTER[0] - 0.0112, DEMO_CENTER[1] - 0.0001], streets: ["West Point Road", "Buffalo Road", "Nixon Avenue", "Weakley Creek Road", "Park Street"], avenues: ["Fourth Street", "Fifth Street", "Sixth Street"] },
  { key: "shoal", center: [DEMO_CENTER[0] + 0.0118, DEMO_CENTER[1] + 0.0058], streets: ["Shoal Circle", "Spring Street", "Creekside Drive", "Prospect Street", "East Gaines Street"], avenues: ["Adams Avenue", "Jackson Avenue", "Polk Avenue"] },
];

function containsPoint(boundary: Coordinates[], point: Coordinates) {
  if (boundary.length < 3) return false;
  const polygon: Polygon = { type: "Polygon", coordinates: [closeRing(boundary)] };
  return geometryContainsPoint(polygon, point);
}

function buildParcels() {
  let sequence = 0;
  return CLUSTERS.flatMap((cluster): ParcelFeature[] => Array.from({ length: 35 }, (_, index) => {
    sequence += 1;
    const column = index % 7;
    const row = Math.floor(index / 7);
    const width = 0.00082;
    const height = 0.00082;
    const left = cluster.center[0] - 0.00386 + column * 0.00115;
    const bottom = cluster.center[1] - 0.00271 + row * 0.00115;
    const representativePoint: Coordinates = [left + width / 2, bottom + height / 2];
    const id = sequence;
    return {
      type: "Feature",
      id,
      properties: {
        id,
        countyFips: LAWRENCE_COUNTY_FIPS,
        gislink: `099DEMO${String(id).padStart(4, "0")}`,
        situsAddress: `${101 + column * 2 + row * 20} ${cluster.streets[row]}`,
        propertyClass: "Residential",
        landUse: "Single-family residential",
        isResidential: true,
        representativePoint,
      },
      geometry: {
        type: "Polygon",
        coordinates: [[[left, bottom], [left + width, bottom], [left + width, bottom + height], [left, bottom + height], [left, bottom]]],
      },
    };
  }));
}

function streetFeature(id: string, name: string, coordinates: Coordinates[]): StreetSegmentFeature {
  return {
    type: "Feature",
    id,
    properties: { id, name, roadClass: "residential", subclass: null, release: LAWRENCEBURG_DEMO_STREET_REVISION, complete: true },
    geometry: { type: "LineString", coordinates },
  };
}

function buildStreets() {
  return CLUSTERS.flatMap((cluster): StreetSegmentFeature[] => {
    const horizontal = cluster.streets.map((name, row) => streetFeature(
      `demo-${cluster.key}-street-${row + 1}`,
      name,
      [[cluster.center[0] - 0.00425, cluster.center[1] - 0.0023 + row * 0.00115], [cluster.center[0] + 0.00425, cluster.center[1] - 0.0023 + row * 0.00115]],
    ));
    const vertical = cluster.avenues.map((name, column) => streetFeature(
      `demo-${cluster.key}-avenue-${column + 1}`,
      name,
      [[cluster.center[0] - 0.0023 + column * 0.0023, cluster.center[1] - 0.00315], [cluster.center[0] - 0.0023 + column * 0.0023, cluster.center[1] + 0.00315]],
    ));
    return [...horizontal, ...vertical];
  });
}

const LAWRENCEBURG_DEMO_PARCELS = buildParcels();
const LAWRENCEBURG_DEMO_STREETS = buildStreets();

export function lawrenceburgDemoParcelResult(boundary: Coordinates[]): PlanningParcelResult {
  const features = LAWRENCEBURG_DEMO_PARCELS.filter((parcel) => containsPoint(boundary, Reflect.get(parcel.properties, "representativePoint") as Coordinates));
  return {
    parcels: { type: "FeatureCollection", features },
    datasetRevision: LAWRENCEBURG_DEMO_PARCEL_REVISION,
    complete: true,
    truncated: false,
  };
}

export function lawrenceburgDemoStreets(boundary: Coordinates[]): StreetSegmentCollection {
  const features = LAWRENCEBURG_DEMO_STREETS.filter((street) => clipLineToBoundary(street.geometry as LineString, boundary).length > 0);
  return {
    type: "FeatureCollection",
    features,
    metadata: {
      release: LAWRENCEBURG_DEMO_STREET_REVISION,
      source: "Bundled fictional Lawrenceburg demo streets",
      complete: true,
      truncated: false,
      attribution: "Fictional demo data",
    },
  };
}
