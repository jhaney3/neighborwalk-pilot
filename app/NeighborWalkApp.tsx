"use client";

import {
  BarChart3,
  BookOpenText,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  CloudOff,
  Edit3,
  LoaderCircle,
  Map as MapIcon,
  MapPin,
  MapPinned,
  Navigation,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Undo2,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapCanvas, type MapSearchTarget } from "../components/MapCanvas";
import { PropertyDrawer } from "../components/PropertyDrawer";
import { PeopleView } from "../components/PeopleView";
import { FollowUpsView } from "../components/FollowUpsView";
import { GuideView } from "../components/GuideView";
import { LeaderView } from "../components/LeaderView";
import { SettingsView } from "../components/SettingsView";
import { Modal } from "../components/ui";
import {
  centerForBoundary,
  outcomeMeta,
  visitsForProperty,
  type Coordinates,
  type NeighborWalkData,
  type Outcome,
  type ParcelReference,
  type Property,
  type Territory,
} from "../lib/domain";
import { useNeighborWalk, type SupabaseUser } from "../lib/use-neighborwalk";
import { conversationGuideTeam, preferredConversationGuide } from "../lib/conversation-guides";
import { forwardGeocode, reverseGeocode, type AddressSearchResult } from "../lib/geocoding";
import { dwellingsForParcel, parcelProgress } from "../lib/parcel-groups";
import { mergeParcelFeatureCollections, type MapViewport, type ParcelDetails } from "../lib/parcels";
import { coverageForTerritory, type TerritoryCoverageById } from "../lib/territory-coverage";
import { useTerritoryParcels } from "../lib/use-territory-parcels";
import { useVisibleParcels } from "../lib/use-visible-parcels";

type View = "map" | "people" | "followups" | "guide" | "leader" | "settings";
type AddIntent = { coordinates: Coordinates; suggestedAddress: string; buildingGeometry?: Coordinates[]; parcel?: ParcelDetails; legacyPropertyIds?: string[] };
type ParcelSelection = { parcel: ParcelReference; situsAddress?: string | null; propertyIds: string[] };
type SavedAddressResult = { propertyId: string; territoryId: string; label: string; detail: string; coordinates: Coordinates; color: string };
const EMPTY_TERRITORIES: Territory[] = [];
const EMPTY_PROPERTIES: Property[] = [];

const PARCEL_COUNTY_NAMES: Record<string, string> = {
  "47055": "Giles County",
  "47099": "Lawrence County",
  "47101": "Lewis County",
  "47181": "Wayne County",
};

function parcelReference(parcel: ParcelDetails): ParcelReference {
  return { id: parcel.id, countyFips: parcel.countyFips, gislink: parcel.gislink };
}

const mapFilterOptions: { value: "all" | Outcome; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unvisited", label: "Open" },
  { value: "conversation", label: "Talked" },
  { value: "no_answer", label: "No answer" },
  { value: "follow_up", label: "Follow-up" },
  { value: "do_not_visit", label: "Skip" },
];

