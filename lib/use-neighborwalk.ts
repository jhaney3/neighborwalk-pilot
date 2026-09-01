"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createId,
  deleteTeamRecord,
  deleteTerritoryRecord,
  dueDateFromNow,
  enforceRetention,
  neighborWalkDataSchema,
  updateTerritoryRecord,
  type AuditEntry,
  type ConversationGuide,
  type ConversationGuideInput,
  type Coordinates,
  type FollowUp,
  type GuideStep,
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
  legacyConversationGuide,
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
  migrateNeighborWalkData,
  saveNeighborWalkData,
} from "./storage";
import { getSupabaseBrowserClient, type Json, type NeighborWalkDatabase } from "./supabase";
import { mergePendingWorkspaceChanges } from "./workspace-sync";
import {
  loadConnectedDiscipleship,
  persistConnectedDiscipleship,
  volunteerIdForUser,
  withAuthenticatedVolunteer,
  withoutSnapshotDiscipleship,
} from "./discipleship";

export type SupabaseUser = { id: string; email: string; name?: string };
export type WorkspaceMembership = {
  churchId: string;
  userId: string;
  role: "leader" | "volunteer";
  email: string;
  displayName: string;
};
type WorkspaceStatus = "device_only" | "connecting" | "invitation_required" | "ready";
type WorkspaceConnection = WorkspaceMembership & { revision: number };
type WorkspaceSnapshotRecord = Pick<
  NeighborWalkDatabase["public"]["Tables"]["workspace_snapshots"]["Row"],
  "church_id" | "schema_version" | "data" | "revision" | "updated_at"
>;

const WORKSPACE_CACHE_KEY = "neighborwalk-supabase-workspace";
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
  coordinates: Coordinates;
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
  const key = "neighborwalk-device-id";
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

