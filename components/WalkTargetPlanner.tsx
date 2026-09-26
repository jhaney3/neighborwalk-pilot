"use client";

import { AlertTriangle, Check, ChevronRight, LoaderCircle, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import type { Coordinates, Territory } from "../lib/domain";
import { drawingBoundaryReady, drawingGestureIntent, drawingInstruction, moveDrawingCorner, rectangleBoundary, rectangleHasArea, undoDrawingPoint, type MapDrawingMode } from "../lib/map-drawing";
import { MAPLIBRE_WORKER_URL } from "../lib/map-worker";
import { cornerPlaced, selectionTick } from "../mobile/haptics";
import type { ParcelFeatureCollection } from "../lib/parcels";
import { clipLineToBoundary, closeRing, mapLineOffsetForSide, polygonInsideBoundary, polygonSelfIntersects, polygonsOverlap, streetSidePolygons } from "../lib/planning-geometry";
import { EMPTY_PLANNING_PARCELS, EMPTY_STREETS, loadPlanningLayers, loadingPlanningParcelLayer, loadingPlanningStreetLayer, planningLayerMatchesIdentity, type PlanningParcelLayer, type PlanningStreetLayer } from "../lib/planning-loader";
import { OVERTURE_TRANSPORTATION_SOURCE, streetSegmentDisplayLines, streetSegmentLines, type StreetSegmentCollection } from "../lib/street-segments";
import { applyParcelSelectionOverrides, parcelInsideZone, planningDatasetIdentity, planningParcelDisplayCollection, planningParcelRoster, polygonParcelKeys, snapshotParcelFeatureCollection, STREET_PARCEL_CORRIDOR_METERS, streetParcelKeys, toggleParcelSelectionOverride } from "../lib/target-parcels";
import type { WalkTargetGeometry, WalkTargetInput } from "../lib/walk-targets";
import { compactToastMessage } from "../lib/toasts";
import { randomUuid } from "../lib/platform";
import { coveredStreetIds } from "../lib/street-coverage";

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
  demo: boolean;
  readOnly?: boolean;
};

type Mode = "select" | "polygon" | "rectangle" | "streets";
type DraftKind = MapDrawingMode | "streets";
const TARGET_COLORS = ["#2d5a45", "#6b91ad", "#b98a3a", "#95598a", "#8a593e"];
const NEW_ROUTE = "new-route";

/** "Route A", "Route B"… the first letter no route uses yet. */
function nextRouteName(targets: WalkTargetDraft[]) {
  const used = new Set(targets.map((target) => target.name));
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!used.has(`Route ${letter}`)) return `Route ${letter}`;
  return `Route ${targets.length + 1}`;
}