export function NeighborWalkApp({ supabaseUser, onSignOut, onUpdatePassword }: { supabaseUser?: SupabaseUser | null; onSignOut?: () => Promise<void>; onUpdatePassword?: (password: string) => Promise<void> } = {}) {
  const { data, loading, storageError, online, saving, syncing, workspaceStatus, workspaceMembership, guideLibrary, guideLibraryError, activeTerritory, activeVolunteer, actions } = useNeighborWalk(supabaseUser);
  const [viewOverride, setViewOverride] = useState<View | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [followUpPersonId, setFollowUpPersonId] = useState<string | null>(null);
  const [guidedPropertyId, setGuidedPropertyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Outcome>("all");
  const [query, setQuery] = useState("");
  const [addressResults, setAddressResults] = useState<AddressSearchResult[]>([]);
  const [addressSearchStatus, setAddressSearchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<MapSearchTarget | null>(null);
  const [mapViewport, setMapViewport] = useState<MapViewport | null>(null);
  const searchTargetSequence = useRef(0);
  const [addMode, setAddMode] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<AddIntent | null>(null);
  const [selectedParcel, setSelectedParcel] = useState<ParcelSelection | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [draftBoundary, setDraftBoundary] = useState<Coordinates[]>([]);
  const [territoryEditorOpen, setTerritoryEditorOpen] = useState(false);
  const [editingTerritoryId, setEditingTerritoryId] = useState<string | null>(null);
  const [territoryPickerOpen, setTerritoryPickerOpen] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!data?.preferences.notificationsEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
    const today = new Date().toISOString().slice(0, 10);
    const due = data.followUps.filter((followUp) => followUp.status === "scheduled" && followUp.dueAt.slice(0, 10) <= today).length;
    const notificationKey = `neighborwalk-notified-${today}`;
    if (due && window.localStorage.getItem(notificationKey) !== String(due)) {
      new Notification("NeighborWalk follow-ups", { body: `${due} return visit${due === 1 ? " is" : "s are"} due today or overdue.` });
      window.localStorage.setItem(notificationKey, String(due));
    }
  }, [data?.followUps, data?.preferences.notificationsEnabled]);

  const visibleOutcomes = useMemo(() => new Set<Outcome>(
    filter === "all" ? Object.keys(outcomeMeta) as Outcome[] : [filter],
  ), [filter]);
  const territories = data?.territories ?? EMPTY_TERRITORIES;
  const properties = data?.properties ?? EMPTY_PROPERTIES;
  const activeTerritoryId = activeTerritory?.id;
  const territoryProperties = useMemo(() => properties.filter((property) => property.territoryId === activeTerritoryId), [properties, activeTerritoryId]);
  const territoryParcelResults = useTerritoryParcels(territories);
  const visibleParcelState = useVisibleParcels(mapViewport);
  const mapParcels = useMemo(() => mergeParcelFeatureCollections(
    activeTerritory ? territoryParcelResults[activeTerritory.id]?.parcels : undefined,
    visibleParcelState.parcels,
  ), [activeTerritory, territoryParcelResults, visibleParcelState.parcels]);
  const coverageByTerritory = useMemo<TerritoryCoverageById>(() => {
    return Object.fromEntries(territories.map((territory) => [
      territory.id,
      coverageForTerritory({ territories, properties }, territory.id, territoryParcelResults[territory.id]?.parcels),
    ]));
  }, [properties, territories, territoryParcelResults]);
  const savedAddressResults = useMemo<SavedAddressResult[]>(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!data || normalizedQuery.length < 2) return [];
    return data.properties
      .filter((property) => `${property.address} ${property.unit ?? ""}`.toLowerCase().includes(normalizedQuery))
      .slice(0, 4)
      .map((property) => ({
        propertyId: property.id,
        territoryId: property.territoryId,
        label: `${property.address}${property.unit ? ` · ${property.unit}` : ""}`,
        detail: `${data.territories.find((territory) => territory.id === property.territoryId)?.name ?? "Saved location"} · ${outcomeMeta[property.currentOutcome].label}`,
        coordinates: property.coordinates,
        color: outcomeMeta[property.currentOutcome].color,
      }));
  }, [data, query]);
  const searchProximityLongitude = activeTerritory?.center[0];
  const searchProximityLatitude = activeTerritory?.center[1];

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 3) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void forwardGeocode(normalizedQuery, {
        proximity: searchProximityLongitude !== undefined && searchProximityLatitude !== undefined
          ? [searchProximityLongitude, searchProximityLatitude]
          : undefined,
        signal: controller.signal,
      }).then((results) => {
        setAddressResults(results);
        setAddressSearchStatus("ready");
      }).catch((error: unknown) => {
        if ((error as { name?: string })?.name === "AbortError") return;
        setAddressResults([]);
        setAddressSearchStatus("error");
      });
    }, 260);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, searchProximityLatitude, searchProximityLongitude]);

  if (loading || workspaceStatus === "connecting") return <AppLoading />;
  if (data && supabaseUser && workspaceStatus === "invitation_required") {
    return <InvitationRequired user={supabaseUser} error={data.sync.lastError} onSignOut={onSignOut} />;
  }
  if (!data || !activeTerritory || !activeVolunteer) return <AppFailure error={storageError || "The app could not load its field data."} />;

  const pendingChanges = data.sync.pending.length;
  const syncStatusLabel = !online
    ? pendingChanges > 0 ? `${pendingChanges} saved offline` : "Working offline"
    : data.sync.mode === "device_only"
      ? "Saved on device"
      : syncing
        ? "Syncing changes"
        : pendingChanges > 0
          ? "Saving automatically"
          : "All changes saved";

  const canManage = workspaceMembership ? workspaceMembership.role === "leader" : activeVolunteer.role === "leader";
  const activeGuideTeam = conversationGuideTeam(data.teams, activeVolunteer.id, activeTerritory.assignedTeamId);
  const teamDefaultGuideId = activeGuideTeam ? guideLibrary.teamGuideDefaults[activeGuideTeam.id] : undefined;
  const favoriteConversationGuide = preferredConversationGuide(guideLibrary.guides, guideLibrary.favoriteGuideId, teamDefaultGuideId);
  const requestedView = typeof window === "undefined"
    ? data.preferences.lastView
    : new URLSearchParams(window.location.search).get("view") ?? data.preferences.lastView;
  const allowedViews: View[] = ["map", "people", "followups", "guide", "leader", "settings"];
  const initialView = allowedViews.includes(requestedView as View) ? requestedView as View : "map";
  const view = viewOverride ?? (initialView === "leader" && !canManage ? "map" : initialView);
  const coverage = coverageByTerritory[activeTerritory.id]
    ?? coverageForTerritory(data, activeTerritory.id);
  const coverageLabel = coverage.basis === "residential_parcels" ? "residential covered" : "mapped covered";
  const selectedProperty = data.properties.find((property) => property.id === selectedPropertyId) ?? null;
  const selectedVisits = selectedProperty ? visitsForProperty(data, selectedProperty.id) : [];
  const selectedFollowUp = selectedProperty ? data.followUps.find((followUp) => followUp.propertyId === selectedProperty.id && followUp.status === "scheduled") : undefined;
  const selectedPropertyDwellings = selectedProperty?.parcel
    ? dwellingsForParcel(data.properties, selectedProperty.parcel)
    : [];
  const selectedParcelDwellings = selectedParcel
    ? selectedParcel.propertyIds.flatMap((propertyId) => {
      const property = data.properties.find((candidate) => candidate.id === propertyId);
      return property ? [property] : [];
    })
    : [];
  const pendingParcelDwellings = pendingAdd?.parcel
    ? dwellingsForParcel(data.properties, pendingAdd.parcel)
    : [];
  const openFollowUps = data.followUps.filter((followUp) => followUp.status === "scheduled").length;
  const activePeople = data.residents.filter((resident) => resident.status === "active").length;
  const editingTerritory = editingTerritoryId ? data.territories.find((territory) => territory.id === editingTerritoryId) : undefined;
  const territoryEditorEventId = editingTerritory?.eventId ?? data.preferences.activeEventId;
  const territoryEditorTeams = data.teams.filter((team) => team.eventId === territoryEditorEventId);
  const territoryEditorTerritories = data.territories.filter((territory) => territory.eventId === territoryEditorEventId);

  const focusSearchTarget = (coordinates: Coordinates, zoom: number) => {
    searchTargetSequence.current += 1;
    setSearchTarget({ id: `search-${searchTargetSequence.current}`, coordinates, zoom });
    setSelectedParcel(null);
    setAddMode(false);
    setSearchOpen(false);
  };

  const selectSavedAddress = (result: SavedAddressResult) => {
    if (result.territoryId !== activeTerritory.id) actions.selectTerritory(result.territoryId);
    setGuidedPropertyId(null);
    setSelectedPropertyId(result.propertyId);
    setQuery(result.label);
    focusSearchTarget(result.coordinates, 18);
  };

  const selectGeocodedAddress = (result: AddressSearchResult) => {
    setSelectedPropertyId(null);
    setQuery(result.label);
    focusSearchTarget(result.coordinates, result.zoom);
    setToast(result.type === "address"
      ? data.sync.mode === "connected" ? "Address found — loading nearby parcels" : "Address found"
      : "Map moved to this result");
  };

  const clearAddressSearch = () => {
    setQuery("");
    setAddressResults([]);
    setAddressSearchStatus("idle");
    setSearchOpen(false);
    setSearchTarget(null);
  };

  const navigate = (next: View) => {
    setViewOverride(next);
    setSelectedPropertyId(null);
    setGuidedPropertyId(null);
    setSelectedParcel(null);
    setAddMode(false);
    if (next !== "map") {
      setDrawMode(false);
      setDraftBoundary([]);
    }
    actions.setPreference("lastView", next);
  };

  const handleAddProperty = (address: string, unit: string, startGuided: boolean) => {
    if (!pendingAdd) return;
    const propertyId = actions.addProperty({ ...pendingAdd, address, unit });
    setPendingAdd(null);
    setAddMode(false);
    setGuidedPropertyId(startGuided ? propertyId : null);
    setSelectedPropertyId(propertyId);
    setToast(startGuided ? "Location added — conversation guide ready" : pendingAdd.parcel ? "Dwelling added to this parcel" : "Location added to this territory");
  };

  const beginAddingDwelling = () => {
    setSelectedParcel(null);
    setSelectedPropertyId(null);
    setGuidedPropertyId(null);
    setPendingAdd(null);
    setAddMode(true);
    setToast("Tap the next dwelling or entrance on the parcel");
  };

  const startDrawing = () => {
    navigate("map");
    setSelectedPropertyId(null);
    setAddMode(false);
    setEditingTerritoryId(null);
    setTerritoryEditorOpen(false);
    setDraftBoundary([]);
    setDrawMode(true);
  };

  const openTerritoryEditor = (territoryId: string) => {
    actions.selectTerritory(territoryId);
    setEditingTerritoryId(territoryId);
    setTerritoryPickerOpen(false);
    setTerritoryEditorOpen(true);
  };

  const startBoundaryRedraw = (territoryId: string) => {
    navigate("map");
    actions.selectTerritory(territoryId);
    setSelectedPropertyId(null);
    setAddMode(false);
    setEditingTerritoryId(territoryId);
    setTerritoryEditorOpen(false);
    setDraftBoundary([]);
    setDrawMode(true);
  };

  const cancelDrawing = () => {
    setDrawMode(false);
    setDraftBoundary([]);
    setEditingTerritoryId(null);
    setTerritoryEditorOpen(false);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => navigate("map")} aria-label="Open NeighborWalk map">
          <span className="brand-mark" aria-hidden="true"><Navigation size={18} /></span>
          <span><strong>NeighborWalk</strong><small>{data.church.name}</small></span>
        </button>
        <div className="header-status">
          <span className={`network-chip ${online ? "online" : "offline"}`} aria-live="polite">{online ? <ShieldCheck size={13} /> : <WifiOff size={13} />}{syncStatusLabel}</span>
          {saving && !syncing && <span className="saving-label">Saving on device…</span>}
          <button className="profile-button" onClick={() => navigate("settings")} aria-label="Open profile and settings"><CircleUserRound size={21} /><span>{activeVolunteer.name}</span></button>
        </div>
      </header>

      <div className="app-body">
        <aside className="desktop-sidebar">
          <div className="sidebar-context">
            <label><span>Active event</span><div className="select-wrap"><select value={data.preferences.activeEventId} onChange={(event) => actions.setPreference("activeEventId", event.target.value)}>{data.events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select><ChevronDown size={14} /></div></label>
            <label><span>Territory</span><div className="select-wrap"><select value={activeTerritory.id} onChange={(event) => actions.selectTerritory(event.target.value)}>{data.territories.filter((territory) => territory.eventId === data.preferences.activeEventId).map((territory) => <option key={territory.id} value={territory.id}>{territory.name}</option>)}</select><ChevronDown size={14} /></div></label>
          </div>
          <div className="coverage-card">
            <div><strong>{coverage.percent}%</strong><span>{coverageLabel}</span></div>
            <div className="progress-track"><i style={{ width: `${coverage.percent}%` }} /></div>
            <p><span>{coverage.touched} touched</span><span>{coverage.remaining} remaining</span></p>
          </div>
          <nav className="sidebar-nav" aria-label="Main sections">
            <NavButton active={view === "map"} icon={<MapIcon size={18} />} label="Walk map" onClick={() => navigate("map")} />
            <NavButton active={view === "people"} icon={<Users size={18} />} label="People" count={activePeople} onClick={() => navigate("people")} />
            <NavButton active={view === "followups"} icon={<CalendarClock size={18} />} label="Follow-ups" count={openFollowUps} onClick={() => { setFollowUpPersonId(null); navigate("followups"); }} />
            <NavButton active={view === "guide"} icon={<BookOpenText size={18} />} label="Conversation guide" onClick={() => navigate("guide")} />
            {canManage && <NavButton active={view === "leader"} icon={<BarChart3 size={18} />} label="Leader view" onClick={() => navigate("leader")} />}
            <NavButton active={view === "settings"} icon={<Settings2 size={18} />} label="Settings" onClick={() => navigate("settings")} />
          </nav>
          <div className="sidebar-footer">
            <div className="local-mode"><CloudOff size={16} /><p><strong>{data.sync.mode === "connected" ? "Automatic sync" : "Device-only mode"}</strong><span>{data.sync.mode === "connected" ? syncStatusLabel : "Connect your backend to share records."}</span></p></div>
            <span className="privacy-note"><ShieldCheck size={13} /> Privacy-first field records</span>
          </div>
        </aside>

        <section className="workspace">
          {view === "map" && (
            <section className="map-view">
              <div className="mobile-context-row">
                <div><p className="eyebrow">{data.events.find((event) => event.id === data.preferences.activeEventId)?.name}</p><button onClick={() => setTerritoryPickerOpen(true)}><strong>{activeTerritory.name}</strong><ChevronDown size={15} /></button></div>
                <div><strong>{coverage.percent}%</strong><span>{coverageLabel}</span></div>
              </div>
              <div className="map-toolbar">
                <div className="map-filter-scroll" aria-label="Filter locations">{mapFilterOptions.map((option) => <button key={option.value} className={filter === option.value ? "active" : ""} onClick={() => setFilter(option.value)}>{option.label}{option.value !== "all" && <i style={{ background: outcomeMeta[option.value].color }} />}</button>)}</div>
                <div className="map-search-wrap" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false); }}>
                  <div className={`map-search${searchOpen ? " active" : ""}`}>
                    <Search size={16} />
                    <input
                      type="search"
                      role="combobox"
                      value={query}
                      onChange={(event) => {
                        const nextQuery = event.target.value;
                        setQuery(nextQuery);
                        setAddressResults([]);
                        setAddressSearchStatus(nextQuery.trim().length >= 3 ? "loading" : "idle");
                        setSearchOpen(true);
                      }}
                      onFocus={() => setSearchOpen(true)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setSearchOpen(false);
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (savedAddressResults[0]) selectSavedAddress(savedAddressResults[0]);
                          else if (addressResults[0]) selectGeocodedAddress(addressResults[0]);
                        }
                      }}
                      placeholder="Search any address"
                      aria-label="Search any address"
                      aria-expanded={searchOpen && Boolean(query.trim())}
                      aria-controls="address-search-results"
                      aria-autocomplete="list"
                    />
                    {addressSearchStatus === "loading" && <LoaderCircle className="spin" size={14} aria-label="Searching addresses" />}
                    {query && <button onClick={clearAddressSearch} aria-label="Clear address search"><X size={14} /></button>}
                  </div>
                  {searchOpen && query.trim() && <div id="address-search-results" className="map-search-results" aria-label="Address search results">
                    {savedAddressResults.length > 0 && <div className="map-search-group">
                      <span className="map-search-group-label">Saved locations</span>
                      {savedAddressResults.map((result) => <button key={result.propertyId} onClick={() => selectSavedAddress(result)}>
                        <span className="map-search-result-icon saved"><i style={{ background: result.color }} /></span>
                        <span className="map-search-result-copy"><strong>{result.label}</strong><small>{result.detail}</small></span>
                        <ChevronRight size={14} />
                      </button>)}
                    </div>}
                    {addressResults.length > 0 && <div className="map-search-group">
                      <span className="map-search-group-label">Address results</span>
                      {addressResults.map((result) => <button key={result.id} onClick={() => selectGeocodedAddress(result)}>
                        <span className="map-search-result-icon"><MapPin size={15} /></span>
                        <span className="map-search-result-copy"><strong>{result.label}</strong><small>{result.type === "address" ? "Address" : result.type === "road" ? "Street" : "Place"} · View on map</small></span>
                        <ChevronRight size={14} />
                      </button>)}
                    </div>}
                    {query.trim().length < 3 && <p>Type at least 3 characters to search addresses.</p>}
                    {query.trim().length >= 3 && addressSearchStatus === "loading" && !savedAddressResults.length && <p className="map-search-loading"><LoaderCircle className="spin" size={14} /> Searching addresses…</p>}
                    {query.trim().length >= 3 && addressSearchStatus === "ready" && !savedAddressResults.length && !addressResults.length && <p>No address found. Try the street number, street, city, and state.</p>}
                    {addressSearchStatus === "error" && <p>Address search is unavailable. Check the connection and try again.</p>}
                  </div>}
                </div>
              </div>
              <div className="map-stage">
                <MapCanvas territory={activeTerritory} properties={territoryProperties} selectedPropertyId={selectedPropertyId} visibleOutcomes={visibleOutcomes} searchTarget={searchTarget} addMode={addMode} drawMode={drawMode} drawModeLabel={editingTerritoryId ? "Tap the corners of the replacement boundary" : "Tap at least 3 corners"} draftBoundary={draftBoundary} compactMarkers={data.preferences.compactMapMarkers} mapStyleUrl={data.preferences.mapStyleUrl} parcels={mapParcels} onViewportChange={setMapViewport} onSelectProperty={(id) => { setSelectedPropertyId(id); setGuidedPropertyId(null); setSelectedParcel(null); setAddMode(false); }} onAddIntent={async (intent) => {
                  if (intent.parcel) {
                    const linkedDwellings = dwellingsForParcel(territoryProperties, intent.parcel);
                    const legacyPropertyIds = intent.legacyPropertyIds ?? [];
                    if (legacyPropertyIds.length) {
                      actions.associatePropertiesWithParcel(legacyPropertyIds, parcelReference(intent.parcel));
                    }
                    const propertyIds = [...new Set([
                      ...linkedDwellings.map((property) => property.id),
                      ...legacyPropertyIds,
                    ])];
                    if (!addMode && propertyIds.length) {
                      setSelectedPropertyId(null);
                      setSelectedParcel({
                        parcel: parcelReference(intent.parcel),
                        situsAddress: intent.parcel.situsAddress,
                        propertyIds,
                      });
                      return;
                    }
                  }
                  if (intent.parcel?.situsAddress) {
                    setSelectedParcel(null);
                    setPendingAdd(intent);
                    setToast("Official parcel selected");
                    return;
                  }
                  setToast("Checking this map location…");
                  try {
                    const address = await reverseGeocode(intent.coordinates);
                    setPendingAdd(address ? { ...intent, suggestedAddress: address } : intent);
                  } catch {
                    setPendingAdd(intent);
                  }
                }} onAssociatePropertiesWithParcel={(propertyIds, parcel) => actions.associatePropertiesWithParcel(propertyIds, parcelReference(parcel))} onDraftBoundaryChange={setDraftBoundary} />
                <div className="map-floating-actions">
                  {!drawMode && <button className={`map-action-button ${addMode ? "active" : ""}`} aria-label={addMode ? "Cancel adding a location" : "Add a location"} onClick={() => { setAddMode((current) => !current); setSelectedPropertyId(null); setGuidedPropertyId(null); setSelectedParcel(null); }}><Plus size={18} /><span>{addMode ? "Cancel adding" : "Add location"}</span></button>}
                  {canManage && !drawMode && <button className="map-action-button secondary" aria-label={`Edit ${activeTerritory.name}`} onClick={() => openTerritoryEditor(activeTerritory.id)}><Edit3 size={18} /><span>Edit territory</span></button>}
                  {canManage && !drawMode && <button className="map-action-button secondary" aria-label="Draw a territory" onClick={startDrawing}><MapPinned size={18} /><span>Draw territory</span></button>}
                </div>
                {drawMode && <div className="draw-controls"><button className="button quiet" disabled={!draftBoundary.length} onClick={() => setDraftBoundary((points) => points.slice(0, -1))}><Undo2 size={15} /> Undo</button><button className="button quiet" onClick={cancelDrawing}>Cancel</button><button className="button primary" disabled={draftBoundary.length < 3} onClick={() => setTerritoryEditorOpen(true)}><Check size={15} /> Finish boundary</button></div>}
              </div>
              {selectedProperty && <PropertyDrawer key={selectedProperty.id} property={selectedProperty} parcelDwellings={selectedPropertyDwellings} data={data} visits={selectedVisits} openFollowUp={selectedFollowUp} conversationGuide={favoriteConversationGuide} conversationGuideContext={teamDefaultGuideId && activeGuideTeam ? `${activeGuideTeam.name} default` : "Your favorite"} canManage={canManage} activeVolunteerId={activeVolunteer.id} startGuided={guidedPropertyId === selectedProperty.id} onClose={() => { setSelectedPropertyId(null); setGuidedPropertyId(null); }} onViewParcel={selectedProperty.parcel ? () => { setSelectedParcel({ parcel: selectedProperty.parcel!, situsAddress: selectedProperty.address, propertyIds: selectedPropertyDwellings.map((property) => property.id) }); setSelectedPropertyId(null); setGuidedPropertyId(null); } : undefined} onAddDwelling={selectedProperty.parcel ? beginAddingDwelling : undefined} onRecordVisit={(input) => { actions.recordVisit(input); setToast(`${outcomeMeta[input.outcome].label} saved`); }} onUpdateProperty={actions.updateProperty} onDeleteProperty={actions.deleteProperty} onUpsertResident={actions.upsertResident} onDeleteResident={actions.deleteResident} />}
            </section>
          )}
          {view === "followups" && <FollowUpsView data={data} canManage={canManage} activeVolunteerId={activeVolunteer.id} initialPersonId={followUpPersonId} onClearPersonFocus={() => setFollowUpPersonId(null)} onOpenProperty={(propertyId) => { navigate("map"); setGuidedPropertyId(null); setSelectedPropertyId(propertyId); const property = data.properties.find((item) => item.id === propertyId); if (property) actions.selectTerritory(property.territoryId); }} onOpenPerson={(residentId) => { setSelectedPersonId(residentId); navigate("people"); }} onAddPersonNote={actions.addPersonNote} onComplete={(id, input) => { actions.completeFollowUp(id, input); setToast(input.nextFollowUp ? "Follow-up completed and next task scheduled" : "Follow-up completed"); }} onReschedule={(id, date, note) => { actions.rescheduleFollowUp(id, date, note); setToast("Follow-up rescheduled"); }} onCancel={(id, note) => { actions.cancelFollowUp(id, note); setToast("Follow-up cancelled"); }} />}
          {view === "people" && <PeopleView data={data} canManage={canManage} activeVolunteerId={activeVolunteer.id} initialSelectedResidentId={selectedPersonId} onOpenProperty={(propertyId) => { navigate("map"); setGuidedPropertyId(null); setSelectedPropertyId(propertyId); const property = data.properties.find((item) => item.id === propertyId); if (property) actions.selectTerritory(property.territoryId); }} onUpsertResident={actions.upsertResident} onDeleteResident={actions.deleteResident} onAddPersonNote={actions.addPersonNote} onDeletePersonNote={actions.deletePersonNote} onAddPersonFollowUp={actions.addPersonFollowUp} onOpenFollowUps={(residentId) => { setFollowUpPersonId(residentId); navigate("followups"); }} />}
          {view === "guide" && <GuideView guides={guideLibrary.guides} favoriteGuideId={guideLibrary.favoriteGuideId} effectiveGuideId={favoriteConversationGuide?.id} activeTeamId={activeGuideTeam?.id} activeTeamName={activeGuideTeam?.name} teams={data.teams} teamGuideDefaults={guideLibrary.teamGuideDefaults} canManage={canManage} allowBuiltInManagement={data.sync.mode === "device_only"} libraryError={guideLibraryError} onSave={actions.saveConversationGuide} onDelete={actions.deleteConversationGuide} onSetFavorite={actions.setFavoriteConversationGuide} onSetTeamDefault={actions.setTeamConversationGuide} />}
          {view === "leader" && canManage && <LeaderView data={data} coverageByTerritory={coverageByTerritory} membership={workspaceMembership} activeTerritory={activeTerritory} onSelectTerritory={(id) => { actions.selectTerritory(id); }} onEditTerritory={openTerritoryEditor} onStartDrawing={startDrawing} onAddTeam={actions.addTeam} onUpdateTeam={actions.updateTeam} onDeleteTeam={actions.deleteTeam} />}
          {view === "settings" && <SettingsView data={data} online={online} saving={saving} syncing={syncing} storageError={storageError} canManage={canManage} guides={guideLibrary.guides} favoriteGuideId={guideLibrary.favoriteGuideId} accountEmail={supabaseUser?.email} onSignOut={onSignOut} onUpdatePassword={onUpdatePassword} onUpdateChurch={actions.updateChurch} onSetPreference={actions.setPreference} onSetFavoriteGuide={actions.setFavoriteConversationGuide} onExport={actions.downloadBackup} onImport={actions.importBackup} onPurge={actions.purgeExpired} onClearOutreach={actions.clearOutreachData} onSync={actions.syncNow} />}
        </section>
      </div>

      <nav className="mobile-nav" aria-label="Main navigation">
        <MobileNav active={view === "map"} icon={<MapIcon size={20} />} label="Map" onClick={() => navigate("map")} />
        <MobileNav active={view === "people"} icon={<Users size={20} />} label="People" count={activePeople} onClick={() => navigate("people")} />
        <MobileNav active={view === "followups"} icon={<CalendarClock size={20} />} label="Follow-ups" count={openFollowUps} onClick={() => { setFollowUpPersonId(null); navigate("followups"); }} />
        <MobileNav active={view === "guide"} icon={<BookOpenText size={20} />} label="Guide" onClick={() => navigate("guide")} />
        {canManage ? <MobileNav active={view === "leader"} icon={<BarChart3 size={20} />} label="Leader" onClick={() => navigate("leader")} /> : <MobileNav active={view === "settings"} icon={<Settings2 size={20} />} label="Settings" onClick={() => navigate("settings")} />}
      </nav>

      {pendingAdd && <AddPropertyModal intent={pendingAdd} existingDwellingCount={pendingParcelDwellings.length} guideName={favoriteConversationGuide?.title} guideAvailable={Boolean(favoriteConversationGuide?.steps.length)} onClose={() => { setPendingAdd(null); setAddMode(false); }} onSave={handleAddProperty} />}
      {selectedParcel && <ParcelSummaryModal selection={selectedParcel} dwellings={selectedParcelDwellings} onClose={() => setSelectedParcel(null)} onOpenDwelling={(propertyId) => { setSelectedParcel(null); setGuidedPropertyId(null); setSelectedPropertyId(propertyId); }} onAddDwelling={beginAddingDwelling} />}
      {territoryPickerOpen && <TerritoryPickerModal data={data} coverageByTerritory={coverageByTerritory} activeTerritoryId={activeTerritory.id} canManage={canManage} onClose={() => setTerritoryPickerOpen(false)} onSelect={(territoryId) => { actions.selectTerritory(territoryId); setTerritoryPickerOpen(false); setSelectedPropertyId(null); }} onEdit={openTerritoryEditor} onDraw={() => { setTerritoryPickerOpen(false); startDrawing(); }} />}
      {territoryEditorOpen && <TerritoryModal key={`${editingTerritoryId ?? "new"}-${draftBoundary.length}`} territory={editingTerritory} territories={territoryEditorTerritories} teams={territoryEditorTeams} boundaryChanged={draftBoundary.length >= 3} onClose={() => { setTerritoryEditorOpen(false); if (!drawMode) setEditingTerritoryId(null); }} onRedraw={editingTerritoryId ? () => startBoundaryRedraw(editingTerritoryId) : undefined} onDelete={editingTerritory ? (destinationTerritoryId) => {
        const destination = data.territories.find((territory) => territory.id === destinationTerritoryId);
        actions.deleteTerritory(editingTerritory.id, destinationTerritoryId);
        setSelectedPropertyId(null); setDraftBoundary([]); setDrawMode(false); setEditingTerritoryId(null); setTerritoryEditorOpen(false); setToast(destination ? `Territory deleted; records moved to ${destination.name}` : "Territory deleted");
      } : undefined} onSave={(name, color, assignedTeamId) => {
        if (editingTerritory) {
          const replacementBoundary = draftBoundary.length >= 3 ? draftBoundary : undefined;
          actions.updateTerritory(editingTerritory.id, {
            name,
            color,
            assignedTeamId: assignedTeamId || undefined,
            boundary: replacementBoundary,
            center: replacementBoundary ? centerForBoundary(replacementBoundary) : undefined,
          });
          setToast("Territory updated");
        } else if (draftBoundary.length >= 3) {
          actions.addTerritory({ name, color, assignedTeamId: assignedTeamId || undefined, boundary: draftBoundary, center: centerForBoundary(draftBoundary) });
          setToast("Territory created");
        }
        setDraftBoundary([]); setDrawMode(false); setEditingTerritoryId(null); setTerritoryEditorOpen(false);
      }} />}
      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </main>
  );
}

