"use client";

import { AlertTriangle, LoaderCircle, MapPin, MousePointerClick } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from "geojson";
import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import type { Coordinates, Outcome, Property, Territory } from "../lib/domain";
import { outcomeMeta } from "../lib/domain";
import { geometryContainsPoint, polygonAtPoint } from "../lib/geometry";
import { groupBy } from "../lib/collections";
import { drawingGestureIntent, drawingInstruction, moveDrawingCorner, rectangleBoundary, rectangleHasArea, type MapDrawingMode } from "../lib/map-drawing";
import { MAPLIBRE_WORKER_URL } from "../lib/map-worker";
import { isMobileApp } from "../lib/mobile";
import { parcelKey, parcelProgress, propertyParcelKey } from "../lib/parcel-groups";
import type { WalkTarget } from "../lib/walk-targets";
import {
  type MapViewport,
  type ParcelDetails,
  type ParcelFeatureCollection,
} from "../lib/parcels";
import { MapDrawingModeControl } from "./MapDrawingModeControl";

const BUILDING_OUTLINE_LAYER_ID = "neighborwalk-building-outlines";
const BUILDING_NUMBER_MIN_ZOOM = 16;
const PARCEL_MIN_ZOOM = 14.5;
const PARCEL_SOURCE_ID = "official-parcels";
const PARCEL_FILL_LAYER_ID = "official-parcels-fill";
const PARCEL_OUTLINE_LAYER_ID = "official-parcels-outline";
const PARCEL_PROGRESS_LAYER_ID = "official-parcels-progress";
const LOCATION_SOURCE_ID = "mapped-locations";
const LOCATION_AREA_HIT_LAYER_ID = "mapped-location-area-hit";
const LOCATION_FILL_LAYER_ID = "mapped-location-fill";
const LOCATION_OUTLINE_LAYER_ID = "mapped-location-outline";
const LOCATION_POINT_HIT_LAYER_ID = "mapped-location-point-hit";
const LOCATION_HALO_LAYER_ID = "mapped-location-selected-halo";
const LOCATION_DOT_LAYER_ID = "mapped-location-dot";
const SEARCH_SOURCE_ID = "address-search-target";
const SEARCH_HALO_LAYER_ID = "address-search-target-halo";
const SEARCH_DOT_LAYER_ID = "address-search-target-dot";
const FIELD_TARGET_SOURCE_ID = "field-walk-target";
const DRAFT_VERTEX_HIT_LAYER_ID = "draft-territory-vertex-hit";
const EMPTY_PARCELS: ParcelFeatureCollection = { type: "FeatureCollection", features: [] };
type MapStyleLayer = ReturnType<MapLibreMap["getStyle"]>["layers"][number];
type BuildingFootprintLayer = Extract<MapStyleLayer, { type: "fill" }> | Extract<MapStyleLayer, { type: "fill-extrusion" }>;
type BuildingNumberLayer = Extract<MapStyleLayer, { type: "symbol" }>;

type AddIntent = {
  coordinates: Coordinates;
  suggestedAddress: string;
  buildingGeometry?: Coordinates[];
  parcel?: ParcelDetails;
  legacyPropertyIds?: string[];
};

export type MapSearchTarget = {
  id: string;
  coordinates: Coordinates;
  zoom: number;
};

type Props = {
  territory: Territory;
  properties: Property[];
  selectedPropertyId: string | null;
  visibleOutcomes: Set<Outcome>;
  searchTarget: MapSearchTarget | null;
  addMode: boolean;
  drawMode: boolean;
  drawShape: MapDrawingMode;
  drawModeLabel?: string;
  draftBoundary: Coordinates[];
  compactMarkers: boolean;
  mapStyleUrl: string;
  parcels?: ParcelFeatureCollection;
  target?: WalkTarget;
  onSelectProperty: (id: string) => void;
  onAddIntent: (intent: AddIntent) => void;
  onAssociatePropertiesWithParcel: (propertyIds: string[], parcel: ParcelDetails) => void;
  onDrawShapeChange: (mode: MapDrawingMode) => void;
  onDraftBoundaryChange: (points: Coordinates[]) => void;
  onViewportChange: (viewport: MapViewport) => void;
  onUseAddressList?: () => void;
};

function polygonFeature(points: Coordinates[]): Feature<Polygon> | null {
  if (points.length < 3) return null;
  const closed = points[0][0] === points[points.length - 1]?.[0] && points[0][1] === points[points.length - 1]?.[1]
    ? points
    : [...points, points[0]];
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [closed] },
  };
}

function featureCollection(...features: Array<Feature<Geometry> | null>): FeatureCollection {
  return { type: "FeatureCollection", features: features.filter((feature): feature is Feature<Geometry> => Boolean(feature)) };
}

function draftFeatureCollection(points: Coordinates[]): FeatureCollection {
  const polygon = polygonFeature(points);
  const line: Feature<LineString> | null = points.length === 2 ? {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: points },
  } : null;
  const vertices: Feature<Point>[] = points.map((coordinates, index) => ({
    type: "Feature",
    properties: { index },
    geometry: { type: "Point", coordinates },
  }));
  return featureCollection(polygon, line, ...vertices);
}

