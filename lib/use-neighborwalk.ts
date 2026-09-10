"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createId,
  deleteTeamRecord,
  deleteTerritoryRecord,
  enforceRetention,
  updateTerritoryRecord,
  type AuditEntry,
  type ConversationGuide,
  type ConversationGuideInput,
  type Coordinates,
  type FollowUpCompletionInput,
  type NeighborWalkData,
  type OutreachEvent,
  type ParcelReference,
  type PersonNoteKind,
  type Property,
  type ResidentInput,
  type TeamUpdate,
  type Territory,
  type TerritoryUpdate,
} from "./domain";
import {
  connectedGuideState,
  guideLibraryAccessDenied,
  loadConnectedGuideLibrary,
  guideLibraryErrorMessage,
  normalizeGuideSteps,
  readLocalGuideLibrary,
  validGuideInput,
  writeLocalGuideLibrary,
  type GuideLibraryState,
} from "./conversation-guides";
import {
  exportNeighborWalkData,
  archiveWorkspaceRecovery,
  recoveryArchives,
  exportRecoveryArchive,
  pendingAdministration,
  finishAdministration,
  pendingGuideChange,
  finishGuideChange,
  type PendingGuideChange,
  authoredDeviceRecovery,
  importNeighborWalkFile,
  loadNeighborWalkData,
  loadScopedNeighborWalkData,
  saveNeighborWalkData,
  type StorageScope,
} from "./storage";
import { createSeedData } from "./seed";
import { getSupabaseBrowserClient } from "./supabase";
import { apiError, loadOutreachWorkspace, matchesWorkspaceIdentity, OutreachApiError, submitOutreachCommand } from "./outreach-client";
import { commandPending, DurableWorkspaceStore, reconcileOutreachWorkspace, stageWorkspaceChange } from "./outreach-queue";
import { versionKey, type CommandOperation } from "./command-schema";
import { prepareReviewedCommand } from "./outreach-recovery";
import { downloadBlob } from "./download";
import { offlineMembershipValid } from "./offline-access";
import { WORKSPACE_CACHE_KEY } from "./offline-identity";
import { acquireWorkspaceTab } from "./workspace-tab";
import { observeOfflineShell, type OfflineShellState } from "./offline-shell";
import { pendingInvitation, clearPendingInvitation } from "./invitations";
import { authoredRecovery } from "./device-recovery";
import { recordEncounter, type EncounterInput } from "./encounters";
import { requireCalendarDate } from "./calendar";
import { addContactRestriction, liftContactRestriction, type RestrictionInput } from "./contact-restrictions";
import { previewDuplicates, previewRetention, submitAdministration, type AdminInput, type DuplicateKind } from "./administration";
import { applyGuideReceipt, guideSaveInput, savedGuideFromReceipt, submitGuideChange, type GuideChangeInput } from "./guide-changes";
import { exportCsv, type ImportKind } from "./csv-exchange";
import { assignFollowUp as assignTask, changeFollowUp, createFollowUp, respondToFollowUp } from "./follow-ups";
import { isProductionApp, storageKey } from "./environment";
import {
  volunteerIdForUser,
  withAuthenticatedVolunteer,
} from "./discipleship";

export type SupabaseUser = { id: string; email: string; name?: string; offlineStart?: true };
export type WorkspaceMembership = {
  churchId: string;
  userId: string;
  role: "leader" | "volunteer";
  email: string;
  displayName: string;
};
type WorkspaceStatus = "device_only" | "connecting" | "invitation_required" | "ready" | "locked";
type WorkspaceConnection = WorkspaceMembership & { revision: number; verifiedAt?: string };

const AUTO_SYNC_DELAY_MS = 1200;
const AUTO_SYNC_MAX_RETRY_MS = 30000;

function readWorkspaceConnection(userId: string): WorkspaceConnection | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WORKSPACE_CACHE_KEY) ?? "null") as WorkspaceConnection | null;
    return parsed?.userId === userId
      && parsed.churchId
      && (parsed.role === "leader" || parsed.role === "volunteer")
      && Number.isInteger(parsed.revision)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeWorkspaceConnection(connection: WorkspaceConnection) {
  window.localStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify(connection));
}

function invitationToken() {
  if (typeof window === "undefined") return null;
  return pendingInvitation(window.sessionStorage);
}

function clearInvitationToken() {
  clearPendingInvitation();
}

type NewPropertyInput = {
  address: string;
  territoryId?: string | null;
  unit?: string;
  coordinates?: Coordinates;
  buildingGeometry?: Coordinates[];
  parcel?: ParcelReference;
};

type NewTerritoryInput = {
  name: string;
  boundary: Coordinates[];
  center?: Coordinates;
  kind?: "map" | "list";
  color: string;
  assignedTeamId?: string;
};

function deviceId() {
  const key = storageKey("neighborwalk-device-id");
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = createId("device");
  window.localStorage.setItem(key, created);
  return created;
}

function mutation(
  entityType: AuditEntry["entityType"],
  entityId: string,
  operation: "upsert" | "delete" = "upsert",
) {
  const changedAt = new Date().toISOString();
  return { id: createId("mutation"), entityType, entityId, operation, changedAt };
}