function InvitationRequired({ user, error, onSignOut }: { user: SupabaseUser; error?: string; onSignOut?: () => Promise<void> }) {
  return (
    <main className="workspace-setup-shell">
      <section className="workspace-setup-card" aria-labelledby="workspace-title">
        <div className="workspace-setup-mark"><Users size={22} /></div>
        <p className="eyebrow">Invitation required</p>
        <h1 id="workspace-title">Ask your leader for an invitation link.</h1>
        <p>NeighborWalk is private to your church team. Open the one-time link from a leader, then sign in with the exact email address they invited.</p>
        <div className="workspace-account"><CircleUserRound size={17} /><span><strong>Signed in</strong>{user.email}</span></div>
        <div className="data-note"><ShieldCheck size={16} /><span>Invitation links expire after 7 days, work once, and cannot be used by a different email.</span></div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {onSignOut && <button className="button quiet" onClick={() => void onSignOut()}>Use a different account</button>}
      </section>
    </main>
  );
}

function AddPropertyModal({ intent, existingDwellingCount, guideName, guideAvailable, onClose, onSave }: {
  intent: AddIntent;
  existingDwellingCount: number;
  guideName?: string;
  guideAvailable: boolean;
  onClose: () => void;
  onSave: (address: string, unit: string, startGuided: boolean) => void;
}) {
  const [address, setAddress] = useState(intent.suggestedAddress);
  const [unit, setUnit] = useState("");
  const countyName = intent.parcel ? PARCEL_COUNTY_NAMES[intent.parcel.countyFips] ?? "Tennessee" : null;
  const needsLabel = existingDwellingCount > 0;
  const canSave = address.trim().length >= 3 && (!needsLabel || unit.trim().length > 0);
  return (
    <Modal
      title={needsLabel ? "Add another dwelling" : "Add this location"}
      description={intent.parcel ? "Each dwelling keeps its own visits, outcome, and follow-ups." : "Confirm the address, then start the visit your way."}
      onClose={onClose}
    >
      <div className="location-preview"><MapPinned size={20} /><span><strong>{intent.parcel ? `Official ${countyName} parcel` : "Map location selected"}</strong>{intent.coordinates[1].toFixed(6)}, {intent.coordinates[0].toFixed(6)}{intent.buildingGeometry ? " · Building found" : ""}</span></div>
      {intent.parcel && <div className="parcel-preview"><span><strong>{intent.parcel.propertyClass ?? "Unclassified parcel"}</strong><small>{intent.parcel.landUse ?? "No land-use description in the county file"}</small></span><ShieldCheck size={15} /><small>Owner names and property values are not stored.</small></div>}
      {needsLabel && <div className="parcel-existing-note"><Building2 size={17} /><span><strong>{existingDwellingCount} {existingDwellingCount === 1 ? "dwelling is" : "dwellings are"} already mapped here</strong>Add a clear label so the next volunteer can choose the right door.</span></div>}
      <div className="form-stack">
        <label className="form-field"><span>Street address</span><input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
        <label className="form-field"><span>Dwelling label or unit <small>{needsLabel ? "Required" : "Optional"}</small></span><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Rear house, Unit B, Apartment 2" /></label>
      </div>
      {guideAvailable && <div className="guided-start-note"><BookOpenText size={17} /><span><strong>Want a little help at the door?</strong>The guided path opens with {guideName || "your favorite guide"}. You can leave it at any time.</span></div>}
      <div className="modal-actions split add-location-actions">
        <button className="button quiet" onClick={onClose}>Cancel</button>
        <div>
          <button className="button quiet" disabled={!canSave} onClick={() => onSave(address, unit, false)}><Plus size={15} /> {guideAvailable ? "Add without guide" : "Add dwelling"}</button>
          {guideAvailable && <button className="button primary" disabled={!canSave} onClick={() => onSave(address, unit, true)}><BookOpenText size={15} /> Add &amp; use guide</button>}
        </div>
      </div>
    </Modal>
  );
}

