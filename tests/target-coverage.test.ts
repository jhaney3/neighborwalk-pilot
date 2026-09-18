import { describe, expect, it } from "vitest";
import type { Property, Visit } from "../lib/domain";
import { parentZoneCoverage, propertyInTarget, targetCoverage } from "../lib/target-coverage";
import type { WalkTarget, WalkTargetParcel } from "../lib/walk-targets";

const recordedAt = "2026-09-12T18:00:00.000Z";

function parcel(countyFips: string, gislink: string): WalkTargetParcel {
  return { countyFips, gislink, datasetRevision: "overture-2026-09-12", inclusionSource: "polygon_auto" } as WalkTargetParcel;
}

function target(parcels: WalkTargetParcel[], overrides: Partial<WalkTarget> = {}): WalkTarget {
  return {
    id: "target-one",
    churchId: "church-one",
    eventId: "outing-one",
    territoryId: "zone-one",
    name: "Target one",
    color: "#286c59",
    selectionKind: "polygon",
    geometry: { type: "Polygon", coordinates: [[[-87, 35], [-86.9, 35], [-86.9, 35.1], [-87, 35]]] },
    parcels,
    rosterState: "frozen",
    frozenAt: recordedAt,
    ...overrides,
  };
}

function visit(targetParcel: { countyFips: string; gislink: string } | undefined, overrides: Partial<Visit> = {}): Visit {
  return {
    id: "visit-one",
    churchId: "church-one",
    eventId: "outing-one",
    territoryId: "zone-one",
    targetId: "target-one",
    targetParcel,
    propertyId: "property-one",
    volunteerId: "volunteer-one",
    outcome: "conversation",
    recordedAt,
    deviceId: "device-one",
    ...overrides,
  };
}

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: "property-one",
    churchId: "church-one",
    territoryId: "zone-one",
    address: "101 Main Street",
    currentOutcome: "conversation",
    visitCount: 1,
    createdAt: recordedAt,
    updatedAt: recordedAt,
    source: "map",
    parcel: { countyFips: "47055", gislink: "parcel-one" },
    ...overrides,
  };
}

describe("nightly target coverage", () => {
  it("deduplicates exact parcel identities while keeping equal GISLINKs in different counties distinct", () => {
    const giles = parcel("47055", "shared-gislink");
    const lawrence = parcel("47099", "shared-gislink");
    const walkTarget = target([giles, { ...giles }, lawrence]);
    const visits = [
      visit(giles, { id: "giles-first" }),
      visit(giles, { id: "giles-repeat" }),
      visit(lawrence, { id: "lawrence-first" }),
    ];

    expect(targetCoverage({ visits }, walkTarget)).toEqual({ total: 2, touched: 2, remaining: 0, percent: 100, complete: true });
  });

  it("counts an apartment parcel once across multiple units and repeated encounters", () => {
    const apartment = parcel("47101", "apartment-parcel");
    const visits = [
      visit(apartment, { id: "unit-a-first", propertyId: "unit-a" }),
      visit(apartment, { id: "unit-a-repeat", propertyId: "unit-a" }),
      visit(apartment, { id: "unit-b-first", propertyId: "unit-b" }),
    ];

    expect(targetCoverage({ visits }, target([apartment]))).toEqual({ total: 1, touched: 1, remaining: 0, percent: 100, complete: true });
  });

  it("isolates encounters by both target and outing", () => {
    const counted = parcel("47055", "counted");
    const wrongTarget = parcel("47055", "wrong-target");
    const wrongOuting = parcel("47055", "wrong-outing");
    const visits = [
      visit(counted, { id: "counted" }),
      visit(wrongTarget, { id: "other-target", targetId: "target-two" }),
      visit(wrongOuting, { id: "other-outing", eventId: "outing-two" }),
    ];

    expect(targetCoverage({ visits }, target([counted, wrongTarget, wrongOuting]))).toEqual({ total: 3, touched: 1, remaining: 2, percent: 33, complete: true });
  });

  it("uses the latest correction and excludes encounters corrected as void", () => {
    const voided = parcel("47055", "voided");
    const restored = parcel("47055", "restored");
    const correction = { id: "review-one", actorId: "leader-one", createdAt: recordedAt, reason: "Correct fictional record", outcome: "conversation" as const, context: "door" as const, voided: true };
    const visits = [
      visit(voided, { id: "voided", corrections: [correction] }),
      visit(restored, { id: "restored", corrections: [correction, { ...correction, id: "review-two", voided: false }] }),
    ];

    expect(targetCoverage({ visits }, target([voided, restored]))).toEqual({ total: 2, touched: 1, remaining: 1, percent: 50, complete: true });
  });

  it("uses the encounter parcel snapshot after its property moves to another parcel and zone", () => {
    const originalParcel = parcel("47055", "original-parcel");
    const movedProperty = property({
      territoryId: "zone-two",
      parcel: { countyFips: "47099", gislink: "replacement-parcel" },
    });
    const visits = [visit(originalParcel, { propertyId: movedProperty.id })];

    expect(propertyInTarget(movedProperty, target([originalParcel]))).toBe(false);
    expect(targetCoverage({ visits }, target([originalParcel]))).toMatchObject({ total: 1, touched: 1, percent: 100 });
    expect(parentZoneCoverage({ visits, properties: [movedProperty] }, "zone-one", { parcels: [originalParcel], complete: true }, "outing-one"))
      .toEqual({ total: 1, touched: 1, remaining: 0, percent: 100, complete: true });
  });

  it("does not turn a finished target into manufactured full coverage", () => {
    const reached = parcel("47181", "reached");
    const untouched = parcel("47181", "untouched");
    const finished = target([reached, untouched], { finishedAt: "2026-09-12T20:00:00.000Z" });

    expect(targetCoverage({ visits: [visit(reached)] }, finished)).toEqual({ total: 2, touched: 1, remaining: 1, percent: 50, complete: true });
  });
});

describe("parent-zone coverage confidence", () => {
  it("withholds a percentage when parent inventory is missing or explicitly truncated", () => {
    const reached = parcel("47055", "reached");
    const data = { visits: [visit(reached)], properties: [property()] };

    expect(parentZoneCoverage(data, "zone-one", undefined, "outing-one"))
      .toEqual({ total: 0, touched: 0, remaining: 0, percent: null, complete: false });
    expect(parentZoneCoverage(data, "zone-one", { parcels: [reached], complete: false }, "outing-one"))
      .toEqual({ total: 1, touched: 1, remaining: 0, percent: null, complete: false });
  });

  it("isolates the nightly parent total to the requested outing", () => {
    const first = parcel("47055", "first");
    const second = parcel("47055", "second");
    const data = {
      properties: [property()],
      visits: [visit(first), visit(second, { id: "other-outing", eventId: "outing-two" })],
    };

    expect(parentZoneCoverage(data, "zone-one", { parcels: [first, second], complete: true }, "outing-one"))
      .toEqual({ total: 2, touched: 1, remaining: 1, percent: 50, complete: true });
  });
});
