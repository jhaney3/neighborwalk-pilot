"use client";

import { AlertTriangle, LoaderCircle, MapPin, MapPinned, MousePointerClick } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from "geojson";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { Coordinates, Outcome, Property, Territory } from "../lib/domain";
import { outcomeMeta } from "../lib/domain";
import {
  fetchParcelsInView,
  PARCEL_RESULT_LIMIT,
  type ParcelDetails,
  type ParcelFeatureCollection,
} from "../lib/parcels";

const BUILDING_OUTLINE_LAYER_ID = "neighborwalk-building-outlines";
const BUILDING_NUMBER_MIN_ZOOM = 16;
const PARCEL_MIN_ZOOM = 14.5;
const PARCEL_SOURCE_ID = "official-parcels";
const PARCEL_FILL_LAYER_ID = "official-parcels-fill";
const PARCEL_OUTLINE_LAYER_ID = "official-parcels-outline";
const LOCATION_SOURCE_ID = "mapped-locations";
const LOCATION_AREA_HIT_LAYER_ID = "mapped-location-area-hit";
const LOCATION_FILL_LAYER_ID = "mapped-location-fill";
const LOCATION_OUTLINE_LAYER_ID = "mapped-location-outline";
const LOCATION_POINT_HIT_LAYER_ID = "mapped-location-point-hit";
const LOCATION_HALO_LAYER_ID = "mapped-location-selected-halo";
const LOCATION_DOT_LAYER_ID = "mapped-location-dot";
const EMPTY_PARCELS: ParcelFeatureCollection = { type: "FeatureCollection", features: [] };
type MapStyleLayer = ReturnType<MapLibreMap["getStyle"]>["layers"][number];
type BuildingFootprintLayer = Extract<MapStyleLayer, { type: "fill" }> | Extract<MapStyleLayer, { type: "fill-extrusion" }>;
type BuildingNumberLayer = Extract<MapStyleLayer, { type: "symbol" }>;

type AddIntent = {
  coordinates: Coordinates;
  suggestedAddress: string;
  buildingGeometry?: Coordinates[];
  parcel?: ParcelDetails;
};

type Props = {
  territory: Territory;
  properties: Property[];
  selectedPropertyId: string | null;
  visibleOutcomes: Set<Outcome>;
  searchQuery: string;
  addMode: boolean;
  drawMode: boolean;
  drawModeLabel?: string;
  draftBoundary: Coordinates[];
  compactMarkers: boolean;
  mapStyleUrl: string;
  onSelectProperty: (id: string) => void;
  onAddIntent: (intent: AddIntent) => void;
  onDraftBoundaryChange: (points: Coordinates[]) => void;
};

function polygonFeature(points: Coordinates[]): Feature<Polygon> | null {
  if (points.length < 3) return null;
  const closed = points[0][0] === points.at(-1)?.[0] && points[0][1] === points.at(-1)?.[1]
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
  searchQuery: string,
  compact: boolean,
): FeatureCollection {
  const features: Feature<Geometry>[] = [];
  const normalizedQuery = searchQuery.trim().toLowerCase();
  for (const property of properties) {
    const matchesSearch = !normalizedQuery
      || `${property.address} ${property.unit ?? ""}`.toLowerCase().includes(normalizedQuery);
    const visible = visibleOutcomes.has(property.currentOutcome) && matchesSearch;
    const selected = selectedPropertyId === property.id;
    const visited = property.currentOutcome !== "unvisited";
    const statusColor = outcomeMeta[property.currentOutcome].color;
    const mapProperties = {
      propertyId: property.id,
      outcome: property.currentOutcome,
      statusColor,
      outlineColor: visited ? statusColor : "#315c50",
      visible,
      selected,
      visited,
      compact,
    };
    const footprint = polygonFeature(property.buildingGeometry ?? []);
    if (footprint) features.push({ ...footprint, properties: mapProperties });
    features.push({
      type: "Feature",
      properties: mapProperties,
      geometry: { type: "Point", coordinates: property.coordinates },
    });
  }
  return { type: "FeatureCollection", features };
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

function ringContainsPoint(point: Coordinates, ring: number[][]) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [currentLng, currentLat] = ring[current];
    const [previousLng, previousLat] = ring[previous];
    const intersects = (currentLat > point[1]) !== (previousLat > point[1])
      && point[0] < ((previousLng - currentLng) * (point[1] - currentLat)) / (previousLat - currentLat) + currentLng;
    if (intersects) inside = !inside;
  }
  return inside;
}