function ParcelSummaryModal({ selection, dwellings, onClose, onOpenDwelling, onAddDwelling }: {
  selection: ParcelSelection;
  dwellings: NeighborWalkData["properties"];
  onClose: () => void;
  onOpenDwelling: (propertyId: string) => void;
  onAddDwelling: () => void;
}) {
  const progress = parcelProgress(dwellings);
  const address = selection.situsAddress ?? dwellings[0]?.address ?? "Selected parcel";
  return (
    <Modal title={`${progress.total} ${progress.total === 1 ? "dwelling" : "dwellings"} on this parcel`} description={address} onClose={onClose}>
      <div className="parcel-tally">
        <div><span>Doorstep tally</span><strong>{progress.visited}<small> / {progress.total}</small></strong></div>
        <div><span>{progress.remaining ? `${progress.remaining} still to visit` : "Every dwelling visited"}</span><div className="parcel-tally-track"><i style={{ width: `${progress.percent}%` }} /></div></div>
      </div>
      <div className="parcel-dwelling-list" aria-label="Dwellings on this parcel">
        {dwellings.map((property) => (
          <button key={property.id} onClick={() => onOpenDwelling(property.id)}>
            <i style={{ background: outcomeMeta[property.currentOutcome].color }} />
            <span><strong>{property.unit || property.address}</strong><small>{property.unit ? property.address : "Main dwelling"} · {outcomeMeta[property.currentOutcome].label}</small></span>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
      <div className="parcel-meaning"><Building2 size={16} /><span>The parcel stays neutral on the map. Each dwelling dot carries its own visit color.</span></div>
      <div className="modal-actions"><button className="button quiet" onClick={onClose}>Close</button><button className="button primary" onClick={onAddDwelling}><Plus size={15} /> Add another dwelling</button></div>
    </Modal>
  );
}

function TerritoryModal({ territory, territories, teams, boundaryChanged, onClose, onRedraw, onDelete, onSave }: {
  territory?: Territory;
  territories: NeighborWalkData["territories"];
  teams: NeighborWalkData["teams"];
  boundaryChanged: boolean;
  onClose: () => void;
  onRedraw?: () => void;
  onDelete?: (destinationTerritoryId: string) => void;
  onSave: (name: string, color: string, assignedTeamId: string) => void;
}) {
  const [name, setName] = useState(territory?.name ?? "");
  const [color, setColor] = useState(territory?.color ?? "#286c59");
  const [assignedTeamId, setAssignedTeamId] = useState(territory?.assignedTeamId ?? "");
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const editing = Boolean(territory);
  const deleteTargets = territories.filter((item) => item.id !== territory?.id);
  const [deleteDestinationId, setDeleteDestinationId] = useState(deleteTargets[0]?.id ?? "");
  const canDelete = deleteTargets.length > 0;
  const boundaryPoints = boundaryChanged ? "Replacement boundary ready" : `${territory?.boundary.length ?? 0} boundary points`;

  return (
    <Modal
      title={editing ? "Edit territory" : "Finish this territory"}
      description={editing ? "Change how this territory appears and who is assigned to it." : "Name the boundary and choose the team that will cover it."}
      onClose={onClose}
    >
      <div className="form-stack">
        <label className="form-field"><span>Territory name</span><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: Oakwood North" /></label>
        <div className="territory-form-row">
          <label className="form-field"><span>Map color</span><input className="territory-color-input" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
          <label className="form-field"><span>Assigned team</span><select value={assignedTeamId} onChange={(event) => setAssignedTeamId(event.target.value)}><option value="">Unassigned</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        </div>
        <div className={`territory-boundary-summary${boundaryChanged ? " changed" : ""}`}>
          <span><MapPinned size={18} /></span>
          <div><strong>{boundaryPoints}</strong><small>Existing locations and visit history stay attached to this territory.</small></div>
          {editing && onRedraw && <button className="button quiet small" onClick={onRedraw}><Edit3 size={14} /> Redraw</button>}
        </div>
        {editing && deleting && <div className="territory-delete-confirm"><strong>Delete this territory?</strong><p>Nothing recorded here will be deleted. Locations and visit history will move to the territory you choose; follow-ups and people stay with their locations.</p><label className="form-field"><span>Move records to</span><select value={deleteDestinationId} onChange={(event) => setDeleteDestinationId(event.target.value)}>{deleteTargets.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="form-field"><span>Type <strong>{territory?.name}</strong> to confirm</span><input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} aria-label="Territory name confirmation" /></label></div>}
      </div>
      <div className="modal-actions split">{editing && onDelete ? <button className="button danger" disabled={!canDelete || (deleting && (deleteConfirmation !== territory?.name || !deleteDestinationId))} onClick={() => deleting ? onDelete(deleteDestinationId) : setDeleting(true)}>{deleting ? "Delete and move records" : "Delete territory"}</button> : <span />}<div><button className="button quiet" onClick={onClose}>Cancel</button><button className="button primary" onClick={() => onSave(name, color, assignedTeamId)} disabled={name.trim().length < 3}><Check size={15} /> {editing ? "Save changes" : "Create territory"}</button></div></div>
      {editing && !canDelete && <p className="modal-footnote">Create another territory in this event before deleting its last one.</p>}
    </Modal>
  );
}

function TerritoryPickerModal({ data, coverageByTerritory, activeTerritoryId, canManage, onClose, onSelect, onEdit, onDraw }: { data: NeighborWalkData; coverageByTerritory: TerritoryCoverageById; activeTerritoryId: string; canManage: boolean; onClose: () => void; onSelect: (territoryId: string) => void; onEdit: (territoryId: string) => void; onDraw: () => void }) {
  const territories = data.territories.filter((territory) => territory.eventId === data.preferences.activeEventId);
  return <Modal title="Choose a territory" description="Switch the map and coverage view for this outreach event." onClose={onClose}><div className="territory-picker-list">{territories.map((territory) => { const coverage = coverageByTerritory[territory.id] ?? coverageForTerritory(data, territory.id); return <div key={territory.id} className={`territory-picker-row${territory.id === activeTerritoryId ? " active" : ""}`}><i style={{ background: territory.color }} /><button className="territory-picker-select" onClick={() => onSelect(territory.id)}><span><strong>{territory.name}</strong><small>{coverage.percent}% covered · {coverage.remaining} residential remaining</small></span>{territory.id === activeTerritoryId && <Check size={16} />}</button>{canManage && <button className="territory-picker-edit" onClick={() => onEdit(territory.id)} aria-label={`Edit ${territory.name}`}><Edit3 size={16} /></button>}</div>; })}</div><div className="modal-actions"><button className="button quiet" onClick={onClose}>Close</button>{canManage && <button className="button primary" onClick={onDraw}><MapPinned size={15} /> Draw a new territory</button>}</div></Modal>;
}

function NavButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick} aria-current={active ? "page" : undefined}>{icon}<span>{label}</span>{count ? <b>{count}</b> : null}</button>;
}

function MobileNav({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick} aria-current={active ? "page" : undefined}><span>{icon}{count ? <b>{count}</b> : null}</span><small>{label}</small></button>;
}

function AppLoading() {
  return <main className="app-loading" role="status"><div className="loading-mark"><Navigation size={23} /></div><strong>Preparing your territory</strong><span>Loading offline records and the neighborhood map…</span></main>;
}

function AppFailure({ error }: { error: string }) {
  return <main className="app-loading error"><div className="loading-mark"><X size={23} /></div><strong>NeighborWalk could not start</strong><span>{error}</span><button className="button primary" onClick={() => location.reload()}>Try again</button></main>;
}
