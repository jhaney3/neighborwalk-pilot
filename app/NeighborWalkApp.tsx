"use client";

import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleEllipsis,
  CircleUserRound,
  Info,
  MapPin,
  Navigation,
  Plus,
  Sun,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { followUpScope, followUpsHref, type FollowUpScope } from "../lib/follow-up-filters";
import Link from "next/link";
import { isMobileApp } from "../lib/mobile";
import { MobileInvitation } from "../components/MobileInvitation";
import { AccountDeletion } from "../components/AccountDeletion";
import { appHref, appRoute, type AppView } from "../lib/app-routes";
import { TodayView } from "../components/TodayView";
import { ConversationLogger } from "../components/ConversationLogger";
import { OutreachView } from "../components/OutreachView";
import { DataHealthView } from "../components/DataHealthView";
import { MapScreen } from "../components/MapScreen";
import { PeopleWorkspace } from "../components/PeopleWorkspace";
import { PersonFormSheet } from "../components/PeopleView";
import { MoreView, SyncPage } from "../components/MoreView";
import { TeamView } from "../components/TeamView";
import { assignmentToAccept, fieldWalkAssignment, homeWalk } from "../lib/home-walk";
import { snapshotParcelFeatureCollection } from "../lib/target-parcels";
import { SettingsView } from "../components/SettingsView";
import { ConfirmProvider, SegmentedControl, initials, useConfirm } from "../components/ui";
import {
  type Property,
  type Territory,
} from "../lib/domain";
import { useAsyncAction } from "../lib/use-async-action";
import { clearPendingInvitation, pendingInvitation } from "../lib/invitations";
import { offlineShellCopy } from "../lib/offline-shell";
import { useNeighborWalk, type SupabaseUser } from "../lib/use-neighborwalk";
import { mergeParcelFeatureCollections, type MapViewport } from "../lib/parcels";
import { useTerritoryParcels } from "../lib/use-territory-parcels";
import { useVisibleParcels } from "../lib/use-visible-parcels";
import { compactToastMessage, type Toast, type ToastTone } from "../lib/toasts";
import { calendarDate } from "../lib/calendar";
import { deviceReminderFingerprint, reconcileDeviceReminders } from "../mobile/notifications";
import { actionFailed, saveSucceeded } from "../mobile/haptics";
import { registerRemotePush, REMOTE_PUSH_REFRESH_EVENT, remotePushConfigured } from "../mobile/push-notifications";

type View = AppView;
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

type NeighborWalkAppProps = { supabaseUser?: SupabaseUser | null; onSignOut?: () => Promise<void>; onUpdatePassword?: (password: string) => Promise<void> };

export function NeighborWalkApp(props: NeighborWalkAppProps = {}) {
  return <ConfirmProvider><NeighborWalkWorkspace {...props} /></ConfirmProvider>;
}

