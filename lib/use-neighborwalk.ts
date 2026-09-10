"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createId,
  deleteTeamRecord,
  deleteTerritoryRecord,
  dueDateFromNow,
  enforceRetention,
  updateTerritoryRecord,
  type AuditEntry,
  type ConversationGuide,
  type ConversationGuideInput,
  type Coordinates,
  type FollowUp,
  type FollowUpCompletionInput,
  type NeighborWalkData,
  type Outcome,
  type ParcelReference,
  type PersonNoteKind,
  type Property,
  type ResidentInput,
  type TeamUpdate,
  type Territory,
  type TerritoryUpdate,
} from "./domain";
import {
  deleteConnectedGuide,
  loadConnectedGuideLibrary,
  normalizeGuideSteps,
  readLocalGuideLibrary,
  saveConnectedFavorite,
  saveConnectedGuide,
  saveConnectedTeamGuideDefault,
  validGuideInput,
  writeLocalGuideLibrary,
  type GuideLibraryState,
} from "./conversation-guides";
import {
  exportNeighborWalkData,
  importNeighborWalkFile,
  loadNeighborWalkData,
  loadScopedNeighborWalkData,
  saveNeighborWalkData,
  type StorageScope,
} from "./storage";
import { createSeedData } from "./seed";
import { getSupabaseBrowserClient } from "./supabase";
import { apiError, loadOutreachWorkspace, OutreachApiError, submitOutreachCommand } from "./outreach-client";
import { commandPending, DurableWorkspaceStore, reconcileOutreachWorkspace, stageWorkspaceChange } from "./outreach-queue";
import { versionKey, type CommandOperation } from "./command-schema";
import { changeFollowUp, createFollowUp } from "./follow-ups";
import { isProductionApp, storageKey } from "./environment";
import {
  volunteerIdForUser,
  withAuthenticatedVolunteer,
} from "./discipleship";

export type SupabaseUser = { id: string; email: string; name?: string };
export type WorkspaceMembership = {
  churchId: string;
  userId: string;
  role: "leader" | "volunteer";
  email: string;
  displayName: string;
};
type WorkspaceStatus = "device_only" | "connecting" | "invitation_required" | "ready" | "locked";
type WorkspaceConnection = WorkspaceMembership & { revision: number; verifiedAt?: string };

const WORKSPACE_CACHE_KEY = storageKey("neighborwalk-supabase-workspace");
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
  const token = new URL(window.location.href).searchParams.get("invite")?.trim() ?? "";
  return /^[0-9a-f]{64}$/i.test(token) ? token : null;
}

