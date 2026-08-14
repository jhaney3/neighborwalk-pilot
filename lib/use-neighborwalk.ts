"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createId,
  dueDateFromNow,
  enforceRetention,
  neighborWalkDataSchema,
  updateTerritoryRecord,
  type AuditEntry,
  type Coordinates,
  type GuideStep,
  type NeighborWalkData,
  type Outcome,
  type Property,
  type Territory,
  type TerritoryUpdate,
} from "./domain";
import {
  exportNeighborWalkData,
  importNeighborWalkFile,
  loadNeighborWalkData,
  resetNeighborWalkData,
  saveNeighborWalkData,
} from "./storage";
import { getSupabaseBrowserClient, type Json, type NeighborWalkDatabase } from "./supabase";
import { createWorkspaceData } from "./seed";
import { mergePendingWorkspaceChanges } from "./workspace-sync";

export type SupabaseUser = { id: string; email: string };
type WorkspaceStatus = "device_only" | "connecting" | "needs_workspace" | "creating" | "ready";
type WorkspaceConnection = { userId: string; churchId: string; revision: number };
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
    return parsed?.userId === userId && parsed.churchId && Number.isInteger(parsed.revision) ? parsed : null;
  } catch {
    return null;
  }
}

function writeWorkspaceConnection(connection: WorkspaceConnection) {
  window.localStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify(connection));
}

type VisitInput = {
  propertyId: string;
  outcome: Exclude<Outcome, "unvisited">;
  objectiveNote?: string;
  followUpConsent: boolean;
  followUpDate?: string;
  assignedTeamId?: string;
};

