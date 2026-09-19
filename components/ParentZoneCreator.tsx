"use client";
import { Check, MapPinned, RotateCcw, Undo2 } from "lucide-react";
import { useState } from "react";
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

export function ParentZoneCreator({ churchId, mapStyleUrl, baseTerritory, demo = false, onAddZone, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#286c59");
  const [drawShape, setDrawShape] = useState<MapDrawingMode>("rectangle");
  const [boundary, setBoundary] = useState<Coordinates[]>([]);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const inventory = usePlanningParcelsInView(open ? viewport : null, demo);
  const action = useAsyncAction();
  const mapTerritory = baseTerritory ?? { ...SUPPORTED_COUNTIES_OVERVIEW, churchId };
  const distinctCorners = new Set(boundary.map(([longitude, latitude]) => `${longitude.toFixed(7)}:${latitude.toFixed(7)}`)).size;
  const boundaryCrossesItself = boundary.length >= 3 && polygonSelfIntersects(boundary);
  const boundaryReady = drawingBoundaryReady(boundary, drawShape) && !boundaryCrossesItself;
  const boundaryStatus = drawShape === "rectangle"
    ? boundaryReady ? "Rectangle ready" : "Drag across the map"
    : distinctCorners < 3 ? `${3 - distinctCorners} more distinct ${3 - distinctCorners === 1 ? "corner" : "corners"} needed` : boundaryCrossesItself ? "Boundary lines cannot cross" : `${distinctCorners} corners ready`;

  if (!open) {
    return <button type="button" className="button quiet walk-create-zone-button" onClick={() => setOpen(true)}><MapPinned size={16} /> Draw and name a new zone</button>;
  }

  const save = () => {
    if (name.trim().length < 3 || !boundaryReady) return;
    void action.run(async () => {
      const center = centerForBoundary(boundary);
      const id = await onAddZone({ name: name.trim(), boundary, center, color, kind: "map" });
      onCreated({ id, churchId, name: name.trim(), boundary, center, color, kind: "map", zoom: 15.5 });
      setOpen(false);
      setName("");
      setBoundary([]);
    });
  };

  return <section className="walk-parent-zone-creator" aria-busy={action.busy}>
    <div className="walk-parent-zone-heading"><div><strong>Draw a lasting neighborhood zone</strong><small>Use a rectangle for a simple block, or a polygon for a custom boundary. This zone is reusable for later walks.</small></div><button type="button" className="button quiet small" disabled={action.busy} onClick={() => { setOpen(false); setBoundary([]); action.clearError(); }}>Close</button></div>
    <div className="walk-parent-zone-map">
      <MapCanvas
        territory={mapTerritory}
        properties={[]}
        selectedPropertyId={null}
        visibleOutcomes={NO_OUTCOMES}
        searchTarget={null}
        addMode={false}
        drawMode
        drawShape={drawShape}
        drawModeLabel="New zone"
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
    <p className="walk-help" role="status" aria-live="polite">{inventory.message}</p>
    {inventory.failed && <button type="button" className="button quiet small" onClick={inventory.retry}>Retry parcel loading</button>}
    <div className="walk-parent-zone-tools">
      {drawShape === "polygon" && <button type="button" className="button quiet small" disabled={action.busy || boundary.length === 0} onClick={() => setBoundary((current) => undoDrawingPoint(current, drawShape))}><Undo2 size={15} /> Undo corner</button>}
      <button type="button" className="button quiet small" disabled={action.busy || boundary.length === 0} onClick={() => setBoundary([])}><RotateCcw size={15} /> Start over</button>
      <span>{boundaryStatus}</span>
    </div>
    <div className="walk-parent-zone-fields">
      <label>Zone name<input value={name} required minLength={3} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Example: Oakwood North" /></label>
      <label>Map color<input className="territory-color-input" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
    </div>
    {boundaryCrossesItself && <p className="walk-ready-note" role="alert">Undo the crossing corner so the zone has one clear boundary.</p>}
    {action.error && <p className="inline-error" role="alert">{action.error}</p>}
    <button type="button" className="button primary" disabled={action.busy || name.trim().length < 3 || !boundaryReady} onClick={save}><Check size={16} /> {action.busy ? "Creating zone…" : "Create and use this zone"}</button>
  </section>;
}
