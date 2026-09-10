"use client";
import { useState } from "react";
import { MapPin, Plus, Printer } from "lucide-react";
import { outcomeMeta, type NeighborWalkData } from "../lib/domain";
import { useAsyncAction } from "../lib/use-async-action";
import { Modal } from "./ui";

export function AddressList({ data, onOpen, onAdd }: {
  data: NeighborWalkData; onOpen: (id: string) => void;
  onAdd: (input: { address: string; unit?: string; territoryId?: string | null }) => Promise<unknown>;
}) {
  const [query, setQuery] = useState("");
  const [territory, setTerritory] = useState(data.preferences.activeTerritoryId);
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const [unit, setUnit] = useState("");
  const action = useAsyncAction();
  const locations = data.properties.filter((p) => !p.mergedIntoId && (!territory || p.territoryId === territory)
    && (p.address + " " + (p.unit ?? "")).toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }));
  return <section className="address-list content-view" aria-label="Outreach address list">
    <div className="view-heading"><div><p className="eyebrow">A map is optional</p><h1>Address list</h1><p>Open a location to record a visit. Saved addresses and restrictions remain available offline.</p></div><button className="button primary" onClick={() => setAdding(true)}><Plus size={16} /> Add address manually</button></div>
    <div className="list-toolbar"><label>Territory<select value={territory} onChange={(e) => setTerritory(e.target.value)}><option value="">All locations</option>{data.territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Search<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Street address or unit" /></label><button className="button quiet" onClick={() => window.print()}><Printer size={16} /> Print address list</button></div>
    <div className="print-heading"><h2>{data.church.name} — outreach addresses</h2><p>Printed {new Date().toLocaleDateString()} · Check the app for current restrictions before visiting. Contains no person notes or phone numbers.</p></div>
    <ol className="address-rows">{locations.map((p) => <li key={p.id}><button onClick={() => onOpen(p.id)}><MapPin size={20} /><span><strong>{p.address}{p.unit ? " · " + p.unit : ""}</strong><small>{data.territories.find((t) => t.id === p.territoryId)?.name ?? "No territory assigned"}</small></span><strong className={p.currentOutcome === "do_not_visit" ? "restriction-label" : ""}>{outcomeMeta[p.currentOutcome].label}</strong></button></li>)}</ol>
    {!locations.length && <p>No saved addresses match. Add an address manually; coordinates and map coverage are not required.</p>}
    {adding && <Modal title="Add an address" description="Use only the address needed for outreach. No map lookup is required." onClose={action.busy ? () => undefined : () => setAdding(false)}><form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action.run(() => onAdd({ address: address.trim(), unit: unit.trim() || undefined, territoryId: territory || null }), () => { setAddress(""); setUnit(""); setAdding(false); }); }}>
      <p>Added to {data.territories.find((t) => t.id === territory)?.name ?? "the church’s unassigned locations"}.</p>
      <label>Street address<input required minLength={3} maxLength={240} value={address} onChange={(e) => setAddress(e.target.value)} /></label><label>Unit or dwelling label (optional)<input maxLength={60} value={unit} onChange={(e) => setUnit(e.target.value)} /></label>
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}<div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={() => setAdding(false)}>Cancel</button><button className="button primary" disabled={action.busy}>{action.busy ? "Saving to device…" : "Add address"}</button></div>
    </form></Modal>}
  </section>;
}
