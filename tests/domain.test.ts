import { describe, expect, it } from "vitest";
import {
  APP_SCHEMA_VERSION,
  coverageForTerritory,
  enforceRetention,
  isFollowUpOverdue,
  isSafeWebUrl,
  neighborWalkDataSchema,
  visitsForProperty,
} from "../lib/domain";
import { createSeedData } from "../lib/seed";
import { withSecurityHeaders } from "../lib/security-headers";

describe("NeighborWalk domain", () => {
  it("ships valid fictional starter data", () => {
    const data = createSeedData();
    expect(neighborWalkDataSchema.safeParse(data).success).toBe(true);
    expect(data.schemaVersion).toBe(APP_SCHEMA_VERSION);
    expect(data.properties.length).toBeGreaterThan(10);
    expect(JSON.stringify(data)).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
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
    expect(secured.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(secured.headers.get("permissions-policy")).toContain("geolocation=(self)");
    expect(await secured.text()).toBe("ok");
  });
});