type NewPropertyInput = {
  address: string;
  unit?: string;
  coordinates: Coordinates;
  buildingGeometry?: Coordinates[];
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
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveVersion = useRef(0);
  const workspaceRef = useRef<WorkspaceConnection | null>(null);
  const dataRef = useRef<NeighborWalkData | null>(null);
  const onlineRef = useRef(true);
  const syncInFlightRef = useRef<Promise<boolean> | null>(null);
  const autoRetryAttemptRef = useRef(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const loaded = await loadNeighborWalkData();
        if (!active) return;
        const client = getSupabaseBrowserClient();
        if (!supabaseUser || !client) {
          setWorkspaceStatus("device_only");
          setData({ ...loaded, sync: { ...loaded.sync, mode: "device_only" } });
          return;
        }

        setWorkspaceStatus("connecting");
        try {
          const { data: membership, error: membershipError } = await client
            .from("church_memberships")
            .select("church_id, role")
            .eq("user_id", supabaseUser.id)
            .eq("active", true)
            .limit(1)
            .maybeSingle();
          if (!active) return;
          if (membershipError) throw membershipError;
          if (!membership) {
            setWorkspaceStatus("needs_workspace");
            setData({ ...loaded, sync: { ...loaded.sync, mode: "connected", lastError: undefined } });
            return;
          }
          const { data: snapshot, error: snapshotError } = await client
            .from("workspace_snapshots")
            .select("church_id, schema_version, data, revision, updated_at")
            .eq("church_id", membership.church_id)
            .single();
          if (!active) return;
          if (snapshotError) throw snapshotError;
          const parsedRemote = neighborWalkDataSchema.safeParse(snapshot.data);
          if (!parsedRemote.success) throw new Error("The church workspace contains data from an unsupported app version.");
          const cachedForUser = readWorkspaceConnection(supabaseUser.id);
          const connection = { userId: supabaseUser.id, churchId: membership.church_id, revision: Number(snapshot.revision) };
          workspaceRef.current = connection;
          writeWorkspaceConnection(connection);
          const hasLocalChanges = cachedForUser?.churchId === membership.church_id
            && loaded.sync.mode === "connected"
            && loaded.sync.pending.length > 0;
          const selected = hasLocalChanges
            ? mergePendingWorkspaceChanges(parsedRemote.data, loaded)
            : parsedRemote.data;
          setData({
            ...selected,
            sync: {
              ...selected.sync,
              mode: "connected",
              lastError: undefined,
            },
          });
          setWorkspaceStatus("ready");
        } catch (error) {
          if (!active) return;
          const cached = readWorkspaceConnection(supabaseUser.id);
          workspaceRef.current = cached;
          setData({
            ...loaded,
            sync: {
              ...loaded.sync,
              mode: "connected",
              lastError: error instanceof Error ? error.message : "The church workspace could not be reached.",
            },
          });
          setWorkspaceStatus(cached ? "ready" : "needs_workspace");
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
    setSaving(true);
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
      actorId: current.preferences.activeVolunteerId,
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
      if (!property || property.visitCount > 0 || property.currentOutcome === "do_not_visit") return current;
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
      const objectiveNote = input.objectiveNote?.trim() || undefined;
      if (objectiveNote && objectiveNote.length > current.church.noteCharacterLimit) return current;
      if (input.outcome === "follow_up" && current.church.requireFollowUpConsent && !input.followUpConsent) return current;
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
        volunteerId: current.preferences.activeVolunteerId,
        outcome: input.outcome,
        objectiveNote,
        followUpConsent: input.followUpConsent,
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
      if (input.outcome === "follow_up" && input.followUpConsent) {
        nextFollowUps = [...nextFollowUps.map((followUp) => followUp.propertyId === property.id && followUp.status === "scheduled"
          ? { ...followUp, status: "cancelled" as const }
          : followUp), {
          id: createId("followup"),
          churchId: current.church.id,
          propertyId: property.id,
          sourceVisitId: visitId,
          assignedTeamId: input.assignedTeamId,
          dueAt: input.followUpDate
            ? new Date(`${input.followUpDate}T17:00:00`).toISOString()
            : dueDateFromNow(current.church.defaultFollowUpDays),
          status: "scheduled" as const,
          note: objectiveNote,
          createdAt: now,
        }];
      }
      if (input.outcome === "do_not_visit") {
        nextFollowUps = nextFollowUps.map((followUp) => followUp.propertyId === property.id && followUp.status === "scheduled"
          ? { ...followUp, status: "cancelled" as const }
          : followUp);
      }
      return addAudit({
        ...current,
        properties: nextProperties,
        visits: [visit, ...current.visits],
        followUps: nextFollowUps,
      }, "visit", visitId, "visit.recorded", `${input.outcome.replaceAll("_", " ")} recorded at ${property.address}`);
    });
  }, [updateData]);

  const completeFollowUp = useCallback((followUpId: string) => {
    updateData((current) => {
      if (!current.followUps.some((followUp) => followUp.id === followUpId && followUp.status === "scheduled")) return current;
      return addAudit({
        ...current,
        followUps: current.followUps.map((followUp) => followUp.id === followUpId
          ? { ...followUp, status: "completed", completedAt: new Date().toISOString() }
          : followUp),
      }, "follow_up", followUpId, "follow_up.completed", "Follow-up marked complete");
    });
  }, [updateData]);

  const rescheduleFollowUp = useCallback((followUpId: string, date: string) => {
    updateData((current) => {
      const dueAt = new Date(`${date}T17:00:00`);
      if (!date || Number.isNaN(dueAt.getTime()) || !current.followUps.some((followUp) => followUp.id === followUpId && followUp.status === "scheduled")) return current;
      return addAudit({
        ...current,
        followUps: current.followUps.map((followUp) => followUp.id === followUpId && followUp.status === "scheduled"
          ? { ...followUp, dueAt: dueAt.toISOString() }
          : followUp),
      }, "follow_up", followUpId, "follow_up.rescheduled", "Follow-up date changed");
    });
  }, [updateData]);

  const cancelFollowUp = useCallback((followUpId: string) => {
    updateData((current) => {
      if (!current.followUps.some((followUp) => followUp.id === followUpId && followUp.status === "scheduled")) return current;
      return addAudit({
        ...current,
        followUps: current.followUps.map((followUp) => followUp.id === followUpId
          ? { ...followUp, status: "cancelled" }
          : followUp),
      }, "follow_up", followUpId, "follow_up.cancelled", "Follow-up cancelled");
    });
  }, [updateData]);

  const updateGuideStep = useCallback((stepId: string, patch: Partial<GuideStep>) => {
    updateData((current) => addAudit({
      ...current,
      guide: current.guide.map((step) => step.id === stepId ? { ...step, ...patch } : step),
    }, "guide", stepId, "guide.updated", "Conversation guide updated"));
  }, [updateData]);

  const updateChurch = useCallback((patch: Partial<NeighborWalkData["church"]>) => {
    updateData((current) => addAudit({
      ...current,
      church: { ...current.church, ...patch },
    }, "settings", current.church.id, "settings.updated", "Church settings updated"));
  }, [updateData]);

  const addTerritory = useCallback((input: NewTerritoryInput) => {
    const territoryId = createId("territory");
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
  }, [updateData]);

  const updateTerritory = useCallback((territoryId: string, update: TerritoryUpdate) => {
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
  }, [updateData]);

  const downloadBackup = useCallback(() => {
    if (!data) return;
    const blob = exportNeighborWalkData(data);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `neighborwalk-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [data]);

  const importBackup = useCallback(async (file: File) => {
    const imported = await importNeighborWalkFile(file);
    const connected = Boolean(supabaseUser && getSupabaseBrowserClient());
    const next = {
      ...imported,
      sync: {
        ...imported.sync,
        mode: connected ? "connected" as const : "device_only" as const,
        pending: connected ? [mutation("data", imported.church.id)] : imported.sync.pending,
      },
    };
    setData(next);
    return next;
  }, [supabaseUser]);

  const resetDemo = useCallback(async () => {
    const reset = await resetNeighborWalkData();
    const connected = Boolean(supabaseUser && getSupabaseBrowserClient());
    const next = connected ? {
      ...reset,
      sync: { ...reset.sync, mode: "connected" as const, pending: [mutation("data", reset.church.id)] },
    } : reset;
    setData(next);
    return next;
  }, [supabaseUser]);

  const purgeExpired = useCallback(() => {
    updateData((current) => {
      const before = current.visits.length;
      const retained = enforceRetention(current);
      return addAudit(retained, "data", current.church.id, "data.retention_run", `${before - retained.visits.length} expired visit records removed`);
    });
  }, [updateData]);

  const createWorkspace = useCallback(async (churchName: string, includeDeviceData = false) => {
    const client = getSupabaseBrowserClient();
    if (!client || !supabaseUser || !data || !online) return false;
    setWorkspaceStatus("creating");
    setSaving(true);
    try {
      const sourceData = includeDeviceData ? data : createWorkspaceData(churchName, supabaseUser);
      const initialData: NeighborWalkData = {
        ...sourceData,
        church: { ...sourceData.church, name: churchName.trim() },
        sync: { ...sourceData.sync, mode: "connected", pending: [], lastError: undefined },
        updatedAt: new Date().toISOString(),
      };
      const { data: created, error } = await client.rpc("create_church_workspace", {
        workspace_name: initialData.church.name,
        initial_data: initialData as unknown as Json,
        initial_schema_version: initialData.schemaVersion,
      });
      if (error) throw error;
      const workspace = created?.[0];
      if (!workspace) throw new Error("The church workspace was not created.");
      const parsed = neighborWalkDataSchema.safeParse(workspace.data);
      if (!parsed.success) throw new Error("The church workspace returned invalid data.");
      const connection = { userId: supabaseUser.id, churchId: workspace.church_id, revision: Number(workspace.revision) };
      workspaceRef.current = connection;
      writeWorkspaceConnection(connection);
      setData({ ...parsed.data, sync: { ...parsed.data.sync, mode: "connected", pending: [], lastSyncedAt: new Date().toISOString(), lastError: undefined } });
      setWorkspaceStatus("ready");
      return true;
    } catch (error) {
      setData((current) => current ? { ...current, sync: { ...current.sync, mode: "connected", lastError: error instanceof Error ? error.message : "The church workspace could not be created." } } : current);
      setWorkspaceStatus("needs_workspace");
      return false;
    } finally {
      setSaving(false);
    }
  }, [data, online, supabaseUser]);

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
        const { data: saved, error } = await client
          .from("workspace_snapshots")
          .update({ schema_version: submittedData.schemaVersion, data: submittedData as unknown as Json })
          .eq("church_id", workspace.churchId)
          .eq("revision", workspace.revision)
          .select("revision, data, updated_at")
          .maybeSingle();
        if (error) throw error;

        if (saved) {
          const parsedServerData = neighborWalkDataSchema.safeParse(saved.data);
          if (!parsedServerData.success) throw new Error("Sync returned invalid data.");
          const nextConnection = { ...workspace, revision: Number(saved.revision) };
          workspaceRef.current = nextConnection;
          writeWorkspaceConnection(nextConnection);
          setData((current) => {
            if (!current) return current;
            const pending = current.sync.pending.filter((item) => !submittedMutationIds.has(item.id));
            const sync = { ...current.sync, mode: "connected" as const, pending, lastSyncedAt: syncedAt, lastError: undefined };
            const next = current.updatedAt !== submittedUpdatedAt
              ? { ...current, sync }
              : { ...parsedServerData.data, sync: { ...parsedServerData.data.sync, ...sync } };
            dataRef.current = next;
            return next;
          });
          autoRetryAttemptRef.current = 0;
          return true;
        }

        if (attempt > 0) throw new Error("Another device is still saving changes.");
        const latestSnapshot = await fetchWorkspaceSnapshot(client, workspace.churchId);
        const parsedLatest = neighborWalkDataSchema.safeParse(latestSnapshot.data);
        if (!parsedLatest.success) throw new Error("The latest church workspace data is invalid.");
        workspace = { ...workspace, revision: Number(latestSnapshot.revision) };
        workspaceRef.current = workspace;
        writeWorkspaceConnection(workspace);
        candidate = mergePendingWorkspaceChanges(parsedLatest.data, dataRef.current ?? candidate);
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
  const activeVolunteer = useMemo(() => data?.volunteers.find((volunteer) => volunteer.id === data.preferences.activeVolunteerId) ?? null, [data]);

  return {
    data,
    loading,
    storageError,
    online,
    saving,
    syncing,
    workspaceStatus,
    activeTerritory,
    activeVolunteer,
    actions: {
      updateData,
      setPreference,
      selectTerritory,
      addProperty,
      updateProperty,
      deleteProperty,
      recordVisit,
      completeFollowUp,
      rescheduleFollowUp,
      cancelFollowUp,
      updateGuideStep,
      updateChurch,
      addTerritory,
      updateTerritory,
      downloadBackup,
      importBackup,
      resetDemo,
      purgeExpired,
      createWorkspace,
      syncNow,
    },
  };
}
