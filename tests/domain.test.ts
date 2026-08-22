import { describe, expect, it } from "vitest";
import {
  APP_SCHEMA_VERSION,
  centerForBoundary,
  coverageForTerritory,
  deleteTeamRecord,
  deleteTerritoryRecord,
  enforceRetention,
  isFollowUpOverdue,
  isSafeWebUrl,
  neighborWalkDataSchema,
  updateTerritoryRecord,
  visitsForProperty,
} from "../lib/domain";
import { createSeedData, createWorkspaceData } from "../lib/seed";
import { withSecurityHeaders } from "../lib/security-headers";
import { mapTilerStyleUrlForKey } from "../lib/map-config";
import { migrateNeighborWalkData } from "../lib/storage";

describe("NeighborWalk domain", () => {
  it("builds a MapTiler style URL only from a configured key", () => {
    expect(mapTilerStyleUrlForKey(undefined)).toBeNull();
    expect(mapTilerStyleUrlForKey("PASTE_YOUR_MAPTILER_KEY_HERE")).toBeNull();
    expect(mapTilerStyleUrlForKey("  a-valid-public-key  ")).toBe(
      "https://api.maptiler.com/maps/streets-v4/style.json?key=a-valid-public-key",
    );
  });

  it("ships valid fictional starter data", () => {
    const data = createSeedData();
    expect(neighborWalkDataSchema.safeParse(data).success).toBe(true);
    expect(data.schemaVersion).toBe(APP_SCHEMA_VERSION);
    expect(data.properties.length).toBeGreaterThan(10);
    expect(JSON.stringify(data)).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it("creates a clean, valid Lawrenceburg workspace for a signed-in leader", () => {
    const data = createWorkspaceData("First Baptist Church", {
      id: "fc77fe56-7784-4b60-9be8-3005bb250c6b",
      email: "erica@example.org",
    });
    expect(neighborWalkDataSchema.safeParse(data).success).toBe(true);
    expect(data.church.name).toBe("First Baptist Church");
    expect(data.territories[0].center).toEqual([-87.3347, 35.2423]);
    expect(data.properties).toHaveLength(0);
    expect(data.visits).toHaveLength(0);
    expect(data.residents).toHaveLength(0);
    expect(data.volunteers[0]).toMatchObject({ email: "erica@example.org", role: "leader" });
  });

  it("migrates version 5 snapshots without losing existing follow-ups", () => {
    const current = createSeedData();
    const legacy = {
      ...current,
      schemaVersion: 5,
      residents: undefined,
      followUps: current.followUps.map((followUp) => {
        const legacyFollowUp: Record<string, unknown> = { ...followUp };
        delete legacyFollowUp.history;
        return legacyFollowUp;
      }),
    };
    const migrated = migrateNeighborWalkData(legacy);
    const parsed = neighborWalkDataSchema.safeParse(migrated);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.residents).toEqual([]);
    expect(parsed.data.followUps).toHaveLength(current.followUps.length);
    expect(parsed.data.followUps.every((followUp) => Array.isArray(followUp.history))).toBe(true);
  });

  it("requires separate contact permission for resident contact details", () => {
    const data = createSeedData();
    const resident = {
      id: "resident_test",
      churchId: data.church.id,
      propertyId: data.properties[0].id,
      name: "Shared voluntarily",
      faithStatus: "exploring" as const,
      phone: "555-0100",
      preferredContact: "text" as const,
      consentToStore: true as const,
      consentToContact: false,
      consentRecordedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(neighborWalkDataSchema.safeParse({ ...data, residents: [resident] }).success).toBe(false);
    expect(neighborWalkDataSchema.safeParse({
      ...data,
      residents: [{ ...resident, consentToContact: true }],
    }).success).toBe(true);
  });

  it("calculates territory coverage from the current state", () => {
    const data = createSeedData();
    const territory = data.territories[0];
    const properties = data.properties.filter((property) => property.territoryId === territory.id);
    const visited = properties.filter((property) => property.currentOutcome !== "unvisited").length;
    expect(coverageForTerritory(data, territory.id)).toEqual({
      total: properties.length,
      visited,
      remaining: properties.length - visited,
      percent: properties.length ? Math.round((visited / properties.length) * 100) : 0,
    });
  });

  it("edits a territory without changing its locations or history", () => {
    const data = createSeedData();
    const territory = data.territories[0];
    const nextTeam = data.teams.find((team) => team.id !== territory.assignedTeamId);
    const replacementBoundary = territory.boundary.map(([longitude, latitude], index) => [
      longitude + (index % 2 ? 0.001 : -0.001),
      latitude + 0.001,
    ] as [number, number]);
    const updated = updateTerritoryRecord(data, territory.id, {
      name: "  Oakwood Updated  ",
      color: "#245f78",
      assignedTeamId: nextTeam?.id,
      boundary: replacementBoundary,
      center: centerForBoundary(replacementBoundary),
    });

    expect(updated.territories.find((item) => item.id === territory.id)).toMatchObject({
      id: territory.id,
      name: "Oakwood Updated",
      color: "#245f78",
      assignedTeamId: nextTeam?.id,
      boundary: replacementBoundary,
    });
    expect(updated.teams.find((team) => team.id === territory.assignedTeamId)?.territoryIds).not.toContain(territory.id);
    expect(updated.teams.find((team) => team.id === nextTeam?.id)?.territoryIds).toContain(territory.id);
    expect(updated.properties).toEqual(data.properties);
    expect(updated.visits).toEqual(data.visits);
    expect(neighborWalkDataSchema.safeParse(updated).success).toBe(true);
  });

  it("deletes a territory by moving its records to another territory", () => {
    const data = createSeedData();
    const territory = data.territories[0];
    const destination = data.territories.find((item) => item.id !== territory.id && item.eventId === territory.eventId)!;
    const property = data.properties.find((item) => item.territoryId === territory.id)!;
    const timestamp = "2026-08-12T16:00:00.000Z";
    const resident = {
      id: "resident_preserved",
      churchId: data.church.id,
      propertyId: property.id,
      name: "Shared voluntarily",
      faithStatus: "exploring" as const,
      preferredContact: "none" as const,
      consentToStore: true as const,
      consentToContact: false,
      consentRecordedAt: timestamp,
      notes: "Requested information about service times.",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const current = { ...data, residents: [resident] };
    const propertyIds = current.properties.map((item) => item.id);
    const visitIds = current.visits.map((item) => item.id);
    const followUpIds = current.followUps.map((item) => item.id);

    const deleted = deleteTerritoryRecord(current, territory.id, destination.id);

    expect(deleted.territories.some((item) => item.id === territory.id)).toBe(false);
    expect(deleted.properties.map((item) => item.id)).toEqual(propertyIds);
    expect(deleted.visits.map((item) => item.id)).toEqual(visitIds);
    expect(deleted.followUps.map((item) => item.id)).toEqual(followUpIds);
    expect(deleted.residents).toEqual([resident]);
    expect(deleted.properties.filter((item) => item.territoryId === destination.id).length)
      .toBeGreaterThan(data.properties.filter((item) => item.territoryId === destination.id).length);
    expect(deleted.visits.some((visit) => visit.territoryId === territory.id)).toBe(false);
    expect(deleted.teams.every((team) => !team.territoryIds.includes(territory.id))).toBe(true);
    expect(deleted.preferences.activeTerritoryId).toBe(destination.id);
    expect(neighborWalkDataSchema.safeParse(deleted).success).toBe(true);
  });

  it("deletes a team and leaves its territory and follow-up assignments unassigned", () => {
    const data = createSeedData();
    const team = data.teams.find((item) => data.territories.some((territory) => territory.assignedTeamId === item.id))!;
    const assignedTerritoryIds = data.territories.filter((territory) => territory.assignedTeamId === team.id).map((territory) => territory.id);
    const assignedFollowUpIds = data.followUps.filter((followUp) => followUp.assignedTeamId === team.id).map((followUp) => followUp.id);

    const deleted = deleteTeamRecord(data, team.id);

    expect(deleted.teams.some((item) => item.id === team.id)).toBe(false);
    expect(deleted.territories.filter((territory) => assignedTerritoryIds.includes(territory.id)).every((territory) => territory.assignedTeamId === undefined)).toBe(true);
    expect(deleted.followUps.filter((followUp) => assignedFollowUpIds.includes(followUp.id)).every((followUp) => followUp.assignedTeamId === undefined)).toBe(true);
    expect(deleted.properties).toEqual(data.properties);
    expect(deleted.visits).toEqual(data.visits);
    expect(deleted.residents).toEqual(data.residents);
    expect(neighborWalkDataSchema.safeParse(deleted).success).toBe(true);
  });

  it("sorts property history newest first", () => {
    const data = createSeedData();
    const propertyId = data.visits[0].propertyId;
    const visits = visitsForProperty(data, propertyId);
    expect(visits.every((visit) => visit.propertyId === propertyId)).toBe(true);
    expect(visits.map((visit) => visit.recordedAt)).toEqual(
      [...visits].map((visit) => visit.recordedAt).sort().reverse(),
    );
  });

  it("expires ordinary history while preserving do-not-visit and active follow-up records", () => {
    const data = createSeedData();
    const now = new Date("2026-08-12T12:00:00.000Z");
    const old = "2020-01-01T12:00:00.000Z";
    const doNotVisit = data.visits.find((visit) => visit.outcome === "do_not_visit");
    const scheduled = data.followUps.find((followUp) => followUp.status === "scheduled");
    expect(doNotVisit).toBeDefined();
    expect(scheduled).toBeDefined();

    const aged = {
      ...data,
      church: { ...data.church, retentionDays: 90 },
      visits: data.visits.map((visit) => ({ ...visit, recordedAt: old })),
      properties: data.properties.map((property) => property.currentOutcome === "do_not_visit"
        ? property
        : { ...property, lastVisitedAt: old }),
      audit: data.audit.map((entry) => ({ ...entry, createdAt: old })),
    };
    const retained = enforceRetention(aged, now);

    expect(retained.visits.some((visit) => visit.id === doNotVisit?.id)).toBe(true);
    expect(retained.visits.some((visit) => visit.id === scheduled?.sourceVisitId)).toBe(true);
    expect(retained.audit).toHaveLength(0);
    const expiredProperty = retained.properties.find((property) =>
      property.currentOutcome === "unvisited" && property.lastVisitedAt === undefined,
    );
    expect(expiredProperty).toBeDefined();
  });

  it("rejects unsafe configuration and recognizes overdue work", () => {
    const data = createSeedData();
    expect(neighborWalkDataSchema.safeParse({
      ...data,
      preferences: { ...data.preferences, mapStyleUrl: "javascript:alert(1)" },
    }).success).toBe(false);
    expect(isSafeWebUrl("http://maps.example.org/style.json")).toBe(false);
    expect(isSafeWebUrl("http://localhost:8080/style.json")).toBe(true);
    expect(isSafeWebUrl("https://maps.example.org/style.json")).toBe(true);
    expect(neighborWalkDataSchema.safeParse({ ...data, schemaVersion: APP_SCHEMA_VERSION + 1 }).success).toBe(false);
    expect(isFollowUpOverdue({
      ...data.followUps[0],
      status: "scheduled",
      dueAt: "2026-01-01T12:00:00.000Z",
    }, new Date("2026-08-12T12:00:00.000Z"))).toBe(true);
  });
});

describe("response hardening", () => {
  it("adds privacy and framing protections without dropping response metadata", async () => {
    const original = new Response("ok", {
      status: 201,
      headers: { "content-type": "text/plain", "x-existing": "kept" },
    });
    const secured = withSecurityHeaders(original);

    expect(secured.status).toBe(201);
    expect(secured.headers.get("x-existing")).toBe("kept");
    expect(secured.headers.get("x-content-type-options")).toBe("nosniff");
    expect(secured.headers.get("x-frame-options")).toBe("DENY");
    expect(secured.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(secured.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(secured.headers.get("permissions-policy")).toContain("geolocation=(self)");
    expect(await secured.text()).toBe("ok");
  });
});