function lineMiles(lines: { coordinates: number[][] }[]) {
  let meters = 0;
  for (const line of lines) for (let index = 1; index < line.coordinates.length; index += 1) {
    const [lng1, lat1] = line.coordinates[index - 1], [lng2, lat2] = line.coordinates[index];
    const dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    meters += 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return meters / 1609.34;
}

function shortStreetName(name: string) {
  return name.replace(/\b(Street|Avenue|Boulevard|Road|Drive|Lane|Court)\b$/, (word) => ({ Street: "St", Avenue: "Ave", Boulevard: "Blvd", Road: "Rd", Drive: "Dr", Lane: "Ln", Court: "Ct" })[word] ?? word);
}
const PLANNING_LOAD_TIMEOUT_MS = 20_000;
const EMPTY_PARCEL_KEYS = new Set<string>();

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

export function WalkTargetPlanner({ parentTerritory, eventId, targets, selectedTargetId, mapStyleUrl, onSelectedTargetChange, onChange, loadPlanningData, visitedParcelKeys = EMPTY_PARCEL_KEYS, demo, readOnly = false }: WalkTargetPlannerProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const stateRef = useRef({ mode: "select" as Mode, points: [] as Coordinates[], streets: EMPTY_STREETS, parcels: EMPTY_PLANNING_PARCELS,
    connected: false, streetIds: new Set<string>(), automaticParcelIds: new Set<string>(), parcelIds: new Set<string>(), claimedParcelIds: new Set<string>(), visitedParcelKeys, coveredStreets: new Set<string>(), targets, selectedTargetId, parentTerritory, readOnly });
  // The map's click handler reaches the latest tap handlers through these.
  const tapStreetRef = useRef<(streetId: string) => void>(() => undefined);
  const tapParcelRef = useRef<(parcelId: string) => void>(() => undefined);
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
  // Taps on streets go to the route being edited: an existing route, or a new one.
  const [editingId, setEditingId] = useState<string>(() => selectedTargetId ?? targets[0]?.clientId ?? NEW_ROUTE);
  const editing = targets.find((target) => target.clientId === editingId);
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
    ? "Some map data didn’t load. Try again to add routes."
    : "";
  const chosenStreetLines = useMemo(() => streets.features.filter((feature) => streetIds.has(feature.properties.id)).flatMap(streetSegmentLines), [streetIds, streets.features]);
  // The route being edited doesn't block its own homes.
  const claimedParcelIds = useMemo(() => new Set(targets.filter((target) => target.clientId !== editingId).flatMap((target) => target.parcels.map((parcel) => `${parcel.countyFips}:${parcel.gislink}`))), [editingId, targets]);
  const candidateAutomaticParcelIds = useMemo(() => {
    if (!currentParcelLayer.complete) return new Set<string>();
    if ((draftKind === "polygon" || draftKind === "rectangle") && points.length >= 3) return polygonParcelKeys(eligibleParcels, points);
    if (draftKind === "streets" && chosenStreetLines.length) return streetParcelKeys(eligibleParcels, chosenStreetLines, parentTerritory.boundary, STREET_PARCEL_CORRIDOR_METERS, "both");
    return new Set<string>();
  }, [chosenStreetLines, currentParcelLayer.complete, draftKind, eligibleParcels, parentTerritory.boundary, points]);
  const automaticParcelIds = useMemo(() => new Set([...candidateAutomaticParcelIds].filter((id) => !claimedParcelIds.has(id))), [candidateAutomaticParcelIds, claimedParcelIds]);
  const parcelIds = useMemo(() => new Set([...applyParcelSelectionOverrides(automaticParcelIds, parcelOverrides)].filter((id) => !claimedParcelIds.has(id))), [automaticParcelIds, claimedParcelIds, parcelOverrides]);

  useEffect(() => {
    if (!overlapNotice) return;
    const timeout = window.setTimeout(() => setOverlapNotice(undefined), 2_800);
    return () => window.clearTimeout(timeout);
  }, [overlapNotice]);

  // Streets already walked are drawn dashed, so leaders plan around what's left.
  const coveredStreets = useMemo(() => readOnly ? new Set<string>() : coveredStreetIds(streets, displayedParcels, visitedParcelKeys), [displayedParcels, readOnly, streets, visitedParcelKeys]);
  useEffect(() => { stateRef.current = { mode, points, streets, parcels: displayedParcels, connected, streetIds, automaticParcelIds, parcelIds, claimedParcelIds, visitedParcelKeys, coveredStreets, targets, selectedTargetId, parentTerritory, readOnly }; }, [automaticParcelIds, claimedParcelIds, connected, coveredStreets, displayedParcels, mode, parentTerritory, parcelIds, points, readOnly, selectedTargetId, streetIds, streets, targets, visitedParcelKeys]);
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
      const map = new maplibre.Map({ container: container.current, style: mapStyleUrl, center: parentTerritory.center, zoom: parentTerritory.zoom, cooperativeGestures: true, attributionControl: { compact: true } });
      mapRef.current = map;
      const configure = () => {
        const addSource = (id: string) => { if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: collection([]) }); };
        ["plan-parent", "plan-targets", "plan-draft", "plan-streets", "plan-parcels"].forEach(addSource);
        const add = (layer: Parameters<MapLibreMap["addLayer"]>[0]) => { if (!map.getLayer(layer.id)) map.addLayer(layer); };
        add({ id: "plan-parent-fill", type: "fill", source: "plan-parent", paint: { "fill-color": ["get", "color"], "fill-opacity": .06 } });
        add({ id: "plan-parent-line", type: "line", source: "plan-parent", paint: { "line-color": ["get", "color"], "line-width": 3 } });
        add({ id: "plan-parcels-fill", type: "fill", source: "plan-parcels", paint: { "fill-color": ["case", ["==", ["get", "chosen"], true], "#2d5a45", ["==", ["get", "previouslyVisited"], true], "#286c59", ["==", ["get", "claimed"], true], "#6f7773", "#315c50"], "fill-opacity": ["case", ["==", ["get", "chosen"], true], .1, ["==", ["get", "previouslyVisited"], true], .28, ["==", ["get", "claimed"], true], .12, .04] } });
        add({ id: "plan-parcels-line", type: "line", source: "plan-parcels", paint: { "line-color": ["case", ["==", ["get", "previouslyVisited"], true], "#174d3f", "#56776c"], "line-width": ["case", ["==", ["get", "previouslyVisited"], true], 2.25, 1] } });
        add({ id: "plan-streets-hit", type: "line", source: "plan-streets", paint: { "line-color": "#000", "line-opacity": .01, "line-width": 18 } });
        add({ id: "plan-streets-line", type: "line", source: "plan-streets", filter: ["any", ["==", ["get", "chosen"], true], ["!=", ["get", "covered"], true]], paint: { "line-color": ["case", ["==", ["get", "chosen"], true], ["coalesce", ["get", "chosenColor"], "#2d5a45"], "#53796d"], "line-width": ["case", ["==", ["get", "chosen"], true], 8, 2], "line-opacity": ["case", ["==", ["get", "chosen"], true], 1, .45] } });
        add({ id: "plan-streets-covered", type: "line", source: "plan-streets", filter: ["all", ["!=", ["get", "chosen"], true], ["==", ["get", "covered"], true]], paint: { "line-color": "#8b918a", "line-width": 3, "line-opacity": .95, "line-dasharray": [1.4, 1.2] } });
        add({ id: "plan-target-fill", type: "fill", source: "plan-targets", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "selected"], .3, .12] } });
        add({ id: "plan-target-line", type: "line", source: "plan-targets", filter: ["!=", ["get", "displayKind"], "side-fill"], paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "selected"], 8, 6], "line-opacity": ["case", ["get", "selected"], 1, .45], "line-offset": ["case", ["==", ["get", "side"], "left"], mapLineOffsetForSide("left"), ["==", ["get", "side"], "right"], mapLineOffsetForSide("right"), 0] } });
        add({ id: "plan-draft-fill", type: "fill", source: "plan-draft", paint: { "fill-color": "#e9a84a", "fill-opacity": .22 } });
        add({ id: "plan-draft-line", type: "line", source: "plan-draft", paint: { "line-color": "#9c6411", "line-width": 3 } });
        add({ id: "plan-draft-point-hit", type: "circle", source: "plan-draft", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 18, "circle-color": "#9c6411", "circle-opacity": .01 } });
        add({ id: "plan-draft-points", type: "circle", source: "plan-draft", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 8, "circle-color": "#fff", "circle-stroke-color": "#9c6411", "circle-stroke-width": 3 } });
        const current = stateRef.current;
        const displayStreets = streetDisplayCollection(current.streets, current.parentTerritory.boundary);
        updateSource("plan-parent", collection([{ type: "Feature", properties: { color: current.parentTerritory.color }, geometry: polygon(current.parentTerritory.boundary) }]));
        updateSource("plan-targets", targetFeatures(current.targets, current.selectedTargetId));
        updateSource("plan-draft", draftFeatures(current.points));
        updateSource("plan-streets", { ...displayStreets, features: displayStreets.features.map((feature) => ({ ...feature, properties: { ...feature.properties, chosen: current.streetIds.has(String(feature.properties?.id)), covered: current.coveredStreets.has(String(feature.properties?.id)) } })) });
        updateSource("plan-parcels", planningParcelDisplayCollection(current.parcels, current.parcelIds, current.claimedParcelIds, current.visitedParcelKeys, current.readOnly));
        setStatus("ready");
      };
      map.on("style.load", configure);
      let styleReady = false;
      map.once("load", () => {
        styleReady = true;
        // Keep the map credits behind their info button.
        const attribution = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
        attribution?.classList.remove("maplibregl-compact-show");
        attribution?.removeAttribute("open");
      });
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
          selectionTick();
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
      const finishDrawingGesture = () => { if (pointerMoved.current && (rectangleStart.current || dragVertex.current !== null)) { cornerPlaced(); suppressMapClick.current = true; window.setTimeout(() => { suppressMapClick.current = false; }, 350); } rectangleStart.current = null; rectanglePointerStart.current = null; dragVertex.current = null; map.dragPan.enable(); };
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
        if (current.mode === "polygon") { cornerPlaced(); setPoints((value) => [...value, [event.lngLat.lng, event.lngLat.lat]]); return; }
        if (current.mode === "rectangle") return;
        if (current.mode === "streets") {
          const street = map.queryRenderedFeatures(event.point, { layers: ["plan-streets-hit"] })[0];
          const streetId = String(street?.properties?.id ?? "");
          if (streetId) { tapStreetRef.current(streetId); return; }
          const hit = map.queryRenderedFeatures(event.point, { layers: ["plan-parcels-fill"] })[0]; const props = hit?.properties; if (!props || !current.streetIds.size) return;
          const countyFips = String(Reflect.get(props, "countyFips") ?? ""); const gislink = String(Reflect.get(props, "gislink") ?? "");
          const id = `${countyFips}:${gislink}`;
          if (current.claimedParcelIds.has(id)) { setOverlapNotice({ id: Date.now(), message: "Already included" }); return; }
          setOverlapNotice(undefined);
          tapParcelRef.current(id);
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
  // The route being edited by streets draws from the live selection, not its saved line.
  useEffect(() => updateSource("plan-targets", targetFeatures(targets.filter((target) => !(target.clientId === editingId && draftKind === "streets")), editingId)), [draftKind, editingId, targets, updateSource]);
  useEffect(() => updateSource("plan-draft", draftFeatures(points)), [points, updateSource]);
  const editingColor = editing?.color ?? TARGET_COLORS[targets.length % TARGET_COLORS.length];
  useEffect(() => { const display = streetDisplayCollection(streets, parentTerritory.boundary); updateSource("plan-streets", { ...display, features: display.features.map((feature) => ({ ...feature, properties: { ...feature.properties, chosen: streetIds.has(String(feature.properties?.id)), chosenColor: editingColor, covered: coveredStreets.has(String(feature.properties?.id)) } })) }); }, [coveredStreets, editingColor, parentTerritory.boundary, streetIds, streets, updateSource]);
  useEffect(() => updateSource("plan-parcels", planningParcelDisplayCollection(displayedParcels, parcelIds, claimedParcelIds, visitedParcelKeys, readOnly)), [claimedParcelIds, displayedParcels, parcelIds, readOnly, updateSource, visitedParcelKeys]);

  /** Save the route being edited from a set of streets: every tap updates it. */
  const commitStreets = (nextIds: Set<string>, overrides = parcelOverrides) => {
    if (readOnly || !planningComplete) return;
    const chosen = streets.features.filter((feature) => nextIds.has(feature.properties.id));
    if (!chosen.length) {
      if (editing) { onChange(targets.filter((target) => target.clientId !== editing.clientId)); setEditingId(NEW_ROUTE); onSelectedTargetChange(undefined); }
      return;
    }
    const lines = chosen.flatMap(streetSegmentLines);
    const automatic = new Set([...streetParcelKeys(eligibleParcels, lines, parentTerritory.boundary, STREET_PARCEL_CORRIDOR_METERS, "both")].filter((id) => !claimedParcelIds.has(id)));
    const ids = new Set([...applyParcelSelectionOverrides(automatic, overrides)].filter((id) => !claimedParcelIds.has(id)));
    const base = editing ?? { clientId: `draft-${randomUuid()}`, eventId, territoryId: parentTerritory.id, name: nextRouteName(targets), color: TARGET_COLORS[targets.length % TARGET_COLORS.length] };
    const target: WalkTargetDraft = { ...base, selectionKind: "streets",
      geometry: { type: "MultiLineString", coordinates: lines.map((line) => line.coordinates.map((position) => [position[0], position[1]] as Coordinates)) },
      streetSelection: { side: "both", corridorMeters: STREET_PARCEL_CORRIDOR_METERS, source: OVERTURE_TRANSPORTATION_SOURCE, sourceRevision: streets.metadata?.release ?? "unknown", segmentIds: [...nextIds], streetNames: [...new Set(chosen.flatMap((feature) => feature.properties.name ? [feature.properties.name] : []))] },
      parcels: planningParcelRoster(ids, automatic, eligibleParcels, parcelRevision, "street_auto") };
    onChange(editing ? targets.map((item) => item.clientId === editing.clientId ? target : item) : [...targets, target]);
    if (!editing) { setEditingId(target.clientId); onSelectedTargetChange(target.clientId); }
  };
  const tapStreet = (streetId: string) => {
    const owner = targets.find((target) => target.clientId !== editingId && target.streetSelection?.segmentIds.includes(streetId));
    if (owner) { setOverlapNotice({ id: Date.now(), message: `That street is on ${owner.name}` }); return; }
    const next = new Set(streetIds);
    if (next.has(streetId)) next.delete(streetId); else next.add(streetId);
    setStreetIds(next);
    commitStreets(next);
  };
  const tapParcel = (id: string) => {
    const overrides = toggleParcelSelectionOverride(parcelOverrides, id, automaticParcelIds);
    setParcelOverrides(overrides);
    commitStreets(streetIds, overrides);
  };
  useEffect(() => { tapStreetRef.current = tapStreet; tapParcelRef.current = tapParcel; });
  const beginEditing = (id: string) => {
    const target = targets.find((item) => item.clientId === id);
    setEditingId(id); onSelectedTargetChange(target?.clientId);
    suppressMapClick.current = false; setPoints([]); setParcelOverrides(new Map()); setOverlapNotice(undefined);
    setDraftKind("streets"); setMode("streets"); setStreetIds(new Set(target?.streetSelection?.segmentIds ?? []));
  };
  const drawArea = () => { suppressMapClick.current = false; setDraftKind("polygon"); setMode("polygon"); setPoints([]); setStreetIds(new Set()); setParcelOverrides(new Map()); setOverlapNotice(undefined); };
  // Start on streets once the neighborhood's streets load.
  const [startedFor, setStartedFor] = useState("");
  if (!readOnly && streetInspectable && startedFor !== planningIdentity) {
    setStartedFor(planningIdentity);
    const target = targets.find((item) => item.clientId === editingId);
    setDraftKind(target && target.selectionKind !== "streets" ? undefined : "streets");
    setMode(target && target.selectionKind !== "streets" ? "select" : "streets");
    setStreetIds(new Set(target?.streetSelection?.segmentIds ?? []));
  }

  const duplicateStreet = useMemo(() => targets.some((target) => target.clientId !== editingId && target.streetSelection?.segmentIds.some((id) => streetIds.has(id))), [editingId, streetIds, targets]);
  const overlapsArea = useMemo(() => points.length >= 3 && targets.some((target) => target.clientId !== editingId && target.geometry.type === "Polygon" && polygonsOverlap(points, target.geometry.coordinates[0])), [editingId, points, targets]);
  const error = useMemo(() => draftKind === "streets" && duplicateStreet ? "That street is already on another route."
    : points.length > 0 && draftKind === "rectangle" && !rectangleHasArea(points) ? "Clear the rectangle and press-drag diagonally to draw it again."
      : points.length > 0 && draftKind === "polygon" && points.length < 3 ? "Add at least three corners."
        : points.length >= 3 && polygonSelfIntersects(points) ? "This boundary crosses itself."
          : points.length >= 3 && !polygonInsideBoundary(points, parentTerritory.boundary) ? "Keep every corner inside the neighborhood."
            : overlapsArea ? "This overlaps another route." : "", [draftKind, duplicateStreet, overlapsArea, parentTerritory.boundary, points]);


  const commitArea = () => {
    if (!planningComplete || (draftKind !== "polygon" && draftKind !== "rectangle") || !drawingBoundaryReady(points, draftKind) || error || !parcelIds.size) return;
    const base = editing ?? { clientId: `draft-${randomUuid()}`, eventId, territoryId: parentTerritory.id, name: nextRouteName(targets), color: TARGET_COLORS[targets.length % TARGET_COLORS.length] };
    const target: WalkTargetDraft = { ...base, selectionKind: draftKind, geometry: polygon(points), streetSelection: undefined, parcels: planningParcelRoster(parcelIds, automaticParcelIds, eligibleParcels, parcelRevision, "polygon_auto") };
    onChange(editing ? targets.map((item) => item.clientId === editing.clientId ? target : item) : [...targets, target]);
    setEditingId(target.clientId); onSelectedTargetChange(target.clientId);
    setPoints([]); setParcelOverrides(new Map()); setDraftKind(undefined); setMode("select");
  };

  const editingName = editing?.name ?? nextRouteName(targets);
  const routeLine = (target: WalkTargetDraft) => {
    if (target.selectionKind === "streets" && target.streetSelection) {
      const lines = streets.features.filter((feature) => target.streetSelection!.segmentIds.includes(feature.properties.id)).flatMap(streetSegmentLines);
      const miles = lineMiles(lines.length ? lines : target.geometry.type === "MultiLineString" ? target.geometry.coordinates.map((coordinates) => ({ coordinates })) : []);
      return `${target.streetSelection.streetNames.map(shortStreetName).join(", ") || "Streets"} · ${miles.toFixed(1)} mi`;
    }
    return `${target.selectionKind === "whole_zone" ? "Whole neighborhood" : "An area"} · ${target.parcels.length} ${target.parcels.length === 1 ? "home" : "homes"}`;
  };
  const areaMode = mode === "polygon" || mode === "rectangle";

  return <section className="walk-target-planner routes-layout" aria-label={`Routes in ${parentTerritory.name}`}>
    {!readOnly && <div className="route-chips" role="group" aria-label="Routes">
      {targets.map((target) => <button type="button" key={target.clientId} aria-pressed={target.clientId === editingId} style={target.clientId === editingId ? { background: target.color, borderColor: target.color } : undefined} onClick={() => beginEditing(target.clientId)}>{target.name}</button>)}
      {editingId === NEW_ROUTE && <button type="button" aria-pressed="true" style={{ background: editingColor, borderColor: editingColor }}>{editingName}</button>}
      {editingId !== NEW_ROUTE && <button type="button" onClick={() => beginEditing(NEW_ROUTE)}>+ Route</button>}
    </div>}
    <div className={`walk-target-map-wrap${areaMode ? " map-drawing-active" : ""}`}><div ref={container} className="walk-target-map" role="application" aria-label="Route map"/>{status !== "ready" && <div className={`walk-target-state ${status}`}>{status === "loading" ? <LoaderCircle className="spin"/> : <AlertTriangle/>}<span>{status === "loading" ? "Loading the map…" : "The map didn’t load. Try again."}</span></div>}{overlapNotice && <div key={overlapNotice.id} className="walk-target-map-toast" role="status"><AlertTriangle size={16} aria-hidden="true"/>{compactToastMessage(overlapNotice.message)}</div>}</div>
    {!readOnly && (areaMode
      ? <p className="mono-meta route-hint" aria-live="polite">{drawingInstruction("polygon", points)}</p>
      : <p className="mono-meta route-hint" aria-live="polite">Tap streets to add them to {editingName} · dashed = walked recently</p>)}
    {(error || inventoryMessage) && <p className="walk-target-feedback" role="alert">{error || inventoryMessage}{retryAvailable && <> <button type="button" className="text-button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button></>}</p>}
    {areaMode && !readOnly && <div className="sheet-actions route-area-actions"><button type="button" className="walk-save quiet" disabled={!points.length} onClick={() => setPoints((current) => undoDrawingPoint(current, "polygon"))}><Undo2 size={16} aria-hidden="true" /> Undo</button><button type="button" className="walk-save" disabled={Boolean(error) || !planningComplete || !parcelIds.size || !drawingBoundaryReady(points, "polygon")} onClick={commitArea}><Check size={16} aria-hidden="true" /> Use this area</button></div>}
    {targets.length > 0 && <div className="grouped-rows route-rows">{targets.map((target) => {
      const current = target.clientId === editingId;
      return <button type="button" key={target.clientId} className="grouped-row" aria-current={current || undefined} onClick={() => !readOnly && beginEditing(target.clientId)}>
        <i className="color-bar" style={{ background: target.color }} aria-hidden="true" />
        <span className="grouped-row-text"><strong>{target.name}</strong><small>{routeLine(target)}</small></span>
        {current && !readOnly ? <span className="mono-meta hedge">Editing</span> : <ChevronRight size={17} aria-hidden="true" />}
      </button>;
    })}</div>}
    {!readOnly && (areaMode
      ? <button type="button" className="mono-meta hedge route-switch" onClick={() => beginEditing(editingId)}>Tap streets instead ›</button>
      : <button type="button" className="mono-meta hedge route-switch" disabled={!planningComplete} onClick={drawArea}>Draw an area instead ›</button>)}
    {!readOnly && targets.some((target) => target.id) && <p className="walk-target-feedback">Saved routes can’t be removed here. Change them from the walk page.</p>}
    {streets.metadata && <small className="walk-target-attribution">{streets.metadata.attribution}</small>}
  </section>;
}
