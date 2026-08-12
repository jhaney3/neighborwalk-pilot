"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createId,
  dueDateFromNow,
  enforceRetention,
  neighborWalkDataSchema,
  type AuditEntry,
  type Coordinates,
  type GuideStep,
  type NeighborWalkData,
  type Outcome,
  type Property,
  type Territory,
} from "./domain";
import {
  exportNeighborWalkData,
  importNeighborWalkFile,
  loadNeighborWalkData,
  resetNeighborWalkData,
  saveNeighborWalkData,
} from "./storage";

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

export function useNeighborWalk() {
  const [data, setData] = useState<NeighborWalkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveVersion = useRef(0);

  useEffect(() => {
    let active = true;
    loadNeighborWalkData()
      .then((loaded) => {
        if (active) {
          const mode = process.env.NEXT_PUBLIC_API_BASE_URL ? "connected" : "device_only";
          setData({ ...loaded, sync: { ...loaded.sync, mode } });
        }
      })
      .catch((error: unknown) => {
        if (active) setStorageError(error instanceof Error ? error.message : "Could not open device storage.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

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
      };
      return addAudit({
        ...current,
        territories: [...current.territories, territory],
        preferences: { ...current.preferences, activeTerritoryId: territoryId },
      }, "territory", territoryId, "territory.created", `${territory.name} created`);
    });
    return territoryId;
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
    setData(imported);
    return imported;
  }, []);

  const resetDemo = useCallback(async () => {
    const reset = await resetNeighborWalkData();
    setData(reset);
    return reset;
  }, []);

  const purgeExpired = useCallback(() => {
    updateData((current) => {
      const before = current.visits.length;
      const retained = enforceRetention(current);
      return addAudit(retained, "data", current.church.id, "data.retention_run", `${before - retained.visits.length} expired visit records removed`);
    });
  }, [updateData]);

  const syncNow = useCallback(async () => {
    if (!data || !process.env.NEXT_PUBLIC_API_BASE_URL || !online) return false;
    const submittedMutationIds = new Set(data.sync.pending.map((item) => item.id));
    const submittedUpdatedAt = data.updatedAt;
    setSaving(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, "")}/v1/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ schemaVersion: data.schemaVersion, mutations: data.sync.pending, snapshot: data }),
      });
      if (!response.ok) throw new Error(`Sync failed (${response.status})`);
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > 10 * 1024 * 1024) throw new Error("Sync response was too large");
      const responseText = await response.text();
      if (responseText.length > 10 * 1024 * 1024) throw new Error("Sync response was too large");
      const result = JSON.parse(responseText) as { data?: unknown };
      const parsedServerData = result.data === undefined ? null : neighborWalkDataSchema.safeParse(result.data);
      if (parsedServerData && !parsedServerData.success) throw new Error("Sync returned invalid data");
      const syncedAt = new Date().toISOString();
      setData((current) => {
        if (!current) return current;
        const pending = current.sync.pending.filter((item) => !submittedMutationIds.has(item.id));
        const sync = { ...current.sync, mode: "connected" as const, pending, lastSyncedAt: syncedAt, lastError: undefined };
        if (current.updatedAt !== submittedUpdatedAt || !parsedServerData?.success) return { ...current, sync };
        return { ...parsedServerData.data, sync: { ...parsedServerData.data.sync, ...sync } };
      });
      return true;
    } catch (error) {
      setData((current) => current ? { ...current, sync: { ...current.sync, lastError: error instanceof Error ? error.message : "Sync failed" } } : current);
      return false;
    } finally {
      setSaving(false);
    }
  }, [data, online]);

  const activeTerritory = useMemo(() => data?.territories.find((territory) => territory.id === data.preferences.activeTerritoryId) ?? null, [data]);
  const activeVolunteer = useMemo(() => data?.volunteers.find((volunteer) => volunteer.id === data.preferences.activeVolunteerId) ?? null, [data]);

  return {
    data,
    loading,
    storageError,
    online,
    saving,
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
      downloadBackup,
      importBackup,
      resetDemo,
      purgeExpired,
      syncNow,
    },
  };
}
