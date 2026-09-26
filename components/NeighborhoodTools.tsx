"use client";

import { Check, ChevronRight, Undo2, X } from "lucide-react";
import { useId, useState } from "react";
import { drawingBoundaryReady, undoDrawingPoint, type MapDrawingMode } from "../lib/map-drawing";
import { centerForBoundary, outcomeValues, type Coordinates, type NeighborWalkData, type Territory } from "../lib/domain";
import { MapCanvas } from "./MapCanvas";
import { neighborhoodPinLine } from "../lib/pin-counts";
import { useAsyncAction } from "../lib/use-async-action";
import { selectionTick } from "../mobile/haptics";
import { Sheet } from "./Sheet";
import { useConfirm } from "./ui";

export const neighborhoodColors = ["#2d5a45", "#6b91ad", "#b98a3a", "#95598a", "#8a593e", "#666f6b"];

/** Tap the capsule to switch neighborhoods. Editing lives in the ⋯ menu, so each
 * row is one tap; leaders get New neighborhood as the last row. */
export function NeighborhoodSheet({ data, activeId, canManage, onSelect, onNew, onClose }: {
  data: NeighborWalkData; activeId: string; canManage: boolean;
  onSelect: (territoryId: string) => void; onNew: () => void; onClose: () => void;
}) {
  const titleId = useId();
  const areas = data.territories.filter((territory) => territory.kind !== "list");
  return <Sheet className="plain-sheet" modal labelledBy={titleId} onDismiss={onClose}>
    <h2 className="pin-title" id={titleId}>Neighborhoods</h2>
    <div className="grouped-rows" role="radiogroup" aria-labelledby={titleId}>
      {areas.map((territory) => <button type="button" role="radio" aria-checked={territory.id === activeId} key={territory.id} className="grouped-row" onClick={() => onSelect(territory.id)}>
        <i className="color-bar" style={{ background: territory.color }} aria-hidden="true" />
        <span className="grouped-row-text"><strong>{territory.name}</strong><small>{neighborhoodPinLine(data, territory.id)}</small></span>
        {territory.id === activeId && <span className="check-dot" aria-hidden="true"><Check size={14} /></span>}
      </button>)}
      {canManage && <button type="button" className="grouped-row" onClick={onNew}>
        <i className="color-bar dashed" aria-hidden="true" />
        <span className="grouped-row-text"><strong>New neighborhood</strong><small>Draw it on the map</small></span>
        <ChevronRight size={17} aria-hidden="true" />
      </button>}
    </div>
  </Sheet>;
}

/** Full-screen drawing chrome over the map: ✕, the title, Undo, a hint, and a
 * sheet to switch between tapping corners and dragging a box. */
export function DrawChrome({ title, mode, points, onMode, onUndo, onCancel, onNext }: {
  title: string; mode: MapDrawingMode; points: Coordinates[];
  onMode: (mode: MapDrawingMode) => void; onUndo: () => void; onCancel: () => void; onNext: () => void;
}) {
  const ready = drawingBoundaryReady(points, mode);
  const hint = mode === "rectangle"
    ? ready ? "Drag a corner to adjust" : "Drag across the area"
    : points.length === 0 ? "Tap the first corner" : points.length < 3 ? `${points.length} ${points.length === 1 ? "corner" : "corners"} · keep going` : `${points.length} corners · tap the first to close`;
  return <>
    <div className="draw-top">
      <button type="button" className="round-button float" aria-label="Cancel drawing" onClick={onCancel}><X size={18} aria-hidden="true" /></button>
      <span className="capsule-title">{title}</span>
      <button type="button" className="round-button float" aria-label={mode === "rectangle" ? "Clear the box" : "Undo the last corner"} disabled={!points.length} onClick={onUndo}><Undo2 size={18} aria-hidden="true" /></button>
    </div>
    <p className="map-hint top" aria-live="polite">{hint}</p>
    <Sheet className="plain-sheet draw-sheet" label="Drawing options" onDismiss={onCancel}>
      <div className="segmented-control" role="group" aria-label="How to draw">
        <button type="button" aria-pressed={mode === "polygon"} onClick={() => { selectionTick(); onMode("polygon"); }}>Tap corners</button>
        <button type="button" aria-pressed={mode === "rectangle"} onClick={() => { selectionTick(); onMode("rectangle"); }}>Draw a box</button>
      </div>
      <button type="button" className="walk-save" disabled={!ready} onClick={onNext}>Next</button>
    </Sheet>
  </>;
}

function Swatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const choices = neighborhoodColors.includes(value.toLowerCase()) ? neighborhoodColors : [value, ...neighborhoodColors.slice(0, 5)];
  return <div className="swatches" role="radiogroup" aria-label="Color">
    {choices.map((color, index) => <button type="button" role="radio" key={color} aria-checked={color.toLowerCase() === value.toLowerCase()} aria-label={`Color ${index + 1}`} style={{ background: color }} onClick={() => { selectionTick(); onChange(color); }} />)}
  </div>;
}

/** Name and color, then save. The color is what its routes and capsule use. */
export function NameNeighborhood({ color, onColor, onSave, onBack }: { color: string; onColor: (color: string) => void; onSave: (name: string, color: string) => Promise<unknown>; onBack: () => void }) {
  const [name, setName] = useState("");
  const setColor = onColor;
  const action = useAsyncAction();
  const titleId = useId();
  return <Sheet className="plain-sheet" labelledBy={titleId} onDismiss={action.busy ? () => undefined : onBack}>
    <h2 className="pin-title" id={titleId}>Name it</h2>
    <label className="pin-field"><span className="mono-meta">Name</span><input value={name} maxLength={120} enterKeyHint="done" placeholder="Riverside" onChange={(event) => setName(event.target.value)} /></label>
    <div className="pin-field"><span className="mono-meta">Color</span><Swatches value={color} onChange={setColor} /></div>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy || name.trim().length < 3} onClick={() => void action.run(() => onSave(name.trim(), color))}>{action.busy ? "Saving…" : "Save neighborhood"}</button>
  </Sheet>;
}