export function useNeighborWalk(supabaseUser?: SupabaseUser | null) {
  const [data, setData] = useState<NeighborWalkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [autoRetryTick, setAutoRetryTick] = useState(0);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>(supabaseUser ? "connecting" : "device_only");
  const [workspaceMembership, setWorkspaceMembership] = useState<WorkspaceMembership | null>(null);
  const [guideLibrary, setGuideLibrary] = useState<GuideLibraryState>({ guides: [], teamGuideDefaults: {} });
  const [guideLibraryError, setGuideLibraryError] = useState<string | null>(null);
  const guideLibraryRef = useRef<GuideLibraryState>({ guides: [], teamGuideDefaults: {} });
  const [guidePending, setGuidePending] = useState<PendingGuideChange | null>(null);
  const [guideChanging, setGuideChanging] = useState(false);
  const guideChangeInFlightRef = useRef(false);
  const storeRef = useRef<DurableWorkspaceStore | null>(null);
  const pendingWritesRef = useRef(0);
  const workspaceRef = useRef<WorkspaceConnection | null>(null);
  const dataRef = useRef<NeighborWalkData | null>(null);
  const onlineRef = useRef(true);
  const syncInFlightRef = useRef<Promise<boolean> | null>(null);
  const recoveryInFlightRef = useRef(false);
  const [offlineShell, setOfflineShell] = useState<OfflineShellState>(process.env.NODE_ENV === "production" ? "preparing" : "development");
  const [preparationAttempt, setPreparationAttempt] = useState(0);
  const autoRetryAttemptRef = useRef(0);
  const actorIdRef = useRef<string | null>(supabaseUser ? volunteerIdForUser(supabaseUser.id) : null);
  const roleRef = useRef<WorkspaceMembership["role"] | null>(null);
  const storageScopeRef = useRef<StorageScope | undefined>(undefined);
  const publishGuideLibrary = useCallback((next: GuideLibraryState, churchId: string, userId?: string, persist = false) => {
    const current = guideLibraryRef.current;
    if (current.revision !== undefined && (next.revision === undefined || next.revision < current.revision)) return;
    if (persist && !userId) writeLocalGuideLibrary(next, churchId);
    guideLibraryRef.current = next;
    setGuideLibrary(next);
    setGuideLibraryError(null);
    if (persist && userId) {
      try { writeLocalGuideLibrary(next, churchId, userId); }
      catch { setGuideLibraryError("The shared guide library was read, but this device could not save its refreshed copy. Keep connected and refresh guides before fieldwork."); }
    }
  }, []);

  const withGuideAuthorization = useCallback(async <T,>(scope: StorageScope, operation: () => Promise<T>): Promise<T> => {
    try { return await operation(); }
    catch (error) {
      const connection = workspaceRef.current;
      if (guideLibraryAccessDenied(error) && connection?.churchId === scope.churchId && connection.userId === scope.userId) {
        // A denied guide operation is a known authorization failure, not a stale
        // content warning. Keep authored work, but revoke the offline window.
        writeWorkspaceConnection({ ...connection, verifiedAt: "" });
        workspaceRef.current = null; storeRef.current = null; dataRef.current = null;
        setData(null); setWorkspaceStatus("locked");
        setStorageError("This account no longer has authorized guide access. Unsent work is preserved. Sign in again or ask your church leader for help.");
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    let active = true;
    let releaseTab: (() => void) | undefined;
    let installedStore: DurableWorkspaceStore | null = null;
    const publish = (next: NeighborWalkData) => {
      if (!active) return;
      dataRef.current = next;
      setData(next);
    };
    const install = async (next: NeighborWalkData, scope?: StorageScope) => {
      await saveNeighborWalkData(next, scope);
      if (!active) return;
      storageScopeRef.current = scope;
      storeRef.current = new DurableWorkspaceStore(next, (value) => saveNeighborWalkData(value, scope), publish);
      installedStore = storeRef.current;
      publish(next);
    };
    const load = async () => {
      let cached: NeighborWalkData | null = null;
      const cachedConnection = supabaseUser ? readWorkspaceConnection(supabaseUser.id) : null;
      try {
        if (!supabaseUser) {
          const demo = await loadNeighborWalkData();
          await install({ ...demo, sync: { ...demo.sync, mode: "device_only" } });
          publishGuideLibrary(readLocalGuideLibrary(demo.church.id, demo.guide), demo.church.id);
          setWorkspaceStatus("device_only");
          return;
        }
        const client = getSupabaseBrowserClient();
        if (!client) throw new Error("The church service is not configured.");
        if (cachedConnection) cached = await loadScopedNeighborWalkData({ userId: supabaseUser.id, churchId: cachedConnection.churchId });
        if (supabaseUser.offlineStart) throw new OutreachApiError("Opening the explicitly selected prepared offline workspace.");
        setWorkspaceStatus("connecting");
        const getMemberships = () => client.from("church_memberships")
          .select("church_id, user_id, role, member_email, display_name").eq("user_id", supabaseUser.id).eq("active", true).order("joined_at");
        let membershipResult = await getMemberships();
        if (membershipResult.error) throw apiError(membershipResult.error);
        const token = invitationToken();
        if (token) {
          const { error } = await client.rpc("accept_church_invitation", { invitation_token: token });
          if (error) throw apiError(error);
          clearInvitationToken();
          membershipResult = await getMemberships();
          if (membershipResult.error) throw apiError(membershipResult.error);
        }
        if (!active) return;
        const membership = membershipResult.data?.find((m) => m.church_id === cachedConnection?.churchId) ?? membershipResult.data?.[0];
        if (!membership) {
          if (cachedConnection) writeWorkspaceConnection({ ...cachedConnection, verifiedAt: "" });
          workspaceRef.current = null;
          setWorkspaceMembership(null);
          roleRef.current = null;
          const empty = { ...createSeedData(), events: [], teams: [], territories: [], properties: [], visits: [], residents: [], personNotes: [], followUps: [], guide: [], audit: [] };
          publish({ ...empty, sync: { mode: "connected", pending: [] } });
          setWorkspaceStatus("invitation_required");
          return;
        }
        if (membership.role !== "leader" && membership.role !== "volunteer") throw new Error("Unsupported membership role.");
        const scope = { userId: supabaseUser.id, churchId: membership.church_id };
        cached = await loadScopedNeighborWalkData(scope);
        const { data: remote, info } = await loadOutreachWorkspace(client, membership.church_id, supabaseUser.id, cached?.preferences);
        if (!active) return;
        const connection: WorkspaceConnection = {
          churchId: membership.church_id, userId: supabaseUser.id, role: info.role,
          email: membership.member_email ?? supabaseUser.email,
          displayName: membership.display_name ?? supabaseUser.name ?? "Church member",
          revision: info.revision, verifiedAt: new Date().toISOString(),
        };
        workspaceRef.current = connection;
        roleRef.current = connection.role;
        actorIdRef.current = volunteerIdForUser(supabaseUser.id);
        setWorkspaceMembership(connection);
        writeWorkspaceConnection(connection);
        await install(cached ? reconcileOutreachWorkspace(remote, cached) : remote, scope);
        setGuidePending(await pendingGuideChange(scope));
        try {
          const guides = await withGuideAuthorization(scope, () => loadConnectedGuideLibrary(client, scope.churchId, scope.userId));
          if (!active) return;
          publishGuideLibrary(guides, scope.churchId, scope.userId, true);
        } catch (error) {
          if (guideLibraryAccessDenied(error)) return;
          publishGuideLibrary(readLocalGuideLibrary(scope.churchId, [], scope.userId), scope.churchId, scope.userId);
          setGuideLibraryError(guideLibraryErrorMessage(error));
        }
        setWorkspaceStatus("ready");
      } catch (error) {
        if (!active) return;
        if (cachedConnection && error instanceof OutreachApiError && /^(42501|PGRST3)/.test(error.code ?? "")) {
          writeWorkspaceConnection({ ...cachedConnection, verifiedAt: "" });
        }
        const allowedOffline = cached && offlineMembershipValid(cachedConnection?.verifiedAt)
          && error instanceof OutreachApiError && !error.code;
        if (allowedOffline && supabaseUser && cachedConnection && cached) {
          workspaceRef.current = cachedConnection;
          roleRef.current = cachedConnection.role;
          setWorkspaceMembership(cachedConnection);
          const scoped = withAuthenticatedVolunteer(cached, cachedConnection);
          await install({ ...scoped, sync: { ...scoped.sync, lastError: "Offline workspace. Membership must be checked online within 24 hours." } },
            { userId: supabaseUser.id, churchId: cachedConnection.churchId });
          publishGuideLibrary(readLocalGuideLibrary(cached.church.id, [], supabaseUser.id), cached.church.id, supabaseUser.id);
          setGuidePending(await pendingGuideChange({ churchId: cached.church.id, userId: supabaseUser.id }));
          setWorkspaceStatus("ready");
        } else {
          workspaceRef.current = null;
          storeRef.current = null;
          setWorkspaceStatus("locked");
          setStorageError(error instanceof Error ? error.message : "The church workspace could not be opened.");
        }
      } finally { if (active) setLoading(false); }
    };
    const boot = (async () => {
      // Let React's discarded Strict Mode setup clean up before taking a lock.
      await Promise.resolve();
      if (!active) return;
      if (supabaseUser) {
        releaseTab = await acquireWorkspaceTab(navigator.locks, storageKey("neighborwalk-workspace-writer") + ":" + supabaseUser.id);
        if (!active) return;
      }
      await load();
    })().catch((error) => {
      if (active) { setWorkspaceStatus("locked"); setStorageError(error instanceof Error ? error.message : "Device coordination failed. Saved records have not been cleared."); setLoading(false); }
    });
    return () => {
      active = false;
      if (storeRef.current === installedStore) storeRef.current = null;
      const inFlightSync = syncInFlightRef.current;
      // Finish writes already acknowledged to the user before another tab can
      // install its snapshot. New callbacks can no longer obtain this store.
      void boot.then(async () => {
        await Promise.allSettled([installedStore?.settled(), inFlightSync]);
        await installedStore?.settled();
        releaseTab?.();
      });
    };
  }, [publishGuideLibrary, supabaseUser, withGuideAuthorization]);

  useEffect(() => {
    const update = () => {
      const nextOnline = navigator.onLine;
      onlineRef.current = nextOnline;
      setOnline(nextOnline);
      if (nextOnline) setAutoRetryTick((current) => current + 1);
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) { queueMicrotask(() => setOfflineShell("unavailable")); return; }
    if (process.env.NODE_ENV === "production") {
      return observeOfflineShell(isProductionApp ? "/sw.js" : "/sw.js?sandbox", setOfflineShell);
    } else {
      // A previous local production build must not revive an old connected app offline.
      void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(
        registrations.filter((registration) => new URL(registration.active?.scriptURL ?? registration.scope).pathname === "/sw.js")
          .map((registration) => registration.unregister()),
      )).catch(() => undefined);
    }
  }, [preparationAttempt]);

  const updateData = useCallback(async (updater: (current: NeighborWalkData) => NeighborWalkData, extraOperations?: (current: NeighborWalkData) => CommandOperation[], reasons?: Record<string, string>) => {
    if (recoveryInFlightRef.current) throw new Error("Wait for the reviewed operation to finish before saving another change.");
    const store = storeRef.current;
    if (!store) throw new Error("Open an authorized church workspace before saving.");
    pendingWritesRef.current += 1;
    setSaving(true);
    try {
      const next = await store.update((current) => {
        const changed = updater(current);
        if (changed === current && !extraOperations) return current;
        const updated = { ...changed, updatedAt: new Date().toISOString() };
        const scope = storageScopeRef.current;
        return scope ? stageWorkspaceChange(current, updated, scope, extraOperations?.(current), reasons) : updated;
      });
      setStorageError(null);
      return next;
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "This change was not saved. Keep the form open and try again.");
      throw error;
    } finally {
      pendingWritesRef.current -= 1;
      setSaving(pendingWritesRef.current > 0);
    }
  }, []);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (pendingWritesRef.current > 0) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  const addAudit = (
    current: NeighborWalkData,
    entityType: AuditEntry["entityType"],
    entityId: string,
    action: string,
    summary: string,
    operation: "upsert" | "delete" = "upsert",
  ) => ({
    ...current,
    audit: [{
      id: createId("audit"),
      action,
      entityType,
      entityId,
      actorId: actorIdRef.current ?? current.preferences.activeVolunteerId,
      createdAt: new Date().toISOString(),
      summary,
    }, ...current.audit].slice(0, 1000),
    sync: {
      ...current.sync,
      pending: [...current.sync.pending, mutation(entityType, entityId, operation)],
    },
  });

  const setPreference = useCallback(<K extends keyof NeighborWalkData["preferences"]>(
    key: K,
    value: NeighborWalkData["preferences"][K],
  ) => {
    return updateData((current) => ({
      ...current,
      preferences: { ...current.preferences, [key]: value },
    }));
  }, [updateData]);

  const selectTerritory = useCallback((territoryId: string) => {
    return updateData((current) => ({
      ...current,
      preferences: { ...current.preferences, activeTerritoryId: territoryId },
    }));
  }, [updateData]);

  const addProperty = useCallback(async (input: NewPropertyInput) => {
    const propertyId = createId("property");
    await updateData((current) => {
      const now = new Date().toISOString();
      if (!input.address.trim()) throw new Error("Enter a useful address or location description.");
      const property: Property = {
        id: propertyId,
        churchId: current.church.id,
        territoryId: input.territoryId === null ? undefined : input.territoryId ?? (current.territories.some((t) => t.id === current.preferences.activeTerritoryId) ? current.preferences.activeTerritoryId : undefined),
        address: input.address.trim(),
        unit: input.unit?.trim() || undefined,
        coordinates: input.coordinates,
        buildingGeometry: input.buildingGeometry,
        parcel: input.parcel,
        currentOutcome: "unvisited",
        visitCount: 0,
        createdAt: now,
        updatedAt: now,
        source: input.coordinates ? "map" : "manual",
      };
      return addAudit(
        { ...current, properties: [...current.properties, property] },
        "property",
        propertyId,
        "property.created",
        `${property.address} added to the territory`,
      );
    });
    return propertyId;
  }, [updateData]);

  const associatePropertiesWithParcel = useCallback((propertyIds: string[], parcel: ParcelReference) => {
    const targetIds = new Set(propertyIds);
    if (!targetIds.size) return;
    return updateData((current) => {
      const changed = current.properties.filter((property) => (
        targetIds.has(property.id)
        && (property.parcel?.countyFips !== parcel.countyFips || property.parcel.gislink !== parcel.gislink)
      ));
      if (!changed.length) return current;
      const now = new Date().toISOString();
      const next = {
        ...current,
        properties: current.properties.map((property) => targetIds.has(property.id)
          ? { ...property, parcel, updatedAt: now }
          : property),
      };
      return changed.reduce((result, property) => addAudit(
        result,
        "property",
        property.id,
        "property.parcel_linked",
        `${property.address} linked to its official parcel`,
      ), next);
    });
  }, [updateData]);

  const updateProperty = useCallback((propertyId: string, patch: Pick<Property, "address" | "unit">) => {
    return updateData((current) => addAudit({
      ...current,
      properties: current.properties.map((property) => property.id === propertyId
        ? { ...property, address: patch.address.trim(), unit: patch.unit?.trim() || undefined, updatedAt: new Date().toISOString() }
        : property),
    }, "property", propertyId, "property.updated", "Location details updated"));
  }, [updateData]);

  const deleteProperty = useCallback((propertyId: string) => {
    return updateData((current) => {
      const property = current.properties.find((item) => item.id === propertyId);
      const hasPeople = current.residents.some((resident) => resident.propertyId === propertyId);
      if (!property) throw new Error("This location is no longer available.");
      if (property.visitCount > 0 || property.currentOutcome === "do_not_visit" || hasPeople) throw new Error("This location has history or restrictions and must be preserved.");
      return addAudit({
        ...current,
        properties: current.properties.filter((item) => item.id !== propertyId),
      }, "property", propertyId, "property.deleted", `${property.address} removed`, "delete");
    });
  }, [updateData]);

  const recordVisit = useCallback((input: EncounterInput) => {
    return updateData((current) => {
      const changed = recordEncounter(current, input, actorIdRef.current ?? current.preferences.activeVolunteerId, deviceId());
      return addAudit(changed, "visit", changed.visits[0].id, "visit.recorded", "Outreach encounter recorded");
    });
  }, [updateData]);

  const completeFollowUp = useCallback((followUpId: string, input: FollowUpCompletionInput = {}) => {
    return updateData((current) => {
      const existing = current.followUps.find((followUp) => followUp.id === followUpId && followUp.status === "scheduled");
      if (!existing) throw new Error("This task is no longer open. Refresh before continuing.");
      const completionNote = input.completionNote?.trim() || undefined;
      if (completionNote && completionNote.length > current.church.noteCharacterLimit) throw new Error("Shorten the completion note to the church’s character limit.");
      if (input.nextFollowUp) {
        requireCalendarDate(input.nextFollowUp.dueAt);
        if ((input.nextFollowUp.note?.trim().length ?? 0) > current.church.noteCharacterLimit) throw new Error("Shorten the next-step note to the church’s character limit.");
      }
      const now = new Date().toISOString();
      const actorId = actorIdRef.current ?? current.preferences.activeVolunteerId;
      const nextFollowUps = current.followUps.map((followUp) => followUp.id === followUpId
        ? changeFollowUp(followUp, { action: "completed", note: completionNote }, actorId, now)
        : followUp);
      const followUpEntity = existing.residentId ? "person_follow_up" as const : "follow_up" as const;
      let result = addAudit({
        ...current,
        followUps: nextFollowUps,
      }, followUpEntity, followUpId, "follow_up.completed", "Follow-up marked complete");
      if (existing.residentId && completionNote) {
        const person = current.residents.find((resident) => resident.id === existing.residentId);
        const personNoteId = createId("person_note");
        result = addAudit({
          ...result,
          personNotes: [{
            id: personNoteId,
            churchId: current.church.id,
            residentId: existing.residentId,
            authorId: actorIdRef.current ?? current.preferences.activeVolunteerId,
            kind: "general",
            body: completionNote,
            createdAt: now,
          }, ...result.personNotes],
        }, "person_note", personNoteId, "person_note.created", `Follow-up note added for ${person?.name || "a person"}`);
      }
      if (!input.nextFollowUp) return result;
      const nextId = createId("followup");
      const note = input.nextFollowUp.note?.trim() || undefined;
      const nextTask = createFollowUp({
        id: nextId,
        churchId: current.church.id,
        propertyId: existing.propertyId,
        residentId: existing.residentId,
        sourceVisitId: existing.sourceVisitId,
        eventId: existing.eventId,
        assignedTeamId: input.nextFollowUp.assignedTeamId,
        assignedVolunteerId: existing.assignedVolunteerId,
        channel: existing.channel,
        dueAt: input.nextFollowUp.dueAt,
        note,
        parentFollowUpId: existing.id,
      }, actorId, now);
      result = addAudit({ ...result, followUps: [...result.followUps, nextTask] }, followUpEntity, nextId, "follow_up.created", "Additional follow-up scheduled");
      return result;
    });
  }, [updateData]);

  const rescheduleFollowUp = useCallback((followUpId: string, date: string, note?: string) => {
    return updateData((current) => {
      requireCalendarDate(date);
      const existing = current.followUps.find((followUp) => followUp.id === followUpId && followUp.status === "scheduled");
      if (!existing) throw new Error("This task is no longer open. Refresh before continuing.");
      const activityNote = note?.trim() || undefined;
      if ((activityNote?.length ?? 0) > current.church.noteCharacterLimit) throw new Error("Shorten the rescheduling note.");
      const now = new Date().toISOString();
      return addAudit({
        ...current,
        followUps: current.followUps.map((followUp) => followUp.id === followUpId
          ? changeFollowUp(followUp, { action: "rescheduled", dueAt: date, note: activityNote }, actorIdRef.current ?? current.preferences.activeVolunteerId, now)
          : followUp),
      }, existing.residentId ? "person_follow_up" : "follow_up", followUpId, "follow_up.rescheduled", "Follow-up date changed");
    });
  }, [updateData]);

  const cancelFollowUp = useCallback((followUpId: string, note?: string) => {
    return updateData((current) => {
      const existing = current.followUps.find((followUp) => followUp.id === followUpId && followUp.status === "scheduled");
      if (!existing) throw new Error("This task is no longer open. Refresh before continuing.");
      if (!note?.trim()) throw new Error("Record a reason for cancelling this next step.");
      if (note.trim().length > current.church.noteCharacterLimit) throw new Error("Shorten the cancellation reason.");
      const now = new Date().toISOString();
      return addAudit({
        ...current,
        followUps: current.followUps.map((followUp) => followUp.id === followUpId
          ? changeFollowUp(followUp, { action: "cancelled", note: note?.trim() || undefined }, actorIdRef.current ?? current.preferences.activeVolunteerId, now)
          : followUp),
      }, existing.residentId ? "person_follow_up" : "follow_up", followUpId, "follow_up.cancelled", "Follow-up cancelled");
    });
  }, [updateData]);

  const addPersonFollowUp = useCallback(async (residentId: string, note: string, date: string) => {
    const followUpId = createId("followup");
    await updateData((current) => {
      const resident = current.residents.find((item) => item.id === residentId);
      const trimmedNote = note.trim();
      requireCalendarDate(date);
      if (!resident) throw new Error("This person is no longer available to your account.");
      if (!trimmedNote || trimmedNote.length > current.church.noteCharacterLimit) throw new Error("Describe the next step within the church’s character limit.");
      const now = new Date().toISOString();
      const followUp = createFollowUp({
        id: followUpId,
        churchId: current.church.id,
        propertyId: resident.propertyId,
        residentId,
        dueAt: date,
        assignedVolunteerId: resident.assignedVolunteerId,
        channel: resident.preferredContact === "none" ? "other" : resident.preferredContact,
        note: trimmedNote,
      }, actorIdRef.current ?? current.preferences.activeVolunteerId, now);
      return addAudit({
        ...current,
        followUps: [...current.followUps, followUp],
      }, "person_follow_up", followUpId, "follow_up.created", `Follow-up planned for ${resident.name || "a person"}`);
    });
    return followUpId;
  }, [updateData]);

  const upsertResident = useCallback(async (propertyId: string | undefined, input: ResidentInput, residentId?: string) => {
    const requestedId = residentId ?? createId("resident");
    await updateData((current) => {
      const property = current.properties.find((item) => item.id === propertyId);
      if (propertyId && !property) throw new Error("Choose an available location or leave the address blank.");
      const existing = residentId ? current.residents.find((resident) => resident.id === residentId) : undefined;
      if (residentId && !existing) throw new Error("This person is no longer available. Refresh before continuing.");
      if (existing && existing.propertyId !== propertyId && (input.changeReason?.trim().length ?? 0) < 3) throw new Error("Record a brief reason for this location change.");
      if (!existing && !input.name?.trim()) throw new Error("Add a name or useful identifying description. Use an anonymous encounter if no person record is needed.");
      const now = new Date().toISOString();
      const id = existing?.id ?? requestedId;
      const creatorId = existing?.createdByVolunteerId ?? actorIdRef.current ?? current.preferences.activeVolunteerId;
      const resident = {
        id,
        churchId: current.church.id,
        ...existing,
        propertyId,
        contactPermission: input.contactPermission ?? existing?.contactPermission ?? "not_recorded",
        name: input.name?.trim() || undefined,
        faithStatus: input.faithStatus,
        discipleshipStage: input.discipleshipStage,
        assignedVolunteerId: existing ? input.assignedVolunteerId : creatorId,
        createdByVolunteerId: creatorId,
        sharedWithVolunteerIds: input.sharedWithVolunteerIds ?? [],
        sharedWithTeamIds: input.sharedWithTeamIds ?? [],
        status: input.status,
        phone: input.phone?.trim() || undefined,
        email: input.email?.trim() || undefined,
        preferredContact: input.preferredContact,
        lastContactAt: input.lastContactAt,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      return addAudit({
        ...current,
        residents: existing
          ? current.residents.map((item) => item.id === id ? resident : item)
          : [...current.residents, resident],
      }, "resident", id, existing ? "resident.updated" : "resident.created", `Person record ${existing ? "updated" : "added"}${property ? ` at ${property.address}` : ""}`);
    }, undefined, input.changeReason?.trim() ? { [versionKey("resident", requestedId)]: input.changeReason.trim() } : undefined);
    return requestedId;
  }, [updateData]);

  const addPersonNote = useCallback(async (residentId: string, kind: PersonNoteKind, body: string, createdAt?: string) => {
    const noteId = createId("person_note");
    await updateData((current) => {
      const resident = current.residents.find((item) => item.id === residentId);
      const trimmedBody = body.trim();
      if (!resident) throw new Error("This person is no longer available to your account.");
      if (!trimmedBody || trimmedBody.length > current.church.noteCharacterLimit) throw new Error("Write a note within the church’s character limit.");
      const timestamp = createdAt && !Number.isNaN(new Date(createdAt).getTime())
        ? new Date(createdAt).toISOString()
        : new Date().toISOString();
      const authorId = actorIdRef.current ?? current.preferences.activeVolunteerId;
      return addAudit({
        ...current,
        personNotes: [{
          id: noteId,
          churchId: current.church.id,
          residentId,
          authorId,
          kind,
          body: trimmedBody,
          createdAt: timestamp,
        }, ...current.personNotes],
      }, "person_note", noteId, "person_note.created", `Note added for ${resident.name || "a person"}`);
    });
    return noteId;
  }, [updateData]);

  const deletePersonNote = useCallback((noteId: string) => {
    return updateData((current) => {
      const note = current.personNotes.find((item) => item.id === noteId);
      if (!note) throw new Error("This note is no longer available.");
      return addAudit({
        ...current,
        personNotes: current.personNotes.filter((item) => item.id !== noteId),
      }, "person_note", noteId, "person_note.deleted", "Person note deleted", "delete");
    });
  }, [updateData]);

  const deleteResident = useCallback((residentId: string) => {
    return updateData((current) => {
      if (!current.residents.some((resident) => resident.id === residentId)) throw new Error("This person is no longer available.");
      const noteIds = current.personNotes.filter((note) => note.residentId === residentId).map((note) => note.id);
      const followUpIds = current.followUps.filter((followUp) => followUp.residentId === residentId).map((followUp) => followUp.id);
      const deleted = addAudit({
        ...current,
        residents: current.residents.filter((resident) => resident.id !== residentId),
        personNotes: current.personNotes.filter((note) => note.residentId !== residentId),
        followUps: current.followUps.filter((followUp) => followUp.residentId !== residentId),
      }, "resident", residentId, "resident.deleted", "Person record deleted", "delete");
      return {
        ...deleted,
        sync: {
          ...deleted.sync,
          pending: [
            ...deleted.sync.pending,
            ...noteIds.map((noteId) => mutation("person_note", noteId, "delete")),
            ...followUpIds.map((followUpId) => mutation("person_follow_up", followUpId, "delete")),
          ],
        },
      };
    });
  }, [updateData]);

  const addRestriction = useCallback((input: RestrictionInput) => updateData((current) => addContactRestriction(current, input)), [updateData]);
  const liftRestriction = useCallback((id: string, reason: string) => {
    if (supabaseUser && roleRef.current !== "leader") return Promise.reject(new Error("Only a church leader may lift a restriction after review."));
    return updateData((current) => liftContactRestriction(current, id, reason));
  }, [supabaseUser, updateData]);

  const updateChurch = useCallback(async (patch: Partial<NeighborWalkData["church"]>) => {
    if (supabaseUser && roleRef.current !== "leader") throw new Error("Only a church leader can update church settings.");
    return updateData((current) => addAudit({
      ...current,
      church: { ...current.church, ...patch },
    }, "settings", current.church.id, "settings.updated", "Church settings updated"));
  }, [supabaseUser, updateData]);

  const assignFollowUp = useCallback((id: string, volunteerId: string) => updateData((current) => assignTask(current, id, volunteerId,
    actorIdRef.current ?? current.preferences.activeVolunteerId, new Date().toISOString())), [updateData]);

  const acceptFollowUp = useCallback((id: string, acceptance: "accepted" | "declined") => updateData((current) => respondToFollowUp(current, id, acceptance,
    actorIdRef.current ?? current.preferences.activeVolunteerId, new Date().toISOString())), [updateData]);

  const handoffPerson = useCallback((id: string, action: "request" | "accept" | "decline" | "cancel", assignedVolunteerId?: string) => {
    if (!storageScopeRef.current) return Promise.reject(new Error("Care handoffs require a connected church workspace."));
    return updateData((current) => current, (current) => [{ entityType: "handoff", entityId: id, operation: "upsert",
      expectedVersion: current.sync.recordVersions?.[versionKey("resident", id)] ?? 0, record: { action, assignedVolunteerId } }]);
  }, [updateData]);

  const saveOuting = useCallback(async (input: Omit<OutreachEvent, "id" | "churchId">, outingId?: string) => {
    if (supabaseUser && roleRef.current !== "leader") throw new Error("Only a church leader can prepare outings.");
    const id = outingId ?? createId("outing");
    if (!input.name.trim() || !Number.isFinite(Date.parse(input.startsAt)) || !Number.isFinite(Date.parse(input.endsAt)) || Date.parse(input.endsAt) <= Date.parse(input.startsAt)) throw new Error("Choose an outing name and an end time after its start.");
    if (["ready", "active"].includes(input.status) && (!input.purpose?.trim() || !input.meetingPoint?.trim() || !input.leaderContact?.trim())) throw new Error("Add a purpose, meeting point and leader contact before marking the outing ready.");
    await updateData((current) => addAudit({ ...current, events: [...current.events.filter((event) => event.id !== id),
      { ...input, id, churchId: current.church.id, name: input.name.trim() }],
      preferences: { ...current.preferences, activeEventId: id },
    }, "event", id, outingId ? "event.updated" : "event.created", "Outing preparation saved"));
    return id;
  }, [supabaseUser, updateData]);

  const saveAssignment = useCallback(async (input: Omit<NonNullable<NeighborWalkData["assignments"]>[number], "id" | "churchId">, assignmentId?: string) => {
    const id = assignmentId ?? createId("assignment");
    await updateData((current) => {
      if (!input.assignedTeamId && !input.assignedVolunteerId) throw new Error("Choose a group or responsible volunteer.");
      if (!assignmentId && current.assignments?.some((a) => a.eventId === input.eventId && a.territoryId === input.territoryId && !["declined", "cancelled"].includes(a.status))) {
        throw new Error("This list or territory already has an assignment for the outing. Review it before assigning again.");
      }
      return addAudit({ ...current, assignments: [...(current.assignments ?? []).filter((a) => a.id !== id), { ...input, id, churchId: current.church.id }] },
        "assignment", id, "assignment.updated", "Outing responsibility updated");
    });
    return id;
  }, [updateData]);

  const repeatOuting = useCallback(async (outingId: string, startsAt: string, endsAt: string) => {
    if (supabaseUser && roleRef.current !== "leader") throw new Error("Only a church leader can repeat an outing.");
    if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || endsAt <= startsAt) throw new Error("Choose an end time after the start.");
    const id = createId("outing");
    await updateData((current) => {
      const original = current.events.find((e) => e.id === outingId);
      if (!original) throw new Error("This outing is no longer available.");
      return addAudit({ ...current, events: [...current.events, { ...original, id, startsAt, endsAt, name: original.name,
        status: "draft", debrief: "" }], assignments: [...(current.assignments ?? []), ...(current.assignments ?? []).filter((a) => a.eventId === outingId && !["cancelled", "declined"].includes(a.status))
        .map((a) => ({ ...a, id: createId("assignment"), eventId: id, status: "assigned" as const }))],
        preferences: { ...current.preferences, activeEventId: id },
      }, "event", id, "event.repeated", "Outing repeated with reusable assignments; people and history were not copied");
    });
    return id;
  }, [supabaseUser, updateData]);

  const addTerritory = useCallback(async (input: NewTerritoryInput) => {
    const territoryId = createId("territory");
    if (supabaseUser && roleRef.current !== "leader") throw new Error("Only a church leader can create outreach lists or territories.");
    await updateData((current) => {
      const territory: Territory = {
        id: territoryId,
        churchId: current.church.id,
        kind: input.kind ?? "map",
        eventId: current.preferences.activeEventId,
        name: input.name.trim(),
        color: input.color,
        center: input.center,
        zoom: 15.5,
        boundary: input.boundary,
        assignedTeamId: input.assignedTeamId,
      };
      return addAudit({
        ...current,
        territories: [...current.territories, territory],
        teams: current.teams.map((team) => team.id === input.assignedTeamId
          ? { ...team, territoryIds: [...team.territoryIds.filter((id) => id !== territoryId), territoryId] }
          : team),
        preferences: { ...current.preferences, activeTerritoryId: territoryId },
      }, "territory", territoryId, "territory.created", `${territory.name} created`);
    });
    return territoryId;
  }, [supabaseUser, updateData]);

  const updateTerritory = useCallback(async (territoryId: string, update: TerritoryUpdate) => {
    if (supabaseUser && roleRef.current !== "leader") throw new Error("Only a church leader can edit an outreach area.");
    return updateData((current) => {
      const existing = current.territories.find((territory) => territory.id === territoryId);
      if (!existing) return current;
      const boundaryChanged = Boolean(update.boundary);
      return addAudit(
        updateTerritoryRecord(current, territoryId, update),
        "territory",
        territoryId,
        "territory.updated",
        boundaryChanged ? `${update.name.trim()} details and boundary updated` : `${update.name.trim()} details updated`,
      );
    });
  }, [supabaseUser, updateData]);

  const deleteTerritory = useCallback(async (territoryId: string, destinationTerritoryId: string) => {
    if (supabaseUser && roleRef.current !== "leader") throw new Error("Only a church leader can archive an outreach area.");
    return updateData((current) => {
      const territory = current.territories.find((item) => item.id === territoryId);
      const destination = current.territories.find((item) => item.id === destinationTerritoryId);
      if (!territory || !destination || territory.id === destination.id) throw new Error("Choose a different available destination for these locations.");
      const movedLocationCount = current.properties.filter((property) => property.territoryId === territoryId).length;
      const reassigned = deleteTerritoryRecord(current, territoryId, destinationTerritoryId);
      if (reassigned === current) return current;
      const audited = addAudit(reassigned, "territory", territoryId, "territory.deleted", `${territory.name} deleted; ${movedLocationCount} locations moved to ${destination.name}`, "delete");
      return {
        ...audited,
        sync: { ...audited.sync, pending: audited.sync.pending.map((item) => item.entityType === "territory" && item.entityId === territoryId && item.operation === "delete"
          ? { ...item, destinationTerritoryId } : item) },
      };
    });
  }, [supabaseUser, updateData]);

  const addTeam = useCallback(async (update: TeamUpdate) => {
    const teamId = createId("team");
    if (supabaseUser && roleRef.current !== "leader") throw new Error("Only a church leader can create groups.");
    await updateData((current) => addAudit({
      ...current,
      teams: [...current.teams, {
        id: teamId,
        churchId: current.church.id,
        eventId: current.preferences.activeEventId,
        name: update.name.trim(),
        memberIds: [...new Set(update.memberIds)],
        territoryIds: [],
        status: update.status,
      }],
    }, "team", teamId, "team.created", `${update.name.trim()} created`));
    return teamId;
  }, [supabaseUser, updateData]);

  const updateTeam = useCallback(async (teamId: string, update: TeamUpdate) => {
    if (supabaseUser && roleRef.current !== "leader") throw new Error("Only a church leader can edit groups.");
    return updateData((current) => addAudit({
      ...current,
      teams: current.teams.map((team) => team.id === teamId
        ? { ...team, name: update.name.trim(), memberIds: [...new Set(update.memberIds)], status: update.status }
        : team),
    }, "team", teamId, "team.updated", `${update.name.trim()} updated`));
  }, [supabaseUser, updateData]);

  const deleteTeam = useCallback(async (teamId: string) => {
    if (supabaseUser && roleRef.current !== "leader") throw new Error("Only a church leader can archive groups.");
    return updateData((current) => {
      const team = current.teams.find((item) => item.id === teamId);
      if (!team) return current;
      return addAudit(
        deleteTeamRecord(current, teamId),
        "team",
        teamId,
        "team.deleted",
        `${team.name} deleted; territory and follow-up assignments cleared`,
        "delete",
      );
    });
  }, [supabaseUser, updateData]);

  const requireGuideScope = useCallback(() => {
    const scope = storageScopeRef.current;
    if (!supabaseUser || !scope || scope.userId !== supabaseUser.id || !workspaceRef.current || !storeRef.current || !onlineRef.current) {
      throw new Error("Connect with this church account before changing guides. Prepared guides remain available offline.");
    }
    return scope;
  }, [supabaseUser]);

  const refreshGuideLibrary = useCallback(async () => {
    const scope = requireGuideScope();
    const fresh = await withGuideAuthorization(scope, () => loadConnectedGuideLibrary(getSupabaseBrowserClient()!, scope.churchId, scope.userId));
    publishGuideLibrary(fresh, scope.churchId, scope.userId, true);
  }, [publishGuideLibrary, requireGuideScope, withGuideAuthorization]);

  const performGuideChange = useCallback(async (input: GuideChangeInput | null) => {
    const scope = requireGuideScope();
    if (guideChangeInFlightRef.current) throw new Error("Another guide request is still being confirmed.");
    guideChangeInFlightRef.current = true;
    setGuideChanging(true);
    try {
      const outcome = await withGuideAuthorization(scope, () => submitGuideChange(scope, input, setGuidePending));
      publishGuideLibrary(applyGuideReceipt(guideLibraryRef.current, outcome.request, outcome.result), scope.churchId, scope.userId, true);
      try { await refreshGuideLibrary(); }
      catch (error) { setGuideLibraryError("Your guide change was confirmed. " + guideLibraryErrorMessage(error)); }
      return outcome;
    } finally {
      try { setGuidePending(await pendingGuideChange(scope)); }
      catch { setGuideLibraryError("The device guide journal could not be read. Keep this browser profile and ask for recovery help before making another guide change."); }
      guideChangeInFlightRef.current = false;
      setGuideChanging(false);
    }
  }, [publishGuideLibrary, refreshGuideLibrary, requireGuideScope, withGuideAuthorization]);

  const reviewGuidePending = useCallback(async () => {
    const scope = requireGuideScope();
    if (guideChangeInFlightRef.current) throw new Error("Wait for the current guide request to finish.");
    guideChangeInFlightRef.current = true; setGuideChanging(true);
    try {
      await withGuideAuthorization(scope, () => connectedGuideState(getSupabaseBrowserClient()!, scope.churchId, scope.userId));
      const pending = await pendingGuideChange(scope);
      if (pending) await finishGuideChange(scope, String(pending.request.id), { reviewedWithoutResubmitting: true,
        note: "Original request preserved for recovery. This does not undo any completed server change." });
      setGuidePending(null);
      try { await refreshGuideLibrary(); } catch (error) { setGuideLibraryError(guideLibraryErrorMessage(error)); }
    } finally { guideChangeInFlightRef.current = false; setGuideChanging(false); }
  }, [refreshGuideLibrary, requireGuideScope, withGuideAuthorization]);

  const saveConversationGuide = useCallback(async (input: ConversationGuideInput) => {
    if (!validGuideInput(input)) throw new Error("Finish each guide step before saving.");
    const library = guideLibraryRef.current;
    const existing = input.id ? library.guides.find((guide) => guide.id === input.id) : undefined;
    if (existing && existing.scope !== input.scope) throw new Error("A guide’s privacy level cannot be changed after it is created.");
    const sortOrder = existing?.sortOrder ?? Math.min(10000, Math.max(0, ...library.guides
      .filter((guide) => guide.scope === input.scope).map((guide) => guide.sortOrder)) + 10);
    if (supabaseUser) {
      const outcome = await performGuideChange(guideSaveInput(input, sortOrder));
      return savedGuideFromReceipt(outcome.request, outcome.result);
    }
    const now = new Date().toISOString();
    const saved: ConversationGuide = {
      id: existing?.id ?? createId("guide"), churchId: dataRef.current?.church.id ?? "device_church",
      scope: existing?.scope ?? input.scope,
      ownerUserId: (existing?.scope ?? input.scope) === "personal" ? actorIdRef.current ?? dataRef.current?.preferences.activeVolunteerId ?? "device_user" : undefined,
      title: input.title.trim(), description: input.description.trim(), steps: normalizeGuideSteps(input.steps),
      sortOrder, createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    publishGuideLibrary({ ...library, guides: [...library.guides.filter((guide) => guide.id !== saved.id), saved] }, saved.churchId, undefined, true);
    return saved;
  }, [performGuideChange, publishGuideLibrary, supabaseUser]);

  const deleteConversationGuide = useCallback(async (guideId: string, expectedVersion?: number) => {
    const library = guideLibraryRef.current;
    if (supabaseUser) {
      if (!expectedVersion) throw new Error("Refresh and reopen this guide before archiving it.");
      await performGuideChange({ action: "archive", guideId, expectedVersion, confirmation: "ARCHIVE GUIDE; KEEP HISTORY" });
      return;
    }
    const next = { ...library, guides: library.guides.filter((guide) => guide.id !== guideId),
      favoriteGuideId: library.favoriteGuideId === guideId ? undefined : library.favoriteGuideId,
      teamGuideDefaults: Object.fromEntries(Object.entries(library.teamGuideDefaults).filter(([, id]) => id !== guideId)) };
    publishGuideLibrary(next, dataRef.current?.church.id ?? "demo", undefined, true);
  }, [performGuideChange, publishGuideLibrary, supabaseUser]);

  const setTeamConversationGuide = useCallback(async (teamId: string, guideId?: string) => {
    const library = guideLibraryRef.current;
    if (!dataRef.current?.teams.some((team) => team.id === teamId)) throw new Error("Choose a group in this church workspace.");
    if (guideId && !library.guides.some((guide) => guide.id === guideId && guide.scope === "church")) throw new Error("Group defaults must use a church guide.");
    if (supabaseUser) {
      if (library.revision === undefined) throw new Error("Refresh the guide library before choosing a group guide.");
      await performGuideChange({ action: "group_default", teamId, guideId: guideId ?? null, expectedVersion: library.teamGuideVersions?.[teamId] ?? 0 });
      return;
    }
    const defaults = { ...library.teamGuideDefaults };
    if (guideId) defaults[teamId] = guideId; else delete defaults[teamId];
    publishGuideLibrary({ ...library, teamGuideDefaults: defaults }, dataRef.current?.church.id ?? "demo", undefined, true);
  }, [performGuideChange, publishGuideLibrary, supabaseUser]);

  const setFavoriteConversationGuide = useCallback(async (guideId?: string) => {
    const library = guideLibraryRef.current;
    if (guideId && !library.guides.some((guide) => guide.id === guideId)) throw new Error("Choose a guide you can access.");
    if (supabaseUser) {
      if (library.favoriteVersion === undefined) throw new Error("Refresh the guide library before changing your favorite.");
      await performGuideChange({ action: "favorite", guideId: guideId ?? null, expectedVersion: library.favoriteVersion });
      return;
    }
    publishGuideLibrary({ ...library, favoriteGuideId: guideId }, dataRef.current?.church.id ?? "demo", undefined, true);
  }, [performGuideChange, publishGuideLibrary, supabaseUser]);
  const downloadBackup = useCallback(() => {
    if (supabaseUser) throw new Error("Use Data & health for a recently authenticated, audited church export.");
    if (!data) return;
    const blob = exportNeighborWalkData(data);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `neighborwalk-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [data, supabaseUser]);

  const importBackup = useCallback(async (file: File) => {
    if (supabaseUser && roleRef.current !== "leader") throw new Error("Only a church leader can import workspace data.");
    if (supabaseUser) throw new Error("Connected restore requires the reviewed server recovery workflow. No records were changed.");
    const imported = await importNeighborWalkFile(file);
    const connected = Boolean(supabaseUser && getSupabaseBrowserClient());
    const previous = dataRef.current;
    const peopleMutations = connected ? [
      ...imported.residents.map((resident) => mutation("resident", resident.id)),
      ...imported.personNotes.map((note) => mutation("person_note", note.id)),
      ...imported.followUps.filter((followUp) => followUp.residentId).map((followUp) => mutation("person_follow_up", followUp.id)),
      ...(previous?.followUps ?? []).filter((followUp) => followUp.residentId && !imported.followUps.some((candidate) => candidate.id === followUp.id)).map((followUp) => mutation("person_follow_up", followUp.id, "delete")),
      ...(previous?.personNotes ?? []).filter((note) => !imported.personNotes.some((candidate) => candidate.id === note.id)).map((note) => mutation("person_note", note.id, "delete")),
      ...(previous?.residents ?? []).filter((resident) => !imported.residents.some((candidate) => candidate.id === resident.id)).map((resident) => mutation("resident", resident.id, "delete")),
    ] : [];
    const next = {
      ...imported,
      sync: {
        ...imported.sync,
        mode: connected ? "connected" as const : "device_only" as const,
        pending: connected ? [mutation("data", imported.church.id), ...peopleMutations] : imported.sync.pending,
      },
    };
    return updateData(() => next);
  }, [supabaseUser, updateData]);

  const clearOutreachData = useCallback(async () => {
    if (supabaseUser) throw new Error("Shared records cannot be bulk-cleared from this device. Use reviewed archive and retention actions.");
    if (supabaseUser && roleRef.current !== "leader") return;
    return updateData((current) => {
      const removed = current.properties.length + current.visits.length + current.followUps.length + current.residents.length + current.personNotes.length;
      const cleared = addAudit({
        ...current,
        properties: [],
        visits: [],
        followUps: [],
        residents: [],
        personNotes: [],
        audit: [],
      }, "data", current.church.id, "data.outreach_cleared", `${removed} sample or outreach records cleared`);
      return {
        ...cleared,
        sync: {
          ...cleared.sync,
          pending: [
            ...cleared.sync.pending,
            ...current.personNotes.map((note) => mutation("person_note", note.id, "delete")),
            ...current.followUps.filter((followUp) => followUp.residentId).map((followUp) => mutation("person_follow_up", followUp.id, "delete")),
            ...current.residents.map((resident) => mutation("resident", resident.id, "delete")),
          ],
        },
      };
    });
  }, [supabaseUser, updateData]);

  const purgeExpired = useCallback(async () => {
    if (supabaseUser) throw new Error("Shared retention requires a server preview and confirmation. No records were changed.");
    if (supabaseUser && roleRef.current !== "leader") return;
    return updateData((current) => {
      const before = current.visits.length;
      const retained = enforceRetention(current);
      const removedResidentIds = new Set(current.residents.filter((resident) => !retained.residents.some((candidate) => candidate.id === resident.id)).map((resident) => resident.id));
      const removedNotes = current.personNotes.filter((note) => removedResidentIds.has(note.residentId));
      const removedPersonFollowUps = current.followUps.filter((followUp) => followUp.residentId && !retained.followUps.some((candidate) => candidate.id === followUp.id));
      const audited = addAudit(retained, "data", current.church.id, "data.retention_run", `${before - retained.visits.length} expired visit records removed`);
      return {
        ...audited,
        sync: {
          ...audited.sync,
          pending: [
            ...audited.sync.pending,
            ...removedNotes.map((note) => mutation("person_note", note.id, "delete")),
            ...removedPersonFollowUps.map((followUp) => mutation("person_follow_up", followUp.id, "delete")),
            ...removedResidentIds.values().map((residentId) => mutation("resident", residentId, "delete")),
          ],
        },
      };
    });
  }, [supabaseUser, updateData]);

  const runSync = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    const workspace = workspaceRef.current;
    const store = storeRef.current;
    if (!store || !client || !supabaseUser || !workspace || !onlineRef.current || store.snapshot.sync.legacyRecoveryRequired || recoveryInFlightRef.current) return false;
    setSyncing(true);
    let submittedId: string | undefined;
    try {
      await store.settled();
      for (let count = 0; count < 50; count += 1) {
        const queued = store.snapshot.sync.commands?.[0];
        if (!queued || queued.state === "needs_review") break;
        submittedId = queued.command.id;
        const receipt = await submitOutreachCommand(client, queued.command);
        await store.update((current) => {
          const commands = (current.sync.commands ?? []).filter((q) => q.command.id !== receipt.id);
          return { ...current, sync: { ...current.sync, commands, pending: commandPending(commands), warnings: receipt.warnings, lastError: undefined } };
        });
        submittedId = undefined;
      }
      const { data: remote, info } = await loadOutreachWorkspace(client, workspace.churchId, workspace.userId, store.snapshot.preferences);
      await store.update((current) => reconcileOutreachWorkspace(remote, current));
      const connection = { ...workspace, role: info.role, revision: info.revision, verifiedAt: new Date().toISOString() };
      workspaceRef.current = connection;
      roleRef.current = connection.role;
      setWorkspaceMembership(connection);
      writeWorkspaceConnection(connection);
      try {
        const guides = await withGuideAuthorization(workspace, () => loadConnectedGuideLibrary(client, workspace.churchId, supabaseUser.id));
        publishGuideLibrary(guides, workspace.churchId, supabaseUser.id, true);
      } catch (error) {
        if (guideLibraryAccessDenied(error)) return false;
        setGuideLibraryError(guideLibraryErrorMessage(error));
      }
      autoRetryAttemptRef.current = 0;
      // A new command can be saved while the complete refresh is downloading.
      // Report unfinished work so an auto-sync callback that joined this pass
      // schedules another attempt instead of waiting for the 30-second poll.
      return (store.snapshot.sync.commands?.length ?? 0) === 0;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The church service could not be reached.";
      if (error instanceof OutreachApiError && /^(42501|PGRST3)/.test(error.code ?? "")) {
        const membershipCheck = await client.rpc("outreach_workspace_info", { target_church: workspace.churchId });
        if (membershipCheck.error && /^(42501|PGRST3)/.test(membershipCheck.error.code ?? "")
          || !membershipCheck.error && !matchesWorkspaceIdentity(membershipCheck.data, workspace.churchId, workspace.userId)) {
          // Keep unsent work in its account-scoped cache, but immediately lock
          // the visible workspace when current membership cannot authorize it.
          writeWorkspaceConnection({ ...workspace, verifiedAt: "" });
          workspaceRef.current = null;
          storeRef.current = null;
          dataRef.current = null;
          setData(null);
          setWorkspaceStatus("locked");
          setStorageError("This account no longer has an authorized church session. Unsent work is preserved on this device. Sign in again or ask your church leader for help.");
          return false;
        }
      }
      const needsReview = error instanceof OutreachApiError && error.needsReview;
      try {
        await store.update((current) => ({
          ...current, sync: { ...current.sync,
            commands: current.sync.commands?.map((q) => q.command.id === submittedId && needsReview ? { ...q, state: "needs_review", error: detail } : q),
            lastError: needsReview ? `A queued change needs review: ${detail}` : `Not shared yet. Your queued work remains on this device. ${detail}`,
          },
        }));
      } catch { setStorageError("Device storage could not confirm the sync receipt. Keep this app open; the original command can be retried safely."); }
      return false;
    } finally { setSyncing(false); }
  }, [publishGuideLibrary, supabaseUser, withGuideAuthorization]);

  const syncNow = useCallback(() => {
    if (syncInFlightRef.current) return syncInFlightRef.current;
    const syncPromise = runSync().finally(() => {
      if (syncInFlightRef.current === syncPromise) syncInFlightRef.current = null;
    });
    syncInFlightRef.current = syncPromise;
    return syncPromise;
  }, [runSync]);

  const previewRecovery = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    const scope = storageScopeRef.current;
    const store = storeRef.current;
    if (!client || !scope || !store || !onlineRef.current) throw new Error("Reconnect with this church account to compare shared records.");
    return (await loadOutreachWorkspace(client, scope.churchId, scope.userId, store.snapshot.preferences)).data;
  }, []);

  const resolveRecovery = useCallback(async (reviewed: NeighborWalkData, commandId: string | null, selected: string[], expectedIds: string[]) => {
    if (recoveryInFlightRef.current) throw new Error("A recovery is already being saved.");
    recoveryInFlightRef.current = true;
    try {
      if (syncInFlightRef.current) await syncInFlightRef.current;
      const scope = storageScopeRef.current;
      const store = storeRef.current;
      const client = getSupabaseBrowserClient();
      if (!scope || !store || !client || !onlineRef.current || reviewed.church.id !== scope.churchId) throw new Error("Reconnect with the account that owns this device’s work.");
      // Check membership again before exporting or changing any visible cache.
      const { data: fresh } = await loadOutreachWorkspace(client, scope.churchId, scope.userId, store.snapshot.preferences);
      if (fresh.sync.serverRevision !== reviewed.sync.serverRevision
        || JSON.stringify(fresh.sync.recordVersions) !== JSON.stringify(reviewed.sync.recordVersions)
        || JSON.stringify(fresh.volunteers) !== JSON.stringify(reviewed.volunteers)) {
        throw new Error("Shared records or access changed during review. Refresh and compare again.");
      }
      let archiveKey = "";
      await store.update(async (current) => {
        const commands = current.sync.commands ?? [];
        if (JSON.stringify(commands.map((q) => q.command.id)) !== JSON.stringify(expectedIds)) throw new Error("The queue changed. Refresh the review before continuing.");
        if (!current.sync.legacyRecoveryRequired && commands[0]?.state !== "needs_review") throw new Error("No held transaction needs recovery.");
        if (commandId && (current.sync.legacyRecoveryRequired || commands[0]?.command.id !== commandId)) throw new Error("Review the first held transaction in order.");
        const replacement = commandId ? prepareReviewedCommand(commands[0], reviewed, selected) : null;
        archiveKey = await archiveWorkspaceRecovery(current, scope, commandId ? "Reviewed selected changes; original transaction preserved." : "Kept shared records; all previous device work preserved for manual reconciliation.");
        const remaining = replacement ? [replacement, ...commands.slice(1)] : [];
        const local = { ...current, sync: { ...current.sync, commands: remaining, pending: commandPending(remaining), legacyRecoveryRequired: false, lastError: undefined } };
        return reconcileOutreachWorkspace(fresh, local);
      });
      return archiveKey;
    } finally { recoveryInFlightRef.current = false; }
  }, []);

  const requireAdminScope = useCallback(() => {
    if (!storageScopeRef.current || !storeRef.current || roleRef.current !== "leader" || !onlineRef.current) throw new Error("Connect as a church leader to use reviewed administration.");
    return storageScopeRef.current;
  }, []);
  const runAdministration = useCallback(async (input: AdminInput | null) => {
    const scope = requireAdminScope();
    const store = storeRef.current!;
    const client = getSupabaseBrowserClient()!;
    if (recoveryInFlightRef.current) throw new Error("Another reviewed operation is still running.");
    recoveryInFlightRef.current = true;
    try {
      if (syncInFlightRef.current) await syncInFlightRef.current;
      await store.settled();
      if (store.snapshot.sync.commands?.length || store.snapshot.sync.legacyRecoveryRequired) throw new Error("Share or recover this device’s pending fieldwork before administration.");
      const before = await loadOutreachWorkspace(client, scope.churchId, scope.userId, store.snapshot.preferences);
      if (input && input.expectedRevision !== before.data.sync.serverRevision) {
        await store.update(() => before.data);
        throw new Error("The church changed. Review the refreshed records before continuing.");
      }
      const result = await submitAdministration(scope, input);
      const fresh = await loadOutreachWorkspace(client, scope.churchId, scope.userId, store.snapshot.preferences);
      await store.update(() => fresh.data);
      return { result, reviewedData: before.data };
    } finally { recoveryInFlightRef.current = false; }
  }, [requireAdminScope]);
  const exportChurchRecords = useCallback(async (kind: ImportKind | "tasks" | "backup") => {
    const revision = storeRef.current?.snapshot.sync.serverRevision;
    if (revision === undefined) throw new Error("Refresh shared records before exporting.");
    const { reviewedData } = await runAdministration({ action: "record_export", expectedRevision: revision, kind });
    const copy = kind === "backup" ? exportNeighborWalkData(reviewedData) : new Blob([exportCsv(reviewedData, kind)], { type: "text/csv;charset=utf-8" });
    downloadBlob(copy, "neighborwalk-" + kind + "-" + new Date().toISOString().slice(0, 10) + (kind === "backup" ? ".json" : ".csv"));
  }, [runAdministration]);
  const reauthenticateAdmin = useCallback(async (password: string) => {
    const scope = requireAdminScope();
    if (!supabaseUser?.email || !password) throw new Error("Enter your current password, or sign out safely and sign in again using your provider.");
    const { data: signedIn, error } = await getSupabaseBrowserClient()!.auth.signInWithPassword({ email: supabaseUser.email, password });
    if (error) throw new Error("Sign-in could not be confirmed. Check your password or use account recovery.");
    if (signedIn.user.id !== scope.userId) throw new Error("Sign-in did not match this account. No administration was performed.");
  }, [requireAdminScope, supabaseUser]);
  const getAdministrationPending = useCallback(() => storageScopeRef.current ? pendingAdministration(storageScopeRef.current) : Promise.resolve(null), []);
  const downloadAuthoredDeviceRecovery = useCallback(async () => {
    if (!supabaseUser) throw new Error("Sign in with the account that authored this work.");
    const connection = readWorkspaceConnection(supabaseUser.id);
    const scope = storageScopeRef.current ?? (connection ? { userId: supabaseUser.id, churchId: connection.churchId } : null);
    if (!scope || scope.userId !== supabaseUser.id) throw new Error("No church device copy is associated with this account. Keep the original browser profile and ask your leader for supervised help.");
    const client = getSupabaseBrowserClient();
    const session = await client?.auth.getSession();
    if (session?.data.session?.user.id !== scope.userId) throw new Error("Sign in again with the original author’s account before recovering device work.");
    const recovery = await authoredDeviceRecovery(scope);
    downloadBlob(new Blob([JSON.stringify(recovery, null, 2)], { type: "application/json" }), "neighborwalk-my-authored-device-recovery.json");
  }, [supabaseUser]);
  const reviewAdministrationPending = useCallback(async () => {
    const scope = requireAdminScope();
    const pending = await pendingAdministration(scope);
    if (pending) await finishAdministration(scope, String(pending.request.id), { reviewedWithoutResubmitting: true, note: "Leader reviewed shared records; original request preserved in device history." });
  }, [requireAdminScope]);
  const getRetentionPreview = useCallback(() => previewRetention(requireAdminScope()), [requireAdminScope]);
  const getDuplicatePreview = useCallback((kind: DuplicateKind, source: string, target: string) => previewDuplicates(requireAdminScope(), kind, source, target), [requireAdminScope]);

  const authorizeRecoveryExport = useCallback(async (scope: StorageScope) => {
    const client = getSupabaseBrowserClient();
    if (!client || !onlineRef.current) throw new Error("A full recovery export needs a connected, recently signed-in church leader. The original remains preserved on this device.");
    const { data: info, error } = await client.rpc("outreach_workspace_info", { target_church: scope.churchId });
    if (error) throw apiError(error);
    if (!info || typeof info !== "object" || Array.isArray(info) || info.role !== "leader" || info.userId !== scope.userId || typeof info.revision !== "number") throw new Error("Current leader authority is required for a full recovery export.");
    await submitAdministration(scope, { action: "record_export", expectedRevision: info.revision, kind: "backup" });
  }, []);
  const downloadDeviceRecovery = useCallback(async () => {
    const current = storeRef.current?.snapshot;
    if (!current) throw new Error("Sign in to the account that owns this device’s records.");
    const scope = storageScopeRef.current;
    if (scope && roleRef.current === "leader") await authorizeRecoveryExport(scope);
    const copy = scope && roleRef.current !== "leader"
      ? new Blob([JSON.stringify(authoredRecovery(current, scope), null, 2)], { type: "application/json" }) : exportNeighborWalkData(current);
    downloadBlob(copy, "neighborwalk-device-recovery-" + new Date().toISOString().slice(0, 10) + ".json");
  }, [authorizeRecoveryExport]);
  const listDeviceArchives = useCallback(async () => storageScopeRef.current ? recoveryArchives(storageScopeRef.current) : [], []);
  const downloadDeviceArchive = useCallback(async (key: string) => {
    const scope = storageScopeRef.current;
    if (!scope || !storeRef.current) throw new Error("An authorized account is required.");
    if (roleRef.current === "leader") await authorizeRecoveryExport(scope);
    downloadBlob(await exportRecoveryArchive(scope, key, roleRef.current === "leader" ? "workspace" : "authored"), "neighborwalk-preserved-recovery.json");
  }, [authorizeRecoveryExport]);

  const pendingCount = data?.sync.pending.length ?? 0;
  const pendingVersion = data?.sync.pending.at(-1)?.id ?? "none";
  useEffect(() => {
    if (!online || workspaceStatus !== "ready" || pendingCount === 0 || dataRef.current?.sync.legacyRecoveryRequired
      || dataRef.current?.sync.commands?.[0]?.state === "needs_review") return;
    const retryDelay = autoRetryAttemptRef.current === 0
      ? AUTO_SYNC_DELAY_MS
      : Math.min(AUTO_SYNC_MAX_RETRY_MS, 1000 * (2 ** autoRetryAttemptRef.current));
    const timeout = window.setTimeout(() => {
      void syncNow().then((success) => {
        if (success) {
          autoRetryAttemptRef.current = 0;
          return;
        }
        autoRetryAttemptRef.current += 1;
        setAutoRetryTick((current) => current + 1);
      });
    }, retryDelay);
    return () => window.clearTimeout(timeout);
  }, [autoRetryTick, online, pendingCount, pendingVersion, syncNow, workspaceStatus]);

  useEffect(() => {
    const retryVisibleChanges = () => {
      if (document.visibilityState === "hidden") {
        void syncNow();
      } else {
        void syncNow();
      }
    };
    const retryOnFocus = () => { void syncNow(); };
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncNow();
    }, 30_000);
    document.addEventListener("visibilitychange", retryVisibleChanges);
    window.addEventListener("focus", retryOnFocus);
    window.addEventListener("online", retryOnFocus);
    return () => {
      document.removeEventListener("visibilitychange", retryVisibleChanges);
      window.removeEventListener("focus", retryOnFocus);
      window.removeEventListener("online", retryOnFocus);
      window.clearInterval(refresh);
    };
  }, [syncNow]);

  useEffect(() => {
    if (!supabaseUser) return;
    const verifyWindow = () => {
      const connection = workspaceRef.current;
      if (!connection || offlineMembershipValid(connection.verifiedAt)) return;
      // Closing the visible workspace does not erase its unsent IDB records.
      storeRef.current = null; dataRef.current = null; workspaceRef.current = null;
      setData(null); setWorkspaceStatus("locked");
      setStorageError("This device needs an online membership check before church records can be opened again. Unsent work is preserved. Reconnect and reload.");
    };
    const interval = window.setInterval(verifyWindow, 30_000);
    window.addEventListener("focus", verifyWindow);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", verifyWindow); };
  }, [supabaseUser]);

  const activeTerritory = useMemo(() => data?.territories.find((territory) => territory.id === data.preferences.activeTerritoryId) ?? null, [data]);
  const activeVolunteer = useMemo(() => {
    if (!data) return null;
    if (!workspaceMembership) {
      return data.volunteers.find((volunteer) => volunteer.id === data.preferences.activeVolunteerId) ?? null;
    }
    const volunteerId = volunteerIdForUser(workspaceMembership.userId);
    return data.volunteers.find((volunteer) => volunteer.id === volunteerId) ?? {
      id: volunteerId,
      churchId: data.church.id,
      name: workspaceMembership.displayName,
      email: workspaceMembership.email,
      role: workspaceMembership.role,
      active: true,
    };
  }, [data, workspaceMembership]);

  return {
    data,
    offlineShell,
    loading,
    storageError,
    online,
    saving,
    syncing,
    workspaceStatus,
    workspaceMembership,
    guideLibrary,
    guideLibraryError,
    guidePending,
    guideChanging,
    activeTerritory,
    activeVolunteer,
    actions: {
      checkOfflinePreparation: () => setPreparationAttempt((attempt) => attempt + 1),
      updateData,
      setPreference,
      selectTerritory,
      addProperty,
      associatePropertiesWithParcel,
      updateProperty,
      deleteProperty,
      recordVisit,
      addRestriction,
      liftRestriction,
      completeFollowUp,
      rescheduleFollowUp,
      cancelFollowUp,
      assignFollowUp,
      acceptFollowUp,
      handoffPerson,
      saveOuting,
      saveAssignment,
      repeatOuting,
      addPersonFollowUp,
      upsertResident,
      addPersonNote,
      deletePersonNote,
      deleteResident,
      saveConversationGuide,
      refreshGuideLibrary,
      retryGuideChange: () => performGuideChange(null),
      reviewGuidePending,
      getGuidePending: () => storageScopeRef.current ? pendingGuideChange(storageScopeRef.current) : Promise.resolve(null),
      deleteConversationGuide,
      setFavoriteConversationGuide,
      setTeamConversationGuide,
      updateChurch,
      addTerritory,
      updateTerritory,
      deleteTerritory,
      addTeam,
      updateTeam,
      deleteTeam,
      downloadBackup,
      importBackup,
      clearOutreachData,
      purgeExpired,
      syncNow,
      previewRecovery,
      resolveRecovery,
      downloadDeviceRecovery,
      listDeviceArchives,
      downloadDeviceArchive,
      runAdministration,
      exportChurchRecords,
      reauthenticateAdmin,
      getAdministrationPending,
      downloadAuthoredDeviceRecovery,
      reviewAdministrationPending,
      getRetentionPreview,
      getDuplicatePreview,
    },
  };
}
