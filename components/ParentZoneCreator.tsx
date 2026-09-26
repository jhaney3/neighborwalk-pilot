"use client";
import { Check, ChevronLeft, MapPinned, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { centerForBoundary, type Coordinates, type Outcome, type Territory } from "../lib/domain";
import { drawingBoundaryReady, undoDrawingPoint, type MapDrawingMode } from "../lib/map-drawing";
import { polygonSelfIntersects } from "../lib/planning-geometry";
import { useAsyncAction } from "../lib/use-async-action";
import type { MapViewport } from "../lib/parcels";
import { usePlanningParcelsInView } from "../lib/use-planning-parcels-in-view";
import { MapCanvas } from "./MapCanvas";

export type NewParentZoneInput = {
  name: string;
  boundary: Coordinates[];
  center: Coordinates;
  color: string;
  kind?: "map";
};

type Props = {
  churchId: string;
  mapStyleUrl: string;
  baseTerritory?: Territory;
  demo?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddZone: (input: NewParentZoneInput) => Promise<string>;
  onCreated: (territory: Territory) => void;
};

const SUPPORTED_COUNTIES_OVERVIEW: Territory = {
  id: "supported-counties-overview",
  churchId: "",
  name: "Giles, Lawrence, Lewis and Wayne counties",
  kind: "map",
  color: "#286c59",
  center: [-87.43, 35.35],
  zoom: 8.4,
  boundary: [[-88.18, 34.96], [-86.73, 34.96], [-86.73, 35.74], [-88.18, 35.74]],
};
const NO_OUTCOMES = new Set<Outcome>();

export function ParentZoneCreator({ churchId, mapStyleUrl, baseTerritory, demo = false, open, onOpenChange, onAddZone, onCreated }: Props) {
  const [phase, setPhase] = useState<"draw" | "details">("draw");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#286c59");
  const [drawShape, setDrawShape] = useState<MapDrawingMode>("rectangle");
  const [boundary, setBoundary] = useState<Coordinates[]>([]);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const wasOpen = useRef(false);
  const stageHeadingId = useId();
  const inventory = usePlanningParcelsInView(open ? viewport : null, demo);
  const action = useAsyncAction();
  const mapTerritory = baseTerritory ?? { ...SUPPORTED_COUNTIES_OVERVIEW, churchId };
  const distinctCorners = new Set(boundary.map(([longitude, latitude]) => `${longitude.toFixed(7)}:${latitude.toFixed(7)}`)).size;
  const boundaryCrossesItself = boundary.length >= 3 && polygonSelfIntersects(boundary);
  const boundaryReady = drawingBoundaryReady(boundary, drawShape) && !boundaryCrossesItself;
  const boundaryStatus = drawShape === "rectangle"
    ? boundaryReady ? "Rectangle ready" : "Drag across the map"
    : distinctCorners < 3 ? `${3 - distinctCorners} more distinct ${3 - distinctCorners === 1 ? "corner" : "corners"} needed` : boundaryCrossesItself ? "Boundary lines cannot cross" : `${distinctCorners} corners ready`;

  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => {
      if (open && window.matchMedia("(max-width: 620px)").matches) stageHeadingRef.current?.focus();
      if (!open && wasOpen.current) triggerRef.current?.focus();
      wasOpen.current = open;
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open, phase]);

  const resetDraft = () => {
    setPhase("draw");
    setName("");
    setColor("#286c59");
    setDrawShape("rectangle");
    setBoundary([]);
    setViewport(null);
    action.clearError();
  };
  const begin = () => {
    resetDraft();
    onOpenChange(true);
  };
  const cancel = () => {
    if (action.busy) return;
    resetDraft();
    onOpenChange(false);
  };

  if (!open) {
    return <button ref={triggerRef} type="button" className="button quiet walk-create-zone-button" onClick={begin}><MapPinned size={16} /> New neighborhood</button>;
  }

  const save = () => {
    if (name.trim().length < 3 || !boundaryReady) return;
    void action.save(async () => {
      const center = centerForBoundary(boundary);
      const id = await onAddZone({ name: name.trim(), boundary, center, color, kind: "map" });
      onCreated({ id, churchId, name: name.trim(), boundary, center, color, kind: "map", zoom: 15.5 });
      resetDraft();
      onOpenChange(false);
    });
  };

  return <section className={`walk-parent-zone-creator stage-${phase}`} aria-label="New neighborhood" aria-busy={action.busy}>
    <header className="walk-parent-zone-mobile-bar">
      <h3 id={stageHeadingId} ref={stageHeadingRef} tabIndex={-1}>{phase === "draw" ? "Draw it" : "Name it"}</h3>
      <button type="button" className="button quiet" disabled={action.busy} onClick={cancel}>Cancel</button>
    </header>
    <p className="sr-only" role="status" aria-live="polite">{phase === "draw" ? "Drawing stage. Draw a rectangle or polygon on the map." : "Name the neighborhood and choose its color."}</p>
    <div className="walk-parent-zone-heading"><div><strong>Draw a neighborhood</strong><small>Use a rectangle for a simple block, or a polygon for any shape. You can reuse it for later walks.</small></div><button type="button" className="button quiet small" disabled={action.busy} onClick={cancel}>Close</button></div>
    <div className="walk-parent-zone-map">
      <MapCanvas
        territory={mapTerritory}
        properties={[]}
        selectedPropertyId={null}
        visibleOutcomes={NO_OUTCOMES}
        searchTarget={null}
        addMode={false}
        drawMode={phase === "draw"}
        drawShape={drawShape}
        drawModeLabel="New neighborhood"
        draftBoundary={boundary}
        compactMarkers
        mapStyleUrl={mapStyleUrl}
        parcels={inventory.parcels}
        onSelectProperty={() => undefined}
        onAddIntent={() => undefined}
        onAssociatePropertiesWithParcel={() => undefined}
        onDrawShapeChange={setDrawShape}
        onDraftBoundaryChange={setBoundary}
        onViewportChange={setViewport}
      />
    </div>
    <div className="walk-parent-zone-draw-panel">
      <p className="walk-help" role="status" aria-live="polite">{inventory.message}</p>
      {inventory.failed && <button type="button" className="button quiet small" onClick={inventory.retry}>Retry parcel loading</button>}
      <div className="walk-parent-zone-tools">
        {drawShape === "polygon" && <button type="button" className="button quiet small" disabled={action.busy || boundary.length === 0} onClick={() => setBoundary((current) => undoDrawingPoint(current, drawShape))}><Undo2 size={15} /> Undo corner</button>}
        <button type="button" className="button quiet small" disabled={action.busy || boundary.length === 0} onClick={() => setBoundary([])}><RotateCcw size={15} /> Start over</button>
        <span>{boundaryStatus}</span>
      </div>
      {boundaryCrossesItself && <p className="walk-ready-note" role="alert">Undo the last corner so the lines don’t cross.</p>}
      <button type="button" className="button primary walk-parent-zone-review" disabled={action.busy || !boundaryReady} onClick={() => setPhase("details")}><Check size={16} /> Next</button>
    </div>
    <div className="walk-parent-zone-details-panel">
      <div className="walk-parent-zone-fields">
        <label>Neighborhood name<input value={name} required minLength={3} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Example: Oakwood North" /></label>
        <label>Map color<input className="territory-color-input" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
      </div>
      {action.error && <p className="inline-error" role="alert">{action.error}</p>}
      <div className="walk-parent-zone-details-actions">
        <button type="button" className="button quiet walk-parent-zone-back" disabled={action.busy} onClick={() => setPhase("draw")}><ChevronLeft size={16} /> Back</button>
        <button type="button" className="button primary" disabled={action.busy || name.trim().length < 3 || !boundaryReady} onClick={save}><Check size={16} /> {action.busy ? "Creating…" : "Create neighborhood"}</button>
      </div>
    </div>
  </section>;
}
