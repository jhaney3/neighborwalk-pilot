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
  Layers3,
  Map as MapIcon,
  MapPinned,
  Navigation,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  TimerReset,
  Undo2,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MapCanvas } from "../components/MapCanvas";
import { PropertyDrawer } from "../components/PropertyDrawer";
import { FollowUpsView, GuideView, LeaderView, Modal, SettingsView } from "../components/Views";
import {
  coverageForTerritory,
  centerForBoundary,
  outcomeMeta,
  visitsForProperty,
  type Coordinates,
  type NeighborWalkData,
  type Outcome,
  type ParcelReference,
  type Territory,
} from "../lib/domain";
import { useNeighborWalk, type SupabaseUser } from "../lib/use-neighborwalk";
import { reverseGeocode } from "../lib/geocoding";
import { MAP_STYLE_OPTIONS } from "../lib/map-config";
import { dwellingsForParcel, parcelProgress } from "../lib/parcel-groups";
import type { ParcelDetails } from "../lib/parcels";

type View = "map" | "followups" | "guide" | "leader" | "settings";
type AddIntent = { coordinates: Coordinates; suggestedAddress: string; buildingGeometry?: Coordinates[]; parcel?: ParcelDetails; legacyPropertyIds?: string[] };
type ParcelSelection = { parcel: ParcelReference; situsAddress?: string | null; propertyIds: string[] };

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