async function fetchWorkspaceSnapshot(
  client: NonNullable<ReturnType<typeof getSupabaseBrowserClient>>,
  churchId: string,
): Promise<WorkspaceSnapshotRecord> {
  const { data, error } = await client
    .from("workspace_snapshots")
    .select("church_id, schema_version, data, revision, updated_at")
    .eq("church_id", churchId)
    .single();
  if (error) throw error;
  return data;
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
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveVersion = useRef(0);
  const workspaceRef = useRef<WorkspaceConnection | null>(null);
  const dataRef = useRef<NeighborWalkData | null>(null);
  const onlineRef = useRef(true);
  const syncInFlightRef = useRef<Promise<boolean> | null>(null);
  const autoRetryAttemptRef = useRef(0);
  const actorIdRef = useRef<string | null>(supabaseUser ? volunteerIdForUser(supabaseUser.id) : null);
  const roleRef = useRef<WorkspaceMembership["role"] | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const loaded = await loadNeighborWalkData();
        if (!active) return;
        const client = getSupabaseBrowserClient();
        if (!supabaseUser || !client) {
          setWorkspaceStatus("device_only");
          setWorkspaceMembership(null);
          roleRef.current = null;
          setGuideLibrary(readLocalGuideLibrary(loaded.church.id, loaded.guide));
          setGuideLibraryError(null);
          setData({ ...loaded, sync: { ...loaded.sync, mode: "device_only" } });
          return;
        }

        setWorkspaceStatus("connecting");
        try {
          let { data: membership, error: membershipError } = await client
            .from("church_memberships")
            .select("church_id, user_id, role, member_email, display_name")
            .eq("user_id", supabaseUser.id)
            .eq("active", true)
            .limit(1)
            .maybeSingle();
          if (!active) return;
          if (membershipError) throw membershipError;
          const token = invitationToken();
          if (!membership && token) {
            const { error: invitationError } = await client.rpc("accept_church_invitation", { invitation_token: token });
            if (invitationError) throw invitationError;
            clearInvitationToken();
            const membershipResult = await client
              .from("church_memberships")
              .select("church_id, user_id, role, member_email, display_name")
              .eq("user_id", supabaseUser.id)
              .eq("active", true)
              .limit(1)
              .maybeSingle();
            membership = membershipResult.data;
            membershipError = membershipResult.error;
            if (membershipError) throw membershipError;
          }
          if (!membership) {
            setWorkspaceStatus("invitation_required");
            setWorkspaceMembership(null);
            roleRef.current = null;
            setData({ ...loaded, sync: { ...loaded.sync, mode: "connected", lastError: undefined } });
            return;
          }
          const resolvedMembership: WorkspaceMembership = {
            churchId: membership.church_id,
            userId: membership.user_id,
            role: membership.role,
            email: membership.member_email ?? supabaseUser.email,
            displayName: membership.display_name ?? supabaseUser.name ?? supabaseUser.email.split("@")[0] ?? "Member",
          };
          setWorkspaceMembership(resolvedMembership);
          roleRef.current = resolvedMembership.role;
          actorIdRef.current = volunteerIdForUser(supabaseUser.id);
          const { data: snapshot, error: snapshotError } = await client
            .from("workspace_snapshots")
            .select("church_id, schema_version, data, revision, updated_at")
            .eq("church_id", membership.church_id)
            .single();
          if (!active) return;
          if (snapshotError) throw snapshotError;
          const parsedRemote = neighborWalkDataSchema.safeParse(migrateNeighborWalkData(snapshot.data));
          if (!parsedRemote.success) throw new Error("The church workspace contains data from an unsupported app version.");
          const connectedDiscipleship = await loadConnectedDiscipleship(client, membership.church_id);
          const parsedProtectedRemote = neighborWalkDataSchema.safeParse({
            ...parsedRemote.data,
            residents: connectedDiscipleship.residents,
            personNotes: connectedDiscipleship.personNotes,
            followUps: [...parsedRemote.data.followUps, ...connectedDiscipleship.personFollowUps],
          });
          if (!parsedProtectedRemote.success) throw new Error("The protected discipleship records contain unsupported data.");
          const protectedRemote = parsedProtectedRemote.data;
          const cachedForUser = readWorkspaceConnection(supabaseUser.id);
          const connection = { ...resolvedMembership, revision: Number(snapshot.revision) };
          workspaceRef.current = connection;
          writeWorkspaceConnection(connection);
          const hasLocalChanges = cachedForUser?.churchId === membership.church_id
            && loaded.sync.mode === "connected"
            && loaded.sync.pending.length > 0;
          const selected = hasLocalChanges
            ? mergePendingWorkspaceChanges(protectedRemote, loaded)
            : protectedRemote;
          const selectedForMember = withAuthenticatedVolunteer(selected, resolvedMembership);
          try {
            const connectedGuideLibrary = await loadConnectedGuideLibrary(client, membership.church_id, supabaseUser.id);
            if (!active) return;
            if (connectedGuideLibrary.guides.length) {
              setGuideLibrary(connectedGuideLibrary);
            } else {
              const fallbackGuide = legacyConversationGuide(selectedForMember.church.id, selectedForMember.guide);
              setGuideLibrary({ guides: [fallbackGuide], favoriteGuideId: fallbackGuide.id, teamGuideDefaults: {} });
            }
            setGuideLibraryError(null);
          } catch (guideError) {
            if (!active) return;
            const fallbackGuide = legacyConversationGuide(selectedForMember.church.id, selectedForMember.guide);
            setGuideLibrary({ guides: [fallbackGuide], favoriteGuideId: fallbackGuide.id, teamGuideDefaults: {} });
            setGuideLibraryError(guideError instanceof Error ? guideError.message : "Conversation guides could not be loaded.");
          }
          setData({
            ...selectedForMember,
            sync: {
              ...selectedForMember.sync,
              mode: "connected",
              lastError: undefined,
            },
          });
          setWorkspaceStatus("ready");
        } catch (error) {
          if (!active) return;
          const cached = readWorkspaceConnection(supabaseUser.id);
          workspaceRef.current = cached;
          if (cached) {
            const cachedMembership: WorkspaceMembership = {
              churchId: cached.churchId,
              userId: cached.userId,
              role: cached.role,
              email: cached.email,
              displayName: cached.displayName,
            };
            setWorkspaceMembership(cachedMembership);
            roleRef.current = cachedMembership.role;
            actorIdRef.current = volunteerIdForUser(supabaseUser.id);
          }
          const connectedLoaded = cached
            ? withAuthenticatedVolunteer(loaded, {
              churchId: cached.churchId,
              userId: cached.userId,
              role: cached.role,
              email: cached.email,
              displayName: cached.displayName,
            })
            : loaded;
          setData({
            ...connectedLoaded,
            sync: {
              ...connectedLoaded.sync,
              mode: "connected",
              lastError: error instanceof Error ? error.message : "The church workspace could not be reached.",
            },
          });
          setGuideLibrary(readLocalGuideLibrary(loaded.church.id, loaded.guide));
          setGuideLibraryError("Conversation guides are using this device until the church workspace reconnects.");
          setWorkspaceStatus(cached ? "ready" : "invitation_required");
        }
      } catch (error) {
        if (active) setStorageError(error instanceof Error ? error.message : "Could not open device storage.");
      } finally {
        if (active) setLoading(false);
      }
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
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!data) return;
    const version = ++saveVersion.current;
    const savingTimer = window.setTimeout(() => setSaving(true), 0);
    saveQueue.current = saveQueue.current.catch(() => undefined).then(() => saveNeighborWalkData(data));
    void saveQueue.current
      .then(() => {
        if (version === saveVersion.current) setStorageError(null);
      })
      .catch((error: unknown) => {
        if (version === saveVersion.current) setStorageError(error instanceof Error ? error.message : "Changes could not be saved.");
      })
      .finally(() => {
        if (version === saveVersion.current) setSaving(false);
      });
    return () => window.clearTimeout(savingTimer);
  }, [data]);

  const updateData = useCallback((updater: (current: NeighborWalkData) => NeighborWalkData) => {
    setData((current) => {
      if (!current) return current;
      const next = updater(current);
      return { ...next, updatedAt: new Date().toISOString() };
    });
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
      pending: [...current.sync.pending, mutation(entityType, entityId, operation)].slice(-2000),
    },
  });

  const setPreference = useCallback(<K extends keyof NeighborWalkData["preferences"]>(
    key: K,
    value: NeighborWalkData["preferences"][K],
  ) => {
    updateData((current) => ({
      ...current,
      preferences: { ...current.preferences, [key]: value },
    }));
  }, [updateData]);

  const selectTerritory = useCallback((territoryId: string) => {
    updateData((current) => ({
      ...current,
      preferences: { ...current.preferences, activeTerritoryId: territoryId },
    }));
  }, [updateData]);

  const addProperty = useCallback((input: NewPropertyInput) => {
    const propertyId = createId("property");
    updateData((current) => {
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
        source: "map",
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
    updateData((current) => {
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
    updateData((current) => addAudit({
      ...current,
      properties: current.properties.map((property) => property.id === propertyId
        ? { ...property, address: patch.address.trim(), unit: patch.unit?.trim() || undefined, updatedAt: new Date().toISOString() }
        : property),
    }, "property", propertyId, "property.updated", "Location details updated"));
  }, [updateData]);

  const deleteProperty = useCallback((propertyId: string) => {
    updateData((current) => {
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
    updateData((current) => {
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
        recordedAt: now,
        deviceId: deviceId(),
      };
      const nextProperties = current.properties.map((item) => item.id === property.id ? {
        ...item,
        currentOutcome: input.outcome,
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
        nextFollowUps = [...nextFollowUps.map((followUp) => replacesSameWork(followUp) && followUp.status === "scheduled"
          ? {
            ...followUp,
            status: "cancelled" as const,
            history: [...followUp.history, {
              id: createId("activity"),
              action: "cancelled" as const,
              note: "Replaced by a new follow-up request.",
              actorId: actorIdRef.current ?? current.preferences.activeVolunteerId,
              createdAt: now,
            }],
          }
          : followUp), {
          id: followUpId,
          churchId: current.church.id,
          propertyId: property.id,
          residentId: input.residentId,
          sourceVisitId: visitId,
          assignedTeamId: linkedResident ? undefined : input.assignedTeamId,
          dueAt: input.followUpDate
            ? new Date(`${input.followUpDate}T17:00:00`).toISOString()
            : dueDateFromNow(current.church.defaultFollowUpDays),
          status: "scheduled" as const,
          note: objectiveNote,
          history: [{
            id: createId("activity"),
            action: "created" as const,
            note: objectiveNote,
            dueAt: input.followUpDate
              ? new Date(`${input.followUpDate}T17:00:00`).toISOString()
              : dueDateFromNow(current.church.defaultFollowUpDays),
            actorId: actorIdRef.current ?? current.preferences.activeVolunteerId,
            createdAt: now,
          }],
          createdAt: now,
        }];
      }
      if (input.outcome === "do_not_visit") {
        current.followUps
          .filter((followUp) => followUp.propertyId === property.id && followUp.residentId && followUp.status === "scheduled")
          .forEach((followUp) => protectedFollowUpMutationIds.add(followUp.id));
        nextFollowUps = nextFollowUps.map((followUp) => followUp.propertyId === property.id && followUp.status === "scheduled"
          ? {
            ...followUp,
            status: "cancelled" as const,
            history: [...followUp.history, {
              id: createId("activity"),
              action: "cancelled" as const,
              note: "Location marked do not revisit.",
              actorId: actorIdRef.current ?? current.preferences.activeVolunteerId,
              createdAt: now,
            }],
          }
          : followUp);
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
          ].slice(-2000),
        },
      };
    });
  }, [updateData]);

  const completeFollowUp = useCallback((followUpId: string, input: FollowUpCompletionInput = {}) => {
    updateData((current) => {
      const existing = current.followUps.find((followUp) => followUp.id === followUpId && followUp.status === "scheduled");
      if (!existing) return current;
      const completionNote = input.completionNote?.trim() || undefined;
      if (completionNote && completionNote.length > current.church.noteCharacterLimit) return current;
      const now = new Date().toISOString();
      let nextFollowUps = current.followUps.map((followUp) => followUp.id === followUpId
        ? {
          ...followUp,
          status: "completed" as const,
          completionNote,
          completedAt: now,
          history: [...followUp.history, {
            id: createId("activity"),
            action: "completed" as const,
            note: completionNote,
            actorId: actorIdRef.current ?? current.preferences.activeVolunteerId,
            createdAt: now,
          }],
        }
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
      nextFollowUps = [...result.followUps, {
        id: nextId,
        churchId: current.church.id,
        propertyId: existing.propertyId,
        residentId: existing.residentId,
        sourceVisitId: existing.sourceVisitId,
        assignedTeamId: input.nextFollowUp.assignedTeamId,
        dueAt: nextDueAt.toISOString(),
        status: "scheduled" as const,
        note,
        parentFollowUpId: existing.id,
        history: [{
          id: createId("activity"),
          action: "created" as const,
          note,
          dueAt: nextDueAt.toISOString(),
          actorId: actorIdRef.current ?? current.preferences.activeVolunteerId,
          createdAt: now,
        }],
        createdAt: now,
      }];
      result = addAudit({ ...result, followUps: nextFollowUps }, followUpEntity, nextId, "follow_up.created", "Additional follow-up scheduled");
      return result;
    });
  }, [updateData]);

  const rescheduleFollowUp = useCallback((followUpId: string, date: string, note?: string) => {
    updateData((current) => {
      const dueAt = new Date(`${date}T17:00:00`);
      const existing = current.followUps.find((followUp) => followUp.id === followUpId && followUp.status === "scheduled");
      if (!date || Number.isNaN(dueAt.getTime()) || !existing) return current;
      const activityNote = note?.trim() || undefined;
      const now = new Date().toISOString();
      return addAudit({
        ...current,
        followUps: current.followUps.map((followUp) => followUp.id === followUpId && followUp.status === "scheduled"
          ? {
            ...followUp,
            dueAt: dueAt.toISOString(),
            history: [...followUp.history, {
              id: createId("activity"),
              action: "rescheduled" as const,
              note: activityNote,
              dueAt: dueAt.toISOString(),
              actorId: actorIdRef.current ?? current.preferences.activeVolunteerId,
              createdAt: now,
            }],
          }
          : followUp),
      }, existing.residentId ? "person_follow_up" : "follow_up", followUpId, "follow_up.rescheduled", "Follow-up date changed");
    });
  }, [updateData]);

  const cancelFollowUp = useCallback((followUpId: string, note?: string) => {
    updateData((current) => {
      const existing = current.followUps.find((followUp) => followUp.id === followUpId && followUp.status === "scheduled");
      if (!existing) return current;
      const now = new Date().toISOString();
      return addAudit({
        ...current,
        followUps: current.followUps.map((followUp) => followUp.id === followUpId
          ? {
            ...followUp,
            status: "cancelled",
            history: [...followUp.history, {
              id: createId("activity"),
              action: "cancelled" as const,
              note: note?.trim() || undefined,
              actorId: actorIdRef.current ?? current.preferences.activeVolunteerId,
              createdAt: now,
            }],
          }
          : followUp),
      }, existing.residentId ? "person_follow_up" : "follow_up", followUpId, "follow_up.cancelled", "Follow-up cancelled");
    });
  }, [updateData]);

  const addPersonFollowUp = useCallback((residentId: string, note: string, date: string) => {
    const followUpId = createId("followup");
    updateData((current) => {
      const resident = current.residents.find((item) => item.id === residentId);
      const trimmedNote = note.trim();
      const dueAt = new Date(`${date}T17:00:00`);
      if (!resident || !trimmedNote || trimmedNote.length > current.church.noteCharacterLimit || !date || Number.isNaN(dueAt.getTime())) return current;
      const now = new Date().toISOString();
      const followUp: FollowUp = {
        id: followUpId,
        churchId: current.church.id,
        propertyId: resident.propertyId,
        residentId,
        dueAt: dueAt.toISOString(),
        status: "scheduled",
        note: trimmedNote,
        history: [{
          id: createId("activity"),
          action: "created",
          note: trimmedNote,
          dueAt: dueAt.toISOString(),
          actorId: actorIdRef.current ?? current.preferences.activeVolunteerId,
          createdAt: now,
        }],
        createdAt: now,
      };
      return addAudit({
        ...current,
        followUps: [...current.followUps, followUp],
      }, "person_follow_up", followUpId, "follow_up.created", `Follow-up planned for ${resident.name || "a person"}`);
    });
    return followUpId;
  }, [updateData]);

  const upsertResident = useCallback((propertyId: string, input: ResidentInput, residentId?: string) => {
    const requestedId = residentId ?? createId("resident");
    updateData((current) => {
      const property = current.properties.find((item) => item.id === propertyId);
      if (!property) return current;
      const existing = residentId ? current.residents.find((resident) => resident.id === residentId) : undefined;
      const now = new Date().toISOString();
      const id = existing?.id ?? requestedId;
      const creatorId = existing?.createdByVolunteerId ?? actorIdRef.current ?? current.preferences.activeVolunteerId;
      const resident = {
        id,
        churchId: current.church.id,
        propertyId,
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
      }, "resident", id, existing ? "resident.updated" : "resident.created", `Person record ${existing ? "updated" : "added"} at ${property.address}`);
    });
    return requestedId;
  }, [updateData]);

  const addPersonNote = useCallback((residentId: string, kind: PersonNoteKind, body: string, createdAt?: string) => {
    const noteId = createId("person_note");
    updateData((current) => {
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
    updateData((current) => {
      const note = current.personNotes.find((item) => item.id === noteId);
      if (!note) return current;
      return addAudit({
        ...current,
        personNotes: current.personNotes.filter((item) => item.id !== noteId),
      }, "person_note", noteId, "person_note.deleted", "Person note deleted", "delete");
    });
  }, [updateData]);

  const deleteResident = useCallback((residentId: string) => {
    updateData((current) => {
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
          ].slice(-2000),
        },
      };
    });
  }, [updateData]);

  const updateGuideStep = useCallback((stepId: string, patch: Partial<GuideStep>) => {
    if (supabaseUser && roleRef.current !== "leader") return;
    updateData((current) => addAudit({
      ...current,
      guide: current.guide.map((step) => step.id === stepId ? { ...step, ...patch } : step),
    }, "guide", stepId, "guide.updated", "Conversation guide updated"));
  }, [supabaseUser, updateData]);

  const updateChurch = useCallback((patch: Partial<NeighborWalkData["church"]>) => {
    if (supabaseUser && roleRef.current !== "leader") return;
    updateData((current) => addAudit({
      ...current,
      church: { ...current.church, ...patch },
    }, "settings", current.church.id, "settings.updated", "Church settings updated"));
  }, [supabaseUser, updateData]);

  const addTerritory = useCallback((input: NewTerritoryInput) => {
    const territoryId = createId("territory");
    if (supabaseUser && roleRef.current !== "leader") return territoryId;
    updateData((current) => {
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
    updateData((current) => {
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
    updateData((current) => {
      const territory = current.territories.find((item) => item.id === territoryId);
      const destination = current.territories.find((item) => item.id === destinationTerritoryId);
      if (!territory || !destination || territory.eventId !== destination.eventId) return current;
      const movedLocationCount = current.properties.filter((property) => property.territoryId === territoryId).length;
      const reassigned = deleteTerritoryRecord(current, territoryId, destinationTerritoryId);
      if (reassigned === current) return current;
      const audited = addAudit(reassigned, "territory", territoryId, "territory.deleted", `${territory.name} deleted; ${movedLocationCount} locations moved to ${destination.name}`, "delete");
      return {
        ...audited,
        sync: { ...audited.sync, pending: [...audited.sync.pending, mutation("data", current.church.id)].slice(-2000) },
      };
    });
  }, [supabaseUser, updateData]);

  const addTeam = useCallback((update: TeamUpdate) => {
    const teamId = createId("team");
    if (supabaseUser && roleRef.current !== "leader") return teamId;
    updateData((current) => addAudit({
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

  const updateTeam = useCallback((teamId: string, update: TeamUpdate) => {
    if (supabaseUser && roleRef.current !== "leader") return;
    updateData((current) => addAudit({
      ...current,
      teams: current.teams.map((team) => team.id === teamId
        ? { ...team, name: update.name.trim(), memberIds: [...new Set(update.memberIds)], status: update.status }
        : team),
    }, "team", teamId, "team.updated", `${update.name.trim()} updated`));
  }, [supabaseUser, updateData]);

  const deleteTeam = useCallback((teamId: string) => {
    if (supabaseUser && roleRef.current !== "leader") return;
    updateData((current) => {
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
    if (!supabaseUser || !client || !workspace) writeLocalGuideLibrary(next);
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
    if (!supabaseUser || !client || !workspace) writeLocalGuideLibrary(next);
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
    if (!supabaseUser || !client || !workspace) writeLocalGuideLibrary(next);
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
    if (!supabaseUser || !client || !workspace) writeLocalGuideLibrary(next);
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
    if (supabaseUser && roleRef.current !== "leader") return;
    updateData((current) => {
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
          ].slice(-2000),
        },
      };
    });
  }, [supabaseUser, updateData]);

  const purgeExpired = useCallback(() => {
    if (supabaseUser && roleRef.current !== "leader") return;
    updateData((current) => {
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
          ].slice(-2000),
        },
      };
    });
  }, [supabaseUser, updateData]);

  const runSync = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    let workspace = workspaceRef.current;
    let candidate = dataRef.current;
    if (!candidate || !client || !supabaseUser || !workspace || !onlineRef.current) return false;
    if (!candidate.sync.pending.length) return true;
    setSyncing(true);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const submittedMutationIds = new Set(candidate.sync.pending.map((item) => item.id));
        const submittedUpdatedAt = candidate.updatedAt;
        const syncedAt = new Date().toISOString();
        const submittedData: NeighborWalkData = {
          ...enforceRetention(candidate),
          sync: { ...candidate.sync, mode: "connected", pending: [], lastSyncedAt: syncedAt, lastError: undefined },
        };
        await persistConnectedDiscipleship(client, workspace.churchId, supabaseUser.id, candidate);
        const snapshotData = withoutSnapshotDiscipleship(submittedData);
        const { data: saved, error } = await client
          .from("workspace_snapshots")
          .update({ schema_version: snapshotData.schemaVersion, data: snapshotData as unknown as Json })
          .eq("church_id", workspace.churchId)
          .eq("revision", workspace.revision)
          .select("revision, data, updated_at")
          .maybeSingle();
        if (error) throw error;

        if (saved) {
          const parsedServerData = neighborWalkDataSchema.safeParse(migrateNeighborWalkData(saved.data));
          if (!parsedServerData.success) throw new Error("Sync returned invalid data.");
          const protectedServerData = withAuthenticatedVolunteer({
            ...parsedServerData.data,
            residents: submittedData.residents,
            personNotes: submittedData.personNotes,
          }, workspace);
          const nextConnection = { ...workspace, revision: Number(saved.revision) };
          workspaceRef.current = nextConnection;
          writeWorkspaceConnection(nextConnection);
          setData((current) => {
            if (!current) return current;
            const pending = current.sync.pending.filter((item) => !submittedMutationIds.has(item.id));
            const sync = { ...current.sync, mode: "connected" as const, pending, lastSyncedAt: syncedAt, lastError: undefined };
            const next = current.updatedAt !== submittedUpdatedAt
              ? { ...current, sync }
              : { ...protectedServerData, sync: { ...protectedServerData.sync, ...sync } };
            dataRef.current = next;
            return next;
          });
          autoRetryAttemptRef.current = 0;
          return true;
        }

        if (attempt > 0) throw new Error("Another device is still saving changes.");
        const latestSnapshot = await fetchWorkspaceSnapshot(client, workspace.churchId);
        const parsedLatest = neighborWalkDataSchema.safeParse(migrateNeighborWalkData(latestSnapshot.data));
        if (!parsedLatest.success) throw new Error("The latest church workspace data is invalid.");
        const latestDiscipleship = await loadConnectedDiscipleship(client, workspace.churchId);
        const parsedProtectedLatest = neighborWalkDataSchema.safeParse({
          ...parsedLatest.data,
          residents: latestDiscipleship.residents,
          personNotes: latestDiscipleship.personNotes,
          followUps: [...parsedLatest.data.followUps, ...latestDiscipleship.personFollowUps],
        });
        if (!parsedProtectedLatest.success) throw new Error("The latest protected discipleship records are invalid.");
        const protectedLatest = withAuthenticatedVolunteer(parsedProtectedLatest.data, workspace);
        workspace = { ...workspace, revision: Number(latestSnapshot.revision) };
        workspaceRef.current = workspace;
        writeWorkspaceConnection(workspace);
        candidate = mergePendingWorkspaceChanges(protectedLatest, dataRef.current ?? candidate);
        dataRef.current = candidate;
        setData(candidate);
      }
      return false;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The sync service could not be reached.";
      setData((current) => {
        if (!current) return current;
        const next = {
          ...current,
          sync: {
            ...current.sync,
            lastError: `Changes are safe on this device. Automatic sync will retry. ${detail}`,
          },
        };
        dataRef.current = next;
        return next;
      });
      return false;
    } finally {
      setSyncing(false);
    }
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
    if (!online || workspaceStatus !== "ready" || pendingCount === 0) return;
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
        setAutoRetryTick((current) => current + 1);
      }
    };
    const retryOnFocus = () => setAutoRetryTick((current) => current + 1);
    document.addEventListener("visibilitychange", retryVisibleChanges);
    window.addEventListener("focus", retryOnFocus);
    return () => {
      document.removeEventListener("visibilitychange", retryVisibleChanges);
      window.removeEventListener("focus", retryOnFocus);
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
      addPersonFollowUp,
      upsertResident,
      addPersonNote,
      deletePersonNote,
      deleteResident,
      updateGuideStep,
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