function buildingGeometryAtPoint(geometry: Geometry | undefined, point: Coordinates): Coordinates[] | undefined {
  const polygons = geometry?.type === "Polygon"
    ? [geometry.coordinates]
    : geometry?.type === "MultiPolygon"
      ? geometry.coordinates
      : [];
  const polygon = polygons.find((candidate) => (
    ringContainsPoint(point, candidate[0])
      && !candidate.slice(1).some((hole) => ringContainsPoint(point, hole))
  ));
  return polygon?.[0].map(([lng, lat]) => [lng, lat] as Coordinates);
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
        "fill-color": ["case", ["==", ["get", "isResidential"], true], "#e3a33b", "#56776c"],
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], PARCEL_MIN_ZOOM, 0.035, 18, 0.1],
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
        "line-color": ["case", ["==", ["get", "isResidential"], true], "#a56b12", "#385b50"],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], PARCEL_MIN_ZOOM, 0.5, 18, 0.86],
        "line-width": ["interpolate", ["linear"], ["zoom"], PARCEL_MIN_ZOOM, 0.55, 18, 1.25],
      },
    });
  }
  if (!map.getSource("active-territory")) {
    map.addSource("active-territory", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
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
  if (!map.getLayer("draft-territory-vertices")) {
    map.addLayer({
      id: "draft-territory-vertices",
      type: "circle",
      source: "draft-territory",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 6,
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
}

export function MapCanvas({
  territory,
  properties,
  selectedPropertyId,
  visibleOutcomes,
  searchQuery,
  addMode,
  drawMode,
  drawModeLabel,
  draftBoundary,
  compactMarkers,
  mapStyleUrl,
  onSelectProperty,
  onAddIntent,
  onDraftBoundaryChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const callbacksRef = useRef({ onSelectProperty, onAddIntent, onDraftBoundaryChange });
  const modesRef = useRef({ addMode, drawMode, draftBoundary });
  const territoryRef = useRef(territory);
  const currentMapStyleUrlRef = useRef(mapStyleUrl);
  const parcelDataRef = useRef<ParcelFeatureCollection>(EMPTY_PARCELS);
  const mappedLocationsRef = useRef<FeatureCollection>(mappedLocationFeatureCollection(
    properties,
    selectedPropertyId,
    visibleOutcomes,
    searchQuery,
    compactMarkers,
  ));
  const parcelRequestRef = useRef(0);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading");
  const [parcelStatus, setParcelStatus] = useState<"zoom" | "loading" | "ready" | "unavailable">("zoom");
  const [parcelCount, setParcelCount] = useState(0);

  useEffect(() => {
    callbacksRef.current = { onSelectProperty, onAddIntent, onDraftBoundaryChange };
  }, [onSelectProperty, onAddIntent, onDraftBoundaryChange]);

  useEffect(() => {
    modesRef.current = { addMode, drawMode, draftBoundary };
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = addMode || drawMode ? "crosshair" : "grab";
  }, [addMode, drawMode, draftBoundary]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let mapLoaded = false;
    let loadTimeout: number | undefined;

    void Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
    ]).then(([maplibregl, workerModule]) => {
      if (cancelled || !containerRef.current) return;
      maplibregl.setWorkerUrl(workerModule.default);
      const initialTerritory = territoryRef.current;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: currentMapStyleUrlRef.current,
        center: initialTerritory.center,
        zoom: initialTerritory.zoom,
        minZoom: 3,
        maxZoom: 20,
        attributionControl: { compact: true },
        cooperativeGestures: true,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true, timeout: 10000 },
        trackUserLocation: true,
        showAccuracyCircle: true,
      }), "bottom-right");
      loadTimeout = window.setTimeout(() => {
        if (!mapLoaded) setMapStatus("error");
      }, 15000);

      const refreshParcels = () => {
        if (!map) return;
        const requestId = ++parcelRequestRef.current;
        if (map.getZoom() < PARCEL_MIN_ZOOM) {
          parcelDataRef.current = EMPTY_PARCELS;
          updateGeoJsonSource(map, PARCEL_SOURCE_ID, EMPTY_PARCELS);
          setParcelCount(0);
          setParcelStatus("zoom");
          return;
        }
        const bounds = map.getBounds();
        setParcelStatus("loading");
        void fetchParcelsInView({
          minLat: bounds.getSouth(),
          minLong: bounds.getWest(),
          maxLat: bounds.getNorth(),
          maxLong: bounds.getEast(),
        }).then((parcels) => {
          if (cancelled || requestId !== parcelRequestRef.current) return;
          if (!parcels) {
            setParcelStatus("unavailable");
            return;
          }
          parcelDataRef.current = parcels;
          updateGeoJsonSource(map!, PARCEL_SOURCE_ID, parcels);
          setParcelCount(parcels.features.length);
          setParcelStatus("ready");
        }).catch(() => {
          if (cancelled || requestId !== parcelRequestRef.current) return;
          parcelDataRef.current = EMPTY_PARCELS;
          updateGeoJsonSource(map!, PARCEL_SOURCE_ID, EMPTY_PARCELS);
          setParcelCount(0);
          setParcelStatus("unavailable");
        });
      };

      map.on("style.load", () => {
        if (!map) return;
        configureNeighborWalkLayers(
          map,
          territoryRef.current,
          modesRef.current.draftBoundary,
          parcelDataRef.current,
          mappedLocationsRef.current,
        );
      });

      map.once("load", () => {
        mapLoaded = true;
        if (loadTimeout !== undefined) window.clearTimeout(loadTimeout);
        setMapStatus("ready");
        refreshParcels();
      });

      map.on("moveend", refreshParcels);

      map.on("mousemove", (event: MapMouseEvent) => {
        if (!map || modesRef.current.addMode || modesRef.current.drawMode) return;
        const interactiveLayers = [
          LOCATION_POINT_HIT_LAYER_ID,
          LOCATION_AREA_HIT_LAYER_ID,
          PARCEL_FILL_LAYER_ID,
        ].filter((layerId) => map!.getLayer(layerId));
        const feature = interactiveLayers.length
          ? map.queryRenderedFeatures(event.point, { layers: interactiveLayers })[0]
          : undefined;
        map.getCanvas().style.cursor = feature ? "pointer" : "grab";
      });

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
          callbacksRef.current.onDraftBoundaryChange([...modesRef.current.draftBoundary, coordinates]);
          return;
        }

        const locationLayers = [LOCATION_POINT_HIT_LAYER_ID, LOCATION_AREA_HIT_LAYER_ID]
          .filter((layerId) => map!.getLayer(layerId));
        const mappedLocation = locationLayers.length
          ? map.queryRenderedFeatures(event.point, { layers: locationLayers })[0]
          : undefined;
        const mappedPropertyId = mappedLocation?.properties?.propertyId;
        if (mappedPropertyId) {
          callbacksRef.current.onSelectProperty(String(mappedPropertyId));
          return;
        }

        const parcelFeature = map.getLayer(PARCEL_FILL_LAYER_ID)
          ? map.queryRenderedFeatures(event.point, { layers: [PARCEL_FILL_LAYER_ID] })[0]
          : undefined;
        if (parcelFeature && (parcelFeature.geometry.type === "Polygon" || parcelFeature.geometry.type === "MultiPolygon")) {
          const properties = parcelFeature.properties;
          callbacksRef.current.onAddIntent({
            coordinates,
            suggestedAddress: String(properties?.situsAddress || `${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}`),
            buildingGeometry: buildingGeometryAtPoint(parcelFeature.geometry, coordinates),
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

        const buildingLayers = map.getStyle().layers
          .filter(isBuildingFootprintLayer)
          .map((layer) => layer.id);
        const features = buildingLayers.length
          ? map.queryRenderedFeatures(event.point, { layers: buildingLayers })
          : [];
        const feature = features.find((candidate) => (
          candidate.geometry.type === "Polygon" || candidate.geometry.type === "MultiPolygon"
        ));
        const geometry = buildingGeometryAtPoint(feature?.geometry, coordinates);
        callbacksRef.current.onAddIntent({
          coordinates,
          suggestedAddress: suggestedAddress(feature?.properties, coordinates),
          buildingGeometry: geometry,
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
    const map = mapRef.current;
    if (!map || mapStatus !== "ready") return;
    updateGeoJsonSource(map, "active-territory", featureCollection(polygonFeature(territory.boundary)));
    map.flyTo({ center: territory.center, zoom: territory.zoom, duration: 650, essential: true });
    const fill = map.getLayer("active-territory-fill");
    if (fill) map.setPaintProperty("active-territory-fill", "fill-color", territory.color);
    const outline = map.getLayer("active-territory-outline");
    if (outline) map.setPaintProperty("active-territory-outline", "line-color", territory.color);
  }, [territory, mapStatus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStatus !== "ready") return;
    updateGeoJsonSource(map, "draft-territory", draftFeatureCollection(draftBoundary));
  }, [draftBoundary, mapStatus]);

  useEffect(() => {
    const map = mapRef.current;
    const mappedLocations = mappedLocationFeatureCollection(
      properties,
      selectedPropertyId,
      visibleOutcomes,
      searchQuery,
      compactMarkers,
    );
    mappedLocationsRef.current = mappedLocations;
    if (!map || mapStatus !== "ready") return;
    updateGeoJsonSource(map, LOCATION_SOURCE_ID, mappedLocations);
  }, [properties, selectedPropertyId, visibleOutcomes, searchQuery, compactMarkers, mapStatus]);

  return (
    <div className="map-engine-shell">
      <div ref={containerRef} className="map-engine" aria-label={`Interactive map of ${territory.name}`} />
      {mapStatus === "loading" && (
        <div className="map-state"><LoaderCircle className="spin" size={22} /><strong>Loading the neighborhood map</strong><span>Your territory records are already available.</span></div>
      )}
      {mapStatus === "error" && (
        <div className="map-state error"><AlertTriangle size={23} /><strong>The map tiles did not load</strong><span>Visit records still work. Check the map style URL or your connection.</span></div>
      )}
      {mapStatus === "ready" && parcelStatus !== "unavailable" && (
        <div className={`parcel-status ${parcelStatus}`}>
          {parcelStatus === "loading" ? <LoaderCircle className="spin" size={14} /> : <MapPinned size={14} />}
          <span>{parcelStatus === "zoom"
            ? "Zoom in for official parcels"
            : parcelStatus === "loading"
              ? "Loading official parcels"
              : `${parcelCount === PARCEL_RESULT_LIMIT ? `${PARCEL_RESULT_LIMIT.toLocaleString()}+` : parcelCount.toLocaleString()} parcels visible · Status colors mark saved locations`}</span>
        </div>
      )}
      {addMode && (
        <div className="map-mode-banner"><MapPin size={15} /><span>Tap an official parcel—or anywhere on the map</span></div>
      )}
      {drawMode && (
        <div className="map-mode-banner draw"><MousePointerClick size={15} /><span>{drawModeLabel ?? "Tap at least 3 corners"} · {draftBoundary.length} added</span></div>
      )}
    </div>
  );
}