/** Name, color, a Boundary row that reopens the drawing, and a quiet red Delete. */
export function EditNeighborhood({ data, territory, onSave, onRedraw, onDelete, onClose }: {
  data: NeighborWalkData; territory: Territory;
  onSave: (name: string, color: string) => Promise<unknown>;
  onRedraw: () => void;
  onDelete: (destinationId: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(territory.name);
  const [color, setColor] = useState(territory.color);
  const action = useAsyncAction();
  const confirm = useConfirm();
  const titleId = useId();
  // Pins and visits stay: they move to the nearest other neighborhood.
  const others = data.territories.filter((item) => item.id !== territory.id && item.kind !== "list" && item.center);
  const nearest = territory.center ? [...others].sort((a, b) => distance(a.center!, territory.center!) - distance(b.center!, territory.center!))[0] : others[0];
  const pins = data.properties.filter((property) => property.territoryId === territory.id && !property.mergedIntoId).length;
  const corners = Math.max(0, territory.boundary.length - (sameCoordinates(territory.boundary[0], territory.boundary[territory.boundary.length - 1]) ? 1 : 0));
  return <Sheet className="plain-sheet" modal labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <div className="home-sheet-head"><h2 className="pin-title" id={titleId}>{territory.name}</h2><button type="button" className="round-line" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    <label className="pin-field"><span className="mono-meta">Name</span><input value={name} maxLength={120} enterKeyHint="done" onChange={(event) => setName(event.target.value)} /></label>
    <div className="pin-field"><span className="mono-meta">Color</span><Swatches value={color} onChange={setColor} /></div>
    <div className="grouped-rows">
      <button type="button" className="grouped-row" onClick={onRedraw}><span className="grouped-row-text"><strong>Boundary</strong><small>{corners} corners</small></span><span className="mono-meta hedge">Redraw ›</span></button>
      <button type="button" className="grouped-row danger" disabled={action.busy || !nearest} onClick={() => nearest && void confirm({ title: `Delete ${territory.name}?`, message: `Its ${pins} ${pins === 1 ? "pin moves" : "pins move"} to ${nearest.name}, with every visit. Walks keep their history.`, confirmLabel: "Delete neighborhood", destructive: true }).then((yes) => { if (yes) void action.run(() => onDelete(nearest.id)); })}>
        <span className="grouped-row-text"><strong>Delete neighborhood</strong><small>{nearest ? "Pins and visits stay" : "Add another neighborhood first"}</small></span>
      </button>
    </div>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy || name.trim().length < 3} onClick={() => void action.run(() => onSave(name.trim(), color))}>{action.busy ? "Saving…" : "Save"}</button>
  </Sheet>;
}

function sameCoordinates(a?: Coordinates, b?: Coordinates) {
  return Boolean(a && b && a[0] === b[0] && a[1] === b[1]);
}

function distance(a: Coordinates, b: Coordinates) {
  return Math.hypot((a[0] - b[0]) * Math.cos(a[1] * Math.PI / 180), a[1] - b[1]);
}

export type NewNeighborhood = { name: string; color: string; boundary: Coordinates[]; center: Coordinates };

/** Draw, then name, a new neighborhood over a full-screen map: the same steps
 * as New neighborhood on the map (MP5, MP6), for places that pick one. */
export function NewNeighborhoodFlow({ data, around, onSave, onCancel }: {
  data: NeighborWalkData; around?: Territory; onSave: (input: NewNeighborhood) => Promise<unknown>; onCancel: () => void;
}) {
  const [drawing, setDrawing] = useState<{ mode: MapDrawingMode; points: Coordinates[] }>({ mode: "polygon", points: [] });
  const [naming, setNaming] = useState<Coordinates[] | null>(null);
  const areas = data.territories.filter((territory) => territory.kind !== "list" && territory.center);
  const [color, setColor] = useState(neighborhoodColors[areas.length % neighborhoodColors.length]);
  const base = around?.center ? around : areas[0];
  const territory: Territory = base ?? { id: "new-neighborhood", churchId: data.church.id, name: "New neighborhood", color, zoom: 4, boundary: [], center: [-98, 39] };
  const next = () => { if (drawingBoundaryReady(drawing.points, drawing.mode)) setNaming(drawing.points); };
  return <div className="zone-draw-page map-screen drawing" role="dialog" aria-modal="true" aria-label="New neighborhood">
    <div className="map-stage">
      <MapCanvas territory={territory} properties={[]} selectedPropertyId={null} visibleOutcomes={new Set(outcomeValues)} searchTarget={null} addMode={false}
        drawMode={!naming} drawShape={drawing.mode} drawChrome={false} draftBoundary={naming ?? drawing.points} draftColor={naming ? color : undefined}
        compactMarkers={data.preferences.compactMapMarkers} mapStyleUrl={data.preferences.mapStyleUrl}
        onSelectProperty={() => undefined} onAddIntent={() => undefined} onAssociatePropertiesWithParcel={() => undefined} onViewportChange={() => undefined}
        onDraftClose={next} onDrawShapeChange={(mode) => setDrawing({ mode, points: [] })} onDraftBoundaryChange={(points) => setDrawing((current) => ({ ...current, points }))} />
    </div>
    {!naming && <DrawChrome title="New neighborhood" mode={drawing.mode} points={drawing.points} onMode={(mode) => setDrawing({ mode, points: [] })}
      onUndo={() => setDrawing((current) => ({ ...current, points: undoDrawingPoint(current.points, current.mode) }))} onCancel={onCancel} onNext={next} />}
    {naming && <NameNeighborhood color={color} onColor={setColor} onBack={() => { setDrawing({ mode: "polygon", points: naming }); setNaming(null); }}
      onSave={(name, chosen) => onSave({ name, color: chosen, boundary: naming, center: centerForBoundary(naming) })} />}
  </div>;
}
