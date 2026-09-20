"use client";

import { AlertTriangle, Check, LoaderCircle, Redo2, Undo2, Waypoints, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import { outcomeMeta, outcomeValues, type Coordinates, type Property, type Territory } from "../lib/domain";
import { drawingBoundaryReady, drawingGestureIntent, drawingInstruction, moveDrawingCorner, rectangleBoundary, rectangleHasArea, undoDrawingPoint, type MapDrawingMode } from "../lib/map-drawing";
import { mapLocationPointCollection } from "../lib/map-location-points";
import { MAPLIBRE_WORKER_URL } from "../lib/map-worker";
import type { ParcelFeatureCollection } from "../lib/parcels";
import { clipLineToBoundary, closeRing, connectedStreetIds, mapLineOffsetForSide, polygonInsideBoundary, polygonSelfIntersects, polygonsOverlap, streetSidePolygons, streetsWithinMeters } from "../lib/planning-geometry";
import { EMPTY_PLANNING_PARCELS, EMPTY_STREETS, loadPlanningLayers, loadingPlanningParcelLayer, loadingPlanningStreetLayer, planningAvailabilityMessage, planningLayerMatchesIdentity, type PlanningParcelLayer, type PlanningStreetLayer } from "../lib/planning-loader";
import { OVERTURE_TRANSPORTATION_SOURCE, streetSegmentDisplayLines, streetSegmentLines, type StreetSegmentCollection } from "../lib/street-segments";
import { applyParcelSelectionOverrides, parcelInsideZone, planningDatasetIdentity, planningParcelDisplayCollection, planningParcelRoster, polygonParcelKeys, snapshotParcelFeatureCollection, STREET_PARCEL_CORRIDOR_METERS, streetParcelKeys, toggleParcelSelectionOverride } from "../lib/target-parcels";
import type { WalkTargetGeometry, WalkTargetInput } from "../lib/walk-targets";
import { MapDrawingModeControl } from "./MapDrawingModeControl";

export type WalkTargetDraft = WalkTargetInput & { clientId: string; id?: string };
export type PlanningMapData = { streets: StreetSegmentCollection; parcels: ParcelFeatureCollection; parcelRevision?: string; parcelComplete: boolean; fromCache?: boolean };
export type WalkTargetPlannerProps = {
  parentTerritory: Territory;
  eventId: string;
  targets: WalkTargetDraft[];
  selectedTargetId?: string;
  mapStyleUrl: string;
  onSelectedTargetChange: (id?: string) => void;
  onChange: (targets: WalkTargetDraft[]) => void;
  loadPlanningData?: (territory: Territory) => Promise<PlanningMapData>;
  visitedParcelKeys?: ReadonlySet<string>;
  locationProperties?: readonly Property[];
  demo: boolean;
  readOnly?: boolean;
};

type Mode = "select" | "polygon" | "rectangle" | "streets";
type DraftKind = MapDrawingMode | "streets";
const TARGET_COLORS = ["#286c59", "#a9660d", "#376f9e", "#95598a", "#8a593e"];
const PLANNING_LOAD_TIMEOUT_MS = 20_000;
const EMPTY_PARCEL_KEYS = new Set<string>();
const EMPTY_LOCATION_PROPERTIES: readonly Property[] = [];

function polygon(points: Coordinates[]): Extract<WalkTargetGeometry, { type: "Polygon" }> { return { type: "Polygon", coordinates: [closeRing(points)] }; }
function collection(features: Feature<Geometry>[]): FeatureCollection { return { type: "FeatureCollection", features }; }
function targetFeatures(targets: WalkTargetDraft[], selected?: string) {
  return collection(targets.flatMap((target): Feature<Geometry>[] => {
    const properties = { id: target.clientId, name: target.name, color: target.color, selected: target.clientId === selected, side: target.streetSelection?.side ?? "both", displayKind: "centerline" };
    const centerline: Feature<Geometry> = { type: "Feature", id: target.clientId, geometry: target.geometry, properties };
    if (target.geometry.type !== "MultiLineString" || !target.streetSelection) return [centerline];
    const lines = target.geometry.coordinates.map((coordinates) => ({ type: "LineString" as const, coordinates }));
    return [centerline, ...streetSidePolygons(lines, target.streetSelection.side, target.streetSelection.corridorMeters)
      .map((geometry, index): Feature<Geometry> => ({ type: "Feature", id: `${target.clientId}-side-${index}`, geometry, properties: { ...properties, displayKind: "side-fill" } }))];
  }));
}
function draftFeatures(points: Coordinates[]) {
  const features: Feature<Geometry>[] = points.map((coordinates, index): Feature<Point> => ({ type: "Feature", properties: { index }, geometry: { type: "Point", coordinates } }));
  if (points.length >= 3) features.unshift({ type: "Feature", properties: {}, geometry: polygon(points) });
  return collection(features);
}
function streetDisplayCollection(streets: StreetSegmentCollection, boundary: Coordinates[]) {
  return collection(streets.features.flatMap((feature) => streetSegmentDisplayLines(feature).flatMap((line) => clipLineToBoundary(line, boundary))
    .map((geometry, index): Feature<Geometry> => ({ type: "Feature", id: `${feature.properties.id}-display-${index}`, geometry, properties: feature.properties }))));
}

function layerSummary(label: string, status: PlanningStreetLayer["status"] | PlanningParcelLayer["status"], count: number, noun: string) {
  if (status === "loading") return `${label}: loading…`;
  if (status === "unavailable") return `${label}: unavailable`;
  if (status === "cached") return `${label}: ${count} cached ${noun}${count === 1 ? "" : "s"} (view only)`;
  if (status === "incomplete") return `${label}: ${count} ${noun}${count === 1 ? "" : "s"} in an incomplete result`;
  if (status === "empty") return `${label}: no ${noun}s found`;
  return `${label}: ${count} ${noun}${count === 1 ? "" : "s"}`;
}

function planningLayerSummary(label: "Streets" | "Parcels", layer: PlanningStreetLayer | PlanningParcelLayer, count: number, noun: string) {
  const availabilityMessage = planningAvailabilityMessage(layer.availability, label === "Parcels" ? "parcels" : "streets");
  if (availabilityMessage) return availabilityMessage;
  return layerSummary(label, layer.status, count, noun);
}

export function WalkTargetPlanner({ parentTerritory, eventId, targets, selectedTargetId, mapStyleUrl, onSelectedTargetChange, onChange, loadPlanningData, visitedParcelKeys = EMPTY_PARCEL_KEYS, locationProperties = EMPTY_LOCATION_PROPERTIES, demo, readOnly = false }: WalkTargetPlannerProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const locationPoints = useMemo(() => mapLocationPointCollection(locationProperties), [locationProperties]);
  const stateRef = useRef({ mode: "select" as Mode, points: [] as Coordinates[], streets: EMPTY_STREETS, parcels: EMPTY_PLANNING_PARCELS,
    locationPoints, connected: false, streetIds: new Set<string>(), automaticParcelIds: new Set<string>(), parcelIds: new Set<string>(), claimedParcelIds: new Set<string>(), visitedParcelKeys, targets, selectedTargetId, parentTerritory, readOnly });
  const dragVertex = useRef<number | null>(null);
  const rectangleStart = useRef<Coordinates | null>(null);
  const rectanglePointerStart = useRef<[number, number] | null>(null);
  const pointerMoved = useRef(false);
  const suppressMapClick = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [mode, setMode] = useState<Mode>("select");
  const [draftKind, setDraftKind] = useState<DraftKind>();
  const [points, setPoints] = useState<Coordinates[]>([]);
  const [streetLayer, setStreetLayer] = useState<PlanningStreetLayer>(() => loadingPlanningStreetLayer(""));
  const [parcelLayer, setParcelLayer] = useState<PlanningParcelLayer>(() => loadingPlanningParcelLayer(""));
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [streetIds, setStreetIds] = useState<Set<string>>(new Set());
  const [parcelOverrides, setParcelOverrides] = useState<Map<string, boolean>>(new Map());
  const [overlapNotice, setOverlapNotice] = useState<{ id: number; message: string }>();
  const [connected, setConnected] = useState(false);
  const planningIdentity = useMemo(() => planningDatasetIdentity(parentTerritory.id, parentTerritory.boundary), [parentTerritory.boundary, parentTerritory.id]);
  const currentStreetLayer = planningLayerMatchesIdentity(streetLayer.identity, planningIdentity) ? streetLayer : loadingPlanningStreetLayer(planningIdentity);
  const currentParcelLayer = planningLayerMatchesIdentity(parcelLayer.identity, planningIdentity) ? parcelLayer : loadingPlanningParcelLayer(planningIdentity);
  const streets = currentStreetLayer.data;
  const parcels = currentParcelLayer.data;
  const parcelRevision = currentParcelLayer.revision || "unknown";
  const eligibleParcels = useMemo<ParcelFeatureCollection>(() => ({ type: "FeatureCollection",
    features: parcels.features.filter((parcel) => parcel.properties.isResidential && parcelInsideZone(parcel, parentTerritory.boundary)) }), [parcels, parentTerritory.boundary]);
  const frozenTargetParcels = useMemo(() => snapshotParcelFeatureCollection(targets.flatMap((target) => target.parcels)), [targets]);
  const displayedParcels = readOnly ? frozenTargetParcels : eligibleParcels;
  const parcelInventoryReady = currentParcelLayer.live && currentParcelLayer.complete && eligibleParcels.features.length > 0;
  const planningComplete = currentStreetLayer.live && currentStreetLayer.complete && parcelInventoryReady;
  const streetInspectable = currentStreetLayer.status !== "loading" && currentStreetLayer.status !== "unavailable" && streets.features.length > 0;
  const layersSettled = currentStreetLayer.status !== "loading" && currentParcelLayer.status !== "loading";
  const retryAvailable = [currentStreetLayer.status, currentParcelLayer.status].some((layerStatus) => ["empty", "incomplete", "cached", "unavailable"].includes(layerStatus));
  const inventoryMessage = !readOnly && layersSettled && !planningComplete
    ? "New targets require complete live street data and at least one residential parcel. Available map data remains visible; retry to refresh unavailable or incomplete layers."
    : "";
  const chosenStreetLines = useMemo(() => streets.features.filter((feature) => streetIds.has(feature.properties.id)).flatMap(streetSegmentLines), [streetIds, streets.features]);
  const claimedParcelIds = useMemo(() => new Set(targets.flatMap((target) => target.parcels.map((parcel) => `${parcel.countyFips}:${parcel.gislink}`))), [targets]);
  const candidateAutomaticParcelIds = useMemo(() => {
    if (!currentParcelLayer.complete) return new Set<string>();
    if ((draftKind === "polygon" || draftKind === "rectangle") && points.length >= 3) return polygonParcelKeys(eligibleParcels, points);
    if (draftKind === "streets" && chosenStreetLines.length) return streetParcelKeys(eligibleParcels, chosenStreetLines, parentTerritory.boundary, STREET_PARCEL_CORRIDOR_METERS, "both");
    return new Set<string>();
  }, [chosenStreetLines, currentParcelLayer.complete, draftKind, eligibleParcels, parentTerritory.boundary, points]);
  const automaticParcelIds = useMemo(() => new Set([...candidateAutomaticParcelIds].filter((id) => !claimedParcelIds.has(id))), [candidateAutomaticParcelIds, claimedParcelIds]);
  const parcelIds = useMemo(() => new Set([...applyParcelSelectionOverrides(automaticParcelIds, parcelOverrides)].filter((id) => !claimedParcelIds.has(id))), [automaticParcelIds, claimedParcelIds, parcelOverrides]);
  const excludedParcelCount = useMemo(() => [...candidateAutomaticParcelIds].filter((id) => claimedParcelIds.has(id)).length, [candidateAutomaticParcelIds, claimedParcelIds]);
  const visitedParcelCount = useMemo(() => eligibleParcels.features.filter((feature) => visitedParcelKeys.has(`${feature.properties.countyFips}:${feature.properties.gislink}`)).length, [eligibleParcels.features, visitedParcelKeys]);
  const locationOutcomes = useMemo(() => {
    const present = new Set(locationPoints.features.map((feature) => feature.properties?.outcome));
    return outcomeValues.filter((outcome) => present.has(outcome));
  }, [locationPoints.features]);

  useEffect(() => {
    if (!overlapNotice) return;
    const timeout = window.setTimeout(() => setOverlapNotice(undefined), 2_800);
    return () => window.clearTimeout(timeout);
  }, [overlapNotice]);

  useEffect(() => { stateRef.current = { mode, points, streets, parcels: displayedParcels, locationPoints, connected, streetIds, automaticParcelIds, parcelIds, claimedParcelIds, visitedParcelKeys, targets, selectedTargetId, parentTerritory, readOnly }; }, [automaticParcelIds, claimedParcelIds, connected, displayedParcels, locationPoints, mode, parentTerritory, parcelIds, points, readOnly, selectedTargetId, streetIds, streets, targets, visitedParcelKeys]);
  const updateSource = useCallback((id: string, data: FeatureCollection) => {
    const source = mapRef.current?.getSource(id) as { setData: (data: FeatureCollection) => void } | undefined;
    source?.setData(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Changing the parent invalidates every in-progress drawing selection before the next inventory loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode("select"); setDraftKind(undefined); setPoints([]); setStreetIds(new Set()); setParcelOverrides(new Map()); setConnected(false);
    setStreetLayer(loadingPlanningStreetLayer(planningIdentity)); setParcelLayer(loadingPlanningParcelLayer(planningIdentity));
    rectangleStart.current = null; rectanglePointerStart.current = null; dragVertex.current = null;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      controller.abort();
      setStreetLayer((current) => current.identity === planningIdentity && current.status === "loading"
        ? { identity: planningIdentity, status: "unavailable", data: EMPTY_STREETS, complete: false, live: false, error: "Street data request timed out." }
        : current);
      setParcelLayer((current) => current.identity === planningIdentity && current.status === "loading"
        ? { identity: planningIdentity, status: "unavailable", data: EMPTY_PLANNING_PARCELS, revision: "", complete: false, live: false, error: "Parcel data request timed out." }
        : current);
    }, PLANNING_LOAD_TIMEOUT_MS);
    if (loadPlanningData) {
      void loadPlanningData(parentTerritory).then((data) => {
        if (cancelled) return;
        const streetsReady = data.streets.metadata?.complete === true && data.streets.metadata.truncated !== true;
        setStreetLayer({ identity: planningIdentity, status: data.fromCache ? "cached" : streetsReady ? (data.streets.features.length ? "ready" : "empty") : "incomplete",
          data: data.streets, complete: streetsReady, live: !data.fromCache });
        setParcelLayer({ identity: planningIdentity, status: data.fromCache ? "cached" : data.parcelComplete ? (data.parcels.features.length ? "ready" : "empty") : "incomplete",
          data: data.parcels, revision: data.parcelRevision ?? "", complete: data.parcelComplete, live: !data.fromCache });
      }).catch((error: unknown) => {
        if (cancelled) return;
        const reason = error instanceof Error ? error.message : "Planning data is unavailable.";
        setStreetLayer({ identity: planningIdentity, status: "unavailable", data: EMPTY_STREETS, complete: false, live: false, error: reason });
        setParcelLayer({ identity: planningIdentity, status: "unavailable", data: EMPTY_PLANNING_PARCELS, revision: "", complete: false, live: false, error: reason });
      }).finally(() => window.clearTimeout(timeout));
    } else {
      void loadPlanningLayers(parentTerritory, { publicMap: demo, signal: controller.signal, onLayer: (event) => {
        if (cancelled || event.value.identity !== planningIdentity) return;
        if (event.layer === "streets") setStreetLayer(event.value);
        else setParcelLayer(event.value);
      } }).finally(() => window.clearTimeout(timeout));
    }
    return () => { cancelled = true; window.clearTimeout(timeout); controller.abort(); };
  // A connected workspace refresh replaces record objects even when their
  // contents are unchanged. The serialized identity is the boundary change
  // signal; object identity must not erase an in-progress drawing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, loadAttempt, loadPlanningData, planningIdentity]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let disposed = false;
    void import("maplibre-gl").then((maplibre) => {
      if (disposed || !container.current) return;
      maplibre.setWorkerUrl(MAPLIBRE_WORKER_URL);
      const map = new maplibre.Map({ container: container.current, style: mapStyleUrl, center: parentTerritory.center, zoom: parentTerritory.zoom, cooperativeGestures: true });
      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      const configure = () => {
        const addSource = (id: string) => { if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: collection([]) }); };
        ["plan-parent", "plan-targets", "plan-draft", "plan-streets", "plan-parcels", "plan-locations"].forEach(addSource);
        const add = (layer: Parameters<MapLibreMap["addLayer"]>[0]) => { if (!map.getLayer(layer.id)) map.addLayer(layer); };
        add({ id: "plan-parent-fill", type: "fill", source: "plan-parent", paint: { "fill-color": ["get", "color"], "fill-opacity": .06 } });
        add({ id: "plan-parent-line", type: "line", source: "plan-parent", paint: { "line-color": ["get", "color"], "line-width": 3 } });
        add({ id: "plan-parcels-fill", type: "fill", source: "plan-parcels", paint: { "fill-color": ["case", ["==", ["get", "chosen"], true], "#e9a84a", ["==", ["get", "previouslyVisited"], true], "#286c59", ["==", ["get", "claimed"], true], "#6f7773", "#315c50"], "fill-opacity": ["case", ["==", ["get", "chosen"], true], .3, ["==", ["get", "previouslyVisited"], true], .28, ["==", ["get", "claimed"], true], .12, .04] } });
        add({ id: "plan-parcels-line", type: "line", source: "plan-parcels", paint: { "line-color": ["case", ["==", ["get", "previouslyVisited"], true], "#174d3f", "#56776c"], "line-width": ["case", ["==", ["get", "previouslyVisited"], true], 2.25, 1] } });
        add({ id: "plan-streets-hit", type: "line", source: "plan-streets", paint: { "line-color": "#000", "line-opacity": .01, "line-width": 18 } });
        add({ id: "plan-streets-line", type: "line", source: "plan-streets", paint: { "line-color": ["case", ["==", ["get", "chosen"], true], "#e28f16", "#53796d"], "line-width": ["case", ["==", ["get", "chosen"], true], 7, 2], "line-opacity": ["case", ["==", ["get", "chosen"], true], .9, .55] } });
        add({ id: "plan-target-fill", type: "fill", source: "plan-targets", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "selected"], .34, .18] } });
        add({ id: "plan-target-line", type: "line", source: "plan-targets", filter: ["!=", ["get", "displayKind"], "side-fill"], paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "selected"], 6, 4], "line-offset": ["case", ["==", ["get", "side"], "left"], mapLineOffsetForSide("left"), ["==", ["get", "side"], "right"], mapLineOffsetForSide("right"), 0] } });
        add({ id: "plan-location-dots", type: "circle", source: "plan-locations", minzoom: 12.5, paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12.5, 2.2, 16, 4.2, 19, 5.2],
          "circle-color": ["get", "statusColor"],
          "circle-stroke-color": ["get", "outlineColor"],
          "circle-stroke-width": ["case", ["==", ["get", "visited"], true], 1.4, 1.8],
        } });
        add({ id: "plan-draft-fill", type: "fill", source: "plan-draft", paint: { "fill-color": "#e9a84a", "fill-opacity": .22 } });
        add({ id: "plan-draft-line", type: "line", source: "plan-draft", paint: { "line-color": "#9c6411", "line-width": 3 } });
        add({ id: "plan-draft-point-hit", type: "circle", source: "plan-draft", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 18, "circle-color": "#9c6411", "circle-opacity": .01 } });
        add({ id: "plan-draft-points", type: "circle", source: "plan-draft", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 8, "circle-color": "#fff", "circle-stroke-color": "#9c6411", "circle-stroke-width": 3 } });
        const current = stateRef.current;
        const displayStreets = streetDisplayCollection(current.streets, current.parentTerritory.boundary);
        updateSource("plan-parent", collection([{ type: "Feature", properties: { color: current.parentTerritory.color }, geometry: polygon(current.parentTerritory.boundary) }]));
        updateSource("plan-targets", targetFeatures(current.targets, current.selectedTargetId));
        updateSource("plan-draft", draftFeatures(current.points));
        updateSource("plan-streets", { ...displayStreets, features: displayStreets.features.map((feature) => ({ ...feature, properties: { ...feature.properties, chosen: current.streetIds.has(String(feature.properties?.id)) } })) });
        updateSource("plan-parcels", planningParcelDisplayCollection(current.parcels, current.parcelIds, current.claimedParcelIds, current.visitedParcelKeys, current.readOnly));
        updateSource("plan-locations", current.locationPoints);
        setStatus("ready");
      };
      map.on("style.load", configure);
      let styleReady = false;
      map.once("load", () => { styleReady = true; });
      map.on("error", (event) => { if (event.error && !styleReady) setStatus("error"); });
      const startDrawingGesture = (event: MapMouseEvent | MapTouchEvent) => {
        if ("points" in event && event.points.length !== 1) return;
        pointerMoved.current = false;
        const current = stateRef.current;
        let vertexIndex: number | undefined;
        if (current.mode === "polygon" || current.mode === "rectangle") {
          const hit = map.queryRenderedFeatures(event.point, { layers: ["plan-draft-point-hit"] })[0];
          if (hit?.properties?.index !== undefined) vertexIndex = Number(hit.properties.index);
        }
        if (current.mode !== "polygon" && current.mode !== "rectangle") return;
        const intent = drawingGestureIntent(current.points, current.mode, vertexIndex, [event.lngLat.lng, event.lngLat.lat]);
        if (intent.kind === "move-corner") {
          if ("points" in event) event.preventDefault();
          dragVertex.current = intent.index;
          map.dragPan.disable();
          return;
        }
        if (intent.kind === "create-rectangle") {
          if ("points" in event) event.preventDefault();
          rectangleStart.current = intent.start;
          rectanglePointerStart.current = [event.point.x, event.point.y];
          map.dragPan.disable();
        }
      };
      const continueDrawingGesture = (event: MapMouseEvent | MapTouchEvent) => {
        const here: Coordinates = [event.lngLat.lng, event.lngLat.lat];
        if (rectangleStart.current) {
          const startPoint = rectanglePointerStart.current;
          if (startPoint && Math.hypot(event.point.x - startPoint[0], event.point.y - startPoint[1]) < 5) return;
          pointerMoved.current = true;
          const rectangle = rectangleBoundary(rectangleStart.current, here);
          if (rectangleHasArea(rectangle)) setPoints(rectangle);
        }
        if (dragVertex.current !== null) {
          pointerMoved.current = true;
          const vertexIndex = dragVertex.current;
          const drawingMode = stateRef.current.mode === "rectangle" ? "rectangle" : "polygon";
          setPoints((current) => moveDrawingCorner(current, drawingMode, vertexIndex, here));
        }
      };
      const finishDrawingGesture = () => { if (pointerMoved.current && (rectangleStart.current || dragVertex.current !== null)) { suppressMapClick.current = true; window.setTimeout(() => { suppressMapClick.current = false; }, 350); } rectangleStart.current = null; rectanglePointerStart.current = null; dragVertex.current = null; map.dragPan.enable(); };
      map.on("mousedown", startDrawingGesture);
      map.on("touchstart", startDrawingGesture);
      map.on("mousemove", continueDrawingGesture);
      map.on("touchmove", continueDrawingGesture);
      map.on("mouseup", finishDrawingGesture);
      map.on("touchend", finishDrawingGesture);
      map.on("touchcancel", finishDrawingGesture);
      map.on("click", (event: MapMouseEvent) => {
        if (suppressMapClick.current) { suppressMapClick.current = false; return; }
        const current = stateRef.current;
        const vertex = (current.mode === "polygon" || current.mode === "rectangle")
          ? map.queryRenderedFeatures(event.point, { layers: ["plan-draft-point-hit"] })[0]
          : undefined;
        if (vertex) return;
        if (current.mode === "polygon") { setPoints((value) => [...value, [event.lngLat.lng, event.lngLat.lat]]); return; }
        if (current.mode === "rectangle") return;
        if (current.mode === "streets") {
          const street = map.queryRenderedFeatures(event.point, { layers: ["plan-streets-hit"] })[0];
          const streetId = String(street?.properties?.id ?? "");
          if (streetId) {
            setStreetIds((chosen) => { const next = new Set(chosen); const candidates = current.streets.features.flatMap((feature) => streetSegmentLines(feature).map((geometry) => ({ id: feature.properties.id, name: feature.properties.name, geometry }))); const ids = current.connected ? connectedStreetIds(streetId, candidates) : [streetId]; const remove = next.has(streetId); ids.forEach((value) => remove ? next.delete(value) : next.add(value)); return next; });
            return;
          }
          const hit = map.queryRenderedFeatures(event.point, { layers: ["plan-parcels-fill"] })[0]; const props = hit?.properties; if (!props || !current.streetIds.size) return;
          const countyFips = String(Reflect.get(props, "countyFips") ?? ""); const gislink = String(Reflect.get(props, "gislink") ?? "");
          const id = `${countyFips}:${gislink}`;
          if (current.claimedParcelIds.has(id)) { setOverlapNotice({ id: Date.now(), message: "That parcel is already included in another target for this outing." }); return; }
          setOverlapNotice(undefined);
          setParcelOverrides((overrides) => toggleParcelSelectionOverride(overrides, id, current.automaticParcelIds));
        }
      });
    }).catch(() => setStatus("error"));
    return () => { disposed = true; mapRef.current?.remove(); mapRef.current = null; };
  // The map owns its event subscriptions for the component lifetime; changing data is sent through GeoJSON sources and stateRef.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    updateSource("plan-parent", collection([{ type: "Feature", properties: { color: parentTerritory.color }, geometry: polygon(parentTerritory.boundary) }]));
  }, [parentTerritory.boundary, parentTerritory.color, updateSource]);
  const parentLongitude = parentTerritory.center?.[0] ?? 0;
  const parentLatitude = parentTerritory.center?.[1] ?? 0;
  useEffect(() => {
    mapRef.current?.jumpTo({ center: [parentLongitude, parentLatitude], zoom: parentTerritory.zoom });
  }, [parentLatitude, parentLongitude, parentTerritory.zoom]);
  useEffect(() => updateSource("plan-targets", targetFeatures(targets, selectedTargetId)), [selectedTargetId, targets, updateSource]);
  useEffect(() => updateSource("plan-draft", draftFeatures(points)), [points, updateSource]);
  useEffect(() => { const display = streetDisplayCollection(streets, parentTerritory.boundary); updateSource("plan-streets", { ...display, features: display.features.map((feature) => ({ ...feature, properties: { ...feature.properties, chosen: streetIds.has(String(feature.properties?.id)) } })) }); }, [parentTerritory.boundary, streetIds, streets, updateSource]);
  useEffect(() => updateSource("plan-parcels", planningParcelDisplayCollection(displayedParcels, parcelIds, claimedParcelIds, visitedParcelKeys, readOnly)), [claimedParcelIds, displayedParcels, parcelIds, readOnly, updateSource, visitedParcelKeys]);
  useEffect(() => updateSource("plan-locations", locationPoints), [locationPoints, updateSource]);

  const duplicateStreet = useMemo(() => targets.some((target) => target.streetSelection?.segmentIds.some((id) => streetIds.has(id))), [streetIds, targets]);
  const overlapsArea = useMemo(() => points.length >= 3 && targets.some((target) => target.geometry.type === "Polygon" && polygonsOverlap(points, target.geometry.coordinates[0])), [points, targets]);
  const error = useMemo(() => draftKind === "streets" && duplicateStreet ? "A selected street section is already in another target."
    : points.length > 0 && draftKind === "rectangle" && !rectangleHasArea(points) ? "Clear the rectangle and press-drag diagonally to draw it again."
      : points.length > 0 && draftKind === "polygon" && points.length < 3 ? "Add at least three corners."
        : points.length >= 3 && polygonSelfIntersects(points) ? "This boundary crosses itself."
          : points.length >= 3 && !polygonInsideBoundary(points, parentTerritory.boundary) ? "Keep every corner inside the parent zone."
            : overlapsArea ? "This target overlaps another nightly target." : "", [draftKind, duplicateStreet, overlapsArea, parentTerritory.boundary, points]);
  const suggestions = useMemo(() => streetIds.size ? streetsWithinMeters([...streetIds][0], streets.features.flatMap((feature) => streetSegmentLines(feature).map((geometry) => ({ id: feature.properties.id, name: feature.properties.name, geometry }))), 100).filter((id) => !streetIds.has(id)).slice(0, 8) : [], [streetIds, streets.features]);
  const hasCurrentSelection = points.length > 0 || streetIds.size > 0 || parcelOverrides.size > 0;
  const clearSelection = () => {
    suppressMapClick.current = false;
    rectangleStart.current = null; rectanglePointerStart.current = null; dragVertex.current = null;
    setPoints([]); setStreetIds(new Set()); setParcelOverrides(new Map()); setOverlapNotice(undefined);
  };
  const addTarget = () => {
    if (!draftKind || !planningComplete) return;
    let geometry: WalkTargetGeometry; let selectionKind: WalkTargetInput["selectionKind"];
    if (draftKind === "streets") { const chosen = streets.features.filter((feature) => streetIds.has(feature.properties.id)); if (!chosen.length) return; geometry = { type: "MultiLineString", coordinates: chosen.flatMap(streetSegmentLines).map((line) => line.coordinates.map((position) => [position[0], position[1]] as Coordinates)) }; selectionKind = "streets"; }
    else { if (!drawingBoundaryReady(points, draftKind) || error) return; geometry = polygon(points); selectionKind = draftKind; }
    if (!parcelIds.size) return;
    const clientId = `draft-${crypto.randomUUID()}`; const color = TARGET_COLORS[targets.length % TARGET_COLORS.length];
    const chosenStreets = streets.features.filter((feature) => streetIds.has(feature.properties.id));
    const target: WalkTargetDraft = { clientId, eventId, territoryId: parentTerritory.id, name: selectionKind === "streets" ? chosenStreets[0]?.properties.name ?? `Street target ${targets.length + 1}` : `Area ${targets.length + 1}`, color, selectionKind, geometry,
      streetSelection: selectionKind === "streets" ? { side: "both", corridorMeters: STREET_PARCEL_CORRIDOR_METERS, source: OVERTURE_TRANSPORTATION_SOURCE, sourceRevision: streets.metadata?.release ?? "unknown", segmentIds: [...streetIds], streetNames: [...new Set(chosenStreets.flatMap((feature) => feature.properties.name ? [feature.properties.name] : []))] } : undefined,
      parcels: planningParcelRoster(parcelIds, automaticParcelIds, eligibleParcels, parcelRevision, selectionKind === "streets" ? "street_auto" : "polygon_auto") };
    onChange([...targets, target]); onSelectedTargetChange(clientId); setPoints([]); setStreetIds(new Set()); setParcelOverrides(new Map()); setOverlapNotice(undefined); setDraftKind(undefined); setMode("select");
  };
  const addWhole = () => { if (!planningComplete) return; const ids = new Set(eligibleParcels.features.map((feature) => `${feature.properties.countyFips}:${feature.properties.gislink}`)); if (!ids.size) return; const clientId = `draft-${crypto.randomUUID()}`; onChange([...targets, { clientId, eventId, territoryId: parentTerritory.id, name: parentTerritory.name, color: TARGET_COLORS[targets.length % TARGET_COLORS.length], selectionKind: "whole_zone", geometry: polygon(parentTerritory.boundary), parcels: planningParcelRoster(ids, ids, eligibleParcels, parcelRevision, "polygon_auto") }]); onSelectedTargetChange(clientId); };

  return <section className="walk-target-planner" aria-label={`Plan targets inside ${parentTerritory.name}`}>
    <div className="walk-target-tools" role="toolbar" aria-label="Target drawing tools">
      <MapDrawingModeControl value={draftKind === "rectangle" || draftKind === "polygon" ? draftKind : undefined} disabled={readOnly || !planningComplete || targets.some((target) => target.selectionKind === "whole_zone")} onChange={(drawingMode) => { if (drawingMode === draftKind) return; suppressMapClick.current = false; setDraftKind(drawingMode); setMode(drawingMode); setPoints([]); setStreetIds(new Set()); setParcelOverrides(new Map()); setOverlapNotice(undefined); }} />
      <button type="button" className={draftKind === "streets" ? "active" : ""} disabled={readOnly || !streetInspectable || targets.some((target) => target.selectionKind === "whole_zone")} onClick={() => { if (draftKind === "streets") return; suppressMapClick.current = false; setDraftKind("streets"); setMode("streets"); setPoints([]); setParcelOverrides(new Map()); setOverlapNotice(undefined); }}><Waypoints size={16}/> Streets</button>
      <button type="button" disabled={readOnly || !planningComplete || targets.length > 0} onClick={addWhole}>Whole zone</button>
    </div>
    <div className={`walk-target-map-wrap${mode === "polygon" || mode === "rectangle" ? " map-drawing-active" : ""}`}><div ref={container} className="walk-target-map" role="application" aria-label="Interactive target map"/>{status !== "ready" && <div className={`walk-target-state ${status}`}>{status === "loading" ? <LoaderCircle className="spin"/> : <AlertTriangle/>}<span>{status === "loading" ? "Loading planning map…" : "Map unavailable. Try again or draw the parent zone later."}</span></div>}{overlapNotice && <div key={overlapNotice.id} className="walk-target-map-toast" role="status"><AlertTriangle size={16} aria-hidden="true"/>{overlapNotice.message}</div>}</div>
    {locationOutcomes.length > 0 && <div className="walk-target-outcome-key" role="group" aria-label="Visit outcome map key"><strong>Map dots</strong><ul>{locationOutcomes.map((outcome) => <li key={outcome}><i style={{ background: outcomeMeta[outcome].color }} /><span>{outcomeMeta[outcome].short}</span></li>)}</ul></div>}
    {!readOnly && <div className="walk-target-options" aria-live="polite">
      <span>{planningLayerSummary("Streets", currentStreetLayer, streets.features.length, "section")}</span>
      <span>{planningLayerSummary("Parcels", currentParcelLayer, eligibleParcels.features.length, "residential parcel")}</span>
      {visitedParcelCount > 0 && <span>Previously visited: {visitedParcelCount} green {visitedParcelCount === 1 ? "parcel" : "parcels"}</span>}
      {retryAvailable && <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Retry</button>}
    </div>}
    {mode === "polygon" && <p className="walk-target-instruction">{drawingInstruction("polygon", points)} Undo removes the last corner.</p>}
    {mode === "rectangle" && <p className="walk-target-instruction">{drawingInstruction("rectangle", points)} Clear it before drawing a replacement.</p>}
    {draftKind === "streets" && <div className="walk-target-options"><label><input type="checkbox" checked={connected} onChange={(event) => setConnected(event.target.checked)}/> Also select connected sections of the same named road</label></div>}
    {draftKind === "streets" && streetIds.size > 0 && <p className="walk-target-instruction" aria-live="polite">
      {parcelIds.size} residential {parcelIds.size === 1 ? "parcel" : "parcels"} selected. Tap a parcel to add or remove it.
    </p>}
    {excludedParcelCount > 0 && <p className="walk-target-feedback" role="status">{excludedParcelCount} {excludedParcelCount === 1 ? "parcel is" : "parcels are"} already in another target and {excludedParcelCount === 1 ? "was" : "were"} left out.</p>}
    {suggestions.length > 0 && <div className="walk-target-suggestions"><span>Within 100 m:</span>{suggestions.map((id) => <button type="button" key={id} onClick={() => setStreetIds((ids) => new Set([...ids, id]))}>{streets.features.find((feature) => feature.properties.id === id)?.properties.name ?? "Unnamed section"}</button>)}</div>}
    {(error || inventoryMessage) && <p className="walk-target-feedback" role="alert">{error || inventoryMessage}</p>}
    {mode !== "select" && <div className="walk-target-edit-actions">{draftKind === "polygon" && <button type="button" disabled={!points.length} onClick={() => setPoints((current) => undoDrawingPoint(current, "polygon"))}><Undo2 size={15}/> Undo</button>}<button type="button" disabled={!hasCurrentSelection} onClick={clearSelection}><X size={15}/> Clear selection</button><button type="button" disabled={!suggestions.length} onClick={() => suggestions.forEach((id) => setStreetIds((current) => new Set([...current, id])))}><Redo2 size={15}/> Add suggestions</button><button type="button" className="button primary" disabled={Boolean(error) || !planningComplete || !parcelIds.size || (draftKind === "streets" ? !streetIds.size : !draftKind || !drawingBoundaryReady(points, draftKind))} onClick={addTarget}><Check size={15}/> Add target</button></div>}
    <ul className="walk-target-list">{targets.map((target) => {
      const persisted = Boolean(target.id);
      return <li key={target.clientId} className={target.clientId === selectedTargetId ? "selected" : ""}><button type="button" onClick={() => onSelectedTargetChange(target.clientId)}><i style={{ background: target.color }}/><span><strong>{target.name}</strong><small>{target.selectionKind.replace("_", " ")} · {target.parcels.length} parcels</small></span></button>{!readOnly && <button type="button" aria-label={`Remove ${target.name}`} disabled={persisted} title={persisted ? "Saved targets cannot be removed here." : undefined} onClick={() => { onChange(targets.filter((item) => item.clientId !== target.clientId)); if (selectedTargetId === target.clientId) onSelectedTargetChange(undefined); }}>Remove</button>}</li>;
    })}</ul>
    {!readOnly && targets.some((target) => target.id) && <p className="walk-target-feedback">Saved targets cannot be removed here. Cancel or replace them from the walk detail.</p>}
    {streets.metadata && <small className="walk-target-attribution">{streets.metadata.attribution} · source {streets.metadata.release}{streets.metadata.truncated ? " · incomplete result" : ""}</small>}
  </section>;
}
