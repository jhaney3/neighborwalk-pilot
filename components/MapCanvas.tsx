"use client";

import { AlertTriangle, LoaderCircle, MapPin, MousePointerClick } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from "geojson";
import type { Map as MapLibreMap, Marker as MapLibreMarker, MapMouseEvent } from "maplibre-gl";
import type { Coordinates, Outcome, Property, Territory } from "../lib/domain";
import { outcomeMeta } from "../lib/domain";

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
  const initialTerritoryRef = useRef(territory);
  const initialMapStyleUrlRef = useRef(mapStyleUrl);
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
    let styleLoaded = false;

    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !containerRef.current) return;
      const initialTerritory = initialTerritoryRef.current;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: initialMapStyleUrlRef.current,
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

      map.once("style.load", () => {
        if (!map) return;
        styleLoaded = true;
        map.addSource("active-territory", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "active-territory-fill",
          type: "fill",
          source: "active-territory",
          paint: { "fill-color": initialTerritory.color, "fill-opacity": 0.08 },
        });
        map.addLayer({
          id: "active-territory-outline",
          type: "line",
          source: "active-territory",
          paint: { "line-color": initialTerritory.color, "line-width": 3, "line-dasharray": [2, 1.5] },
        });
        map.addSource("draft-territory", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "draft-territory-fill",
          type: "fill",
          source: "draft-territory",
          paint: { "fill-color": "#e9a84a", "fill-opacity": 0.15 },
        });
        map.addLayer({
          id: "draft-territory-outline",
          type: "line",
          source: "draft-territory",
          paint: { "line-color": "#b47417", "line-width": 3 },
        });
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
        updateGeoJsonSource(map, "active-territory", featureCollection(polygonFeature(initialTerritory.boundary)));
        setMapStatus("ready");
      });

      map.on("error", (event) => {
        if (event.error && !styleLoaded) setMapStatus("error");
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
          .filter((layer) => /building|house|residential/i.test(layer.id) && layer.type === "fill")
          .map((layer) => layer.id);
        const features = buildingLayers.length
          ? map.queryRenderedFeatures(event.point, { layers: buildingLayers })
          : [];
        const feature = features.find((candidate) => candidate.geometry.type === "Polygon");
        const geometry = feature?.geometry.type === "Polygon"
          ? feature.geometry.coordinates[0].map((point: number[]) => [point[0], point[1]] as Coordinates)
          : undefined;
        callbacksRef.current.onAddIntent({
          coordinates,
          suggestedAddress: suggestedAddress(feature?.properties, coordinates),
          buildingGeometry: geometry,
        });
      });
    }).catch(() => setMapStatus("error"));

    return () => {
      cancelled = true;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
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
