import { describe, expect, it } from "vitest";
import {
  APP_SCHEMA_VERSION,
  centerForBoundary,
  deleteTeamRecord,
  deleteTerritoryRecord,
  enforceRetention,
  formatPhoneNumber,
  isFollowUpOverdue,
  isSafeWebUrl,
  neighborWalkDataSchema,
  updateTerritoryRecord,
  visitsForProperty,
} from "../lib/domain";
import type { ParcelFeatureCollection } from "../lib/parcels";
import { coverageForTerritory } from "../lib/territory-coverage";
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

  it("removes legacy approval fields without losing version 6 records", () => {
    const current = createSeedData();
    const timestamp = "2026-08-22T12:00:00.000Z";
    const legacyResident = {
      id: "resident_legacy",
      churchId: current.church.id,
      propertyId: current.properties[0].id,
      name: "Neighbor",
      faithStatus: "not_discussed" as const,
      phone: "5550100142",
      preferredContact: "text" as const,
      consentToStore: true,
      consentToContact: true,
      consentRecordedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const legacy = {
      ...current,
      schemaVersion: 6,
      church: { ...current.church, requireFollowUpConsent: true },
      visits: current.visits.map((visit) => ({ ...visit, followUpConsent: visit.outcome === "follow_up" })),
      residents: [legacyResident],
    };

    const migrated = neighborWalkDataSchema.parse(migrateNeighborWalkData(legacy));

    expect(migrated.schemaVersion).toBe(APP_SCHEMA_VERSION);
    expect(migrated.visits).toHaveLength(current.visits.length);
    expect(migrated.followUps).toHaveLength(current.followUps.length);
    expect(migrated.residents).toHaveLength(1);
    expect(migrated.residents[0]).toMatchObject({ name: "Neighbor", phone: "5550100142" });
    expect(migrated.church).not.toHaveProperty("requireFollowUpConsent");
    expect(migrated.visits[0]).not.toHaveProperty("followUpConsent");
    expect(migrated.residents[0]).not.toHaveProperty("consentToStore");
    expect(migrated.residents[0]).not.toHaveProperty("consentToContact");
    expect(migrated.residents[0]).not.toHaveProperty("consentRecordedAt");
  });

  it("stores contact details without in-app approval fields", () => {
    const data = createSeedData();
    const resident = {
      id: "resident_test",
      churchId: data.church.id,
      propertyId: data.properties[0].id,
      name: "Shared voluntarily",
      faithStatus: "exploring" as const,
      phone: "555-0100",
      preferredContact: "text" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(neighborWalkDataSchema.safeParse({ ...data, residents: [resident] }).success).toBe(true);
  });

  it("formats stored phone numbers consistently for display", () => {
    expect(formatPhoneNumber("5550100142")).toBe("(555) 010-0142");
    expect(formatPhoneNumber("555.010.0142")).toBe("(555) 010-0142");
    expect(formatPhoneNumber("1-555-010-0142")).toBe("+1 (555) 010-0142");
    expect(formatPhoneNumber("5550100 x24")).toBe("555-0100 ext. 24");
    expect(formatPhoneNumber("+44 20 7946 0958")).toBe("+44 20 7946 0958");
  });

  it("calculates territory coverage from the current state", () => {
    const data = createSeedData();
    const territory = data.territories[0];
    const properties = data.properties.filter((property) => property.territoryId === territory.id);
    const touched = properties.filter((property) => property.currentOutcome !== "unvisited").length;
    expect(coverageForTerritory(data, territory.id)).toEqual({
      total: properties.length,
      touched,
      remaining: properties.length - touched,
      percent: properties.length ? Math.round((touched / properties.length) * 100) : 0,
      basis: "mapped_locations",
    });
  });

  it("measures coverage against residential parcels and counts no-answer visits as touched", () => {
    const seed = createSeedData();
    const territory = {
      ...seed.territories[0],
      id: "territory_parcel_coverage",
      boundary: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][],
      center: [0.5, 0.5] as [number, number],
    };
    const properties = [
      {
        ...seed.properties[0],
        territoryId: territory.id,
        coordinates: [0.25, 0.25] as [number, number],
        currentOutcome: "no_answer" as const,
        parcel: { countyFips: "47099", gislink: "RES-TOUCHED" },
      },
      {
        ...seed.properties[1],
        territoryId: territory.id,
        coordinates: [0.75, 0.75] as [number, number],
        currentOutcome: "unvisited" as const,
        parcel: { countyFips: "47099", gislink: "RES-OPEN" },
      },
    ];
    const parcel = (id: number, gislink: string, isResidential: boolean, offset: number) => ({
      type: "Feature" as const,
      id,
      properties: {
        id,
        countyFips: "47099",
        gislink,
        situsAddress: null,
        propertyClass: null,
        landUse: null,
        isResidential,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [[
          [offset, offset],
          [offset + 0.1, offset],
          [offset + 0.1, offset + 0.1],
          [offset, offset + 0.1],
          [offset, offset],
        ]],
      },
    });
    const parcels: ParcelFeatureCollection = {
      type: "FeatureCollection",
      features: [
        parcel(1, "RES-TOUCHED", true, 0.2),
        parcel(2, "RES-OPEN", true, 0.7),
        parcel(3, "COMMERCIAL", false, 0.4),
        parcel(4, "OUTSIDE", true, 1.1),
      ],
    };
    const data = { ...seed, territories: [territory], properties };

    expect(coverageForTerritory(data, territory.id, parcels)).toEqual({
      total: 2,
      touched: 1,
      remaining: 1,
      percent: 50,
      basis: "residential_parcels",
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
