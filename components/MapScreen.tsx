"use client";

import { ArrowLeft, Check, ChevronDown, Ellipsis, List as ListIcon, LoaderCircle, MapPin, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { calendarDate, formatCalendarDate } from "../lib/calendar";
import { centerForBoundary, outcomeMeta, type Coordinates, type NeighborWalkData, type Outcome, type OutreachEvent, type Property, type Territory } from "../lib/domain";
import { reviewedEncounter } from "../lib/encounter-history";
import { forwardGeocode, reverseGeocode, type AddressSearchResult } from "../lib/geocoding";
import { undoDrawingPoint, type MapDrawingMode } from "../lib/map-drawing";
import type { MapViewport, ParcelFeatureCollection } from "../lib/parcels";
import { homesVisitedOnWalk, neighborhoodPins, routeVisitsTonight, routeWalkerIds } from "../lib/pin-counts";
import type { useNeighborWalk } from "../lib/use-neighborwalk";
import { parcelKey, type WalkTarget } from "../lib/walk-targets";
import { pinDropped, selectionTick, saveSucceeded } from "../mobile/haptics";
import { HomeSheet } from "./HomeSheet";
import { MapCanvas, type AddIntent, type MapSearchTarget } from "./MapCanvas";
import { DrawChrome, EditNeighborhood, NameNeighborhood, NeighborhoodSheet, neighborhoodColors } from "./NeighborhoodTools";
import { outcomeWord } from "./OutcomeGrid";
import { PinnedList, WalkLog } from "./PinLists";
import { PinSheet, type PinDraft, type PinTarget, type PinVisit } from "./PinSheet";
import { ActionSheet, Sheet, useFocusOnMount } from "./Sheet";
import { WalkWrapUp } from "./WalkWrapUp";

type Actions = ReturnType<typeof useNeighborWalk>["actions"];
type Assignment = NonNullable<NeighborWalkData["assignments"]>[number];
export type FieldWalk = { outing: OutreachEvent; assignment: Assignment; target?: WalkTarget };
type Pending = { key: string; target: PinTarget; visit: PinVisit; held: boolean };
type PinState = { kind: "new"; draft: PinDraft } | { kind: "home"; propertyId: string; stage: "choose" | "another" };

const chips: { value: "all" | Outcome; label: string }[] = [
  { value: "all", label: "All" },
  { value: "conversation", label: "Talked" },
  { value: "no_answer", label: "No answer" },
  { value: "follow_up", label: "Come back" },
  { value: "do_not_visit", label: "Don’t knock" },
];

function compactElapsed(minutes: number) {
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

let draftSequence = 0;

/** Walk mode and Walks → Map / List. Nothing is pinned ahead of time: tapping a
 * house drops a pin and opens the outcome grid; long-press drops one straight
 * to Don't knock. Saves wait five seconds behind Undo, then commit. */
export function MapScreen({ data, actions, canManage, activeVolunteerId, territory, properties, walk, display, onDisplay, walksSwitch, parcels, onViewportChange, focusPropertyId, peopleReturn, onOpenWalk, onFinishRoute, onOpenFollowUp, onOpenPerson, onAddPerson, onAssignFollowUp, showToast }: {
  data: NeighborWalkData;
  actions: Actions;
  canManage: boolean;
  activeVolunteerId: string;
  territory: Territory;
  /** The neighborhood's homes (not merged). */
  properties: Property[];
  walk?: FieldWalk;
  display: "map" | "list";
  onDisplay: (display: "map" | "list") => void;
  walksSwitch: React.ReactNode;
  parcels?: ParcelFeatureCollection;
  onViewportChange: (viewport: MapViewport) => void;
  /** A home to open, from a link or another tab. */
  focusPropertyId?: string | null;
  peopleReturn?: { label: string; onBack: () => void };
  onOpenWalk: () => void;
  onFinishRoute: () => Promise<unknown>;
  onOpenFollowUp: (followUpId: string) => void;
  onOpenPerson: (personId: string) => void;
  onAddPerson: (propertyId: string) => void;
  onAssignFollowUp: (followUpId: string, volunteerId: string) => Promise<unknown>;
  showToast: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const timezone = data.church.timezone;
  const [filter, setFilter] = useState<"all" | Outcome>("all");
  const [pin, setPin] = useState<PinState | null>(null);
  const [pinKey, setPinKey] = useState(0);
  const [home, setHome] = useState<{ propertyId: string; focusHistory: boolean } | null>(null);
  const [moving, setMoving] = useState<{ propertyId: string; coordinates: Coordinates } | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [wrapUpOpen, setWrapUpOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<MapSearchTarget | null>(null);
  const flyTo = useCallback((coordinates: Coordinates, zoom = 18) => { draftSequence += 1; setSearchTarget({ id: `fly-${draftSequence}`, coordinates, zoom }); }, []);
  const [neighborhoodsOpen, setNeighborhoodsOpen] = useState(false);
  const [leaderMenu, setLeaderMenu] = useState(false);
  const [drawing, setDrawing] = useState<{ mode: MapDrawingMode; points: Coordinates[]; editingId?: string } | null>(null);
  const [naming, setNaming] = useState<Coordinates[] | null>(null);
  const [namingColor, setNamingColor] = useState(neighborhoodColors[0]);
  const [editing, setEditing] = useState<{ territoryId: string; boundary?: Coordinates[] } | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);

  // One small hint teaches the gesture, until your first pin on this walk.
  const hintKey = walk ? `nw-pin-hint-${walk.outing.id}` : "";
  const [hintHidden, setHintHidden] = useState(() => { try { return Boolean(hintKey && sessionStorage.getItem(hintKey)); } catch { return false; } });
  const hideHint = useCallback(() => { setHintHidden(true); try { if (hintKey) sessionStorage.setItem(hintKey, "1"); } catch { /* Private mode: the hint just comes back next time. */ } }, [hintKey]);

  /* ---------- saving behind Undo ---------- */
  const pendingRef = useRef<Pending | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const commit = async (save: Pending) => {
    let propertyId: string;
    let parcel: Property["parcel"];
    if (save.target.kind === "new") {
      const { draft } = save.target;
      parcel = draft.parcel;
      propertyId = await actions.addProperty({ address: save.target.address, unit: save.target.unit, coordinates: draft.coordinates, buildingGeometry: draft.buildingGeometry, parcel, territoryId: territory.id || null });
    } else {
      propertyId = save.target.propertyId;
      parcel = data.properties.find((property) => property.id === propertyId)?.parcel;
    }
    let residentId = save.visit.residentId;
    const person = save.visit.newPerson;
    const hasPhone = Boolean(person?.stayInTouch && person.phone.length >= 3);
    if (person && (person.name || hasPhone)) residentId = await actions.upsertResident(propertyId, {
      name: person.name || undefined, faithStatus: "not_discussed", discipleshipStage: "new_connection",
      assignedVolunteerId: activeVolunteerId, sharedWithVolunteerIds: [], sharedWithTeamIds: [], status: "active",
      phone: hasPhone ? person.phone : undefined, preferredContact: hasPhone ? person.method : "none",
      contactPermission: hasPhone ? "requested" : "not_recorded",
    });
    // A visit counts toward the route's target only when its home is on the
    // target's parcel roster; pins elsewhere in the area still count for the walk.
    const onRoster = Boolean(walk?.target && parcel && walk.target.parcels.some((item) => parcelKey(item) === parcelKey(parcel!)));
    await actions.recordVisit({ propertyId, outcome: save.visit.outcome, residentId, needs: save.visit.needs, objectiveNote: save.visit.note, followUpDate: save.visit.followUpDate, eventId: walk?.outing.id, targetId: onRoster ? walk!.target!.id : undefined });
  };
  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; });
  const toastRef = useRef(showToast);
  useEffect(() => { toastRef.current = showToast; }, [showToast]);
  const flush = useCallback(async () => {
    const save = pendingRef.current;
    if (!save) return;
    pendingRef.current = null;
    setPending(null);
    try { await commitRef.current(save); }
    catch (error) { toastRef.current(error instanceof Error ? error.message : "That visit couldn’t be saved. Try again.", "error"); }
  }, []);
  useEffect(() => {
    if (!pending || pending.held) return;
    const timer = window.setTimeout(() => void flush(), 5000);
    return () => window.clearTimeout(timer);
  }, [pending, flush]);
  useEffect(() => {
    const whenHidden = () => { if (document.visibilityState === "hidden") void flush(); };
    const onPageHide = () => void flush();
    document.addEventListener("visibilitychange", whenHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => { document.removeEventListener("visibilitychange", whenHidden); window.removeEventListener("pagehide", onPageHide); void flush(); };
  }, [flush]);

  const startSave = (target: PinTarget, visit: PinVisit, hold: boolean) => {
    if (pendingRef.current) void flush();
    const save: Pending = { key: target.kind === "new" ? target.draft.key : target.propertyId, target, visit, held: hold };
    pendingRef.current = save;
    setPending(save);
    hideHint();
    if (!hold) { saveSucceeded(); setPin(null); setHome(null); }
  };
  const updateSave = (visit: PinVisit) => {
    if (!pendingRef.current) return;
    pendingRef.current = { ...pendingRef.current, visit };
    setPending(pendingRef.current);
  };
  const releaseSave = () => {
    if (pendingRef.current) { pendingRef.current = { ...pendingRef.current, held: false }; setPending(pendingRef.current); saveSucceeded(); }
    setPin(null); setHome(null);
  };
  const undo = () => {
    const save = pendingRef.current;
    if (!save) return;
    pendingRef.current = null;
    setPending(null);
    setPinKey((key) => key + 1);
    if (save.target.kind === "new") setPin({ kind: "new", draft: { ...save.target.draft, address: save.target.address } });
    else if (walk) setPin({ kind: "home", propertyId: save.target.propertyId, stage: "choose" });
    else setHome({ propertyId: save.target.propertyId, focusHistory: false });
  };

  /* ---------- what the map shows ---------- */
  const churchId = data.church.id;
  const pendingHome = useMemo<Property | undefined>(() => pending?.target.kind === "new" ? {
    id: pending.key, churchId, territoryId: territory.id, address: pending.target.address, unit: pending.target.unit,
    coordinates: pending.target.draft.coordinates, parcel: pending.target.draft.parcel, currentOutcome: pending.visit.outcome,
    visitCount: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: "map",
  } : undefined, [pending, churchId, territory.id]);
  const homes = useMemo(() => {
    const shown = pending?.target.kind === "home" ? properties.map((item) => item.id === pending.key && item.currentOutcome !== "do_not_visit" ? { ...item, currentOutcome: pending.visit.outcome } : item) : properties;
    return pendingHome ? [...shown, pendingHome] : shown;
  }, [pending, pendingHome, properties]);
  const routeVisits = useMemo(() => walk ? routeVisitsTonight(data, walk.outing, walk.assignment) : [], [data, walk]);
  const tonight = useMemo(() => {
    if (!walk) return undefined;
    const ids = homesVisitedOnWalk(data.visits, walk.outing.id);
    if (pending) ids.add(pending.key);
    return ids;
  }, [data.visits, pending, walk]);
  const doorsCommitted = new Set(routeVisits.map((visit) => visit.propertyId));
  const doors = doorsCommitted.size + (pending && !doorsCommitted.has(pending.key) ? 1 : 0);
  const visibleOutcomes = useMemo(() => new Set<Outcome>(filter === "all" ? Object.keys(outcomeMeta) as Outcome[] : filter === "conversation" ? ["conversation"] : [filter]), [filter]);
  const minutes = walk && walk.outing.status === "active" && Date.parse(walk.outing.startsAt) <= clock ? Math.floor((clock - Date.parse(walk.outing.startsAt)) / 60000) : undefined;
  const pinProperty = pin?.kind === "home" ? homes.find((item) => item.id === pin.propertyId) : undefined;
  const homeProperty = home ? data.properties.find((item) => item.id === home.propertyId) : undefined;
  const selectedId = pinProperty?.id ?? homeProperty?.id ?? null;
  const canvasTerritory: Territory = territory.center ? territory : { ...territory, center: [-98, 39], zoom: 4 };
  const pins = neighborhoodPins(data, territory.id).pins;

  // A home opened from another tab or a link.
  const [openedFocus, setOpenedFocus] = useState<string | null>(null);
  if (focusPropertyId && focusPropertyId !== openedFocus) {
    const target = data.properties.find((item) => item.id === focusPropertyId);
    setOpenedFocus(focusPropertyId);
    if (target) {
      setPin(null);
      setHome({ propertyId: target.id, focusHistory: false });
      if (target.coordinates) setSearchTarget({ id: `focus-${target.id}`, coordinates: target.coordinates, zoom: 18 });
    }
  }

  // Drawing, moving a pin and full-screen lists hide the tab bar.
  const immersive = Boolean(drawing || naming || moving || logOpen || wrapUpOpen);
  useEffect(() => {
    document.body.classList.toggle("map-immersive", immersive);
    return () => document.body.classList.remove("map-immersive");
  }, [immersive]);

  /* ---------- taps on the map ---------- */
  const anySheet = Boolean(pin || home || neighborhoodsOpen || leaderMenu || editing);
  const closeSheets = () => { setPin(null); setHome(null); setNeighborhoodsOpen(false); setLeaderMenu(false); setEditing(null); };
  const selectProperty = (propertyId: string) => {
    if (drawing || moving) return;
    if (pending?.held) releaseSave();
    const target = homes.find((item) => item.id === propertyId);
    if (!target || target.id === pendingHome?.id) return;
    setPinKey((key) => key + 1);
    if (walk) { setHome(null); setPin({ kind: "home", propertyId, stage: "choose" }); }
    else { setPin(null); setHome({ propertyId, focusHistory: false }); }
  };
  const dropPin = (intent: AddIntent) => {
    if (pending?.held) { releaseSave(); return; }
    // Tapping away closes whatever is open; a new pin with nothing logged goes with it.
    if (anySheet) { closeSheets(); return; }
    draftSequence += 1;
    const key = `draft-${draftSequence}`;
    const draft: PinDraft = { key, coordinates: intent.coordinates, address: intent.suggestedAddress, source: intent.addressSource ?? (intent.suggestedAddress ? "map" : "unknown"), parcel: intent.parcel ? { countyFips: intent.parcel.countyFips, gislink: intent.parcel.gislink, ...(walk ? {} : { id: intent.parcel.id }) } : undefined, buildingGeometry: intent.buildingGeometry };
    pinDropped();
    hideHint();
    setPinKey((current) => current + 1);
    setPin({ kind: "new", draft });
    if (!draft.address) void reverseGeocode(intent.coordinates).then((address) => {
      if (address) setPin((current) => current?.kind === "new" && current.draft.key === key && !current.draft.address ? { kind: "new", draft: { ...current.draft, address: address.split(",")[0], source: "geocoder" } } : current);
    }).catch(() => undefined);
  };
  const longPress = (intent: AddIntent) => {
    closeSheets();
    draftSequence += 1;
    const draft: PinDraft = { key: `draft-${draftSequence}`, coordinates: intent.coordinates, address: intent.suggestedAddress, source: intent.addressSource ?? "unknown", parcel: intent.parcel ? { countyFips: intent.parcel.countyFips, gislink: intent.parcel.gislink } : undefined, buildingGeometry: intent.buildingGeometry };
    pinDropped();
    startSave({ kind: "new", draft, address: intent.suggestedAddress || "Address not recorded" }, { outcome: "do_not_visit", needs: [] }, false);
  };

  /* ---------- search (Walks → Map) ---------- */
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [addressResults, setAddressResults] = useState<AddressSearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const needle = query.trim().toLowerCase();
  const pinnedResults = needle.length < 2 ? [] : data.properties.filter((item) => !item.mergedIntoId && `${item.address} ${item.unit ?? ""}`.toLowerCase().includes(needle)).slice(0, 4);
  const proximityLng = territory.center?.[0];
  const proximityLat = territory.center?.[1];
  useEffect(() => {
    if (!searching || needle.length < 3) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void forwardGeocode(needle, { proximity: proximityLng !== undefined && proximityLat !== undefined ? [proximityLng, proximityLat] : undefined, signal: controller.signal })
        .then((results) => { setAddressResults(results); setSearchStatus("ready"); })
        .catch((error: unknown) => { if ((error as { name?: string })?.name !== "AbortError") { setAddressResults([]); setSearchStatus("error"); } });
    }, 260);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [needle, searching, proximityLng, proximityLat]);
  const closeSearch = () => { setSearching(false); setQuery(""); setAddressResults([]); setSearchStatus("idle"); };
  const lastLine = (propertyId: string) => {
    const visit = data.visits.filter((item) => item.propertyId === propertyId).map(reviewedEncounter).filter((item) => !item.voided).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
    if (!visit) return "Pinned · not logged yet";
    const person = data.residents.find((resident) => resident.propertyId === propertyId && resident.name)?.name;
    return [outcomeWord[visit.outcome], formatCalendarDate(calendarDate(visit.recordedAt, timezone), { month: "short", day: "numeric" }), person].filter(Boolean).join(" · ");
  };

  /* ---------- render ---------- */
  const walkName = walk?.target?.name ?? territory.name;
  const walkerNames = walk ? [...routeWalkerIds(data, walk.assignment)].sort((a, b) => Number(b === activeVolunteerId) - Number(a === activeVolunteerId)).map((id) => id === activeVolunteerId ? "you" : data.volunteers.find((volunteer) => volunteer.id === id)?.name).filter((name): name is string => Boolean(name)) : [];
  const chipRow = <div className="map-chips" role="group" aria-label="Show pins">{chips.map((option) => <button type="button" key={option.value} aria-pressed={filter === option.value} onClick={() => { selectionTick(); setFilter(option.value); }}>{option.value !== "all" && <i style={{ background: outcomeMeta[option.value].color }} aria-hidden="true" />}{option.label}</button>)}</div>;
  const drawTitle = drawing?.editingId ? `Redraw ${data.territories.find((item) => item.id === drawing.editingId)?.name ?? "neighborhood"}` : "New neighborhood";
  const editingTerritory = editing ? data.territories.find((item) => item.id === editing.territoryId) : undefined;

  if (display === "list" && !walk) return <>
    <PinnedList data={data} territory={territory} switcher={walksSwitch} onNeighborhoods={() => setNeighborhoodsOpen(true)} onOpen={(id) => { const target = data.properties.find((item) => item.id === id); onDisplay("map"); setHome({ propertyId: id, focusHistory: false }); if (target?.coordinates) flyTo(target.coordinates); }} />
    {neighborhoodsOpen && <NeighborhoodSheet data={data} activeId={territory.id} canManage={canManage} onClose={() => setNeighborhoodsOpen(false)} onSelect={(id) => { selectionTick(); setNeighborhoodsOpen(false); void actions.selectTerritory(id); }} onNew={() => { setNeighborhoodsOpen(false); onDisplay("map"); setDrawing({ mode: "polygon", points: [] }); }} />}
  </>;

  return <div className={`map-screen${walk ? " walking" : " browsing"}${drawing ? " drawing" : ""}`}>
    <div className="map-stage">
      <MapCanvas territory={canvasTerritory} target={walk?.target} properties={drawing || naming ? [] : homes} selectedPropertyId={selectedId} visibleOutcomes={visibleOutcomes}
        searchTarget={searchTarget} addMode={false} dropPins={!drawing && !naming && !moving} drawMode={Boolean(drawing)} drawShape={drawing?.mode ?? "polygon"} drawChrome={false}
        draftBoundary={drawing?.points ?? naming ?? []} draftColor={naming ? namingColor : undefined} compactMarkers={data.preferences.compactMapMarkers} mapStyleUrl={data.preferences.mapStyleUrl} parcels={parcels}
        tonightIds={tonight} draftPin={pin?.kind === "new" ? pin.draft.coordinates : null} movingPin={moving?.coordinates ?? null}
        onViewportChange={onViewportChange} onSelectProperty={selectProperty} onAddIntent={dropPin} onLongPressIntent={longPress}
        onMovePin={(coordinates) => setMoving((current) => current ? { ...current, coordinates } : current)}
        onDraftClose={() => { if (drawing?.editingId) { setEditing({ territoryId: drawing.editingId, boundary: drawing.points }); setDrawing(null); } else if (drawing) { setNaming(drawing.points); setDrawing(null); } }}
        onUseAddressList={() => onDisplay("list")} onAssociatePropertiesWithParcel={(ids, parcel) => actions.associatePropertiesWithParcel(ids, { id: parcel.id, countyFips: parcel.countyFips, gislink: parcel.gislink })}
        onDrawShapeChange={(mode) => setDrawing((current) => current ? { ...current, mode, points: [] } : current)} onDraftBoundaryChange={(points) => setDrawing((current) => current ? { ...current, points } : current)} />
    </div>

    {walk && !drawing && !moving && <>
      <header className="walk-pill-bar">
        <div className="walk-pill">
          <button type="button" className="walk-pill-copy" onClick={onOpenWalk} aria-label={`${walkName}, ${doors} ${doors === 1 ? "door" : "doors"} tonight. Open the walk page`}>
            <strong>{walkName}</strong><span className="mono-meta">{[`${doors} ${doors === 1 ? "door" : "doors"}`, minutes !== undefined ? compactElapsed(minutes) : undefined].filter(Boolean).join(" · ")}</span>
          </button>
          <button type="button" className="walk-pill-finish" onClick={() => { void flush().then(() => { setPin(null); setHome(null); setWrapUpOpen(true); }); }}>Finish</button>
        </div>
        <button type="button" className="round-button float" aria-label="Logged tonight" onClick={() => { void flush(); setLogOpen(true); }}><ListIcon size={20} aria-hidden="true" /></button>
      </header>
      {chipRow}
    </>}

    {!walk && !drawing && !naming && !moving && <div className="map-top">
      {peopleReturn && !searching && <button type="button" className="capsule-button back" onClick={peopleReturn.onBack}><ArrowLeft size={17} aria-hidden="true" />{peopleReturn.label}</button>}
      {searching ? <div className="map-search-open" role="search">
        <div className="map-top-row">
          <label className="search-box solid"><Search size={17} aria-hidden="true" /><span className="visually-hidden">Search an address</span><SearchInput value={query} enterKeyHint="search" placeholder="Search an address" onChange={(event) => { setQuery(event.target.value); setAddressResults([]); setSearchStatus(event.target.value.trim().length >= 3 ? "loading" : "idle"); }} />{searchStatus === "loading" && <LoaderCircle className="spin" size={15} aria-label="Searching" />}</label>
          <button type="button" className="round-button float" aria-label="Close search" onClick={closeSearch}><X size={17} aria-hidden="true" /></button>
        </div>
        {needle.length >= 2 && <div className="search-results grouped-rows" aria-live="polite">
          {pinnedResults.length > 0 && <p className="mono-meta search-label">Pinned</p>}
          {pinnedResults.map((item) => <button type="button" key={item.id} className="grouped-row" onClick={() => { closeSearch(); if (item.territoryId && item.territoryId !== territory.id) void actions.selectTerritory(item.territoryId); setHome({ propertyId: item.id, focusHistory: false }); if (item.coordinates) flyTo(item.coordinates); }}>
            <i className="outcome-dot" style={{ background: outcomeMeta[item.currentOutcome].color }} aria-hidden="true" />
            <span className="grouped-row-text"><strong>{item.address}{item.unit ? ` · ${item.unit}` : ""}</strong><small>{lastLine(item.id)}</small></span>
          </button>)}
          {addressResults.length > 0 && <p className="mono-meta search-label">Addresses</p>}
          {addressResults.map((result) => <button type="button" key={result.id} className="grouped-row" onClick={() => { closeSearch(); draftSequence += 1; setSearchTarget({ id: `address-${draftSequence}`, coordinates: result.coordinates, zoom: result.zoom, marker: true }); }}>
            <MapPin size={16} aria-hidden="true" />
            <span className="grouped-row-text"><strong>{result.label.split(",")[0]}</strong><small>{result.label.split(",").slice(1, 2).join("").trim() || (result.type === "road" ? "Street" : "Place")}</small></span>
          </button>)}
          {!pinnedResults.length && !addressResults.length && <p className="search-empty">{searchStatus === "loading" ? "Searching…" : searchStatus === "error" ? "Address search is unavailable. Check the connection." : needle.length < 3 ? "Keep typing to search addresses." : "No pinned home or address matches."}</p>}
        </div>}
      </div> : <>
        {walksSwitch}
        <div className="map-top-row">
          <button type="button" className="capsule-button" aria-label={`${territory.name}, ${pins} pins. Choose a neighborhood`} onClick={() => setNeighborhoodsOpen(true)}><strong>{territory.name}</strong><span className="mono-meta">{pins}</span><ChevronDown size={14} aria-hidden="true" /></button>
          <button type="button" className="round-button float" aria-label="Search an address" onClick={() => { closeSheets(); setSearching(true); }}><Search size={19} aria-hidden="true" /></button>
          <button type="button" className="round-button float" aria-label="Map options" onClick={() => { closeSheets(); setLeaderMenu(true); }}><Ellipsis size={19} aria-hidden="true" /></button>
        </div>
        {chipRow}
      </>}
    </div>}

    {walk && !hintHidden && !pin && !home && !pending && !drawing && !moving && <button type="button" className="map-hint" onClick={hideHint} aria-label="Tap a house to drop a pin. Long-press to mark it Don’t knock. Dismiss"><MapPin size={16} aria-hidden="true" />Tap a house to drop a pin</button>}
    {pending && !pending.held && <div className="map-hint saved" role="status"><Check size={15} aria-hidden="true" /><span>Saved</span><button type="button" onClick={undo}>Undo</button></div>}

    {pin?.kind === "new" && <PinSheet key={`new-${pinKey}`} data={data} subject={{ kind: "new", draft: pin.draft }} onOutcome={startSave} onDetails={updateSave} onDone={releaseSave} onHistory={() => undefined} onClose={() => setPin(null)} />}
    {pin?.kind === "home" && pinProperty && <PinSheet key={`home-${pinKey}`} data={data} subject={{ kind: "home", property: pinProperty }} initialStage={pin.stage} onOutcome={startSave} onDetails={updateSave} onDone={releaseSave} onHistory={(id) => { setPin(null); setHome({ propertyId: id, focusHistory: true }); }} onClose={() => setPin(null)} />}
    {home && homeProperty && <HomeSheet key={`${homeProperty.id}-${pinKey}`} data={data} property={homeProperty} canManage={canManage} activeVolunteerId={activeVolunteerId} focusHistory={home.focusHistory}
      onOutcome={startSave} onDetails={updateSave} onDone={releaseSave} onOpenFollowUp={onOpenFollowUp} onOpenPerson={onOpenPerson} onAddPerson={onAddPerson}
      onAnotherHome={(id) => { setHome(null); setPinKey((key) => key + 1); setPin({ kind: "home", propertyId: id, stage: "another" }); }}
      onMovePin={(id) => { const target = data.properties.find((item) => item.id === id); setHome(null); if (target?.coordinates) setMoving({ propertyId: id, coordinates: target.coordinates }); }}
      onUpdateProperty={actions.updateProperty} onDeleteProperty={async (id) => { await actions.deleteProperty(id); showToast("Home deleted"); }} onClose={() => setHome(null)} />}

    {moving && <MovePin address={data.properties.find((item) => item.id === moving.propertyId)?.address ?? "This home"} onCancel={() => setMoving(null)} onSave={async () => { await actions.updateProperty(moving.propertyId, { coordinates: moving.coordinates }); setMoving(null); showToast("Pin moved"); }} />}

    {neighborhoodsOpen && <NeighborhoodSheet data={data} activeId={territory.id} canManage={canManage} onClose={() => setNeighborhoodsOpen(false)} onSelect={(id) => { selectionTick(); setNeighborhoodsOpen(false); void actions.selectTerritory(id); }} onNew={() => { setNeighborhoodsOpen(false); setDrawing({ mode: "polygon", points: [] }); }} />}
    {leaderMenu && <ActionSheet onClose={() => setLeaderMenu(false)} actions={[
      ...(canManage && territory.center ? [{ label: `Edit ${territory.name}`, onSelect: () => { setLeaderMenu(false); setEditing({ territoryId: territory.id }); } }] : []),
      ...(canManage ? [{ label: "New neighborhood", onSelect: () => { setLeaderMenu(false); setDrawing({ mode: "polygon", points: [] }); } }] : []),
      { label: "Print address list", onSelect: () => { setLeaderMenu(false); onDisplay("list"); window.setTimeout(() => window.print(), 350); } },
    ]} />}
    {drawing && <DrawChrome title={drawTitle} mode={drawing.mode} points={drawing.points} onMode={(mode) => setDrawing({ ...drawing, mode, points: [] })} onUndo={() => setDrawing({ ...drawing, points: undoDrawingPoint(drawing.points, drawing.mode) })}
      onCancel={() => { const editingId = drawing.editingId; setDrawing(null); if (editingId) setEditing({ territoryId: editingId }); }}
      onNext={() => { if (drawing.editingId) { setEditing({ territoryId: drawing.editingId, boundary: drawing.points }); setDrawing(null); } else { setNaming(drawing.points); setDrawing(null); } }} />}
    {naming && <NameNeighborhood color={namingColor} onColor={setNamingColor} onBack={() => { setDrawing({ mode: "polygon", points: naming }); setNaming(null); }} onSave={async (name, color) => {
      const id = await actions.addTerritory({ name, color, boundary: naming, center: centerForBoundary(naming) });
      setNaming(null); await actions.selectTerritory(id); showToast("Neighborhood saved");
    }} />}
    {editingTerritory && <EditNeighborhood data={data} territory={editingTerritory} onClose={() => setEditing(null)}
      onRedraw={() => { setEditing(null); setDrawing({ mode: "polygon", points: [], editingId: editingTerritory.id }); }}
      onSave={async (name, color) => { await actions.updateTerritory(editingTerritory.id, { name, color, boundary: editing?.boundary, center: editing?.boundary ? centerForBoundary(editing.boundary) : undefined }); setEditing(null); showToast("Neighborhood saved"); }}
      onDelete={async (destinationId) => { await actions.deleteTerritory(editingTerritory.id, destinationId); setEditing(null); showToast("Neighborhood deleted"); }} />}

    {logOpen && walk && <WalkLog data={data} visits={routeVisits} routeName={walkName} walkers={walkerNames} doors={doors} onBack={() => setLogOpen(false)} onOpen={(id) => { setLogOpen(false); const target = data.properties.find((item) => item.id === id); if (target?.coordinates) flyTo(target.coordinates); selectProperty(id); }} />}
    {wrapUpOpen && walk && <WalkWrapUp data={data} outing={walk.outing} routeName={walkName} visits={routeVisits} canManage={canManage} onAssign={onAssignFollowUp} onClose={() => setWrapUpOpen(false)} onFinish={async () => { await onFinishRoute(); setWrapUpOpen(false); }} />}
  </div>;
}

function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const ref = useFocusOnMount<HTMLInputElement>();
  return <input ref={ref} type="search" {...props} />;
}

/** Drag the pin, or tap the right house, then Save. */
function MovePin({ address, onCancel, onSave }: { address: string; onCancel: () => void; onSave: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Sheet className="plain-sheet move-sheet" label={`Move the pin for ${address}`} onDismiss={busy ? () => undefined : onCancel}>
    <p className="mono-meta pin-kicker">Move pin · {address}</p>
    <h2 className="pin-title">Drag it onto the right house</h2>
    <p className="pin-source">Or tap the house on the map.</p>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <div className="sheet-actions"><button type="button" className="walk-save quiet" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="walk-save" disabled={busy} onClick={() => { setBusy(true); setError(""); onSave().catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : "The pin couldn’t move."); setBusy(false); }); }}>{busy ? "Saving…" : "Save"}</button></div>
  </Sheet>;
}