function mappedLocationFeatureCollection(
  properties: Property[],
  selectedPropertyId: string | null,
  visibleOutcomes: Set<Outcome>,
  compact: boolean,
): FeatureCollection {
  const features: Feature<Geometry>[] = [];
  const parcelDwellingCounts = new Map<string, number>();
  for (const property of properties) {
    const key = propertyParcelKey(property);
    if (key) parcelDwellingCounts.set(key, (parcelDwellingCounts.get(key) ?? 0) + 1);
  }
  for (const property of properties) {
    if (!property.coordinates) continue;
    const visible = visibleOutcomes.has(property.currentOutcome);
    const selected = selectedPropertyId === property.id;
    const visited = property.currentOutcome !== "unvisited";
    const statusColor = outcomeMeta[property.currentOutcome].color;
    const propertyParcel = propertyParcelKey(property);
    const parcelDwellingCount = propertyParcel ? parcelDwellingCounts.get(propertyParcel) ?? 1 : 1;
    const mapProperties = {
      propertyId: property.id,
      outcome: property.currentOutcome,
      statusColor,
      outlineColor: visited ? statusColor : "#315c50",
      visible,
      selected,
      visited,
      compact,
      parcelDwellingCount,
    };
    const footprint = polygonFeature(property.buildingGeometry ?? []);
    if (footprint && parcelDwellingCount === 1) features.push({ ...footprint, properties: mapProperties });
    features.push({
      type: "Feature",
      properties: mapProperties,
      geometry: { type: "Point", coordinates: property.coordinates },
    });
  }
  return { type: "FeatureCollection", features };
}

function searchTargetFeatureCollection(target: MapSearchTarget | null): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: target ? [{
      type: "Feature",
      properties: { id: target.id },
      geometry: { type: "Point", coordinates: target.coordinates },
    }] : [],
  };
}

function mappedParcelFeatureCollection(parcels: ParcelFeatureCollection, properties: Property[]): ParcelFeatureCollection {
  const grouped = groupBy(properties, propertyParcelKey);
  const legacyProperties = grouped.get(null) ?? [];

  return {
    ...parcels,
    features: parcels.features.map((feature) => {
      const key = parcelKey(feature.properties);
      const linked = grouped.get(key) ?? [];
      const inferred = legacyProperties.filter((property) => property.coordinates && geometryContainsPoint(feature.geometry, property.coordinates));
      const progress = parcelProgress([...linked, ...inferred]);
      return {
        ...feature,
        properties: {
          ...feature.properties,
          dwellingCount: progress.total,
          visitedDwellingCount: progress.visited,
          remainingDwellingCount: progress.remaining,
          allDwellingsVisited: progress.total > 0 && progress.remaining === 0,
        },
      };
    }),
  };
}

function legacyParcelAssociations(parcels: ParcelFeatureCollection, properties: Property[]) {
  const unlinked = new Map(properties
    .filter((property) => !property.parcel)
    .map((property) => [property.id, property]));
  const associations: Array<{ parcel: ParcelDetails; propertyIds: string[] }> = [];
  for (const feature of parcels.features) {
    const propertyIds = [...unlinked.values()]
      .filter((property) => property.coordinates && geometryContainsPoint(feature.geometry, property.coordinates))
      .map((property) => property.id);
    if (!propertyIds.length) continue;
    associations.push({ parcel: feature.properties, propertyIds });
    for (const propertyId of propertyIds) unlinked.delete(propertyId);
    if (!unlinked.size) break;
  }
  return associations;
}

function updateGeoJsonSource(map: MapLibreMap, sourceId: string, data: FeatureCollection) {
  const source = map.getSource(sourceId) as { setData: (value: FeatureCollection) => void } | undefined;
  if (!source) return;
  source.setData(data);
}

function suggestedAddress(properties: Record<string, unknown> | null | undefined, coordinates: Coordinates) {
  const houseNumber = properties?.["addr:housenumber"] ?? properties?.housenumber ?? properties?.house_number;
  const street = properties?.["addr:street"] ?? properties?.street ?? properties?.name;
  if (houseNumber && street) return `${String(houseNumber)} ${String(street)}`;
  if (street) return String(street);
  return `${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}`;
}

function redactMapError(message: string) {
  return message.replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]");
}

function isBuildingFootprintLayer(layer: MapStyleLayer): layer is BuildingFootprintLayer {
  return (layer.type === "fill" || layer.type === "fill-extrusion")
    && (layer["source-layer"] === "building" || /building|house|residential/i.test(layer.id));
}

function isBuildingNumberLayer(layer: MapStyleLayer): layer is BuildingNumberLayer {
  return layer.type === "symbol"
    && (layer["source-layer"] === "building_number" || /building number|house ?number|housenumber/i.test(layer.id));
}

