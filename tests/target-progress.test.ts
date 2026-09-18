import { describe, expect, it } from "vitest";
import { createSeedData } from "../lib/seed";
import { parentZoneCoverage, targetCoverage } from "../lib/target-coverage";
import type { WalkTarget } from "../lib/walk-targets";

const parcel = { countyFips: "47055", gislink: "one" };
const inventory = { complete: true, parcels: [parcel, { ...parcel, gislink: "two" }] };

describe("privacy-safe operational coverage", () => {
  it("includes permitted target progress without requiring private encounter rows", () => {
    const target: WalkTarget = { id: "target", churchId: "church", eventId: "event", territoryId: "zone", name: "North", color: "#286c59", selectionKind: "whole_zone", geometry: { type: "Polygon", coordinates: [[[-87, 35], [-86, 35], [-86, 36], [-87, 35]]] }, parcels: inventory.parcels.map((item) => ({ ...item, datasetRevision: "test", inclusionSource: "manual_add" })), rosterState: "frozen", frozenAt: "2026-09-12T12:00:00Z" };
    expect(targetCoverage({ visits: [], targetProgress: [{ ...parcel, targetId: "target" }, { ...parcel, targetId: "other" }] }, target)).toMatchObject({ touched: 1, total: 2, percent: 50 });
  });

  it("deduplicates cumulative parent activity but scopes tonight to its outing", () => {
    const data = createSeedData();
    data.visits = [];
    data.parentProgress = [{ ...parcel, territoryId: "zone", eventId: "yesterday" }, { ...parcel, territoryId: "zone", eventId: "today" }, { ...parcel, gislink: "two", territoryId: "zone", eventId: "yesterday" }, { ...parcel, gislink: "two", territoryId: "other-zone", eventId: "today" }];
    expect(parentZoneCoverage(data, "zone", inventory)).toMatchObject({ touched: 2, percent: 100 });
    expect(parentZoneCoverage(data, "zone", inventory, "today")).toMatchObject({ touched: 1, percent: 50 });
  });

  it("does not claim parent-wide accuracy for an assigned-target-only read", () => {
    const data = createSeedData();
    data.coverageVisibility = "assigned_targets_only";
    data.parentProgress = [{ ...parcel, territoryId: "zone", eventId: "today" }];
    expect(parentZoneCoverage(data, "zone", inventory)).toMatchObject({ complete: false, percent: null });
  });
});
