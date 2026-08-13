"use client";

import { AlertTriangle, LoaderCircle, MapPin, MousePointerClick } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from "geojson";
import type { Map as MapLibreMap, Marker as MapLibreMarker, MapMouseEvent } from "maplibre-gl";
import type { Coordinates, Outcome, Property, Territory } from "../lib/domain";
import { outcomeMeta } from "../lib/domain";

const BUILDING_OUTLINE_LAYER_ID = "neighborwalk-building-outlines";
const BUILDING_NUMBER_MIN_ZOOM = 16;
type MapStyleLayer = ReturnType<MapLibreMap["getStyle"]>["layers"][number];
type BuildingFootprintLayer = Extract<MapStyleLayer, { type: "fill" }> | Extract<MapStyleLayer, { type: "fill-extrusion" }>;
type BuildingNumberLayer = Extract<MapStyleLayer, { type: "symbol" }>;

type AddIntent = {
  coordinates: Coordinates;
  suggestedAddress: string;
  buildingGeometry?: Coordinates[];
};

type Props = {
  territory: Territory;
  properties: Property[];
  selectedPropertyId: string | null;
  visibleOutcomes: Set<Outcome>;
  addMode: boolean;
  drawMode: boolean;
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

function configureNeighborWalkLayers(map: MapLibreMap, territory: Territory, draftBoundary: Coordinates[]) {
  configureBuildingDetails(map);
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
}

export function MapCanvas({
  territory,
  properties,
  selectedPropertyId,
  visibleOutcomes,
  addMode,
  drawMode,
  draftBoundary,
  compactMarkers,
  mapStyleUrl,
  onSelectProperty,
  onAddIntent,
  onDraftBoundaryChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<MapLibreMarker[]>([]);
  const callbacksRef = useRef({ onSelectProperty, onAddIntent, onDraftBoundaryChange });
  const modesRef = useRef({ addMode, drawMode, draftBoundary });
  const territoryRef = useRef(territory);
  const currentMapStyleUrlRef = useRef(mapStyleUrl);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading");

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

      map.on("style.load", () => {
        if (!map) return;
        configureNeighborWalkLayers(map, territoryRef.current, modesRef.current.draftBoundary);
      });

      map.once("load", () => {
        mapLoaded = true;
        if (loadTimeout !== undefined) window.clearTimeout(loadTimeout);
        setMapStatus("ready");
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
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
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
    if (!map || mapStatus !== "ready") return;
    let disposed = false;
    void import("maplibre-gl").then((maplibregl) => {
      if (disposed || !mapRef.current) return;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = properties
        .filter((property) => visibleOutcomes.has(property.currentOutcome))
        .map((property) => {
          const element = document.createElement("button");
          element.type = "button";
          element.className = `nw-map-marker${selectedPropertyId === property.id ? " is-selected" : ""}${compactMarkers ? " is-compact" : ""}`;
          element.dataset.outcome = property.currentOutcome;
          element.style.setProperty("--marker-color", outcomeMeta[property.currentOutcome].color);
          element.setAttribute("aria-label", `${property.address}: ${outcomeMeta[property.currentOutcome].label}`);
          const label = document.createElement("span");
          label.className = "nw-map-marker-label";
          label.textContent = property.address;
          element.appendChild(label);
          element.addEventListener("click", (event) => {
            event.stopPropagation();
            callbacksRef.current.onSelectProperty(property.id);
          });
          return new maplibregl.Marker({ element, anchor: "bottom" })
            .setLngLat(property.coordinates)
            .addTo(map);
        });
    });
    return () => { disposed = true; };
  }, [properties, selectedPropertyId, visibleOutcomes, compactMarkers, mapStatus]);

  return (
    <div className="map-engine-shell">
      <div ref={containerRef} className="map-engine" aria-label={`Interactive map of ${territory.name}`} />
      {mapStatus === "loading" && (
        <div className="map-state"><LoaderCircle className="spin" size={22} /><strong>Loading the neighborhood map</strong><span>Your territory records are already available.</span></div>
      )}
      {mapStatus === "error" && (
        <div className="map-state error"><AlertTriangle size={23} /><strong>The map tiles did not load</strong><span>Visit records still work. Check the map style URL or your connection.</span></div>
      )}
      {addMode && (
        <div className="map-mode-banner"><MapPin size={15} /><span>Tap a building or location to add it</span></div>
      )}
      {drawMode && (
        <div className="map-mode-banner draw"><MousePointerClick size={15} /><span>Tap at least 3 corners · {draftBoundary.length} added</span></div>
      )}
    </div>
  );
}