function configureBuildingDetails(map: MapLibreMap) {
  const layers = map.getStyle().layers;
  const numberLayers = layers.filter(isBuildingNumberLayer);

  for (const layer of numberLayers) {
    map.setLayerZoomRange(layer.id, BUILDING_NUMBER_MIN_ZOOM, layer.maxzoom ?? 24);
    map.setPaintProperty(layer.id, "text-halo-color", "rgba(255, 253, 247, 0.96)");
    map.setPaintProperty(layer.id, "text-halo-width", 1.25);
    map.setPaintProperty(layer.id, "text-halo-blur", 0.25);
  }

  const footprintLayer = layers.find(isBuildingFootprintLayer);
  if (!footprintLayer || map.getLayer(BUILDING_OUTLINE_LAYER_ID)) return;
  const sourceLayer = footprintLayer["source-layer"];
  if (!sourceLayer) return;

  map.addLayer({
    id: BUILDING_OUTLINE_LAYER_ID,
    type: "line",
    source: footprintLayer.source,
    "source-layer": sourceLayer,
    minzoom: 15,
    paint: {
      "line-color": "#70877d",
      "line-opacity": 0.78,
      "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.35, 18, 1.05],
    },
  }, numberLayers[0]?.id);
}

function configureNeighborWalkLayers(
  map: MapLibreMap,
  territory: Territory,
  draftBoundary: Coordinates[],
  parcels: ParcelFeatureCollection,
  mappedLocations: FeatureCollection,
  searchTarget: MapSearchTarget | null,
  target?: WalkTarget,
) {
  configureBuildingDetails(map);
  if (!map.getSource(PARCEL_SOURCE_ID)) {
    map.addSource(PARCEL_SOURCE_ID, { type: "geojson", data: parcels });
  }
  if (!map.getLayer(PARCEL_FILL_LAYER_ID)) {
    map.addLayer({
      id: PARCEL_FILL_LAYER_ID,
      type: "fill",
      source: PARCEL_SOURCE_ID,
      minzoom: PARCEL_MIN_ZOOM,
      paint: {
        "fill-color": ["case", [">", ["get", "dwellingCount"], 0], "#789087", ["==", ["get", "isResidential"], true], "#e3a33b", "#56776c"],
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], PARCEL_MIN_ZOOM, 0.035, 18, ["case", [">", ["get", "dwellingCount"], 0], 0.12, 0.08]],
      },
    });
  }
  if (!map.getLayer(PARCEL_OUTLINE_LAYER_ID)) {
    map.addLayer({
      id: PARCEL_OUTLINE_LAYER_ID,
      type: "line",
      source: PARCEL_SOURCE_ID,
      minzoom: PARCEL_MIN_ZOOM,
      paint: {
        "line-color": ["case",
          ["==", ["get", "allDwellingsVisited"], true], "#286c59",
          [">", ["get", "visitedDwellingCount"], 0], "#a9660d",
          [">", ["get", "dwellingCount"], 0], "#315c50",
          ["==", ["get", "isResidential"], true], "#a56b12",
          "#385b50",
        ],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], PARCEL_MIN_ZOOM, 0.5, 18, 0.86],
        "line-width": ["interpolate", ["linear"], ["zoom"], PARCEL_MIN_ZOOM, 0.55, 18, ["case", [">", ["get", "dwellingCount"], 0], 1.8, 1.25]],
      },
    });
  }
  if (!map.getLayer(PARCEL_PROGRESS_LAYER_ID)) {
    map.addLayer({
      id: PARCEL_PROGRESS_LAYER_ID,
      type: "symbol",
      source: PARCEL_SOURCE_ID,
      minzoom: 15.5,
      filter: [">", ["get", "dwellingCount"], 1],
      layout: {
        "text-field": ["concat", ["to-string", ["get", "visitedDwellingCount"]], " / ", ["to-string", ["get", "dwellingCount"]]],
        "text-size": ["interpolate", ["linear"], ["zoom"], 15.5, 10, 18, 12],
        "text-allow-overlap": false,
        "text-padding": 3,
      },
      paint: {
        "text-color": "#163b31",
        "text-halo-color": "rgba(255,255,255,0.96)",
        "text-halo-width": 2.5,
      },
    });
  }
  if (!map.getSource("active-territory")) {
    map.addSource("active-territory", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource(FIELD_TARGET_SOURCE_ID)) map.addSource(FIELD_TARGET_SOURCE_ID, { type: "geojson", data: featureCollection() });
  if (!map.getLayer("field-walk-target-fill")) map.addLayer({ id: "field-walk-target-fill", type: "fill", source: FIELD_TARGET_SOURCE_ID,
    filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": target?.color ?? "#e9a84a", "fill-opacity": .23 } });
  if (!map.getLayer("field-walk-target-line")) map.addLayer({ id: "field-walk-target-line", type: "line", source: FIELD_TARGET_SOURCE_ID,
    paint: { "line-color": target?.color ?? "#a9660d", "line-width": 5, "line-opacity": .95,
      "line-offset": target?.streetSelection?.side === "left" ? -5 : target?.streetSelection?.side === "right" ? 5 : 0 } });
  if (!map.getLayer("active-territory-fill")) {
    map.addLayer({
      id: "active-territory-fill",
      type: "fill",
      source: "active-territory",
      paint: { "fill-color": territory.color, "fill-opacity": 0.08 },
    });
  }
  if (!map.getLayer("active-territory-outline")) {
    map.addLayer({
      id: "active-territory-outline",
      type: "line",
      source: "active-territory",
      paint: { "line-color": territory.color, "line-width": 3, "line-dasharray": [2, 1.5] },
    });
  }
  if (!map.getSource(LOCATION_SOURCE_ID)) {
    map.addSource(LOCATION_SOURCE_ID, { type: "geojson", data: mappedLocations });
  }
  if (!map.getLayer(LOCATION_AREA_HIT_LAYER_ID)) {
    map.addLayer({
      id: LOCATION_AREA_HIT_LAYER_ID,
      type: "fill",
      source: LOCATION_SOURCE_ID,
      minzoom: PARCEL_MIN_ZOOM,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#163b31", "fill-opacity": 0.01 },
    });
  }
  if (!map.getLayer(LOCATION_FILL_LAYER_ID)) {
    map.addLayer({
      id: LOCATION_FILL_LAYER_ID,
      type: "fill",
      source: LOCATION_SOURCE_ID,
      minzoom: PARCEL_MIN_ZOOM,
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "visible"], true]],
      paint: {
        "fill-color": ["get", "statusColor"],
        "fill-opacity": [
          "case",
          ["==", ["get", "selected"], true], 0.42,
          ["==", ["get", "visited"], true], 0.26,
          0.11,
        ],
      },
    });
  }
  if (!map.getLayer(LOCATION_OUTLINE_LAYER_ID)) {
    map.addLayer({
      id: LOCATION_OUTLINE_LAYER_ID,
      type: "line",
      source: LOCATION_SOURCE_ID,
      minzoom: PARCEL_MIN_ZOOM,
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "visible"], true]],
      paint: {
        "line-color": ["get", "outlineColor"],
        "line-opacity": 0.96,
        "line-width": ["case", ["==", ["get", "selected"], true], 3, 1.65],
      },
    });
  }
  if (!map.getLayer(LOCATION_POINT_HIT_LAYER_ID)) {
    map.addLayer({
      id: LOCATION_POINT_HIT_LAYER_ID,
      type: "circle",
      source: LOCATION_SOURCE_ID,
      minzoom: 12.5,
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 13, "circle-color": "#163b31", "circle-opacity": 0.01 },
    });
  }
  if (!map.getLayer(LOCATION_HALO_LAYER_ID)) {
    map.addLayer({
      id: LOCATION_HALO_LAYER_ID,
      type: "circle",
      source: LOCATION_SOURCE_ID,
      minzoom: 12.5,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "visible"], true], ["==", ["get", "selected"], true]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12.5, 5.5, 16, 8, 19, 10],
        "circle-color": "rgba(255, 248, 232, 0.9)",
        "circle-stroke-color": "#a9660d",
        "circle-stroke-width": 1.5,
      },
    });
  }
  if (!map.getLayer(LOCATION_DOT_LAYER_ID)) {
    map.addLayer({
      id: LOCATION_DOT_LAYER_ID,
      type: "circle",
      source: LOCATION_SOURCE_ID,
      minzoom: 12.5,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "visible"], true]],
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          12.5, ["case", ["==", ["get", "compact"], true], 1.7, 2.2],
          16, ["case", ["==", ["get", "compact"], true], 3.4, 4.2],
          19, ["case", ["==", ["get", "compact"], true], 4.4, 5.2],
        ],
        "circle-color": ["get", "statusColor"],
        "circle-stroke-color": ["get", "outlineColor"],
        "circle-stroke-width": ["case", ["==", ["get", "visited"], true], 1.4, 1.8],
      },
    });
  }
  if (!map.getSource(SEARCH_SOURCE_ID)) {
    map.addSource(SEARCH_SOURCE_ID, { type: "geojson", data: searchTargetFeatureCollection(searchTarget) });
  }
  if (!map.getLayer(SEARCH_HALO_LAYER_ID)) {
    map.addLayer({
      id: SEARCH_HALO_LAYER_ID,
      type: "circle",
      source: SEARCH_SOURCE_ID,
      paint: {
        "circle-radius": 15,
        "circle-color": "rgba(255,255,255,.86)",
        "circle-stroke-color": "rgba(22,59,49,.18)",
        "circle-stroke-width": 1,
      },
    });
  }
  if (!map.getLayer(SEARCH_DOT_LAYER_ID)) {
    map.addLayer({
      id: SEARCH_DOT_LAYER_ID,
      type: "circle",
      source: SEARCH_SOURCE_ID,
      paint: {
        "circle-radius": 7,
        "circle-color": "#e9a84a",
        "circle-stroke-color": "#163b31",
        "circle-stroke-width": 2.5,
      },
    });
  }
  if (!map.getSource("draft-territory")) {
    map.addSource("draft-territory", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getLayer("draft-territory-fill")) {
    map.addLayer({
      id: "draft-territory-fill",
      type: "fill",
      source: "draft-territory",
      paint: { "fill-color": "#e9a84a", "fill-opacity": 0.15 },
    });
  }
  if (!map.getLayer("draft-territory-outline")) {
    map.addLayer({
      id: "draft-territory-outline",
      type: "line",
      source: "draft-territory",
      paint: { "line-color": "#b47417", "line-width": 3 },
    });
  }
  if (!map.getLayer(DRAFT_VERTEX_HIT_LAYER_ID)) {
    map.addLayer({
      id: DRAFT_VERTEX_HIT_LAYER_ID,
      type: "circle",
      source: "draft-territory",
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 18, "circle-color": "#b47417", "circle-opacity": 0.01 },
    });
  }
  if (!map.getLayer("draft-territory-vertices")) {
    map.addLayer({
      id: "draft-territory-vertices",
      type: "circle",
      source: "draft-territory",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 8,
        "circle-color": "#fff8e8",
        "circle-stroke-color": "#b47417",
        "circle-stroke-width": 3,
      },
    });
  }
  updateGeoJsonSource(map, "active-territory", featureCollection(polygonFeature(territory.boundary)));
  updateGeoJsonSource(map, "draft-territory", draftFeatureCollection(draftBoundary));
  updateGeoJsonSource(map, PARCEL_SOURCE_ID, parcels);
  updateGeoJsonSource(map, LOCATION_SOURCE_ID, mappedLocations);
  updateGeoJsonSource(map, SEARCH_SOURCE_ID, searchTargetFeatureCollection(searchTarget));
  updateGeoJsonSource(map, FIELD_TARGET_SOURCE_ID, target ? collectionForTarget(target) : featureCollection());
}