function NeighborWalkWorkspace({ supabaseUser, onSignOut, onUpdatePassword }: NeighborWalkAppProps) {
  const confirm = useConfirm();
  const { data, loading, storageError, online, saving, syncing, offlineShell, workspaceStatus, workspaceMembership, guideChanging, activeTerritory: currentTerritory, activeVolunteer, actions } = useNeighborWalk(supabaseUser);
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
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [followUpPersonId, setFollowUpPersonId] = useState<string | null>(null);
  const [peopleMapReturn, setPeopleMapReturn] = useState<PeopleMapReturn | null>(null);
  const [mapViewport, setMapViewport] = useState<MapViewport | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [addPersonHome, setAddPersonHome] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = useCallback((message: string, tone: ToastTone = "success") => {
    if (tone === "success") saveSucceeded();
    else if (tone === "error") actionFailed();
    setToast({ message: compactToastMessage(message), tone });
  }, []);
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

  const territories = data?.territories ?? EMPTY_TERRITORIES;
  const properties = useMemo(() => data?.properties.filter((property) => !property.mergedIntoId) ?? EMPTY_PROPERTIES, [data?.properties]);
  const activeTerritoryId = activeTerritory?.id;
  // Walkers drop pins anywhere in the route area, so walk mode shows the whole
  // neighborhood's pins, not only the target's parcel roster.
  const territoryProperties = useMemo(() => properties.filter((property) => property.territoryId === activeTerritoryId), [properties, activeTerritoryId]);
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

  if (loading || workspaceStatus === "connecting") return <AppLoading />;
  if (data && supabaseUser && workspaceStatus === "invitation_required") {
    return <InvitationRequired user={supabaseUser} error={data.sync.lastError} onSignOut={onSignOut} />;
  }
  if (workspaceStatus === "locked" || !data || !activeVolunteer) return <AppFailure error={storageError || "SendMe couldn’t load your church’s records."} onSignOut={onSignOut} onRecovery={supabaseUser ? actions.downloadAuthoredDeviceRecovery : undefined} />;

  const pendingChanges = data.sync.commands?.length ?? data.sync.pending.length;
  const needsReview = data.sync.legacyRecoveryRequired || data.sync.commands?.some((q) => q.state === "needs_review");
  // Practice mode never sends anything, so queued sample changes are not a problem to flag.
  const deviceNeedsAttention = data.sync.mode === "connected" && Boolean(data.sync.legacyRecoveryRequired || pendingChanges || data.sync.lastError || !online);
  const syncStatusLabel = saving ? "Saving…"
    : needsReview ? "Needs review"
    : data.sync.mode === "device_only" ? "Practice mode"
    : !online ? pendingChanges ? `Offline, ${pendingChanges} waiting to send` : "Offline"
    : syncing ? "Sending…"
    : pendingChanges ? `${pendingChanges} waiting to send`
    : data.sync.lastError ? "Couldn’t refresh"
    : data.sync.lastSyncedAt ? "Updated " + new Date(data.sync.lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Up to date";
  const syncStatusTone = data.sync.lastError || needsReview ? "error" : data.sync.mode === "device_only" ? "online" : !online ? "offline" : saving || syncing || pendingChanges ? "pending" : "online";
  const canManage = workspaceMembership ? workspaceMembership.role === "leader" : activeVolunteer.role === "leader";
  const openOutingIds = new Set(data.events.filter((event) => ["draft", "scheduled", "ready", "active"].includes(event.status)).map((event) => event.id));
  const walkAttentionCount = data.outingParticipants.filter((participant) => participant.volunteerId === activeVolunteer.id
    && participant.status === "invited" && openOutingIds.has(participant.eventId)).length;
  const churchToday = calendarDate(new Date(), data.church.timezone);
  const followUpAttentionCount = data.followUps.filter((task) => task.status === "scheduled" && task.assignedVolunteerId === activeVolunteer.id
    && (task.acceptance === "pending" || calendarDate(task.dueAt, data.church.timezone) <= churchToday)).length;
  const peopleAttentionCount = data.residents.filter((person) => person.pendingOwnerId === activeVolunteer.id).length;
  // The header capsule stays quiet unless the phone has something to say.
  const syncNeedsNotice = syncStatusTone !== "online";
  const requestedView = route.view;
  const view = requestedView === "leader" && !canManage ? "today" : requestedView;
  const fieldOuting = route.fieldOutingId ? data.events.find((e) => e.id === route.fieldOutingId) : undefined;
  const focusPropertyId = view === "map" && route.id ? route.id : null;
  const showAddressList = outreachDisplay === "list" || !activeTerritory.center || activeTerritory.kind === "list";

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
    if (next !== "map") setPeopleMapReturn(null);
    setSelectedPersonId(next === "people" ? id ?? null : null);
  };

  const openPropertyFromPeople = (propertyId: string) => {
    const inApp = pathname.startsWith("/app");
    const workspace: PeopleWorkspaceSnapshot = {
      initialPanel: view === "people" ? "directory" : "followups",
      selectedResidentId: view === "people" ? (view === "people" && route.id ? route.id : selectedPersonId) : undefined,
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
    setOutreachDisplay("map");
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

  const openPeopleDirectory = () => {
    navigate("people");
    if (pathname.startsWith("/app")) window.history.replaceState(null, "", appHref("people") + "?view=all");
    else setDemoPeopleDirectory(true);
  };
  // Follow-ups and People are separate tabs; the workspace asks to switch when
  // a person's profile links to their follow-ups or back.
  const changePeoplePanel = (panel: "directory" | "followups") => {
    setSelectedPersonId(null);
    setFollowUpPersonId(null);
    setDemoTaskScope("mine");
    navigate(panel === "directory" ? "people" : "followups");
  };
  const openFollowUp = (id: string) => {
    setFollowUpPersonId(null);
    if (pathname.startsWith("/app")) window.history.pushState(null, "", followUpsHref(id));
    else setDemoRoute({ view: "followups", id });
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
    setOutreachDisplay("map");
    setDemoFieldAreaId(area.id);
    setDemoFieldTargetId(assignment?.targetId);
    if (pathname.startsWith("/app")) window.history.pushState(null, "", appHref("outreach", id) + "/field?" + new URLSearchParams({ area: area.id, ...(assignment?.targetId ? { target: assignment.targetId } : {}) }).toString());
    else setDemoRoute({ view: "map", fieldOutingId: id });
  };

  // Finishing a route never ends the walk for other teams; leaders complete
  // the whole walk from its page.
  const completeFieldwork = async () => {
    if (!fieldOuting || !fieldAssignment) return;
    if (fieldAssignment.targetId) await actions.finishTarget(fieldAssignment.targetId);
    else await actions.saveAssignment({
      eventId: fieldAssignment.eventId,
      territoryId: fieldAssignment.territoryId,
      assignedTeamId: fieldAssignment.assignedTeamId,
      assignedVolunteerId: fieldAssignment.assignedVolunteerId,
      status: "completed",
    }, fieldAssignment.id);
    showToast("Route finished");
    navigate("outreach", fieldOuting.id);
  };

  // During a live walk, + starts on that walk: "Crockett north · away from a door" (PL1).
  const liveWalk = homeWalk(data, activeVolunteer.id, canManage);
  const liveOuting = fieldOuting ?? (liveWalk.outing?.status === "active" ? liveWalk.outing : undefined);
  const liveAssignment = fieldAssignment ?? (liveOuting ? liveWalk.assignments[0] : undefined);
  const liveRouteName = liveAssignment ? data.walkTargets.find((target) => target.id === liveAssignment.targetId)?.name ?? data.territories.find((territory) => territory.id === liveAssignment.territoryId)?.name : undefined;
  const peopleReturnLabel = peopleMapReturn?.workspace.initialPanel === "followups" ? "Follow-ups" : "People";
  const walkMode = Boolean(fieldOuting && fieldArea);
  const walksView = view === "map" ? (showAddressList ? "list" : "map") : "walks";
  const walksSwitch = <SegmentedControl label="Walks view" value={walksView} options={[
    { value: "walks", label: "Walks" },
    { value: "map", label: "Map", disabled: !activeTerritory.center || activeTerritory.kind === "list" },
    { value: "list", label: "List" },
  ]} onChange={(next) => {
    if (next === "walks") { navigate("outreach"); return; }
    setOutreachDisplay(next);
    if (view !== "map") navigate("map");
  }} />;
  // On the phone every tab draws its own top: Today and Follow-ups have a mono
  // capsule and your avatar; Walks and People open on their own controls.
  const headerHidden = true;

  return (
    <main className={`app-shell view-${view}${walkMode ? " walk-mode" : ""}${headerHidden ? " no-header" : ""}`}>
      {data.sync.mode === "device_only" && <div className="demo-notice" role="status"><span>Practice with a sample church. Nothing here is shared.</span> <Link href={isMobileApp ? "/login" : "/"}>{isMobileApp ? "Sign in" : "Return to website"}</Link></div>}
      <header className="app-header">
        <button className={`brand${syncNeedsNotice ? " has-notice" : ""}`} onClick={() => navigate("today")} aria-label={`Open Today. ${data.church.name}, ${syncStatusLabel}`}>
          <span className="brand-mark" aria-hidden="true"><Navigation size={18} /></span>
          <span><strong>{data.church.name}</strong><small><i className={`status-dot ${syncStatusTone}`} aria-hidden="true" /><span>{syncStatusLabel}</span></small></span>
        </button>
        <div className="header-status">
          <button className="profile-button" onClick={() => navigate("more")} aria-label="Open your profile, settings and more"><span className="profile-avatar" aria-hidden="true">{initials(activeVolunteer.name)}</span><span>{activeVolunteer.name}</span>{deviceNeedsAttention && <b className="profile-attention" aria-hidden="true" />}</button>
        </div>
      </header>
      {data.sync.mode === "connected" && !isMobileApp && <div className={`offline-preparation ${offlineShell}`}><span role="status">{offlineShellCopy[offlineShell]}</span>{["preparing", "unavailable"].includes(offlineShell) && <button className="text-button" onClick={actions.checkOfflinePreparation}>Check preparation</button>}</div>}

      <div className="app-body">
        <aside className="desktop-sidebar">
          <div className="sidebar-context">
            <p className="sidebar-church"><strong>{data.church.name}</strong><span>{canManage ? "Church leader" : "Church volunteer"}</span></p>
          </div>
          <button type="button" className="button accent sidebar-log-button" onClick={() => setLogOpen(true)}><Plus size={18} aria-hidden="true" /> Log a conversation</button>
          <nav className="sidebar-nav" aria-label="Main sections">
            <NavButton active={view === "today"} icon={<Sun size={18} />} label="Today" onClick={() => navigate("today")} />
            <NavButton active={view === "outreach" || view === "map" || Boolean(fieldOuting)} icon={<MapPin size={18} />} label="Walks" count={walkAttentionCount} onClick={() => navigate("outreach")} />
            <NavButton active={view === "followups"} icon={<CircleCheck size={18} />} label="Follow-ups" count={followUpAttentionCount} onClick={() => { setFollowUpPersonId(null); navigate("followups"); }} />
            <NavButton active={view === "people"} icon={<Users size={18} />} label="People" count={peopleAttentionCount} onClick={() => { setFollowUpPersonId(null); navigate("people"); }} />
            <NavButton active={["more", "leader", "settings", "recovery", "data"].includes(view)} icon={<CircleEllipsis size={18} />} label="More" onClick={() => navigate("more")} />
          </nav>
        </aside>

        <section className="workspace">
          {view === "data" && (canManage && data.sync.mode === "connected" ? <DataHealthView data={data} online={online} onRun={actions.runAdministration} onExport={actions.exportChurchRecords} onAuthenticate={actions.reauthenticateAdmin} onPending={actions.getAdministrationPending} onReviewPending={actions.reviewAdministrationPending} onPreviewRetention={actions.getRetentionPreview} onPreviewDuplicates={actions.getDuplicatePreview} onRefresh={actions.syncNow} onOpenPerson={(id) => navigate("people", id)} onOpenLocation={(id) => navigate("map", id)} /> : <section className="content-view"><h1>Data &amp; health</h1><p>Sign in as a church leader to use these tools.</p></section>)}
          {view === "recovery" && <SyncPage onBack={() => navigate("more")} recovery={{ data: data, online: online, onPreview: actions.previewRecovery, onResolve: actions.resolveRecovery, onExport: actions.downloadDeviceRecovery, onAuthoredExport: actions.downloadAuthoredDeviceRecovery, onArchives: actions.listDeviceArchives, onDownloadArchive: actions.downloadDeviceArchive, onSync: actions.syncNow }} />}
          {view === "today" && <TodayView data={data} activeVolunteerId={activeVolunteer.id} canManage={canManage} profileName={activeVolunteer.name} attention={deviceNeedsAttention} syncLabel={syncNeedsNotice ? syncStatusLabel : undefined} onProfile={() => navigate("more")} onSync={() => navigate("recovery")} onFollowUps={(id, scope = "mine") => { setFollowUpPersonId(null); setDemoTaskScope(scope); if (pathname.startsWith("/app")) window.history.pushState(null, "", followUpsHref(id, undefined, scope)); else setDemoRoute({ view: "followups", id }); }} onPerson={(id) => navigate("people", id)} onOuting={(id) => navigate("outreach", id)} onReviewSync={() => navigate("recovery")} onPeople={openPeopleDirectory} onStart={startWalk} onWalkResponse={async (participant, status) => { await actions.saveOutingResponse(participant.id, status); showToast(status === "going" ? "You’re going" : "Response saved"); }} />}
          {view === "outreach" && <OutreachView viewSwitch={walksSwitch} data={data} canManage={canManage} activeVolunteerId={activeVolunteer.id} selectedId={route.id} onRecordEncounter={async (input) => { await actions.recordVisit(input); showToast("Conversation saved"); }} onCreatePerson={(input) => actions.upsertResident(undefined, input)} onUpdatePerson={(id, input) => actions.upsertResident(data.residents.find((person) => person.id === id)?.propertyId, input, id)} initialCreate={pathname.startsWith("/app") ? searchParams.get("plan") === "1" : demoPlanWalk} onCreateClosed={() => { setDemoPlanWalk(false); if (pathname.startsWith("/app") && searchParams.has("plan")) window.history.replaceState(null, "", appHref("outreach", route.id)); }} onSelect={(id) => navigate("outreach", id)} onStart={startWalk} onSave={actions.saveOuting} onRepeat={actions.repeatOuting} onAssign={actions.saveAssignment} onSaveRoster={actions.saveOutingRoster} onSaveCrews={actions.saveWalkCrews} onAddZone={actions.addTerritory} onSaveTarget={actions.saveTarget} onReplaceTarget={actions.replaceTarget} onRespond={async (participant, status) => { await actions.saveOutingResponse(participant.id, status); showToast(status === "going" ? "You’re going" : "Response saved"); }} onAssignFollowUp={actions.assignFollowUp} onNotice={(message) => showToast(message, "info")} />}
          {view === "more" && <MoreView data={data} name={activeVolunteer.name} canManage={canManage} online={online} onTeam={() => navigate("leader")} onSettings={() => navigate("settings")} onSync={() => navigate("recovery")} />}
          {view === "map" && (!route.fieldOutingId || fieldArea ? <section className="map-view">
            <MapScreen key={fieldOuting ? `walk-${fieldOuting.id}` : "browse"} data={data} actions={actions} canManage={canManage} activeVolunteerId={activeVolunteer.id}
              territory={activeTerritory} properties={territoryProperties}
              walk={fieldOuting && fieldAssignment && fieldArea ? { outing: fieldOuting, assignment: fieldAssignment, target: fieldTarget } : undefined}
              display={showAddressList ? "list" : "map"} onDisplay={setOutreachDisplay} walksSwitch={walksSwitch} parcels={mapParcels} onViewportChange={setMapViewport}
              focusPropertyId={focusPropertyId} peopleReturn={peopleMapReturn && !fieldOuting ? { label: peopleReturnLabel, onBack: returnFromPeopleMap } : undefined}
              onOpenWalk={() => { if (fieldOuting) navigate("outreach", fieldOuting.id); }} onFinishRoute={completeFieldwork}
              onOpenFollowUp={openFollowUp} onOpenPerson={(id) => navigate("people", id)} onAddPerson={setAddPersonHome}
              onAssignFollowUp={actions.assignFollowUp} showToast={showToast} />
          </section> : <section className="content-view"><h1>Choose where to begin</h1><p>Open the walk to see your route.</p><button className="button primary" onClick={() => navigate("outreach", fieldOuting?.id)}>Open walk</button></section>)}
          {(view === "people" || view === "followups" || peopleMapReturn) && <PeopleWorkspace
            key={activeVolunteer.id}
            hidden={view === "map"}
            initialPanel={peopleMapReturn?.workspace.initialPanel ?? (view === "people" ? "directory" : "followups")}
            onPanelChange={changePeoplePanel}
            followUpProps={{
              data, canManage, activeVolunteerId: activeVolunteer.id,
              profileName: activeVolunteer.name, attention: deviceNeedsAttention, onProfile: () => navigate("more"),
              focusedTaskId: peopleMapReturn?.workspace.focusedTaskId ?? (view === "followups" ? route.id : undefined),
              initialPersonId: peopleMapReturn?.workspace.initialPersonId ?? (view === "followups" ? (pathname.startsWith("/app") ? searchParams.get("person") : followUpPersonId) : undefined),
              initialScope: peopleMapReturn?.workspace.initialScope ?? (pathname.startsWith("/app") ? followUpScope(searchParams.get("scope")) : demoTaskScope),
              onOpenTask: (id) => navigate("followups", id),
              onClearPersonFocus: () => { setFollowUpPersonId(null); navigate("followups"); },
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
              initialSelectedResidentId: peopleMapReturn?.workspace.selectedResidentId ?? (view === "people" ? (route.id ?? selectedPersonId) : undefined),
              onSelectResident: (id) => navigate("people", id),
              onOpenProperty: openPropertyFromPeople,
              onUpsertResident: actions.upsertResident,
              onAddPersonNote: actions.addPersonNote, onDeletePersonNote: actions.deletePersonNote,
              onAddPersonFollowUp: actions.addPersonFollowUp, onHandoff: actions.handoffPerson,
              onOpenFollowUp: (id) => navigate("followups", id),
            }}
          />}
          {view === "leader" && canManage && <TeamView data={data} membership={workspaceMembership} activeVolunteerId={activeVolunteer.id} onBack={() => navigate("more")} onAddTeam={actions.addTeam} onUpdateTeam={actions.updateTeam} onDeleteTeam={actions.deleteTeam} onOpenOutreach={() => navigate("outreach")} onOpenToday={() => navigate("today")} onOpenSettings={() => navigate("settings")} onAuthenticate={actions.reauthenticateAdmin} onAccessChanged={actions.syncNow} />}
          {view === "settings" && <SettingsView data={data} online={online} storageError={storageError} canManage={canManage} accountEmail={supabaseUser?.email} onBack={() => navigate("more")} onOpenDataHealth={() => navigate("data")} onSignOut={onSignOut ? async () => {
            if (saving || guideChanging) throw new Error("Wait for saving to finish, then sign out.");
            const pendingAdministration = await actions.getAdministrationPending();
            const pendingGuide = await actions.getGuidePending();
            if ((pendingChanges || data.sync.legacyRecoveryRequired || pendingAdministration || pendingGuide) && !await confirm({ title: "Sign out with unsent work?", message: "Some changes haven’t reached the church yet. They stay on this phone and will send when you sign back in with this account.", confirmLabel: "Sign out", destructive: true })) return;
            await onSignOut();
          } : undefined} onUpdatePassword={onUpdatePassword} onUpdateChurch={actions.updateChurch} onSetPreference={actions.setPreference} onExport={actions.downloadBackup} onImport={actions.importBackup} onClearOutreach={actions.clearOutreachData} />}
        </section>
      </div>

      <nav className="mobile-nav" aria-label="Main navigation">
        <MobileNav active={view === "today"} icon={<Sun size={20} />} label="Today" onClick={() => navigate("today")} />
        <MobileNav active={view === "outreach" || view === "map" || Boolean(fieldOuting)} icon={<MapPin size={20} />} label="Walks" count={walkAttentionCount} onClick={() => navigate("outreach")} />
        <MobileNav active={view === "followups"} icon={<CircleCheck size={20} />} label="Follow-ups" count={followUpAttentionCount} onClick={() => { setFollowUpPersonId(null); navigate("followups"); }} />
        <MobileNav active={view === "people"} icon={<Users size={20} />} label="People" count={peopleAttentionCount} onClick={() => { setFollowUpPersonId(null); navigate("people"); }} />
      </nav>
      {/* The yellow + always opens the logger; during a live walk it starts there (PL1). */}
      <button type="button" className="tab-log-button" aria-label="Log a conversation" onClick={() => setLogOpen(true)}><Plus size={26} aria-hidden="true" /></button>

      {addPersonHome && <PersonFormSheet data={data} initialPropertyId={addPersonHome} activeVolunteerId={activeVolunteer.id} onSave={actions.upsertResident} onSaved={() => { setAddPersonHome(null); showToast("Person added"); }} onClose={() => setAddPersonHome(null)} />}
      {logOpen && <ConversationLogger data={data} outingId={liveOuting?.id} routeName={liveRouteName} onSave={async (input) => { await actions.recordVisit(input); showToast("Conversation saved"); }} onCreatePerson={(input) => actions.upsertResident(undefined, input)} onUpdatePerson={(id, input) => actions.upsertResident(data.residents.find((person) => person.id === id)?.propertyId, input, id)} onClose={() => setLogOpen(false)} />}
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
        <p>SendMe is private to each church. Open the invite link from your leader, then sign in.</p>
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

function NavButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  const accessibilityLabel = count ? `${label}, ${count} item${count === 1 ? "" : "s"} need attention` : label;
  return <button className={active ? "active" : ""} onClick={onClick} aria-current={active ? "page" : undefined} aria-label={accessibilityLabel}>{icon}<span>{label}</span>{count ? <b aria-hidden="true">{count}</b> : null}</button>;
}

function MobileNav({ active, icon, label, count, attention = false, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; attention?: boolean; onClick: () => void }) {
  const accessibilityLabel = count ? `${label}, ${count} item${count === 1 ? "" : "s"} need attention` : attention ? `${label}, needs attention` : label;
  return <button className={active ? "active" : ""} onClick={onClick} aria-current={active ? "page" : undefined} aria-label={accessibilityLabel}><span>{icon}{count ? <b aria-hidden="true">{count}</b> : attention ? <b className="dot" aria-hidden="true" /> : null}</span><small>{label}</small></button>;
}

function AppLoading() {
  return <main className="app-loading"><div className="loading-mark"><Navigation size={23} /></div><h1>Getting things ready</h1><span role="status" aria-live="polite">Loading your church…</span></main>;
}

function AppFailure({ error, onSignOut, onRecovery }: { error: string; onSignOut?: () => Promise<void>; onRecovery?: () => Promise<void> }) {
  const action = useAsyncAction();
  const confirm = useConfirm();
  let hasInvitation = false;
  try { hasInvitation = typeof window !== "undefined" && Boolean(pendingInvitation(window.sessionStorage)); } catch { /* Leave a blocked browser's state intact. */ }
  return <main className="app-loading error"><div className="loading-mark"><X size={23} /></div><h1>We couldn’t open your church</h1><p>{error}</p><p>Nothing on this phone was deleted. Reconnect, or ask your leader to check your access.</p><button className="button primary" onClick={() => location.reload()}>Try again</button>{hasInvitation && <button className="button quiet" disabled={action.busy} onClick={() => { void confirm({ title: "Use your existing church instead?", message: "This skips the invitation on this phone. The invitation itself still works.", confirmLabel: "Skip invitation" }).then((confirmed) => { if (confirmed) void action.run(async () => { clearPendingInvitation(); window.location.reload(); }); }); }}>Skip this invitation</button>}{onRecovery && <button className="button quiet" disabled={action.busy} onClick={() => void action.run(onRecovery)}>Download my unsent work</button>}{onSignOut && <button className="button quiet" disabled={action.busy} onClick={() => { void confirm({ title: "Sign out?", message: "Unsent work stays on this phone and sends when you sign back in with this account.", confirmLabel: "Sign out", destructive: true }).then((confirmed) => { if (confirmed) void action.run(onSignOut); }); }}>Sign out or use a different account</button>}{isMobileApp && onSignOut && <AccountDeletion />}<Link href="/help">Sign-in help</Link>{action.error && <p role="alert">{action.error}</p>}</main>;
}
