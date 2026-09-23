"use client";

import {
  ArrowLeft,
  BookOpenText,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleEllipsis,
  CircleHelp,
  CircleUserRound,
  CloudOff,
  Database,
  Edit3,
  Footprints,
  House,
  Info,
  LoaderCircle,
  Lock,
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
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { followUpScope, followUpsHref, type FollowUpScope } from "../lib/follow-up-filters";
import Link from "next/link";
import { isMobileApp } from "../lib/mobile";
import { MobileInvitation } from "../components/MobileInvitation";
import { AccountDeletion } from "../components/AccountDeletion";
import { appHref, appRoute, type AppView } from "../lib/app-routes";
import { TodayView } from "../components/TodayView";
import { EncounterComposer } from "../components/EncounterComposer";
import { OutreachView } from "../components/OutreachView";
import { RecoveryView } from "../components/RecoveryView";
import { DataHealthView } from "../components/DataHealthView";
import { indexCurrentRecords } from "../lib/record-aliases";
import { MapCanvas, type MapSearchTarget } from "../components/MapCanvas";
import { PropertyDrawer } from "../components/PropertyDrawer";
import { AddressList } from "../components/AddressList";
import { PeopleWorkspace } from "../components/PeopleWorkspace";
import { assignmentToAccept, fieldWalkAssignment } from "../lib/home-walk";
import { drawingBoundaryReady, undoDrawingPoint, type MapDrawingMode } from "../lib/map-drawing";
import { propertyInTarget, targetCoverage } from "../lib/target-coverage";
import { parcelKey } from "../lib/walk-targets";
import { parcelSelectionPoint, snapshotParcelFeatureCollection } from "../lib/target-parcels";
import { GuideView } from "../components/GuideView";
import { GuideChangeRecovery } from "../components/GuideChangeRecovery";
import { LeaderView } from "../components/LeaderView";
import { SettingsView } from "../components/SettingsView";
import { Badge, ConfirmProvider, ListGroup, ListRow, Modal, initials, useConfirm } from "../components/ui";
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
import { useAsyncAction } from "../lib/use-async-action";
import { clearPendingInvitation, pendingInvitation } from "../lib/invitations";
import { offlineShellCopy } from "../lib/offline-shell";
import { useNeighborWalk, type SupabaseUser } from "../lib/use-neighborwalk";
import { resolveFieldGuide } from "../lib/conversation-guides";
import { forwardGeocode, reverseGeocode, type AddressSearchResult } from "../lib/geocoding";
import { dwellingsForParcel, parcelProgress } from "../lib/parcel-groups";
import { mergeParcelFeatureCollections, type MapViewport, type ParcelDetails } from "../lib/parcels";
import { coverageForTerritory, type TerritoryCoverageById } from "../lib/territory-coverage";
import { useTerritoryParcels } from "../lib/use-territory-parcels";
import { useVisibleParcels } from "../lib/use-visible-parcels";
import { compactToastMessage, type Toast, type ToastTone } from "../lib/toasts";
import { calendarDate } from "../lib/calendar";
import { deviceReminderFingerprint, reconcileDeviceReminders } from "../mobile/notifications";
import { registerRemotePush, REMOTE_PUSH_REFRESH_EVENT, remotePushConfigured } from "../mobile/push-notifications";

type View = AppView;
type AddIntent = { coordinates: Coordinates; suggestedAddress: string; buildingGeometry?: Coordinates[]; parcel?: ParcelDetails; legacyPropertyIds?: string[] };
type ParcelSelection = { parcel: ParcelReference; situsAddress?: string | null; propertyIds: string[] };
type SavedAddressResult = { propertyId: string; territoryId?: string; label: string; detail: string; coordinates?: Coordinates; color: string };
type PeopleWorkspaceSnapshot = {
  initialPanel: "followups" | "directory";
  selectedResidentId?: string | null;
  focusedTaskId?: string;
  initialPersonId?: string | null;
  initialScope: FollowUpScope;
  scrollTop: number;
};
type PeopleMapReturn = ({ mode: "history" } | {
  mode: "demo";
  route: ReturnType<typeof appRoute>;
  peopleDirectory: boolean;
  taskScope: FollowUpScope;
  followUpPersonId: string | null;
  selectedPersonId: string | null;
}) & { workspace: PeopleWorkspaceSnapshot };
const EMPTY_TERRITORIES: Territory[] = [];
const EMPTY_PROPERTIES: Property[] = [];

const PARCEL_COUNTY_NAMES: Record<string, string> = {
  "47055": "Giles County",
  "47099": "Lawrence County",
  "47101": "Lewis County",
  "47181": "Wayne County",
};

function parcelReference(parcel: ParcelDetails, snapshot = false): ParcelReference {
  return { ...(snapshot ? {} : { id: parcel.id }), countyFips: parcel.countyFips, gislink: parcel.gislink };
}

const mapFilterOptions: { value: "all" | Outcome; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unvisited", label: "Not yet" },
  { value: "conversation", label: "Talked" },
  { value: "no_answer", label: "No answer" },
  { value: "follow_up", label: "Follow-up" },
  { value: "do_not_visit", label: "Don’t knock" },
];

type NeighborWalkAppProps = { supabaseUser?: SupabaseUser | null; onSignOut?: () => Promise<void>; onUpdatePassword?: (password: string) => Promise<void> };

export function NeighborWalkApp(props: NeighborWalkAppProps = {}) {
  return <ConfirmProvider><NeighborWalkWorkspace {...props} /></ConfirmProvider>;
}

function NeighborWalkWorkspace({ supabaseUser, onSignOut, onUpdatePassword }: NeighborWalkAppProps) {
  const confirm = useConfirm();
  const { data, loading, storageError, online, saving, syncing, offlineShell, workspaceStatus, workspaceMembership, guideLibrary, guideLibraryError, guidePending, guideChanging, activeTerritory: currentTerritory, activeVolunteer, actions } = useNeighborWalk(supabaseUser);
  const fieldworkAction = useAsyncAction();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [demoTaskScope, setDemoTaskScope] = useState<FollowUpScope>("mine");
  const [demoRoute, setDemoRoute] = useState<ReturnType<typeof appRoute>>({ view: "today" });
  const [outreachDisplay, setOutreachDisplay] = useState<"map" | "list">("map");
  const [demoPlanWalk, setDemoPlanWalk] = useState(false);
  const [demoPeopleDirectory, setDemoPeopleDirectory] = useState(false);
  const [demoFieldAreaId, setDemoFieldAreaId] = useState<string>();
  const [demoFieldTargetId, setDemoFieldTargetId] = useState<string>();
  const route = pathname.startsWith("/app") ? appRoute(pathname) : demoRoute;
  const fieldAssignment = data && activeVolunteer && route.fieldOutingId ? fieldWalkAssignment(data, route.fieldOutingId, activeVolunteer.id, (workspaceMembership?.role ?? activeVolunteer.role) === "leader", pathname.startsWith("/app") ? searchParams.get("area") : demoFieldAreaId, pathname.startsWith("/app") ? searchParams.get("target") : demoFieldTargetId) : undefined;
  const fieldArea = data?.territories.find((area) => area.id === fieldAssignment?.territoryId);
  const fieldTarget = data?.walkTargets.find((target) => target.id === fieldAssignment?.targetId);
  const activeTerritory = useMemo<Territory>(() => (route.fieldOutingId ? fieldArea : currentTerritory) ?? { id: "", churchId: data?.church.id ?? "", name: "No neighborhood selected", kind: "list", boundary: [], zoom: 15, color: "#286c59" }, [currentTerritory, data?.church, route.fieldOutingId, fieldArea]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [followUpPersonId, setFollowUpPersonId] = useState<string | null>(null);
  const [peopleMapReturn, setPeopleMapReturn] = useState<PeopleMapReturn | null>(null);
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
  const [drawShape, setDrawShape] = useState<MapDrawingMode>("rectangle");
  const [draftBoundary, setDraftBoundary] = useState<Coordinates[]>([]);
  const [territoryEditorOpen, setTerritoryEditorOpen] = useState(false);
  const [editingTerritoryId, setEditingTerritoryId] = useState<string | null>(null);
  const [territoryPickerOpen, setTerritoryPickerOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = (message: string, tone: ToastTone = "success") => setToast({ message: compactToastMessage(message), tone });
  const reminderDataRef = useRef(data);
  const remindersEnabled = data?.preferences.notificationsEnabled === true;
  const signedInUserId = supabaseUser?.id;
  const reminderFingerprint = useMemo(() => data ? deviceReminderFingerprint(data) : "", [data]);

  useEffect(() => { reminderDataRef.current = data; }, [data]);

  useEffect(() => {
    if (!isMobileApp || !remindersEnabled || !reminderFingerprint) return;
    const current = reminderDataRef.current;
    if (!current) return;
    // This refresh never prompts. iOS permission is requested only from the
    // explicit Settings action, while normal data refreshes keep schedules current.
    void reconcileDeviceReminders(current).catch(() => {});
  }, [reminderFingerprint, remindersEnabled]);

  useEffect(() => {
    if (!isMobileApp || !remotePushConfigured || !remindersEnabled || !online || !signedInUserId) return;
    // Refresh APNs registration after an authenticated launch/reconnect without
    // prompting; the explicit Settings action owns the iOS permission prompt.
    const refresh = () => { void registerRemotePush().catch(() => {}); };
    refresh();
    window.addEventListener(REMOTE_PUSH_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(REMOTE_PUSH_REFRESH_EVENT, refresh);
  }, [online, remindersEnabled, signedInUserId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visibleOutcomes = useMemo(() => new Set<Outcome>(
    filter === "all" ? Object.keys(outcomeMeta) as Outcome[] : [filter],
  ), [filter]);
  const territories = data?.territories ?? EMPTY_TERRITORIES;
  const properties = useMemo(() => data?.properties.filter((property) => !property.mergedIntoId) ?? EMPTY_PROPERTIES, [data?.properties]);
  const activeTerritoryId = activeTerritory?.id;
  const territoryProperties = useMemo(() => properties.filter((property) => property.territoryId === activeTerritoryId && (!fieldTarget || propertyInTarget(property, fieldTarget))), [properties, activeTerritoryId, fieldTarget]);
  const liveParcelMap = data?.sync.mode === "connected" && route.view === "map" && (outreachDisplay === "map" || Boolean(fieldTarget));
  const territoryParcelResults = useTerritoryParcels(liveParcelMap ? territories : EMPTY_TERRITORIES);
  const visibleParcelState = useVisibleParcels(liveParcelMap ? mapViewport : null);
  const mapParcels = useMemo(() => {
    const merged = mergeParcelFeatureCollections(
    activeTerritory ? territoryParcelResults[activeTerritory.id]?.parcels : undefined,
    visibleParcelState.parcels,
    );
    if (!fieldTarget) return merged;
    return snapshotParcelFeatureCollection(fieldTarget.parcels, merged);
  }, [activeTerritory, territoryParcelResults, visibleParcelState.parcels, fieldTarget]);
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
      .filter((property) => !property.mergedIntoId)
      .filter((property) => !route.fieldOutingId || property.territoryId === activeTerritoryId)
      .filter((property) => !fieldTarget || propertyInTarget(property, fieldTarget))
      .filter((property) => `${property.address} ${property.unit ?? ""}`.toLowerCase().includes(normalizedQuery))
      .slice(0, 4)
      .map((property) => ({
        propertyId: property.id,
        territoryId: property.territoryId,
        label: `${property.address}${property.unit ? ` · ${property.unit}` : ""}`,
        detail: `${data.territories.find((territory) => territory.id === property.territoryId)?.name ?? "Saved home"} · ${outcomeMeta[property.currentOutcome].label}`,
        coordinates: property.coordinates,
        color: outcomeMeta[property.currentOutcome].color,
      }));
  }, [data, query, route.fieldOutingId, activeTerritoryId, fieldTarget]);
  const searchProximityLongitude = activeTerritory?.center?.[0];
  const searchProximityLatitude = activeTerritory?.center?.[1];

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
  if (workspaceStatus === "locked" || !data || !activeVolunteer) return <AppFailure error={storageError || "NeighborWalk couldn’t load your church’s records."} onSignOut={onSignOut} onRecovery={supabaseUser ? actions.downloadAuthoredDeviceRecovery : undefined} />;

  const pendingChanges = data.sync.commands?.length ?? data.sync.pending.length;
  const needsReview = data.sync.legacyRecoveryRequired || data.sync.commands?.some((q) => q.state === "needs_review");
  const deviceNeedsAttention = Boolean(data.sync.legacyRecoveryRequired || pendingChanges || data.sync.lastError || (data.sync.mode === "connected" && !online));
  const syncStatusLabel = saving ? "Saving…"
    : needsReview ? "Needs review"
    : data.sync.mode === "device_only" ? "Practice mode"
    : !online ? pendingChanges ? `Offline, ${pendingChanges} waiting to send` : "Offline"
    : syncing ? "Sending…"
    : pendingChanges ? `${pendingChanges} waiting to send`
    : data.sync.lastError ? "Couldn’t refresh"
    : data.sync.lastSyncedAt ? "Updated " + new Date(data.sync.lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Up to date";
  const syncStatusTone = data.sync.lastError || needsReview ? "error" : !online ? "offline" : saving || syncing || pendingChanges ? "pending" : "online";
  const canManage = workspaceMembership ? workspaceMembership.role === "leader" : activeVolunteer.role === "leader";
  const openOutingIds = new Set(data.events.filter((event) => ["draft", "scheduled", "ready", "active"].includes(event.status)).map((event) => event.id));
  const walkAttentionCount = data.outingParticipants.filter((participant) => participant.volunteerId === activeVolunteer.id
    && participant.status === "invited" && openOutingIds.has(participant.eventId)).length;
  const churchToday = calendarDate(new Date(), data.church.timezone);
  const peopleAttentionCount = data.followUps.filter((task) => task.status === "scheduled" && task.assignedVolunteerId === activeVolunteer.id
    && (task.acceptance === "pending" || calendarDate(task.dueAt, data.church.timezone) <= churchToday)).length
    + data.residents.filter((person) => person.pendingOwnerId === activeVolunteer.id).length;
  const requestedView = route.view;
  const view = requestedView === "leader" && !canManage ? "today" : requestedView;
  const fieldOuting = route.fieldOutingId ? data.events.find((e) => e.id === route.fieldOutingId) : undefined;
  const fieldPrintContext = fieldOuting && fieldAssignment ? {
    outingName: fieldOuting.name,
    targetName: fieldTarget?.name ?? activeTerritory.name,
    eventId: fieldOuting.id,
    targetId: fieldTarget?.id,
    startsAt: fieldOuting.startsAt,
    endsAt: fieldOuting.endsAt,
    timezone: fieldOuting.timezone ?? data.church.timezone,
    meetingPoint: fieldOuting.meetingPoint,
    ownerLabel: data.teams.find((team) => team.id === fieldAssignment.assignedTeamId)?.name
      ?? data.volunteers.find((volunteer) => volunteer.id === fieldAssignment.assignedVolunteerId)?.name
      ?? activeVolunteer.name,
  } : undefined;
  const activeGuideTeam = fieldAssignment?.assignedTeamId ? data.teams.find((team) => team.id === fieldAssignment.assignedTeamId) : undefined;
  const teamDefaultGuideId = activeGuideTeam ? guideLibrary.teamGuideDefaults[activeGuideTeam.id] : undefined;
  const fieldGuide = resolveFieldGuide(guideLibrary.guides, { outingGuideId: fieldOuting?.guideId, favoriteGuideId: guideLibrary.favoriteGuideId, teamDefaultGuideId });
  const favoriteConversationGuide = fieldGuide.guide;
  const fieldGuideContext = fieldGuide.source ? { outing: "Walk guide", group: `${activeGuideTeam?.name ?? "Your team"} default`, favorite: "Your favorite", church: "Church guide", personal: "Your personal guide" }[fieldGuide.source] : undefined;
  const propertySelection = view === "map" && route.id ? route.id : selectedPropertyId;
  const personSelection = view === "people" && route.id ? route.id : selectedPersonId;
  const showAddressList = !drawMode && (outreachDisplay === "list" || !activeTerritory.center || activeTerritory.kind === "list");
  // This is only a starting viewport for drawing, never a persisted location.
  const canvasTerritory: Territory = activeTerritory.center ? activeTerritory : { ...activeTerritory, center: [-98, 39], zoom: 4 };
  const coverage = fieldTarget ? { ...targetCoverage(data, fieldTarget), basis: "target" } : coverageByTerritory[activeTerritory.id]
    ?? coverageForTerritory(data, activeTerritory.id);
  const coverageLabel = fieldTarget ? "target covered tonight" : coverage.basis === "residential_parcels" ? "residential covered" : "mapped covered";
  const coverageValue = coverage.percent === null ? "—" : `${coverage.percent}%`;
  const candidateProperty = indexCurrentRecords(data.properties).get(propertySelection ?? "");
  const selectedProperty = candidateProperty && (!fieldOuting || candidateProperty.territoryId === activeTerritory.id) && (!fieldTarget || propertyInTarget(candidateProperty, fieldTarget)) ? candidateProperty : null;
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
  const editingTerritory = editingTerritoryId ? data.territories.find((territory) => territory.id === editingTerritoryId) : undefined;
  const territoryEditorTerritories = data.territories;

  const focusSearchTarget = (coordinates: Coordinates, zoom: number) => {
    searchTargetSequence.current += 1;
    setSearchTarget({ id: `search-${searchTargetSequence.current}`, coordinates, zoom });
    setSelectedParcel(null);
    setAddMode(false);
    setSearchOpen(false);
  };

  const selectSavedAddress = (result: SavedAddressResult) => {
    if (result.territoryId && result.territoryId !== activeTerritory.id) void actions.selectTerritory(result.territoryId).catch(() => undefined);
    setGuidedPropertyId(null);
    setSelectedPropertyId(result.propertyId);
    setQuery(result.label);
    if (result.coordinates) focusSearchTarget(result.coordinates, 18);
  };

  const selectGeocodedAddress = (result: AddressSearchResult) => {
    setSelectedPropertyId(null);
    setQuery(result.label);
    focusSearchTarget(result.coordinates, result.zoom);
    showToast(result.type === "address" ? "Address found" : "Map moved", result.type === "address" ? "success" : "info");
  };

  const clearAddressSearch = () => {
    setQuery("");
    setAddressResults([]);
    setAddressSearchStatus("idle");
    setSearchOpen(false);
    setSearchTarget(null);
  };

  const navigate = (next: View, id?: string) => {
    // All protected views use the same client workspace. Next's native History
    // integration updates routes without a network-only RSC navigation.
    if (pathname.startsWith("/app")) window.history.pushState(null, "", appHref(next, id));
    else setDemoRoute({ view: next, id });
    setDemoPlanWalk(false);
    setDemoPeopleDirectory(false);
    if (next === "people") setDemoTaskScope("mine");
    if (next === "people" && !id) {
      setDemoTaskScope("mine");
      setFollowUpPersonId(null);
    }
    setSelectedPropertyId(null);
    setGuidedPropertyId(null);
    setSelectedParcel(null);
    setAddMode(false);
    if (next !== "map") {
      setPeopleMapReturn(null);
      setDrawMode(false);
      setDraftBoundary([]);
    }
    setSelectedPersonId(next === "people" ? id ?? null : null);
  };

  const openPropertyFromPeople = (propertyId: string) => {
    const inApp = pathname.startsWith("/app");
    const workspace: PeopleWorkspaceSnapshot = {
      initialPanel: view === "people" && personSelection
        ? "directory"
        : (inApp ? searchParams.get("view") === "all" : demoPeopleDirectory) ? "directory" : "followups",
      selectedResidentId: view === "people" ? personSelection : undefined,
      focusedTaskId: view === "followups" ? route.id : undefined,
      initialPersonId: view === "followups" ? (inApp ? searchParams.get("person") : followUpPersonId) : undefined,
      initialScope: inApp ? followUpScope(searchParams.get("scope")) : demoTaskScope,
      scrollTop: document.querySelector<HTMLElement>(".people-workspace")?.scrollTop ?? 0,
    };
    const returnContext: PeopleMapReturn = pathname.startsWith("/app")
      ? { mode: "history", workspace }
      : {
          mode: "demo",
          workspace,
          route: demoRoute,
          peopleDirectory: demoPeopleDirectory,
          taskScope: demoTaskScope,
          followUpPersonId,
          selectedPersonId,
        };
    navigate("map", propertyId);
    setPeopleMapReturn(returnContext);
    const property = data.properties.find((item) => item.id === propertyId);
    if (property?.territoryId) void actions.selectTerritory(property.territoryId).catch(() => undefined);
  };

  const returnFromPeopleMap = () => {
    if (!peopleMapReturn) return;
    const returnContext = peopleMapReturn;
    const restoreScroll = () => window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".people-workspace")?.scrollTo({ top: returnContext.workspace.scrollTop });
    });
    setSelectedPropertyId(null);
    setGuidedPropertyId(null);
    setSelectedParcel(null);
    if (returnContext.mode === "history") {
      window.addEventListener("popstate", () => {
        setPeopleMapReturn(null);
        restoreScroll();
      }, { once: true });
      window.history.back();
      return;
    }
    setDemoRoute(returnContext.route);
    setDemoPeopleDirectory(returnContext.peopleDirectory);
    setDemoTaskScope(returnContext.taskScope);
    setFollowUpPersonId(returnContext.followUpPersonId);
    setSelectedPersonId(returnContext.selectedPersonId);
    setPeopleMapReturn(null);
    restoreScroll();
  };

  const planWalk = () => {
    navigate("outreach");
    if (pathname.startsWith("/app")) window.history.replaceState(null, "", appHref("outreach") + "?plan=1");
    else setDemoPlanWalk(true);
  };
  const viewMap = () => {
    setOutreachDisplay("map");
    navigate("map");
  };
  const openPeopleDirectory = () => {
    navigate("people");
    if (pathname.startsWith("/app")) window.history.replaceState(null, "", appHref("people") + "?view=all");
    else setDemoPeopleDirectory(true);
  };
  const changePeoplePanel = (panel: "directory" | "followups") => {
    setSelectedPersonId(null);
    setFollowUpPersonId(null);
    setDemoTaskScope("mine");
    if (pathname.startsWith("/app")) {
      const href = appHref("people") + (panel === "directory" ? "?view=all" : "");
      if (pathname + (searchParams.size ? "?" + searchParams.toString() : "") !== href) window.history.pushState(null, "", href);
    } else {
      setDemoRoute({ view: "people" });
      setDemoPeopleDirectory(panel === "directory");
    }
  };
  const startWalk = async (id: string, territoryId: string, targetId?: string) => {
    const assignment = fieldWalkAssignment(data, id, activeVolunteer.id, canManage, territoryId, targetId);
    const area = data.territories.find((item) => item.id === assignment?.territoryId);
    if (!area) throw new Error(canManage ? "Choose a route before opening the walk." : "Choose your route before opening the walk.");
    const acknowledgement = assignmentToAccept(data, assignment, activeVolunteer.id);
    if (acknowledgement) await actions.saveAssignment({
      eventId: acknowledgement.eventId,
      territoryId: acknowledgement.territoryId,
      targetId: acknowledgement.targetId,
      assignedTeamId: acknowledgement.assignedTeamId,
      assignedVolunteerId: acknowledgement.assignedVolunteerId,
      status: "accepted",
    }, acknowledgement.id);
    await actions.setPreference("activeEventId", id);
    await actions.selectTerritory(area.id);
    clearAddressSearch();
    setOutreachDisplay("map");
    setSelectedPropertyId(null);
    setGuidedPropertyId(null);
    setSelectedParcel(null);
    setAddMode(false);
    setDrawMode(false);
    setDemoFieldAreaId(area.id);
    setDemoFieldTargetId(assignment?.targetId);
    if (pathname.startsWith("/app")) window.history.pushState(null, "", appHref("outreach", id) + "/field?" + new URLSearchParams({ area: area.id, ...(assignment?.targetId ? { target: assignment.targetId } : {}) }).toString());
    else setDemoRoute({ view: "map", fieldOutingId: id });
  };

  const finishFieldwork = async () => {
    if (!fieldOuting || !fieldAssignment) return;
    const label = fieldTarget?.name ?? activeTerritory.name;
    // Finishing a route never ends the walk for other teams; leaders complete
    // the whole walk from its page.
    const confirmed = await confirm({
      title: `Finish ${label}?`,
      message: canManage ? "Other routes stay open. End the whole walk from its page." : "You won’t be able to add visits to it afterward.",
      confirmLabel: "Finish route",
    });
    if (!confirmed) return;
    void fieldworkAction.run(async () => {
      if (fieldAssignment.targetId) await actions.finishTarget(fieldAssignment.targetId);
      else await actions.saveAssignment({
        eventId: fieldAssignment.eventId,
        territoryId: fieldAssignment.territoryId,
        assignedTeamId: fieldAssignment.assignedTeamId,
        assignedVolunteerId: fieldAssignment.assignedVolunteerId,
        status: "completed",
      }, fieldAssignment.id);
    }, () => {
      showToast("Route finished");
      navigate("outreach", fieldOuting.id);
    });
  };

  const handleAddProperty = async (address: string, unit: string, startGuided: boolean) => {
    if (!pendingAdd) return;
    if (fieldTarget && (!pendingAdd.parcel || !fieldTarget.parcels.some((parcel) => parcelKey(parcel) === parcelKey(pendingAdd.parcel!)))) throw new Error("Choose a home on this route.");
    const propertyId = await actions.addProperty({ ...pendingAdd, parcel: pendingAdd.parcel ? parcelReference(pendingAdd.parcel, Boolean(fieldTarget)) : undefined, address, unit });
    setPendingAdd(null);
    setAddMode(false);
    setGuidedPropertyId(startGuided ? propertyId : null);
    setSelectedPropertyId(propertyId);
    showToast(pendingAdd.parcel ? "Home added" : "Place added");
  };

  const beginAddingDwelling = () => {
    setSelectedParcel(null);
    setSelectedPropertyId(null);
    setGuidedPropertyId(null);
    setPendingAdd(null);
    setAddMode(true);
    showToast("Tap a spot on the map", "info");
  };

  const startDrawing = () => {
    navigate("map");
    setOutreachDisplay("map");
    setSelectedPropertyId(null);
    setAddMode(false);
    setEditingTerritoryId(null);
    setTerritoryEditorOpen(false);
    setDrawShape("rectangle");
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
    setDrawShape("rectangle");
    setDraftBoundary([]);
    setDrawMode(true);
  };

  const cancelDrawing = () => {
    setDrawMode(false);
    setDraftBoundary([]);
    setEditingTerritoryId(null);
    setTerritoryEditorOpen(false);
  };

  const outreachDisplaySwitch = <div className="outreach-display-switch" role="group" aria-label="View as"><button aria-pressed={showAddressList} onClick={() => setOutreachDisplay("list")}>Address list</button><button disabled={!activeTerritory.center || activeTerritory.kind === "list"} aria-pressed={!showAddressList} onClick={() => setOutreachDisplay("map")}>Map</button></div>;

  return (
    <main className="app-shell">
      {data.sync.mode === "device_only" && <div className="demo-notice" role="status"><span>Practice with a sample church. Nothing here is shared.</span> <Link href={isMobileApp ? "/login" : "/"}>{isMobileApp ? "Sign in" : "Return to website"}</Link></div>}
      <header className="app-header">
        <button className="brand" onClick={() => navigate("today")} aria-label="Open NeighborWalk Home">
          <span className="brand-mark" aria-hidden="true"><Navigation size={18} /></span>
          <span><strong>{data.church.name}</strong><small><i className={`status-dot ${syncStatusTone}`} aria-hidden="true" /><span>{syncStatusLabel}</span></small></span>
        </button>
        <div className="header-status">
          {canManage && !fieldOuting && !drawMode && <button className="button quiet header-zone-button" onClick={startDrawing}><MapPinned size={16} /><span>Add zone</span></button>}
          <button className="profile-button" onClick={() => navigate("settings")} aria-label="Open profile and settings"><span className="profile-avatar" aria-hidden="true">{initials(activeVolunteer.name)}</span><span>{activeVolunteer.name}</span></button>
        </div>
      </header>
      {data.sync.mode === "connected" && !isMobileApp && <div className={`offline-preparation ${offlineShell}`}><span role="status">{offlineShellCopy[offlineShell]}</span>{["preparing", "unavailable"].includes(offlineShell) && <button className="text-button" onClick={actions.checkOfflinePreparation}>Check preparation</button>}</div>}

      <div className="app-body">
        <aside className="desktop-sidebar">
          <div className="sidebar-context">
            <p className="sidebar-church"><strong>{data.church.name}</strong><span>{canManage ? "Church leader" : "Church volunteer"}</span></p>
            {view === "map" && !fieldOuting && <label><span>Area</span><div className="select-wrap"><select value={activeTerritory.id} onChange={(event) => actions.selectTerritory(event.target.value)}>{data.territories.map((territory) => <option key={territory.id} value={territory.id}>{territory.name}</option>)}</select><ChevronDown size={14} /></div></label>}
          </div>
          {view === "map" && <div className="coverage-card">
            <div><strong>{coverageValue}</strong><span>{coverageLabel}</span></div>
            <div className="progress-track"><i style={{ width: `${coverage.percent}%` }} /></div>
            <p><span>{coverage.touched} touched</span><span>{coverage.remaining} remaining</span></p>
          </div>}
          <nav className="sidebar-nav" aria-label="Main sections">
            <NavButton active={view === "today"} icon={<House size={18} />} label="Home" onClick={() => navigate("today")} />
            <NavButton active={view === "outreach" || Boolean(fieldOuting)} icon={<Footprints size={18} />} label="Walks" count={walkAttentionCount} onClick={() => navigate("outreach")} />
            <NavButton active={view === "people" || view === "followups"} icon={<Users size={18} />} label="People" count={peopleAttentionCount} onClick={() => { setFollowUpPersonId(null); navigate("people"); }} />
            <NavButton active={["more", "guide", "leader", "settings", "map", "recovery", "data"].includes(view) && !fieldOuting} icon={<CircleEllipsis size={18} />} label="More" onClick={() => navigate("more")} />
          </nav>
        </aside>

        <section className="workspace">
          {view === "data" && (canManage && data.sync.mode === "connected" ? <DataHealthView data={data} online={online} onRun={actions.runAdministration} onExport={actions.exportChurchRecords} onAuthenticate={actions.reauthenticateAdmin} onPending={actions.getAdministrationPending} onReviewPending={actions.reviewAdministrationPending} onPreviewRetention={actions.getRetentionPreview} onPreviewDuplicates={actions.getDuplicatePreview} onRefresh={actions.syncNow} onOpenPerson={(id) => navigate("people", id)} onOpenLocation={(id) => navigate("map", id)} /> : <section className="content-view"><h1>Data &amp; health</h1><p>Sign in as a church leader to use these tools.</p></section>)}
          {view === "recovery" && <RecoveryView data={data} online={online} onPreview={actions.previewRecovery} onResolve={actions.resolveRecovery} onExport={actions.downloadDeviceRecovery} onAuthoredExport={actions.downloadAuthoredDeviceRecovery} onArchives={actions.listDeviceArchives} onDownloadArchive={actions.downloadDeviceArchive} onSync={actions.syncNow} />}
          {view === "today" && <TodayView data={data} activeVolunteerId={activeVolunteer.id} canManage={canManage} onFollowUps={(id, scope = "mine") => { setFollowUpPersonId(null); setDemoTaskScope(scope); if (pathname.startsWith("/app")) window.history.pushState(null, "", followUpsHref(id, undefined, scope)); else setDemoRoute({ view: "followups", id }); }} onPerson={(id) => navigate("people", id)} onOuting={(id) => navigate("outreach", id)} onReviewSync={() => navigate("recovery")} onPeople={openPeopleDirectory} onViewMap={viewMap} onStart={startWalk} onWalkResponse={async (participant, status) => { await actions.saveOutingResponse(participant.id, status); showToast(status === "going" ? "You’re going" : "Response saved"); }} additionalAction={<EncounterComposer data={data} onSave={async (input) => { await actions.recordVisit(input); showToast("Conversation saved"); }} onCreatePerson={(input) => actions.upsertResident(undefined, input)} />} />}
          {view === "outreach" && <OutreachView data={data} canManage={canManage} activeVolunteerId={activeVolunteer.id} guides={guideLibrary.guides} selectedId={route.id} onRecordEncounter={async (input) => { await actions.recordVisit(input); showToast("Conversation saved"); }} onCreatePerson={(input) => actions.upsertResident(undefined, input)} initialCreate={pathname.startsWith("/app") ? searchParams.get("plan") === "1" : demoPlanWalk} onCreateClosed={() => { setDemoPlanWalk(false); if (pathname.startsWith("/app") && searchParams.has("plan")) window.history.replaceState(null, "", appHref("outreach", route.id)); }} onSelect={(id) => navigate("outreach", id)} onStart={startWalk} onSave={actions.saveOuting} onRepeat={actions.repeatOuting} onAssign={actions.saveAssignment} onSaveRoster={actions.saveOutingRoster} onSaveCrews={actions.saveWalkCrews} onAddZone={actions.addTerritory} onSaveTarget={actions.saveTarget} onReplaceTarget={actions.replaceTarget} onOpenGuide={(id) => navigate("guide", id)} />}
          {view === "more" && <section className="content-view more-view"><h1>More</h1>
            <ListGroup label="Your church">
              <ListRow icon={<BookOpenText />} title="Conversation guides" onClick={() => navigate("guide")} />
              <ListRow icon={<MapIcon />} title="Map & address lists" onClick={viewMap} />
              {canManage && <ListRow icon={<UsersRound />} title="Team & invitations" onClick={() => navigate("leader")} />}
              {canManage && data.sync.mode === "connected" && <ListRow icon={<Database />} title="Data & health" onClick={() => navigate("data")} />}
            </ListGroup>
            <ListGroup label="This phone">
              <ListRow icon={<Settings2 />} title="Settings" onClick={() => navigate("settings")} />
              <ListRow icon={<CloudOff />} title="Sync" value={deviceNeedsAttention ? <Badge tone="accent">Needs attention</Badge> : undefined} onClick={() => navigate("recovery")} />
            </ListGroup>
            <ListGroup label="Help">
              <ListRow icon={<CircleHelp />} title="Help & field guide" href="/help" />
              <ListRow icon={<Lock />} title="Privacy & trust" href="/trust" />
            </ListGroup>
          </section>}
          {view === "map" && (!route.fieldOutingId || fieldArea ? (
            <section className="map-view">
              {!fieldOuting && peopleMapReturn && !selectedProperty && <div className="map-people-return"><button type="button" onClick={returnFromPeopleMap} aria-label="Back to People"><ArrowLeft size={20} aria-hidden="true" /><span>People</span></button></div>}
              {fieldOuting && <header className="fieldwork-header">
                <div className="field-context">
                  <button className="field-context-back" onClick={() => navigate("outreach", fieldOuting.id)}><span className="field-context-back-icon" aria-hidden="true"><ArrowLeft size={18} /></span><span className="field-context-back-copy"><strong>{fieldTarget?.name ?? fieldOuting.name}</strong><span>{fieldTarget ? `${fieldOuting.name} · ${coverage.touched} of ${coverage.total} reached · ${coverageValue}` : "Conversations here are saved to this walk."}</span></span></button>
                </div>
                <div className="fieldwork-header-actions">{outreachDisplaySwitch}<button className="button quiet fieldwork-finish-button" disabled={fieldworkAction.busy} onClick={() => void finishFieldwork()}><CheckCircle2 size={16} /> {fieldworkAction.busy ? "Finishing…" : "Finish for tonight"}</button></div>
              </header>}
              {!fieldOuting && <div className="map-view-controls">{outreachDisplaySwitch}{canManage && <button type="button" className="button primary map-plan-walk-button" onClick={planWalk} aria-label="Plan a walk"><Plus size={16} aria-hidden="true" /><span>Plan a walk</span></button>}</div>}
              {fieldworkAction.error && <p role="alert" className="inline-error fieldwork-error">{fieldworkAction.error}</p>}
              {showAddressList ? <AddressList key={fieldTarget?.id ?? activeTerritory.id} targetName={fieldTarget?.name} targetParcels={fieldTarget ? mapParcels : undefined} printContext={fieldPrintContext} lockedTerritoryId={fieldOuting ? activeTerritory.id : undefined} data={fieldTarget ? { ...data, properties: territoryProperties } : data} onOpen={(id) => { if (fieldOuting) setSelectedPropertyId(id); else navigate("map", id); }} onOpenParcel={(parcel) => {
                const coordinates = parcelSelectionPoint(parcel);
                if (!coordinates || !parcel.properties.situsAddress) { showToast("Use the map to add this home", "info"); setOutreachDisplay("map"); return; }
                setSelectedPropertyId(null); setSelectedParcel(null); setGuidedPropertyId(null);
                setPendingAdd({ coordinates, suggestedAddress: parcel.properties.situsAddress, parcel: parcel.properties });
              }} onAdd={actions.addProperty} onTerritoryChange={actions.selectTerritory} /> : <>
              {!fieldOuting && <div className="mobile-context-row">
                <div><p className="eyebrow">{data.events.find((event) => event.id === data.preferences.activeEventId)?.name}</p><button disabled={Boolean(fieldOuting)} onClick={() => setTerritoryPickerOpen(true)}><strong>{activeTerritory.name}</strong>{!fieldOuting && <ChevronDown size={15} />}</button></div>
                <div><strong>{coverageValue}</strong><span>{coverageLabel}</span></div>
              </div>}
              <div className="map-toolbar">
                <div className="map-filter-scroll" role="group" aria-label="Filter homes">{mapFilterOptions.map((option) => <button key={option.value} className={filter === option.value ? "active" : ""} aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>{option.label}{option.value !== "all" && <i style={{ background: outcomeMeta[option.value].color }} />}</button>)}</div>
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
                  {searchOpen && query.trim() && <div id="address-search-results" className="map-search-results" role="region" aria-label="Address search results">
                    {savedAddressResults.length > 0 && <div className="map-search-group">
                      <span className="map-search-group-label">Saved homes</span>
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
                <MapCanvas territory={canvasTerritory} target={fieldTarget} properties={territoryProperties} selectedPropertyId={selectedPropertyId} visibleOutcomes={visibleOutcomes} searchTarget={searchTarget} addMode={addMode} drawMode={drawMode} drawShape={drawShape} drawModeLabel={editingTerritoryId ? "New boundary" : "New zone"} draftBoundary={draftBoundary} compactMarkers={data.preferences.compactMapMarkers} mapStyleUrl={data.preferences.mapStyleUrl} parcels={mapParcels} onViewportChange={setMapViewport} onSelectProperty={(id) => { if (!fieldOuting) navigate("map", id); setSelectedPropertyId(id); setGuidedPropertyId(null); setSelectedParcel(null); setAddMode(false); }} onAddIntent={async (intent) => {
                  if (fieldTarget && (!intent.parcel || !fieldTarget.parcels.some((parcel) => parcelKey(parcel) === parcelKey(intent.parcel!)))) { showToast("That home isn’t on this route", "error"); return; }
                  if (intent.parcel) {
                    const linkedDwellings = dwellingsForParcel(territoryProperties, intent.parcel);
                    const legacyPropertyIds = intent.legacyPropertyIds ?? [];
                    if (legacyPropertyIds.length) {
                      actions.associatePropertiesWithParcel(legacyPropertyIds, parcelReference(intent.parcel, Boolean(fieldTarget)));
                    }
                    const propertyIds = [...new Set([
                      ...linkedDwellings.map((property) => property.id),
                      ...legacyPropertyIds,
                    ])];
                    if (!addMode && propertyIds.length) {
                      setSelectedPropertyId(null);
                      setSelectedParcel({
                        parcel: parcelReference(intent.parcel, Boolean(fieldTarget)),
                        situsAddress: intent.parcel.situsAddress,
                        propertyIds,
                      });
                      return;
                    }
                  }
                  if (intent.parcel?.situsAddress) {
                    setSelectedParcel(null);
                    setPendingAdd(intent);
                    showToast("Parcel selected", "info");
                    return;
                  }
                  showToast("Checking location", "info");
                  try {
                    const address = await reverseGeocode(intent.coordinates);
                    setPendingAdd(address ? { ...intent, suggestedAddress: address } : intent);
                  } catch {
                    setPendingAdd(intent);
                  }
                }} onUseAddressList={() => setOutreachDisplay("list")} onAssociatePropertiesWithParcel={(propertyIds, parcel) => actions.associatePropertiesWithParcel(propertyIds, parcelReference(parcel, Boolean(fieldTarget)))} onDrawShapeChange={setDrawShape} onDraftBoundaryChange={setDraftBoundary} />
                <div className="map-floating-actions">
                  {!drawMode && <button className={`map-action-button ${addMode ? "active" : ""}`} aria-label={addMode ? "Cancel adding a home" : "Add a home"} onClick={() => { setAddMode((current) => !current); setSelectedPropertyId(null); setGuidedPropertyId(null); setSelectedParcel(null); }}><Plus size={18} /><span>{addMode ? "Cancel adding" : "Add home"}</span></button>}
                  {canManage && !fieldTarget && !drawMode && <button className="map-action-button secondary" aria-label={`Edit ${activeTerritory.name}`} onClick={() => openTerritoryEditor(activeTerritory.id)}><Edit3 size={18} /><span>Edit neighborhood</span></button>}
                  {canManage && !fieldTarget && !drawMode && <button className="map-action-button secondary" aria-label="Draw a neighborhood" onClick={startDrawing}><MapPinned size={18} /><span>New neighborhood</span></button>}
                </div>
                {drawMode && <div className="draw-controls"><button className="button quiet" disabled={!draftBoundary.length} onClick={() => setDraftBoundary((points) => undoDrawingPoint(points, drawShape))}><Undo2 size={15} /> {drawShape === "rectangle" ? "Clear rectangle" : "Undo corner"}</button><button className="button quiet" onClick={cancelDrawing}>Cancel</button><button className="button primary" disabled={!drawingBoundaryReady(draftBoundary, drawShape)} onClick={() => setTerritoryEditorOpen(true)}><Check size={15} /> Finish boundary</button></div>}
              </div>
              </>}
              {selectedProperty && <PropertyDrawer key={selectedProperty.id} property={selectedProperty} parcelDwellings={selectedPropertyDwellings} data={data} visits={selectedVisits} openFollowUp={selectedFollowUp} conversationGuide={favoriteConversationGuide} conversationGuideContext={fieldGuideContext} canManage={canManage} activeVolunteerId={activeVolunteer.id} startGuided={guidedPropertyId === selectedProperty.id} onBack={peopleMapReturn ? returnFromPeopleMap : undefined} onClose={() => { if (route.id && !fieldOuting) navigate("map"); setSelectedPropertyId(null); setGuidedPropertyId(null); }} onViewParcel={selectedProperty.parcel ? () => { setSelectedParcel({ parcel: selectedProperty.parcel!, situsAddress: selectedProperty.address, propertyIds: selectedPropertyDwellings.map((property) => property.id) }); setSelectedPropertyId(null); setGuidedPropertyId(null); } : undefined} onAddDwelling={selectedProperty.parcel ? beginAddingDwelling : undefined} onRecordVisit={async (input) => { if (fieldOuting && selectedProperty.territoryId !== activeTerritory.id) throw new Error("This home is in another neighborhood. Open its walk to log a visit."); await actions.recordVisit({ ...input, eventId: fieldOuting?.id, targetId: fieldTarget?.id }); showToast("Visit saved"); }} onUpdateProperty={actions.updateProperty} onDeleteProperty={actions.deleteProperty} onUpsertResident={actions.upsertResident} onDeleteResident={actions.deleteResident} />}
            </section>
          ) : <section className="content-view"><h1>Choose where to begin</h1><p>Open the walk to see your route.</p><button className="button primary" onClick={() => navigate("outreach", fieldOuting?.id)}>Open walk</button></section>)}
          {(view === "people" || view === "followups" || peopleMapReturn) && <PeopleWorkspace
            key={activeVolunteer.id}
            hidden={view === "map"}
            initialPanel={peopleMapReturn?.workspace.initialPanel ?? ((pathname.startsWith("/app") ? searchParams.get("view") === "all" : demoPeopleDirectory) ? "directory" : "followups")}
            onPanelChange={changePeoplePanel}
            followUpProps={{
              data, canManage, activeVolunteerId: activeVolunteer.id,
              focusedTaskId: peopleMapReturn?.workspace.focusedTaskId ?? (view === "followups" ? route.id : undefined),
              initialPersonId: peopleMapReturn?.workspace.initialPersonId ?? (view === "followups" ? (pathname.startsWith("/app") ? searchParams.get("person") : followUpPersonId) : undefined),
              initialScope: peopleMapReturn?.workspace.initialScope ?? (pathname.startsWith("/app") ? followUpScope(searchParams.get("scope")) : demoTaskScope),
              onOpenTask: (id) => navigate("followups", id),
              onClearPersonFocus: () => { setFollowUpPersonId(null); navigate("people"); },
              onOpenProperty: openPropertyFromPeople,
              onOpenPerson: (id) => navigate("people", id),
              onAddPersonNote: actions.addPersonNote,
              onComplete: async (id, input) => { await actions.completeFollowUp(id, input); showToast(input.nextFollowUp ? "Next scheduled" : "Follow-up completed"); },
              onReschedule: async (id, date, note) => { await actions.rescheduleFollowUp(id, date, note); showToast("Follow-up rescheduled"); },
              onCancel: async (id, note) => { await actions.cancelFollowUp(id, note); showToast("Cancelled"); },
              onAssign: actions.assignFollowUp, onAccept: actions.acceptFollowUp,
            }}
            peopleProps={{
              restrictionActions: { add: actions.addRestriction, lift: actions.liftRestriction },
              data, canManage, activeVolunteerId: activeVolunteer.id,
              initialSelectedResidentId: peopleMapReturn?.workspace.selectedResidentId ?? (view === "people" ? personSelection : undefined),
              onSelectResident: (id) => navigate("people", id),
              onOpenProperty: openPropertyFromPeople,
              onUpsertResident: actions.upsertResident, onDeleteResident: actions.deleteResident,
              onAddPersonNote: actions.addPersonNote, onDeletePersonNote: actions.deletePersonNote,
              onAddPersonFollowUp: actions.addPersonFollowUp, onHandoff: actions.handoffPerson,
              onOpenFollowUps: (id) => { setFollowUpPersonId(id); if (pathname.startsWith("/app")) window.history.pushState(null, "", followUpsHref(undefined, id)); else setDemoRoute({ view: "followups" }); },
            }}
          />}
          {view === "guide" && <GuideView key={route.id ?? "guides"} routeGuideId={route.id} onSelectGuide={(id) => navigate("guide", id)} guides={guideLibrary.guides} favoriteGuideId={guideLibrary.favoriteGuideId} effectiveGuideId={favoriteConversationGuide?.id} activeTeamId={activeGuideTeam?.id} activeTeamName={activeGuideTeam?.name} teams={data.teams} teamGuideDefaults={guideLibrary.teamGuideDefaults} canManage={canManage} allowBuiltInManagement={data.sync.mode === "device_only"} libraryError={guideLibraryError} changesDisabled={Boolean(supabaseUser && (!online || guideChanging || guidePending))} pendingRequest={Boolean(guidePending)} recovery={supabaseUser ? <GuideChangeRecovery pending={guidePending} online={online} busy={guideChanging} onRefresh={actions.refreshGuideLibrary} onRetry={actions.retryGuideChange} onReview={actions.reviewGuidePending} /> : undefined} onSave={actions.saveConversationGuide} onDelete={actions.deleteConversationGuide} onSetFavorite={actions.setFavoriteConversationGuide} onSetTeamDefault={actions.setTeamConversationGuide} />}
          {view === "leader" && canManage && <LeaderView data={data} membership={workspaceMembership} onSelectTerritory={(id) => { void actions.selectTerritory(id).then(() => navigate("map")).catch(() => showToast("Couldn’t open that area", "error")); }} onEditTerritory={openTerritoryEditor} onStartDrawing={startDrawing} onAddTeam={actions.addTeam} onUpdateTeam={actions.updateTeam} onDeleteTeam={actions.deleteTeam} onOpenOutreach={() => navigate("outreach")} onOpenToday={() => navigate("today")} onOpenSettings={() => navigate("settings")} onOpenData={() => navigate("data")} onAuthenticate={actions.reauthenticateAdmin} onAccessChanged={actions.syncNow} />}
          {view === "settings" && <SettingsView data={data} online={online} saving={saving} syncing={syncing} storageError={storageError} canManage={canManage} guides={guideLibrary.guides} favoriteGuideId={guideLibrary.favoriteGuideId} accountEmail={supabaseUser?.email} onSignOut={onSignOut ? async () => {
            if (saving || guideChanging) throw new Error("Wait for saving to finish, then sign out.");
            const pendingAdministration = await actions.getAdministrationPending();
            const pendingGuide = await actions.getGuidePending();
            if ((pendingChanges || data.sync.legacyRecoveryRequired || pendingAdministration || pendingGuide) && !await confirm({ title: "Sign out with unsent work?", message: "Some changes haven’t reached the church yet. They stay on this phone and will send when you sign back in with this account.", confirmLabel: "Sign out", destructive: true })) return;
            await onSignOut();
          } : undefined} onUpdatePassword={onUpdatePassword} onUpdateChurch={actions.updateChurch} onSetPreference={actions.setPreference} onSetFavoriteGuide={actions.setFavoriteConversationGuide} onExport={actions.downloadBackup} onImport={actions.importBackup} onPurge={actions.purgeExpired} onClearOutreach={actions.clearOutreachData} onSync={actions.syncNow} onOpenRecovery={() => navigate("recovery")} />}
        </section>
      </div>

      <nav className="mobile-nav" aria-label="Main navigation">
        <MobileNav active={view === "today"} icon={<House size={24} />} label="Home" onClick={() => navigate("today")} />
        <MobileNav active={view === "outreach" || Boolean(fieldOuting)} icon={<Footprints size={24} />} label="Walks" count={walkAttentionCount} onClick={() => navigate("outreach")} />
        <MobileNav active={view === "people" || view === "followups"} icon={<Users size={24} />} label="People" count={peopleAttentionCount} onClick={() => navigate("people")} />
        <MobileNav active={["more", "guide", "leader", "settings", "map", "recovery", "data"].includes(view) && !fieldOuting} icon={<CircleEllipsis size={24} />} label="More" onClick={() => navigate("more")} />
      </nav>

      {pendingAdd && <AddPropertyModal intent={pendingAdd} existingDwellingCount={pendingParcelDwellings.length} guideName={favoriteConversationGuide?.title} guideAvailable={Boolean(favoriteConversationGuide?.steps.length)} onClose={() => { setPendingAdd(null); setAddMode(false); }} onSave={handleAddProperty} />}
      {selectedParcel && <ParcelSummaryModal selection={selectedParcel} dwellings={selectedParcelDwellings} onClose={() => setSelectedParcel(null)} onOpenDwelling={(propertyId) => { setSelectedParcel(null); setGuidedPropertyId(null); setSelectedPropertyId(propertyId); }} onAddDwelling={beginAddingDwelling} />}
      {territoryPickerOpen && <TerritoryPickerModal data={data} coverageByTerritory={coverageByTerritory} activeTerritoryId={activeTerritory.id} canManage={canManage} onClose={() => setTerritoryPickerOpen(false)} onSelect={(territoryId) => { actions.selectTerritory(territoryId); setTerritoryPickerOpen(false); setSelectedPropertyId(null); }} onEdit={openTerritoryEditor} onDraw={() => { setTerritoryPickerOpen(false); startDrawing(); }} />}
      {territoryEditorOpen && <TerritoryModal key={`${editingTerritoryId ?? "new"}-${draftBoundary.length}`} territory={editingTerritory} territories={territoryEditorTerritories} boundaryChanged={draftBoundary.length >= 3} onClose={() => { setTerritoryEditorOpen(false); if (!drawMode) setEditingTerritoryId(null); }} onRedraw={editingTerritoryId ? () => startBoundaryRedraw(editingTerritoryId) : undefined} onDelete={editingTerritory ? async (destinationTerritoryId) => {
        await actions.deleteTerritory(editingTerritory.id, destinationTerritoryId);
        setSelectedPropertyId(null); setDraftBoundary([]); setDrawMode(false); setEditingTerritoryId(null); setTerritoryEditorOpen(false); showToast("Neighborhood deleted");
      } : undefined} onSave={async (name, color) => {
        if (editingTerritory) {
          const replacementBoundary = draftBoundary.length >= 3 ? draftBoundary : undefined;
          await actions.updateTerritory(editingTerritory.id, {
            name,
            color,
            boundary: replacementBoundary,
            center: replacementBoundary ? centerForBoundary(replacementBoundary) : undefined,
          });
          showToast("Neighborhood updated");
        } else if (draftBoundary.length >= 3) {
          await actions.addTerritory({ name, color, boundary: draftBoundary, center: centerForBoundary(draftBoundary) });
          showToast("Neighborhood created");
        }
        setDraftBoundary([]); setDrawMode(false); setEditingTerritoryId(null); setTerritoryEditorOpen(false);
      }} />}
      {toast && <div className={`toast ${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.tone === "success" ? <Check size={16} aria-hidden="true" /> : toast.tone === "error" ? <CircleAlert size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}{toast.message}</div>}
    </main>
  );
}

function InvitationRequired({ user, error, onSignOut }: { user: SupabaseUser; error?: string; onSignOut?: () => Promise<void> }) {
  const action = useAsyncAction();
  return (
    <main className="workspace-setup-shell">
      <section className="workspace-setup-card" aria-labelledby="workspace-title">
        <div className="workspace-setup-mark"><Users size={22} /></div>
        <p className="eyebrow">Invitation required</p>
        <h1 id="workspace-title">Ask your leader for an invitation link.</h1>
        <p>NeighborWalk is private to each church. Open the invite link from your leader, then sign in.</p>
        <div className="workspace-account"><CircleUserRound size={17} /><span><strong>Signed in</strong>{user.email}</span></div>
        <div className="data-note"><ShieldCheck size={16} /><span>Invite links work once and expire after 7 days.</span></div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {isMobileApp && <><MobileInvitation /><AccountDeletion /></>}
        {onSignOut && <button className="button quiet" disabled={action.busy} onClick={() => void action.run(onSignOut)}>Use a different account</button>}
        {action.error && <p role="alert">{action.error}</p>}
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
  onSave: (address: string, unit: string, startGuided: boolean) => Promise<unknown>;
}) {
  const [address, setAddress] = useState(intent.suggestedAddress);
  const action = useAsyncAction();
  const [unit, setUnit] = useState("");
  const countyName = intent.parcel ? PARCEL_COUNTY_NAMES[intent.parcel.countyFips] ?? "Tennessee" : null;
  const needsLabel = existingDwellingCount > 0;
  const canSave = address.trim().length >= 3 && (!needsLabel || unit.trim().length > 0);
  return (
    <Modal
      title={needsLabel ? "Add another home" : "Add this home"}
      description={intent.parcel ? "Each home keeps its own visits and follow-ups." : "Check the address, then start the visit."}
      onClose={action.busy ? () => undefined : onClose}
    >
      <div className="location-preview"><MapPinned size={20} /><span><strong>{intent.parcel ? `${countyName} property record` : "Spot on the map"}</strong>{intent.coordinates[1].toFixed(6)}, {intent.coordinates[0].toFixed(6)}{intent.buildingGeometry ? " · Building found" : ""}</span></div>
      {intent.parcel && <div className="parcel-preview"><span><strong>{intent.parcel.propertyClass ?? "Property type unknown"}</strong><small>{intent.parcel.landUse ?? "Not listed in county records"}</small></span><ShieldCheck size={15} /><small>We don’t store owner names or property values.</small></div>}
      {needsLabel && <div className="parcel-existing-note"><Building2 size={17} /><span><strong>{existingDwellingCount} {existingDwellingCount === 1 ? "home is" : "homes are"} already mapped here</strong>Add a label so the next person knocks on the right door.</span></div>}
      <div className="form-stack">
        <label className="form-field"><span>Street address</span><input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
        <label className="form-field"><span>Unit or label <small>{needsLabel ? "Required" : "Optional"}</small></span><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Rear house, Unit B, Apartment 2" /></label>
      </div>
      {guideAvailable && <div className="guided-start-note"><BookOpenText size={17} /><span><strong>Want a little help at the door?</strong>The guided path opens with {guideName || "your favorite guide"}. You can leave it at any time.</span></div>}
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      <div className="modal-actions split add-location-actions">
        <button className="button quiet" disabled={action.busy} onClick={onClose}>Cancel</button>
        <div>
          <button className="button quiet" disabled={!canSave || action.busy} onClick={() => void action.run(() => onSave(address, unit, false))}><Plus size={15} /> {guideAvailable ? "Add without guide" : "Add home"}</button>
          {guideAvailable && <button className="button primary" disabled={!canSave || action.busy} onClick={() => void action.run(() => onSave(address, unit, true))}><BookOpenText size={15} /> Add &amp; use guide</button>}
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
  const address = selection.situsAddress ?? dwellings[0]?.address ?? "This property";
  return (
    <Modal title={`${progress.total} ${progress.total === 1 ? "home" : "homes"} at this address`} description={address} onClose={onClose}>
      <div className="parcel-tally">
        <div><span>Doors</span><strong>{progress.visited}<small> / {progress.total}</small></strong></div>
        <div><span>{progress.remaining ? `${progress.remaining} still to visit` : "Every home visited"}</span><div className="parcel-tally-track"><i style={{ width: `${progress.percent}%` }} /></div></div>
      </div>
      <div className="parcel-dwelling-list" role="group" aria-label="Homes at this address">
        {dwellings.map((property) => (
          <button key={property.id} onClick={() => onOpenDwelling(property.id)}>
            <i style={{ background: outcomeMeta[property.currentOutcome].color }} />
            <span><strong>{property.unit || property.address}</strong><small>{property.unit ? property.address : "Main home"} · {outcomeMeta[property.currentOutcome].label}</small></span>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
      <div className="modal-actions"><button className="button quiet" onClick={onClose}>Close</button><button className="button primary" onClick={onAddDwelling}><Plus size={15} /> Add another home</button></div>
    </Modal>
  );
}

function TerritoryModal({ territory, territories, boundaryChanged, onClose, onRedraw, onDelete, onSave }: {
  territory?: Territory;
  territories: NeighborWalkData["territories"];
  boundaryChanged: boolean;
  onClose: () => void;
  onRedraw?: () => void;
  onDelete?: (destinationTerritoryId: string) => Promise<unknown>;
  onSave: (name: string, color: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(territory?.name ?? "");
  const [color, setColor] = useState(territory?.color ?? "#286c59");
  const action = useAsyncAction();
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const editing = Boolean(territory);
  const deleteTargets = territories.filter((item) => item.id !== territory?.id);
  const [deleteDestinationId, setDeleteDestinationId] = useState(deleteTargets[0]?.id ?? "");
  const canDelete = deleteTargets.length > 0;
  const boundaryPoints = boundaryChanged ? "Replacement boundary ready" : `${territory?.boundary.length ?? 0} boundary points`;

  return (
    <Modal
      title={editing ? "Edit neighborhood" : "Name this neighborhood"}
      description={editing ? "Change its name or boundary." : "Give it a name people will recognize."}
      onClose={action.busy ? () => undefined : onClose}
    >
      <div className="form-stack">
        <label className="form-field"><span>{editing ? "Neighborhood name" : "Zone name"}</span><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: Oakwood North" /></label>
        <div className="territory-form-row">
          <label className="form-field"><span>Map color</span><input className="territory-color-input" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
          
        </div>
        <div className={`territory-boundary-summary${boundaryChanged ? " changed" : ""}`}>
          <span><MapPinned size={18} /></span>
          <div><strong>{boundaryPoints}</strong><small>Existing locations and visit history stay attached to this {editing ? "territory" : "zone"}.</small></div>
          {editing && onRedraw && <button className="button quiet small" onClick={onRedraw}><Edit3 size={14} /> Redraw</button>}
        </div>
        {editing && deleting && <div className="territory-delete-confirm"><strong>Delete this neighborhood?</strong><p>Homes move to the neighborhood you pick. Past visits, people and follow-ups stay.</p><label className="form-field"><span>Move homes to</span><select value={deleteDestinationId} onChange={(event) => setDeleteDestinationId(event.target.value)}>{deleteTargets.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="form-field"><span>Type <strong>{territory?.name}</strong> to confirm</span><input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} aria-label="Type the neighborhood name to confirm" /></label></div>}
      </div>
      <div className="modal-actions split">{editing && onDelete ? <button className="button danger" disabled={action.busy || !canDelete || (deleting && (deleteConfirmation !== territory?.name || !deleteDestinationId))} onClick={() => deleting ? void action.run(() => onDelete(deleteDestinationId)) : setDeleting(true)}>{deleting ? "Delete and move homes" : "Delete neighborhood"}</button> : <span />}<div><button className="button quiet" onClick={onClose}>Cancel</button><button className="button primary" onClick={() => void action.run(() => onSave(name, color))} disabled={action.busy || name.trim().length < 3}><Check size={15} /> {editing ? "Save changes" : "Create neighborhood"}</button></div></div>
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      {editing && !canDelete && <p className="modal-footnote">Create another neighborhood first so its homes have somewhere to go.</p>}
    </Modal>
  );
}

function TerritoryPickerModal({ data, coverageByTerritory, activeTerritoryId, canManage, onClose, onSelect, onEdit, onDraw }: { data: NeighborWalkData; coverageByTerritory: TerritoryCoverageById; activeTerritoryId: string; canManage: boolean; onClose: () => void; onSelect: (territoryId: string) => void; onEdit: (territoryId: string) => void; onDraw: () => void }) {
  const territories = data.territories;
  return <Modal title="Choose a neighborhood" onClose={onClose}><div className="territory-picker-list">{territories.map((territory) => { const coverage = coverageByTerritory[territory.id] ?? coverageForTerritory(data, territory.id); return <div key={territory.id} className={`territory-picker-row${territory.id === activeTerritoryId ? " active" : ""}`}><i style={{ background: territory.color }} /><button className="territory-picker-select" onClick={() => onSelect(territory.id)}><span><strong>{territory.name}</strong><small>{coverage.percent}% covered · {coverage.remaining} residential remaining</small></span>{territory.id === activeTerritoryId && <Check size={16} />}</button>{canManage && <button className="territory-picker-edit" onClick={() => onEdit(territory.id)} aria-label={`Edit ${territory.name}`}><Edit3 size={16} /></button>}</div>; })}</div><div className="modal-actions"><button className="button quiet" onClick={onClose}>Close</button>{canManage && <button className="button primary" onClick={onDraw}><MapPinned size={15} /> Draw a new territory</button>}</div></Modal>;
}

function NavButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  const accessibilityLabel = count ? `${label}, ${count} item${count === 1 ? "" : "s"} need attention` : label;
  return <button className={active ? "active" : ""} onClick={onClick} aria-current={active ? "page" : undefined} aria-label={accessibilityLabel}>{icon}<span>{label}</span>{count ? <b aria-hidden="true">{count}</b> : null}</button>;
}

function MobileNav({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  const accessibilityLabel = count ? `${label}, ${count} item${count === 1 ? "" : "s"} need attention` : label;
  return <button className={active ? "active" : ""} onClick={onClick} aria-current={active ? "page" : undefined} aria-label={accessibilityLabel}><span>{icon}{count ? <b aria-hidden="true">{count}</b> : null}</span><small>{label}</small></button>;
}

function AppLoading() {
  return <main className="app-loading"><div className="loading-mark"><Navigation size={23} /></div><h1>Getting things ready</h1><span role="status" aria-live="polite">Loading your church…</span></main>;
}

function AppFailure({ error, onSignOut, onRecovery }: { error: string; onSignOut?: () => Promise<void>; onRecovery?: () => Promise<void> }) {
  const action = useAsyncAction();
  const confirm = useConfirm();
  let hasInvitation = false;
  try { hasInvitation = typeof window !== "undefined" && Boolean(pendingInvitation(window.sessionStorage)); } catch { /* Leave a blocked browser's state intact. */ }
  return <main className="app-loading error"><div className="loading-mark"><X size={23} /></div><h1>We couldn’t open your church</h1><p>{error}</p><p>Nothing on this phone was deleted. Reconnect, or ask your leader to check your access.</p><button className="button primary" onClick={() => location.reload()}>Try again</button>{hasInvitation && <button className="button quiet" disabled={action.busy} onClick={() => { void confirm({ title: "Use your existing church instead?", message: "This skips the invitation on this phone. The invitation itself still works.", confirmLabel: "Skip invitation" }).then((confirmed) => { if (confirmed) void action.run(async () => { clearPendingInvitation(); window.location.reload(); }); }); }}>Skip this invitation</button>}{onRecovery && <button className="button quiet" disabled={action.busy} onClick={() => void action.run(onRecovery)}>Download my unsent work</button>}{onSignOut && <button className="button quiet" disabled={action.busy} onClick={() => { void confirm({ title: "Sign out?", message: "Unsent work stays on this phone and sends when you sign back in with this account.", confirmLabel: "Sign out", destructive: true }).then((confirmed) => { if (confirmed) void action.run(onSignOut); }); }}>Sign out or use a different account</button>}<Link href="/help">Sign-in help</Link>{action.error && <p role="alert">{action.error}</p>}</main>;
}