function clearInvitationToken() {
  const url = new URL(window.location.href);
  url.searchParams.delete("invite");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

type VisitInput = {
  propertyId: string;
  outcome: Exclude<Outcome, "unvisited">;
  objectiveNote?: string;
  followUpDate?: string;
  assignedTeamId?: string;
  residentId?: string;
};

type NewPropertyInput = {
  address: string;
  unit?: string;
  coordinates?: Coordinates;
  buildingGeometry?: Coordinates[];
  parcel?: ParcelReference;
};

type NewTerritoryInput = {
  name: string;
  boundary: Coordinates[];
  center: Coordinates;
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
  const storeRef = useRef<DurableWorkspaceStore | null>(null);
  const pendingWritesRef = useRef(0);
  const workspaceRef = useRef<WorkspaceConnection | null>(null);
  const dataRef = useRef<NeighborWalkData | null>(null);
  const onlineRef = useRef(true);
  const syncInFlightRef = useRef<Promise<boolean> | null>(null);
  const autoRetryAttemptRef = useRef(0);
  const actorIdRef = useRef<string | null>(supabaseUser ? volunteerIdForUser(supabaseUser.id) : null);
  const roleRef = useRef<WorkspaceMembership["role"] | null>(null);
  const storageScopeRef = useRef<StorageScope | undefined>(undefined);

  useEffect(() => {
    let active = true;
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
      publish(next);
    };
    const load = async () => {
      let cached: NeighborWalkData | null = null;
      const cachedConnection = supabaseUser ? readWorkspaceConnection(supabaseUser.id) : null;
      try {
        if (!supabaseUser) {
          const demo = await loadNeighborWalkData();
          await install({ ...demo, sync: { ...demo.sync, mode: "device_only" } });
          setGuideLibrary(readLocalGuideLibrary(demo.church.id, demo.guide));
          setWorkspaceStatus("device_only");
          return;
        }
        const client = getSupabaseBrowserClient();
        if (!client) throw new Error("The church service is not configured.");
        if (cachedConnection) cached = await loadScopedNeighborWalkData({ userId: supabaseUser.id, churchId: cachedConnection.churchId });
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
        const { data: remote, info } = await loadOutreachWorkspace(client, membership.church_id, cached?.preferences);
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
        try {
          const guides = await loadConnectedGuideLibrary(client, scope.churchId, scope.userId);
          if (!active) return;
          writeLocalGuideLibrary(guides, scope.churchId, scope.userId);
          setGuideLibrary(guides);
          setGuideLibraryError(null);
        } catch {
          setGuideLibrary(readLocalGuideLibrary(scope.churchId, [], scope.userId));
          setGuideLibraryError("The saved guide library is available; refresh online to check for changes.");
        }
        setWorkspaceStatus("ready");
      } catch (error) {
        if (!active) return;
        const allowedOffline = cachedConnection?.verifiedAt && cached
          && Date.now() - Date.parse(cachedConnection.verifiedAt) < 24 * 60 * 60 * 1000
          && (!navigator.onLine || (error instanceof OutreachApiError && !error.code));
        if (allowedOffline && supabaseUser && cachedConnection && cached) {
          workspaceRef.current = cachedConnection;
          roleRef.current = cachedConnection.role;
          setWorkspaceMembership(cachedConnection);
          const scoped = withAuthenticatedVolunteer(cached, cachedConnection);
          await install({ ...scoped, sync: { ...scoped.sync, lastError: "Offline workspace. Membership must be checked online within 24 hours." } },
            { userId: supabaseUser.id, churchId: cachedConnection.churchId });
          setGuideLibrary(readLocalGuideLibrary(cached.church.id, [], supabaseUser.id));
          setWorkspaceStatus("ready");
        } else {
          workspaceRef.current = null;
          storeRef.current = null;
          setWorkspaceStatus("locked");
          setStorageError(error instanceof Error ? error.message : "The church workspace could not be opened.");
        }
      } finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [supabaseUser]);

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
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register(isProductionApp ? "/sw.js" : "/sw.js?sandbox").catch(() => undefined);
    } else {
      // A previous local production build must not revive an old connected app offline.
      void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(
        registrations.filter((registration) => new URL(registration.active?.scriptURL ?? registration.scope).pathname === "/sw.js")
          .map((registration) => registration.unregister()),
      )).catch(() => undefined);
    }
  }, []);

  const updateData = useCallback(async (updater: (current: NeighborWalkData) => NeighborWalkData, extraOperations?: (current: NeighborWalkData) => CommandOperation[]) => {
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
        return scope ? stageWorkspaceChange(current, updated, scope, extraOperations?.(current)) : updated;
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
      const property: Property = {
        id: propertyId,
        churchId: current.church.id,
        territoryId: current.preferences.activeTerritoryId,
        address: input.address.trim() || "Confirm this address",
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
      if (!property || property.visitCount > 0 || property.currentOutcome === "do_not_visit" || hasPeople) return current;
      return addAudit({
        ...current,
        properties: current.properties.filter((item) => item.id !== propertyId),
      }, "property", propertyId, "property.deleted", `${property.address} removed`, "delete");
    });
  }, [updateData]);

  const recordVisit = useCallback((input: VisitInput) => {
    return updateData((current) => {
      const property = current.properties.find((item) => item.id === input.propertyId);
      if (!property) return current;
      const linkedResident = input.residentId
        ? current.residents.find((resident) => resident.id === input.residentId && resident.propertyId === property.id)
        : undefined;
      if (input.residentId && !linkedResident) return current;
      const objectiveNote = input.objectiveNote?.trim() || undefined;
      if (objectiveNote && objectiveNote.length > current.church.noteCharacterLimit) return current;
      if (input.outcome === "follow_up" && input.followUpDate) {
        const dueAt = new Date(`${input.followUpDate}T17:00:00`);
        if (Number.isNaN(dueAt.getTime()) || dueAt < new Date(new Date().toISOString().slice(0, 10))) return current;
      }
      const now = new Date().toISOString();
      const visitId = createId("visit");
      const visit = {
        id: visitId,
        churchId: current.church.id,
        eventId: current.preferences.activeEventId,
        territoryId: property.territoryId,
        propertyId: property.id,
        volunteerId: actorIdRef.current ?? current.preferences.activeVolunteerId,
        outcome: input.outcome,
        // Person-linked care notes stay with the protected task instead of the
        // church-wide visit snapshot.
        objectiveNote: linkedResident ? undefined : objectiveNote,
        residentId: input.residentId,
        recordedAt: now,
        deviceId: deviceId(),
      };
      const nextProperties = current.properties.map((item) => item.id === property.id ? {
        ...item,
        currentOutcome: item.currentOutcome === "do_not_visit" ? "do_not_visit" as const : input.outcome,
        lastVisitedAt: now,
        visitCount: item.visitCount + 1,
        updatedAt: now,
      } : item);
      let nextFollowUps = current.followUps;
      const protectedFollowUpMutationIds = new Set<string>();
      if (input.outcome === "follow_up") {
        const replacesSameWork = (followUp: FollowUp) => input.residentId
          ? followUp.residentId === input.residentId
          : followUp.propertyId === property.id && !followUp.residentId;
        if (input.residentId) {
          current.followUps
            .filter((followUp) => replacesSameWork(followUp) && followUp.status === "scheduled")
            .forEach((followUp) => protectedFollowUpMutationIds.add(followUp.id));
        }
        const followUpId = createId("followup");
        if (input.residentId) protectedFollowUpMutationIds.add(followUpId);
        const actorId = actorIdRef.current ?? current.preferences.activeVolunteerId;
        nextFollowUps = [...nextFollowUps.map((followUp) => replacesSameWork(followUp)
          ? changeFollowUp(followUp, { action: "cancelled", note: "Replaced by a new follow-up request." }, actorId, now)
          : followUp), createFollowUp({
          id: followUpId,
          churchId: current.church.id,
          propertyId: property.id,
          residentId: input.residentId,
          sourceVisitId: visitId,
          assignedTeamId: input.assignedTeamId,
          assignedVolunteerId: linkedResident?.assignedVolunteerId ?? actorId,
          dueAt: input.followUpDate
            ? input.followUpDate
            : dueDateFromNow(current.church.defaultFollowUpDays, current.church.timezone),
          note: objectiveNote,
        }, actorId, now)];
      }
      if (input.outcome === "do_not_visit") {
        const actorId = actorIdRef.current ?? current.preferences.activeVolunteerId;
        nextFollowUps = nextFollowUps.map((followUp) => {
          if (followUp.propertyId !== property.id || followUp.status !== "scheduled") return followUp;
          if (followUp.residentId) protectedFollowUpMutationIds.add(followUp.id);
          return changeFollowUp(followUp, { action: "cancelled", note: "Location marked do not revisit." }, actorId, now);
        });
      }
      const result = addAudit({
        ...current,
        properties: nextProperties,
        visits: [visit, ...current.visits],
        followUps: nextFollowUps,
      }, "visit", visitId, "visit.recorded", `${input.outcome.replaceAll("_", " ")} recorded at ${property.address}`);
      if (!protectedFollowUpMutationIds.size) return result;
      return {
        ...result,
        sync: {
          ...result.sync,
          pending: [
            ...result.sync.pending,
            ...[...protectedFollowUpMutationIds].map((followUpId) => mutation("person_follow_up", followUpId)),
          ],
        },
      };
    });
  }, [updateData]);

  const completeFollowUp = useCallback((followUpId: string, input: FollowUpCompletionInput = {}) => {
    return updateData((current) => {
      const existing = current.followUps.find((followUp) => followUp.id === followUpId && followUp.status === "scheduled");
      if (!existing) return current;
      const completionNote = input.completionNote?.trim() || undefined;
      if (completionNote && completionNote.length > current.church.noteCharacterLimit) return current;
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
      const nextDueAt = new Date(input.nextFollowUp.dueAt);
      if (Number.isNaN(nextDueAt.getTime())) return result;
      const nextId = createId("followup");
      const note = input.nextFollowUp.note?.trim() || undefined;
      const nextTask = createFollowUp({
        id: nextId,
        churchId: current.church.id,
        propertyId: existing.propertyId,
        residentId: existing.residentId,
        sourceVisitId: existing.sourceVisitId,
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
      const dueAt = new Date(`${date}T17:00:00`);
      const existing = current.followUps.find((followUp) => followUp.id === followUpId && followUp.status === "scheduled");
      if (!date || Number.isNaN(dueAt.getTime()) || !existing) return current;
      const activityNote = note?.trim() || undefined;
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
      if (!existing) return current;
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
      const dueAt = new Date(`${date}T17:00:00`);
      if (!resident || !trimmedNote || trimmedNote.length > current.church.noteCharacterLimit || !date || Number.isNaN(dueAt.getTime())) return current;
      const now = new Date().toISOString();
      const followUp = createFollowUp({
        id: followUpId,
        churchId: current.church.id,
        propertyId: resident.propertyId,
        residentId,
        dueAt: date,
        assignedVolunteerId: resident.assignedVolunteerId,
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
    });
    return requestedId;
  }, [updateData]);

  const addPersonNote = useCallback(async (residentId: string, kind: PersonNoteKind, body: string, createdAt?: string) => {
    const noteId = createId("person_note");
    await updateData((current) => {
      const resident = current.residents.find((item) => item.id === residentId);
      const trimmedBody = body.trim();
      if (!resident || !trimmedBody || trimmedBody.length > current.church.noteCharacterLimit) return current;
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
      if (!note) return current;
      return addAudit({
        ...current,
        personNotes: current.personNotes.filter((item) => item.id !== noteId),
      }, "person_note", noteId, "person_note.deleted", "Person note deleted", "delete");
    });
  }, [updateData]);

  const deleteResident = useCallback((residentId: string) => {
    return updateData((current) => {
      if (!current.residents.some((resident) => resident.id === residentId)) return current;
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

  const updateChurch = useCallback((patch: Partial<NeighborWalkData["church"]>) => {
    if (supabaseUser && roleRef.current !== "leader") return;
    return updateData((current) => addAudit({
      ...current,
      church: { ...current.church, ...patch },
    }, "settings", current.church.id, "settings.updated", "Church settings updated"));
  }, [supabaseUser, updateData]);

  const assignFollowUp = useCallback((id: string, volunteerId: string) => updateData((current) => ({
    ...current, followUps: current.followUps.map((task) => task.id === id ? { ...task, assignedVolunteerId: volunteerId,
      acceptance: volunteerId === current.preferences.activeVolunteerId ? "accepted" : "pending" } : task),
  })), [updateData]);

  const acceptFollowUp = useCallback((id: string, acceptance: "accepted" | "declined") => updateData((current) => ({
    ...current, followUps: current.followUps.map((task) => task.id === id ? { ...task, acceptance } : task),
  })), [updateData]);

  const handoffPerson = useCallback((id: string, action: "request" | "accept" | "decline" | "cancel", assignedVolunteerId?: string) => {
    if (!storageScopeRef.current) return Promise.reject(new Error("Care handoffs require a connected church workspace."));
    return updateData((current) => current, (current) => [{ entityType: "handoff", entityId: id, operation: "upsert",
      expectedVersion: current.sync.recordVersions?.[versionKey("resident", id)] ?? 0, record: { action, assignedVolunteerId } }]);
  }, [updateData]);

  const addTerritory = useCallback(async (input: NewTerritoryInput) => {
    const territoryId = createId("territory");
    if (supabaseUser && roleRef.current !== "leader") return territoryId;
    await updateData((current) => {
      const territory: Territory = {
        id: territoryId,
        churchId: current.church.id,
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

  const updateTerritory = useCallback((territoryId: string, update: TerritoryUpdate) => {
    if (supabaseUser && roleRef.current !== "leader") return;
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

  const deleteTerritory = useCallback((territoryId: string, destinationTerritoryId: string) => {
    if (supabaseUser && roleRef.current !== "leader") return;
    return updateData((current) => {
      const territory = current.territories.find((item) => item.id === territoryId);
      const destination = current.territories.find((item) => item.id === destinationTerritoryId);
      if (!territory || !destination || territory.eventId !== destination.eventId) return current;
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
    if (supabaseUser && roleRef.current !== "leader") return teamId;
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

  const saveConversationGuide = useCallback(async (input: ConversationGuideInput) => {
    if (!validGuideInput(input)) throw new Error("Finish each guide step before saving.");
    if (input.scope === "church" && supabaseUser && roleRef.current !== "leader") {
      throw new Error("Only a church leader can publish a church guide.");
    }
    const client = getSupabaseBrowserClient();
    const workspace = workspaceRef.current;
    let saved: ConversationGuide;
    if (supabaseUser && client && workspace) {
      const existing = input.id ? guideLibrary.guides.find((guide) => guide.id === input.id) : undefined;
      if (existing && existing.scope !== input.scope) throw new Error("A guide’s privacy level cannot be changed after it is created.");
      const nextSortOrder = Math.min(10000, Math.max(0, ...guideLibrary.guides
        .filter((guide) => guide.scope === input.scope)
        .map((guide) => guide.sortOrder)) + 10);
      saved = await saveConnectedGuide(client, input, workspace.churchId, supabaseUser.id, nextSortOrder);
    } else {
      const existing = input.id ? guideLibrary.guides.find((guide) => guide.id === input.id) : undefined;
      const now = new Date().toISOString();
      saved = {
        id: existing?.id ?? createId("guide"),
        churchId: dataRef.current?.church.id ?? "device_church",
        scope: existing?.scope ?? input.scope,
        ownerUserId: (existing?.scope ?? input.scope) === "personal"
          ? actorIdRef.current ?? dataRef.current?.preferences.activeVolunteerId ?? "device_user"
          : undefined,
        title: input.title.trim(),
        description: input.description.trim(),
        steps: normalizeGuideSteps(input.steps),
        sortOrder: existing?.sortOrder ?? Math.min(10000, Math.max(0, ...guideLibrary.guides.map((guide) => guide.sortOrder)) + 10),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
    }
    const nextGuides = [...guideLibrary.guides.filter((guide) => guide.id !== saved.id), saved]
      .sort((first, second) => first.sortOrder - second.sortOrder || first.title.localeCompare(second.title));
    const next = { ...guideLibrary, guides: nextGuides };
    setGuideLibrary(next);
    setGuideLibraryError(null);
    writeLocalGuideLibrary(next, dataRef.current?.church.id, supabaseUser?.id);
    return saved;
  }, [guideLibrary, supabaseUser]);

  const deleteConversationGuide = useCallback(async (guideId: string) => {
    const guide = guideLibrary.guides.find((item) => item.id === guideId);
    if (!guide) return;
    if (guide.scope === "church" && supabaseUser && roleRef.current !== "leader") {
      throw new Error("Only a church leader can delete a church guide.");
    }
    const client = getSupabaseBrowserClient();
    const workspace = workspaceRef.current;
    if (supabaseUser && client && workspace) await deleteConnectedGuide(client, guideId);
    const next: GuideLibraryState = {
      guides: guideLibrary.guides.filter((item) => item.id !== guideId),
      favoriteGuideId: guideLibrary.favoriteGuideId === guideId ? undefined : guideLibrary.favoriteGuideId,
      teamGuideDefaults: Object.fromEntries(
        Object.entries(guideLibrary.teamGuideDefaults).filter(([, defaultGuideId]) => defaultGuideId !== guideId),
      ),
    };
    setGuideLibrary(next);
    setGuideLibraryError(null);
    writeLocalGuideLibrary(next, dataRef.current?.church.id, supabaseUser?.id);
  }, [guideLibrary, supabaseUser]);

  const setTeamConversationGuide = useCallback(async (teamId: string, guideId?: string) => {
    if (supabaseUser && roleRef.current !== "leader") {
      throw new Error("Only a church leader can set a group guide.");
    }
    if (!dataRef.current?.teams.some((team) => team.id === teamId)) {
      throw new Error("Choose a group in this church workspace.");
    }
    if (guideId && !guideLibrary.guides.some((guide) => guide.id === guideId && guide.scope === "church")) {
      throw new Error("Group defaults must use a church guide.");
    }
    const client = getSupabaseBrowserClient();
    const workspace = workspaceRef.current;
    if (supabaseUser && client && workspace) {
      await saveConnectedTeamGuideDefault(client, workspace.churchId, supabaseUser.id, teamId, guideId);
    }
    const teamGuideDefaults = { ...guideLibrary.teamGuideDefaults };
    if (guideId) teamGuideDefaults[teamId] = guideId;
    else delete teamGuideDefaults[teamId];
    const next = { ...guideLibrary, teamGuideDefaults };
    setGuideLibrary(next);
    setGuideLibraryError(null);
    writeLocalGuideLibrary(next, dataRef.current?.church.id, supabaseUser?.id);
  }, [guideLibrary, supabaseUser]);

  const setFavoriteConversationGuide = useCallback(async (guideId: string) => {
    if (!guideLibrary.guides.some((guide) => guide.id === guideId)) throw new Error("Choose a guide you can access.");
    const client = getSupabaseBrowserClient();
    const workspace = workspaceRef.current;
    if (supabaseUser && client && workspace) {
      await saveConnectedFavorite(client, workspace.churchId, supabaseUser.id, guideId);
    }
    const next = { ...guideLibrary, favoriteGuideId: guideId };
    setGuideLibrary(next);
    setGuideLibraryError(null);
    writeLocalGuideLibrary(next, dataRef.current?.church.id, supabaseUser?.id);
  }, [guideLibrary, supabaseUser]);

  const downloadBackup = useCallback(() => {
    if (supabaseUser && roleRef.current !== "leader") return;
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
    setData(next);
    return next;
  }, [supabaseUser]);

  const clearOutreachData = useCallback(() => {
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

  const purgeExpired = useCallback(() => {
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
    if (!store || !client || !supabaseUser || !workspace || !onlineRef.current || store.snapshot.sync.legacyRecoveryRequired) return false;
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
      const { data: remote, info } = await loadOutreachWorkspace(client, workspace.churchId, store.snapshot.preferences);
      await store.update((current) => reconcileOutreachWorkspace(remote, current));
      const connection = { ...workspace, role: info.role, revision: info.revision, verifiedAt: new Date().toISOString() };
      workspaceRef.current = connection;
      roleRef.current = connection.role;
      setWorkspaceMembership(connection);
      writeWorkspaceConnection(connection);
      try {
        const guides = await loadConnectedGuideLibrary(client, workspace.churchId, supabaseUser.id);
        writeLocalGuideLibrary(guides, workspace.churchId, supabaseUser.id);
        setGuideLibrary(guides);
        setGuideLibraryError(null);
      } catch { setGuideLibraryError("Guides could not refresh. Your saved library is still available."); }
      autoRetryAttemptRef.current = 0;
      return !store.snapshot.sync.commands?.some((q) => q.state === "needs_review");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The church service could not be reached.";
      if (error instanceof OutreachApiError && /^(42501|PGRST3)/.test(error.code ?? "")) {
        const membershipCheck = await client.rpc("outreach_workspace_info", { target_church: workspace.churchId });
        if (membershipCheck.error && /^(42501|PGRST3)/.test(membershipCheck.error.code ?? "")) {
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
  }, [supabaseUser]);

  const syncNow = useCallback(() => {
    if (syncInFlightRef.current) return syncInFlightRef.current;
    const syncPromise = runSync().finally(() => {
      if (syncInFlightRef.current === syncPromise) syncInFlightRef.current = null;
    });
    syncInFlightRef.current = syncPromise;
    return syncPromise;
  }, [runSync]);

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
    loading,
    storageError,
    online,
    saving,
    syncing,
    workspaceStatus,
    workspaceMembership,
    guideLibrary,
    guideLibraryError,
    activeTerritory,
    activeVolunteer,
    actions: {
      updateData,
      setPreference,
      selectTerritory,
      addProperty,
      associatePropertiesWithParcel,
      updateProperty,
      deleteProperty,
      recordVisit,
      completeFollowUp,
      rescheduleFollowUp,
      cancelFollowUp,
      assignFollowUp,
      acceptFollowUp,
      handoffPerson,
      addPersonFollowUp,
      upsertResident,
      addPersonNote,
      deletePersonNote,
      deleteResident,
      saveConversationGuide,
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
    },
  };
}