export function NeighborWalkApp({ supabaseUser, onSignOut }: { supabaseUser?: SupabaseUser | null; onSignOut?: () => Promise<void> } = {}) {
  const { data, loading, storageError, online, saving, syncing, workspaceStatus, workspaceMembership, activeTerritory, activeVolunteer, actions } = useNeighborWalk(supabaseUser);
  const [viewOverride, setViewOverride] = useState<View | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Outcome>("all");
  const [query, setQuery] = useState("");
  const [addMode, setAddMode] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<AddIntent | null>(null);
  const [selectedParcel, setSelectedParcel] = useState<ParcelSelection | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [draftBoundary, setDraftBoundary] = useState<Coordinates[]>([]);
  const [territoryEditorOpen, setTerritoryEditorOpen] = useState(false);
  const [editingTerritoryId, setEditingTerritoryId] = useState<string | null>(null);
  const [territoryPickerOpen, setTerritoryPickerOpen] = useState(false);
  const [mapLayersOpen, setMapLayersOpen] = useState(false);
  const [walkStartedAt, setWalkStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!walkStartedAt) return;
    const update = () => setElapsed(Math.floor((Date.now() - walkStartedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [walkStartedAt]);

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
  const territoryProperties = useMemo(() => (
    data && activeTerritory
      ? data.properties.filter((property) => property.territoryId === activeTerritory.id)
      : []
  ), [data, activeTerritory]);
  const filteredProperties = useMemo(() => territoryProperties.filter((property) => {
    const matchesOutcome = visibleOutcomes.has(property.currentOutcome);
    const matchesSearch = !query || `${property.address} ${property.unit ?? ""}`.toLowerCase().includes(query.toLowerCase());
    return matchesOutcome && matchesSearch;
  }), [query, territoryProperties, visibleOutcomes]);

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
  const requestedView = typeof window === "undefined"
    ? data.preferences.lastView
    : new URLSearchParams(window.location.search).get("view") ?? data.preferences.lastView;
  const allowedViews: View[] = ["map", "followups", "guide", "leader", "settings"];
  const initialView = allowedViews.includes(requestedView as View) ? requestedView as View : "map";
  const view = viewOverride ?? (initialView === "leader" && !canManage ? "map" : initialView);
  const coverage = coverageForTerritory(data, activeTerritory.id);
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
  const editingTerritory = editingTerritoryId ? data.territories.find((territory) => territory.id === editingTerritoryId) : undefined;
  const territoryEditorEventId = editingTerritory?.eventId ?? data.preferences.activeEventId;
  const territoryEditorTeams = data.teams.filter((team) => team.eventId === territoryEditorEventId);

  const navigate = (next: View) => {
    setViewOverride(next);
    setSelectedPropertyId(null);
    setSelectedParcel(null);
    setAddMode(false);
    setMapLayersOpen(false);
    if (next !== "map") {
      setDrawMode(false);
      setDraftBoundary([]);
    }
    actions.setPreference("lastView", next);
  };

  const formatElapsed = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  const handleAddProperty = (address: string, unit: string) => {
    if (!pendingAdd) return;
    const propertyId = actions.addProperty({ ...pendingAdd, address, unit });
    setPendingAdd(null);
    setAddMode(false);
    setSelectedPropertyId(propertyId);
    setToast(pendingAdd.parcel ? "Dwelling added to this parcel" : "Location added to this territory");
  };

  const beginAddingDwelling = () => {
    setSelectedParcel(null);
    setSelectedPropertyId(null);
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
            <div><strong>{coverage.percent}%</strong><span>covered</span></div>
            <div className="progress-track"><i style={{ width: `${coverage.percent}%` }} /></div>
            <p><span>{coverage.visited} visited</span><span>{coverage.remaining} remaining</span></p>
          </div>
          <nav className="sidebar-nav" aria-label="Main sections">
            <NavButton active={view === "map"} icon={<MapIcon size={18} />} label="Walk map" onClick={() => navigate("map")} />
            <NavButton active={view === "followups"} icon={<CalendarClock size={18} />} label="Follow-ups" count={openFollowUps} onClick={() => navigate("followups")} />
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
                <div><strong>{coverage.percent}%</strong><span>covered</span></div>
              </div>
              <div className="map-toolbar">
                <div className="map-filter-scroll" aria-label="Filter locations">{mapFilterOptions.map((option) => <button key={option.value} className={filter === option.value ? "active" : ""} onClick={() => setFilter(option.value)}>{option.label}{option.value !== "all" && <i style={{ background: outcomeMeta[option.value].color }} />}</button>)}</div>
                <label className="map-search"><Search size={15} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an address" aria-label="Find an address" />{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}</label>
                <div className="map-layer-picker">
                  <button className="toolbar-icon" aria-label="Map layers" aria-expanded={mapLayersOpen} onClick={() => setMapLayersOpen((open) => !open)}><Layers3 size={18} /></button>
                  {mapLayersOpen && <div className="map-layer-menu" role="menu" aria-label="Choose map style">
                    <p>Map appearance</p>
                    {MAP_STYLE_OPTIONS.map((style) => <button key={style.url} role="menuitemradio" aria-checked={data.preferences.mapStyleUrl === style.url} onClick={() => { actions.setPreference("mapStyleUrl", style.url); setMapLayersOpen(false); setToast(`${style.label} map selected`); }}><span><strong>{style.label}</strong><small>{style.description}</small></span>{data.preferences.mapStyleUrl === style.url && <Check size={15} />}</button>)}
                    {!MAP_STYLE_OPTIONS.some((style) => style.url === data.preferences.mapStyleUrl) && <div className="custom-map-style"><Layers3 size={14} /><span><strong>Custom style</strong><small>Configured in Settings</small></span></div>}
                  </div>}
                </div>
              </div>
              <div className="map-stage">
                <MapCanvas territory={activeTerritory} properties={territoryProperties} selectedPropertyId={selectedPropertyId} visibleOutcomes={visibleOutcomes} searchQuery={query} addMode={addMode} drawMode={drawMode} drawModeLabel={editingTerritoryId ? "Tap the corners of the replacement boundary" : "Tap at least 3 corners"} draftBoundary={draftBoundary} compactMarkers={data.preferences.compactMapMarkers} mapStyleUrl={data.preferences.mapStyleUrl} onSelectProperty={(id) => { setSelectedPropertyId(id); setSelectedParcel(null); setAddMode(false); }} onAddIntent={async (intent) => {
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
                {query && <div className="map-search-results" aria-label="Address search results">{filteredProperties.slice(0, 5).map((property) => <button key={property.id} onClick={() => { setSelectedPropertyId(property.id); setSelectedParcel(null); }}><span><strong>{property.address}{property.unit ? ` · ${property.unit}` : ""}</strong><small>{outcomeMeta[property.currentOutcome].label}</small></span><i style={{ background: outcomeMeta[property.currentOutcome].color }} /></button>)}{!filteredProperties.length && <p>No locations match “{query}”.</p>}</div>}
                <div className="map-floating-actions">
                  {!drawMode && <button className={`map-action-button ${addMode ? "active" : ""}`} aria-label={addMode ? "Cancel adding a location" : "Add a location"} onClick={() => { setAddMode((current) => !current); setSelectedPropertyId(null); setSelectedParcel(null); }}><Plus size={18} /><span>{addMode ? "Cancel adding" : "Add location"}</span></button>}
                  {canManage && !drawMode && <button className="map-action-button secondary" aria-label={`Edit ${activeTerritory.name}`} onClick={() => openTerritoryEditor(activeTerritory.id)}><Edit3 size={18} /><span>Edit territory</span></button>}
                  {canManage && !drawMode && <button className="map-action-button secondary" aria-label="Draw a territory" onClick={startDrawing}><MapPinned size={18} /><span>Draw territory</span></button>}
                </div>
                {drawMode && <div className="draw-controls"><button className="button quiet" disabled={!draftBoundary.length} onClick={() => setDraftBoundary((points) => points.slice(0, -1))}><Undo2 size={15} /> Undo</button><button className="button quiet" onClick={cancelDrawing}>Cancel</button><button className="button primary" disabled={draftBoundary.length < 3} onClick={() => setTerritoryEditorOpen(true)}><Check size={15} /> Finish boundary</button></div>}
                {!selectedProperty && !drawMode && <div className="walk-dock"><div><span>{walkStartedAt ? "Walk in progress" : "Ready for the next block"}</span><strong>{walkStartedAt ? formatElapsed(elapsed) : `${coverage.remaining} locations remaining`}</strong></div><button className={walkStartedAt ? "button quiet" : "button primary"} onClick={() => { if (walkStartedAt) { setWalkStartedAt(null); setElapsed(0); setToast("Walk session finished"); } else { setWalkStartedAt(Date.now()); setToast("Walk session started"); } }}>{walkStartedAt ? <><TimerReset size={15} /> Finish</> : <><Navigation size={15} /> Start walk</>}</button></div>}
              </div>
              {selectedProperty && <PropertyDrawer key={selectedProperty.id} property={selectedProperty} parcelDwellings={selectedPropertyDwellings} data={data} visits={selectedVisits} openFollowUp={selectedFollowUp} canManage={canManage} onClose={() => setSelectedPropertyId(null)} onViewParcel={selectedProperty.parcel ? () => { setSelectedParcel({ parcel: selectedProperty.parcel!, situsAddress: selectedProperty.address, propertyIds: selectedPropertyDwellings.map((property) => property.id) }); setSelectedPropertyId(null); } : undefined} onAddDwelling={selectedProperty.parcel ? beginAddingDwelling : undefined} onRecordVisit={(input) => { actions.recordVisit(input); setToast(`${outcomeMeta[input.outcome].label} saved`); }} onUpdateProperty={actions.updateProperty} onDeleteProperty={actions.deleteProperty} />}
            </section>
          )}
          {view === "followups" && <FollowUpsView data={data} onOpenProperty={(propertyId) => { navigate("map"); setSelectedPropertyId(propertyId); const property = data.properties.find((item) => item.id === propertyId); if (property) actions.selectTerritory(property.territoryId); }} onComplete={(id) => { actions.completeFollowUp(id); setToast("Follow-up completed"); }} onReschedule={(id, date) => { actions.rescheduleFollowUp(id, date); setToast("Follow-up rescheduled"); }} onCancel={(id) => { actions.cancelFollowUp(id); setToast("Follow-up cancelled"); }} />}
          {view === "guide" && <GuideView data={data} canManage={canManage} onUpdate={(id, patch) => { actions.updateGuideStep(id, patch); setToast("Guide step saved"); }} />}
          {view === "leader" && canManage && <LeaderView data={data} membership={workspaceMembership} activeTerritory={activeTerritory} onSelectTerritory={(id) => { actions.selectTerritory(id); }} onEditTerritory={openTerritoryEditor} onStartDrawing={startDrawing} />}
          {view === "settings" && <SettingsView data={data} online={online} saving={saving} syncing={syncing} storageError={storageError} canManage={canManage} accountEmail={supabaseUser?.email} onSignOut={onSignOut} onUpdateChurch={actions.updateChurch} onSetPreference={actions.setPreference} onExport={actions.downloadBackup} onImport={actions.importBackup} onPurge={actions.purgeExpired} onReset={actions.resetDemo} onSync={actions.syncNow} />}
        </section>
      </div>

      <nav className="mobile-nav" aria-label="Main navigation">
        <MobileNav active={view === "map"} icon={<MapIcon size={20} />} label="Map" onClick={() => navigate("map")} />
        <MobileNav active={view === "followups"} icon={<CalendarClock size={20} />} label="Follow-ups" count={openFollowUps} onClick={() => navigate("followups")} />
        <MobileNav active={view === "guide"} icon={<BookOpenText size={20} />} label="Guide" onClick={() => navigate("guide")} />
        {canManage ? <MobileNav active={view === "leader"} icon={<Users size={20} />} label="Leader" onClick={() => navigate("leader")} /> : <MobileNav active={view === "settings"} icon={<Settings2 size={20} />} label="Settings" onClick={() => navigate("settings")} />}
      </nav>

      {pendingAdd && <AddPropertyModal intent={pendingAdd} existingDwellingCount={pendingParcelDwellings.length} onClose={() => { setPendingAdd(null); setAddMode(false); }} onSave={handleAddProperty} />}
      {selectedParcel && <ParcelSummaryModal selection={selectedParcel} dwellings={selectedParcelDwellings} onClose={() => setSelectedParcel(null)} onOpenDwelling={(propertyId) => { setSelectedParcel(null); setSelectedPropertyId(propertyId); }} onAddDwelling={beginAddingDwelling} />}
      {territoryPickerOpen && <TerritoryPickerModal data={data} activeTerritoryId={activeTerritory.id} canManage={canManage} onClose={() => setTerritoryPickerOpen(false)} onSelect={(territoryId) => { actions.selectTerritory(territoryId); setTerritoryPickerOpen(false); setSelectedPropertyId(null); }} onEdit={openTerritoryEditor} onDraw={() => { setTerritoryPickerOpen(false); startDrawing(); }} />}
      {territoryEditorOpen && <TerritoryModal key={`${editingTerritoryId ?? "new"}-${draftBoundary.length}`} territory={editingTerritory} teams={territoryEditorTeams} boundaryChanged={draftBoundary.length >= 3} onClose={() => { setTerritoryEditorOpen(false); if (!drawMode) setEditingTerritoryId(null); }} onRedraw={editingTerritoryId ? () => startBoundaryRedraw(editingTerritoryId) : undefined} onSave={(name, color, assignedTeamId) => {
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

function AddPropertyModal({ intent, existingDwellingCount, onClose, onSave }: { intent: AddIntent; existingDwellingCount: number; onClose: () => void; onSave: (address: string, unit: string) => void }) {
  const [address, setAddress] = useState(intent.suggestedAddress);
  const [unit, setUnit] = useState("");
  const countyName = intent.parcel ? PARCEL_COUNTY_NAMES[intent.parcel.countyFips] ?? "Tennessee" : null;
  const needsLabel = existingDwellingCount > 0;
  const canSave = address.trim().length >= 3 && (!needsLabel || unit.trim().length > 0);
  return (
    <Modal
      title={needsLabel ? "Add another dwelling" : "Add this location"}
      description={intent.parcel ? "Each dwelling keeps its own visits, outcome, and follow-ups." : "Confirm the address before recording a visit."}
      onClose={onClose}
    >
      <div className="location-preview"><MapPinned size={20} /><span><strong>{intent.parcel ? `Official ${countyName} parcel` : "Map location selected"}</strong>{intent.coordinates[1].toFixed(6)}, {intent.coordinates[0].toFixed(6)}{intent.buildingGeometry ? " · Building found" : ""}</span></div>
      {intent.parcel && <div className="parcel-preview"><span><strong>{intent.parcel.propertyClass ?? "Unclassified parcel"}</strong><small>{intent.parcel.landUse ?? "No land-use description in the county file"}</small></span><ShieldCheck size={15} /><small>Owner names and property values are not stored.</small></div>}
      {needsLabel && <div className="parcel-existing-note"><Building2 size={17} /><span><strong>{existingDwellingCount} {existingDwellingCount === 1 ? "dwelling is" : "dwellings are"} already mapped here</strong>Add a clear label so the next volunteer can choose the right door.</span></div>}
      <div className="form-stack">
        <label className="form-field"><span>Street address</span><input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
        <label className="form-field"><span>Dwelling label or unit <small>{needsLabel ? "Required" : "Optional"}</small></span><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Rear house, Unit B, Apartment 2" /></label>
      </div>
      <div className="modal-actions"><button className="button quiet" onClick={onClose}>Cancel</button><button className="button primary" disabled={!canSave} onClick={() => onSave(address, unit)}><Plus size={15} /> Add dwelling</button></div>
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

function TerritoryModal({ territory, teams, boundaryChanged, onClose, onRedraw, onSave }: {
  territory?: Territory;
  teams: NeighborWalkData["teams"];
  boundaryChanged: boolean;
  onClose: () => void;
  onRedraw?: () => void;
  onSave: (name: string, color: string, assignedTeamId: string) => void;
}) {
  const [name, setName] = useState(territory?.name ?? "");
  const [color, setColor] = useState(territory?.color ?? "#286c59");
  const [assignedTeamId, setAssignedTeamId] = useState(territory?.assignedTeamId ?? "");
  const editing = Boolean(territory);
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
      </div>
      <div className="modal-actions"><button className="button quiet" onClick={onClose}>Cancel</button><button className="button primary" onClick={() => onSave(name, color, assignedTeamId)} disabled={name.trim().length < 3}><Check size={15} /> {editing ? "Save changes" : "Create territory"}</button></div>
    </Modal>
  );
}

function TerritoryPickerModal({ data, activeTerritoryId, canManage, onClose, onSelect, onEdit, onDraw }: { data: NeighborWalkData; activeTerritoryId: string; canManage: boolean; onClose: () => void; onSelect: (territoryId: string) => void; onEdit: (territoryId: string) => void; onDraw: () => void }) {
  const territories = data.territories.filter((territory) => territory.eventId === data.preferences.activeEventId);
  return <Modal title="Choose a territory" description="Switch the map and coverage view for this outreach event." onClose={onClose}><div className="territory-picker-list">{territories.map((territory) => { const coverage = coverageForTerritory(data, territory.id); return <div key={territory.id} className={`territory-picker-row${territory.id === activeTerritoryId ? " active" : ""}`}><i style={{ background: territory.color }} /><button className="territory-picker-select" onClick={() => onSelect(territory.id)}><span><strong>{territory.name}</strong><small>{coverage.percent}% covered · {coverage.remaining} remaining</small></span>{territory.id === activeTerritoryId && <Check size={16} />}</button>{canManage && <button className="territory-picker-edit" onClick={() => onEdit(territory.id)} aria-label={`Edit ${territory.name}`}><Edit3 size={16} /></button>}</div>; })}</div><div className="modal-actions"><button className="button quiet" onClick={onClose}>Close</button>{canManage && <button className="button primary" onClick={onDraw}><MapPinned size={15} /> Draw a new territory</button>}</div></Modal>;
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