function collectionForTarget(target: WalkTarget): FeatureCollection {
  return featureCollection({ type: "Feature", properties: { id: target.id }, geometry: target.geometry } as Feature<Geometry>);
}

export function MapCanvas({
  territory,
  properties,
  selectedPropertyId,
  visibleOutcomes,
  searchTarget,
  addMode,
  drawMode,
  drawShape,
  drawModeLabel,
  draftBoundary,
  compactMarkers,
  mapStyleUrl,
  parcels,
  target,
  onSelectProperty,
  onAddIntent,
  onAssociatePropertiesWithParcel,
  onDrawShapeChange,
  onDraftBoundaryChange,
  onViewportChange,
  onUseAddressList,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const callbacksRef = useRef({ onSelectProperty, onAddIntent, onAssociatePropertiesWithParcel, onDraftBoundaryChange, onViewportChange });
  const modesRef = useRef({ addMode, drawMode, drawShape, draftBoundary });
  const dragVertexRef = useRef<number | null>(null);
  const rectangleDragStartRef = useRef<Coordinates | null>(null);
  const rectangleDragPointRef = useRef<[number, number] | null>(null);
  const pointerMovedRef = useRef(false);
  const suppressMapClickRef = useRef(false);
  const territoryRef = useRef(territory);
  const searchTargetRef = useRef(searchTarget);
  const targetRef = useRef(target);
  const displayedTerritoryIdRef = useRef(territory.id);
  const displayedTargetIdRef = useRef<string | null>(null);
  const displayedSearchTargetIdRef = useRef<string | null>(null);
  const currentMapStyleUrlRef = useRef(mapStyleUrl);
  const parcelDataRef = useRef<ParcelFeatureCollection>(EMPTY_PARCELS);
  const propertiesRef = useRef(properties);
  const mappedLocationsRef = useRef<FeatureCollection>({ type: "FeatureCollection", features: [] });
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading");
  const [locationStatus, setLocationStatus] = useState<"denied" | "unavailable" | null>(null);
  const territoryLongitude = territory.center?.[0] ?? 0;
  const territoryLatitude = territory.center?.[1] ?? 0;
  const changeDrawShape = (mode: MapDrawingMode) => {
    if (mode === drawShape) return;
    suppressMapClickRef.current = false;
    onDraftBoundaryChange([]);
    onDrawShapeChange(mode);
  };

  useEffect(() => {
    callbacksRef.current = { onSelectProperty, onAddIntent, onAssociatePropertiesWithParcel, onDraftBoundaryChange, onViewportChange };
  }, [onSelectProperty, onAddIntent, onAssociatePropertiesWithParcel, onDraftBoundaryChange, onViewportChange]);

  useEffect(() => {
    searchTargetRef.current = searchTarget;
  }, [searchTarget]);

  useEffect(() => { targetRef.current = target; }, [target]);

  useEffect(() => {
    modesRef.current = { addMode, drawMode, drawShape, draftBoundary };
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = addMode || drawMode ? "crosshair" : "grab";
  }, [addMode, drawMode, drawShape, draftBoundary]);

  useEffect(() => {
    rectangleDragStartRef.current = null;
    dragVertexRef.current = null;
  }, [drawMode, drawShape]);

  useEffect(() => {
    const nextParcels = parcels ?? EMPTY_PARCELS;
    parcelDataRef.current = nextParcels;
    for (const association of legacyParcelAssociations(nextParcels, propertiesRef.current)) {
      callbacksRef.current.onAssociatePropertiesWithParcel(association.propertyIds, association.parcel);
    }
    const map = mapRef.current;
    if (map?.getSource(PARCEL_SOURCE_ID)) {
      updateGeoJsonSource(map, PARCEL_SOURCE_ID, mappedParcelFeatureCollection(nextParcels, propertiesRef.current));
    }
  }, [parcels, territory.id]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let mapLoaded = false;
    let loadTimeout: number | undefined;

    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !containerRef.current) return;
      maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
      const initialTerritory = territoryRef.current;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: currentMapStyleUrlRef.current,
        center: initialTerritory.center,
        zoom: initialTerritory.zoom,
        minZoom: 3,
        maxZoom: 20,
        attributionControl: false,
        cooperativeGestures: true,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      const geolocate = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true, timeout: 10000 },
        trackUserLocation: true,
        showAccuracyCircle: true,
      });
      geolocate.on("geolocate", () => setLocationStatus(null));
      geolocate.on("error", (event) => setLocationStatus(event.code === 1 ? "denied" : "unavailable"));
      map.addControl(geolocate, "bottom-right");
      const publishViewport = () => {
        if (!map) return;
        const bounds = map.getBounds();
        callbacksRef.current.onViewportChange({
          minLatitude: bounds.getSouth(),
          minLongitude: bounds.getWest(),
          maxLatitude: bounds.getNorth(),
          maxLongitude: bounds.getEast(),
          zoom: map.getZoom(),
        });
      };
      loadTimeout = window.setTimeout(() => {
        if (!mapLoaded) setMapStatus("error");
      }, 15000);

      map.on("style.load", () => {
        if (!map) return;
        configureNeighborWalkLayers(
          map,
          territoryRef.current,
          modesRef.current.draftBoundary,
          mappedParcelFeatureCollection(parcelDataRef.current, propertiesRef.current),
          mappedLocationsRef.current,
          searchTargetRef.current,
          targetRef.current,
        );
      });

      map.once("load", () => {
        mapLoaded = true;
        if (loadTimeout !== undefined) window.clearTimeout(loadTimeout);
        // MapLibre opens compact credits on first load; leave them behind the info button in the iOS app.
        if (isMobileApp) {
          const attribution = map?.getContainer().querySelector(".maplibregl-ctrl-attrib");
          attribution?.classList.remove("maplibregl-compact-show");
          attribution?.removeAttribute("open");
        }
        setMapStatus("ready");
        publishViewport();
      });
      map.on("moveend", publishViewport);

      const draftVertexAt = (event: MapMouseEvent | MapTouchEvent) => {
        if (!map?.getLayer(DRAFT_VERTEX_HIT_LAYER_ID)) return undefined;
        return map.queryRenderedFeatures(event.point, { layers: [DRAFT_VERTEX_HIT_LAYER_ID] })[0];
      };

      const startDrawingGesture = (event: MapMouseEvent | MapTouchEvent) => {
        if (!map || !modesRef.current.drawMode) return;
        if ("points" in event && event.points.length !== 1) return;
        pointerMovedRef.current = false;
        const vertex = draftVertexAt(event);
        const vertexIndex = vertex?.properties?.index === undefined ? undefined : Number(vertex.properties.index);
        const intent = drawingGestureIntent(
          modesRef.current.draftBoundary,
          modesRef.current.drawShape,
          vertexIndex,
          [event.lngLat.lng, event.lngLat.lat],
        );
        if (intent.kind === "move-corner") {
          if ("points" in event) event.preventDefault();
          dragVertexRef.current = intent.index;
          map.dragPan.disable();
          map.getCanvas().style.cursor = "grabbing";
          return;
        }
        if (intent.kind === "create-rectangle") {
          if ("points" in event) event.preventDefault();
          rectangleDragStartRef.current = intent.start;
          rectangleDragPointRef.current = [event.point.x, event.point.y];
          map.dragPan.disable();
        }
      };

      const continueDrawingGesture = (event: MapMouseEvent | MapTouchEvent) => {
        if (!map) return;
        if (modesRef.current.drawMode) {
          const coordinates: Coordinates = [event.lngLat.lng, event.lngLat.lat];
          if (rectangleDragStartRef.current) {
            const startPoint = rectangleDragPointRef.current;
            if (startPoint && Math.hypot(event.point.x - startPoint[0], event.point.y - startPoint[1]) < 5) return;
            pointerMovedRef.current = true;
            const rectangle = rectangleBoundary(rectangleDragStartRef.current, coordinates);
            if (rectangleHasArea(rectangle)) callbacksRef.current.onDraftBoundaryChange(rectangle);
            return;
          }
          if (dragVertexRef.current !== null) {
            pointerMovedRef.current = true;
            callbacksRef.current.onDraftBoundaryChange(moveDrawingCorner(
              modesRef.current.draftBoundary,
              modesRef.current.drawShape,
              dragVertexRef.current,
              coordinates,
            ));
            return;
          }
          map.getCanvas().style.cursor = draftVertexAt(event) ? "move" : "crosshair";
          return;
        }
        if ("points" in event) return;
        if (modesRef.current.addMode) return;
        const interactiveLayers = [
          LOCATION_POINT_HIT_LAYER_ID,
          LOCATION_AREA_HIT_LAYER_ID,
          PARCEL_FILL_LAYER_ID,
        ].filter((layerId) => map!.getLayer(layerId));
        const feature = interactiveLayers.length
          ? map.queryRenderedFeatures(event.point, { layers: interactiveLayers })[0]
          : undefined;
        map.getCanvas().style.cursor = feature ? "pointer" : "grab";
      };

      const finishDrawingGesture = () => {
        if (!map || !modesRef.current.drawMode) return;
        if (pointerMovedRef.current && (rectangleDragStartRef.current || dragVertexRef.current !== null)) {
          suppressMapClickRef.current = true;
          window.setTimeout(() => { suppressMapClickRef.current = false; }, 350);
        }
        rectangleDragStartRef.current = null;
        rectangleDragPointRef.current = null;
        dragVertexRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = "crosshair";
      };

      map.on("mousedown", startDrawingGesture);
      map.on("touchstart", startDrawingGesture);
      map.on("mousemove", continueDrawingGesture);
      map.on("touchmove", continueDrawingGesture);
      map.on("mouseup", finishDrawingGesture);
      map.on("touchend", finishDrawingGesture);
      map.on("touchcancel", finishDrawingGesture);

      map.on("error", (event) => {
        if (!event.error) return;
        const message = redactMapError(event.error.message || String(event.error));
        if (containerRef.current) containerRef.current.dataset.mapError = message;
        console.error("[NeighborWalk map]", message);
        if (!mapLoaded) setMapStatus("error");
      });

      map.on("click", (event: MapMouseEvent) => {
        if (!map) return;
        const coordinates: Coordinates = [event.lngLat.lng, event.lngLat.lat];
        if (modesRef.current.drawMode) {
          if (suppressMapClickRef.current) {
            suppressMapClickRef.current = false;
            return;
          }
          if (draftVertexAt(event)) return;
          if (modesRef.current.drawShape === "polygon") {
            callbacksRef.current.onDraftBoundaryChange([...modesRef.current.draftBoundary, coordinates]);
          }
          return;
        }

        const locationLayers = [LOCATION_POINT_HIT_LAYER_ID, LOCATION_AREA_HIT_LAYER_ID]
          .filter((layerId) => map!.getLayer(layerId));
        const mappedLocation = locationLayers.length
          ? map.queryRenderedFeatures(event.point, { layers: locationLayers })[0]
          : undefined;
        const mappedPropertyId = mappedLocation?.properties?.propertyId;
        if (mappedPropertyId && !modesRef.current.addMode) {
          callbacksRef.current.onSelectProperty(String(mappedPropertyId));
          return;
        }

        const buildingLayers = map.getStyle().layers
          .filter(isBuildingFootprintLayer)
          .map((layer) => layer.id);
        const buildingFeatures = buildingLayers.length
          ? map.queryRenderedFeatures(event.point, { layers: buildingLayers })
          : [];
        const buildingFeature = buildingFeatures.find((candidate) => (
          candidate.geometry.type === "Polygon" || candidate.geometry.type === "MultiPolygon"
        ));
        const buildingGeometry = polygonAtPoint(buildingFeature?.geometry, coordinates)?.[0].map(([lng, lat]) => [lng, lat] as Coordinates);

        const parcelFeature = map.getLayer(PARCEL_FILL_LAYER_ID)
          ? map.queryRenderedFeatures(event.point, { layers: [PARCEL_FILL_LAYER_ID] })[0]
          : undefined;
        if (parcelFeature && (parcelFeature.geometry.type === "Polygon" || parcelFeature.geometry.type === "MultiPolygon")) {
          const properties = parcelFeature.properties;
          callbacksRef.current.onAddIntent({
            coordinates,
            suggestedAddress: String(properties?.situsAddress || `${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}`),
            buildingGeometry,
            legacyPropertyIds: propertiesRef.current
              .filter((property) => !property.parcel && property.coordinates && geometryContainsPoint(parcelFeature.geometry, property.coordinates))
              .map((property) => property.id),
            parcel: {
              id: Number(properties?.id),
              countyFips: String(properties?.countyFips || ""),
              gislink: String(properties?.gislink || ""),
              situsAddress: properties?.situsAddress ? String(properties.situsAddress) : null,
              propertyClass: properties?.propertyClass ? String(properties.propertyClass) : null,
              landUse: properties?.landUse ? String(properties.landUse) : null,
              isResidential: properties?.isResidential === true || properties?.isResidential === "true",
            },
          });
          return;
        }
        if (!modesRef.current.addMode) return;
        callbacksRef.current.onAddIntent({
          coordinates,
          suggestedAddress: suggestedAddress(buildingFeature?.properties, coordinates),
          buildingGeometry,
        });
      });
    }).catch(() => setMapStatus("error"));

    return () => {
      cancelled = true;
      if (loadTimeout !== undefined) window.clearTimeout(loadTimeout);
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || currentMapStyleUrlRef.current === mapStyleUrl) return;
    currentMapStyleUrlRef.current = mapStyleUrl;
    map.setStyle(mapStyleUrl);
  }, [mapStyleUrl]);

  useEffect(() => {
    territoryRef.current = territory;
  }, [territory]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStatus !== "ready") return;
    updateGeoJsonSource(map, "active-territory", featureCollection(polygonFeature(territory.boundary)));
    const fill = map.getLayer("active-territory-fill");
    if (fill) map.setPaintProperty("active-territory-fill", "fill-color", territory.color);
    const outline = map.getLayer("active-territory-outline");
    if (outline) map.setPaintProperty("active-territory-outline", "line-color", territory.color);
  }, [territory.boundary, territory.color, mapStatus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStatus !== "ready") return;
    if (displayedTerritoryIdRef.current === territory.id) return;
    displayedTerritoryIdRef.current = territory.id;
    map.flyTo({
      center: [territoryLongitude, territoryLatitude],
      zoom: territory.zoom,
      duration: 650,
      essential: true,
    });
  }, [mapStatus, territory.id, territory.zoom, territoryLatitude, territoryLongitude]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStatus !== "ready") return;
    updateGeoJsonSource(map, SEARCH_SOURCE_ID, searchTargetFeatureCollection(searchTarget));
    if (!searchTarget || displayedSearchTargetIdRef.current === searchTarget.id) return;
    displayedSearchTargetIdRef.current = searchTarget.id;
    map.flyTo({
      center: searchTarget.coordinates,
      zoom: searchTarget.zoom,
      duration: 700,
      essential: true,
    });
  }, [mapStatus, searchTarget]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStatus !== "ready") return;
    updateGeoJsonSource(map, FIELD_TARGET_SOURCE_ID, target ? collectionForTarget(target) : featureCollection());
    if (map.getLayer("active-territory-fill")) map.setPaintProperty("active-territory-fill", "fill-opacity", target ? .025 : .08);
    if (map.getLayer("field-walk-target-fill")) map.setPaintProperty("field-walk-target-fill", "fill-color", target?.color ?? "#e9a84a");
    if (map.getLayer("field-walk-target-line")) {
      map.setPaintProperty("field-walk-target-line", "line-color", target?.color ?? "#a9660d");
      map.setPaintProperty("field-walk-target-line", "line-offset", target?.streetSelection?.side === "left" ? -5 : target?.streetSelection?.side === "right" ? 5 : 0);
    }
    if (!target) { displayedTargetIdRef.current = null; return; }
    if (displayedTargetIdRef.current === target.id) return;
    displayedTargetIdRef.current = target.id;
    const rosterPoints = target.parcels.flatMap((parcel) => parcel.representativePoint ? [parcel.representativePoint] : []);
    const points = rosterPoints.length ? rosterPoints : target.geometry.coordinates.flat();
    if (points.length) {
      const longitudes = points.map((point) => point[0]);
      const latitudes = points.map((point) => point[1]);
      map.fitBounds([[Math.min(...longitudes), Math.min(...latitudes)], [Math.max(...longitudes), Math.max(...latitudes)]], { padding: 48, maxZoom: 18, duration: 0 });
    }
  }, [mapStatus, target]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStatus !== "ready") return;
    updateGeoJsonSource(map, "draft-territory", draftFeatureCollection(draftBoundary));
  }, [draftBoundary, mapStatus]);

  useEffect(() => {
    propertiesRef.current = properties;
    const map = mapRef.current;
    if (!map || mapStatus !== "ready") return;
    updateGeoJsonSource(map, PARCEL_SOURCE_ID, mappedParcelFeatureCollection(parcelDataRef.current, properties));
  }, [properties, mapStatus]);

  useEffect(() => {
    const map = mapRef.current;
    const mappedLocations = mappedLocationFeatureCollection(
      properties,
      selectedPropertyId,
      visibleOutcomes,
      compactMarkers,
    );
    mappedLocationsRef.current = mappedLocations;
    if (!map || mapStatus !== "ready") return;
    updateGeoJsonSource(map, LOCATION_SOURCE_ID, mappedLocations);
  }, [properties, selectedPropertyId, visibleOutcomes, compactMarkers, mapStatus]);

  return (
    <div className={`map-engine-shell${drawMode ? " map-drawing-active" : ""}`}>
      <div ref={containerRef} className="map-engine" role="region" aria-label={`Interactive map of ${territory.name}`} />
      {mapStatus === "loading" && (
        <div className="map-state"><LoaderCircle className="spin" size={22} /><strong>Loading the neighborhood map</strong><span>Your territory records are already available.</span></div>
      )}
      {mapStatus === "error" && (
        <div className="map-state error"><AlertTriangle size={23} /><strong>The map is unavailable</strong><span>Your saved locations and visit records can still be used in the address list.</span>{onUseAddressList && <button className="button primary" onClick={onUseAddressList}>Use address list</button>}</div>
      )}
      {mapStatus === "ready" && locationStatus && !addMode && !drawMode && <div className="map-location-notice" role="status"><AlertTriangle size={16} /><span>{locationStatus === "denied"
        ? "Location access is off. Search and saved addresses still work. To change it, open iOS Settings → NeighborWalk → Location."
        : "Your location is unavailable right now. Search and saved addresses still work."}</span></div>}
      {addMode && (
        <div className="map-mode-banner"><MapPin size={15} /><span>Tap the next dwelling or entrance</span></div>
      )}
      {drawMode && (
        <div className="map-drawing-panel">
          <MapDrawingModeControl value={drawShape} onChange={changeDrawShape} />
          <p aria-live="polite"><MousePointerClick size={15} /><span><strong>{drawModeLabel ?? "Draw boundary"}</strong>{drawingInstruction(drawShape, draftBoundary)}</span></p>
        </div>
      )}
    </div>
  );
}
