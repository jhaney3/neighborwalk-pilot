"use client";
import { useMemo, useState } from "react";
import { MapPin, Plus, Printer } from "lucide-react";
import { outcomeMeta, type NeighborWalkData } from "../lib/domain";
import type { ParcelFeature, ParcelFeatureCollection } from "../lib/parcels";
import { buildAddressWorksheet, targetAddressEntries } from "../lib/target-address-list";
import { useAsyncAction } from "../lib/use-async-action";
import { FieldWorksheet, type FieldWorksheetContext } from "./FieldWorksheet";
import { Modal } from "./ui";

export function AddressList({ data, onOpen, onOpenParcel, onAdd, onTerritoryChange, lockedTerritoryId, targetName, targetParcels, printContext }: {
  data: NeighborWalkData; onOpen: (id: string) => void;
  onOpenParcel?: (parcel: ParcelFeature) => void;
  onAdd: (input: { address: string; unit?: string; territoryId?: string | null }) => Promise<unknown>;
  onTerritoryChange: (territoryId: string) => Promise<unknown>;
  lockedTerritoryId?: string;
  targetName?: string;
  targetParcels?: ParcelFeatureCollection;
  printContext?: FieldWorksheetContext;
}) {
  const [query, setQuery] = useState("");
  const [selectedTerritory, setTerritory] = useState(data.preferences.activeTerritoryId);
  const territory = lockedTerritoryId ?? selectedTerritory;
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const [unit, setUnit] = useState("");
  const [printedAt, setPrintedAt] = useState<string>();
  const action = useAsyncAction();
  const allEntries = useMemo(() => targetAddressEntries(
    data.properties.filter((property) => !property.mergedIntoId && (!territory || property.territoryId === territory)),
    targetName ? targetParcels : undefined,
  ), [data.properties, territory, targetName, targetParcels]);
  const entries = allEntries.filter((entry) => `${entry.address} ${entry.unit ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const unavailableAddresses = allEntries.filter((entry) => entry.kind === "parcel" && !entry.parcel.properties.situsAddress).length;
  const worksheetPages = useMemo(() => printContext ? buildAddressWorksheet(allEntries, { visits: data.visits, restrictions: data.restrictions, eventId: printContext.eventId, targetId: printContext.targetId }) : [],
    [allEntries, data.visits, data.restrictions, printContext]);
  const worksheetRows = useMemo(() => new Map(worksheetPages.flatMap((page) => page.rows).map((row) => [row.entry.key, row])), [worksheetPages]);
  const printList = () => {
    setPrintedAt(new Date().toISOString());
    window.setTimeout(() => window.print(), 0);
  };
  return <section className={`address-list content-view${targetName ? " target-address-list" : ""}${printContext ? " has-field-worksheet" : ""}`} aria-label="Outreach address list">
    <div className="view-heading"><div>{targetName && <p className="eyebrow">{targetName}</p>}<h1>{targetName ? "Tonight’s addresses" : "Address list"}</h1>{targetName && <p>{allEntries.length} {allEntries.length === 1 ? "location" : "locations"}</p>}</div>{!targetName && <button className="button primary" aria-label="Add address manually" onClick={() => setAdding(true)}><Plus size={16} /><span>Add address</span></button>}</div>
    <div className="list-toolbar">{!lockedTerritoryId && <label>Neighborhood<select value={territory} disabled={action.busy} onChange={(event) => { const value = event.target.value; if (!value) setTerritory(""); else void action.run(() => onTerritoryChange(value), () => setTerritory(value)); }}><option value="">All neighborhoods</option>{data.territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}<label>Search<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Street address or unit" /></label><button type="button" className="button quiet" onClick={printList}><Printer size={16} /> {printContext ? "Print field worksheet" : "Print address list"}</button></div>
    {!adding && action.error && <p role="alert" className="inline-error">{action.error}</p>}
    {targetName && unavailableAddresses > 0 && <p className="target-address-note">{unavailableAddresses} {unavailableAddresses === 1 ? "address is" : "addresses are"} unavailable on this device. Reconnect or use Map to identify {unavailableAddresses === 1 ? "it" : "them"}.</p>}
    {!printContext && <div className="print-heading"><h2>{data.church.name} — outreach addresses</h2><p>Check the app for “Don’t knock” homes before you go. No names or phone numbers are printed.</p></div>}
    <ol className="address-rows">{entries.map((entry) => {
      const outcome = entry.kind === "saved" ? entry.property.currentOutcome : "unvisited";
      const unavailable = entry.kind === "parcel" && !entry.parcel.properties.situsAddress;
      return <li key={entry.key}><button type="button" disabled={unavailable} onClick={() => entry.kind === "saved" ? onOpen(entry.property.id) : onOpenParcel?.(entry.parcel)}>{printContext && <span className="address-list-sequence">{worksheetRows.get(entry.key)?.sequenceLabel}</span>}<MapPin size={20} /><span><strong>{entry.address}{entry.unit ? " · " + entry.unit : ""}</strong><small>{targetName ?? (entry.kind === "saved" ? data.territories.find((item) => item.id === entry.property.territoryId)?.name : undefined) ?? "No neighborhood"}</small></span><strong className={outcome === "do_not_visit" ? "restriction-label" : ""} aria-label={outcomeMeta[outcome].label}>{outcomeMeta[outcome].short}</strong></button></li>;
    })}</ol>
    {!entries.length && <p>{targetName ? "No homes on this route match." : "No saved addresses match. Add one below."}</p>}
    {adding && <Modal title="Add an address" description="Just the street address is enough." onClose={action.busy ? () => undefined : () => setAdding(false)}><form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action.run(() => onAdd({ address: address.trim(), unit: unit.trim() || undefined, territoryId: territory || null }), () => { setAddress(""); setUnit(""); setAdding(false); }); }}>
      <p>Added to {data.territories.find((t) => t.id === territory)?.name ?? "the church’s unassigned locations"}.</p>
      <label>Street address<input required minLength={3} maxLength={240} value={address} onChange={(e) => setAddress(e.target.value)} /></label><label>Unit or label (optional)<input maxLength={60} value={unit} onChange={(e) => setUnit(e.target.value)} /></label>
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}<div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={() => setAdding(false)}>Cancel</button><button className="button primary" disabled={action.busy}>{action.busy ? "Saving…" : "Add address"}</button></div>
    </form></Modal>}
    {printContext && <FieldWorksheet churchName={data.church.name} context={printContext} pages={worksheetPages} printedAt={printedAt} />}
  </section>;
}
