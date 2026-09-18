import { describe, expect, it, vi } from "vitest";
import type { Territory } from "../lib/domain";
import type { ParcelFeatureCollection } from "../lib/parcels";
import { loadPlanningLayers, planningAvailabilityMessage, planningLayerMatchesIdentity, type PlanningLayerEvent } from "../lib/planning-loader";
import type { StreetSegmentCollection } from "../lib/street-segments";

const territory: Territory = {
  id: "lawrence-zone",
  churchId: "church-1",
  name: "Lawrence zone",
  color: "#286c59",
  center: [-87.34, 35.24],
  zoom: 15,
  boundary: [[-87.35, 35.23], [-87.33, 35.23], [-87.33, 35.25], [-87.35, 35.25]],
};

const streets: StreetSegmentCollection = {
  type: "FeatureCollection",
  metadata: { release: "streets-r1", source: "Overture transportation", complete: true, truncated: false, attribution: "fixture" },
  features: [{ type: "Feature", id: "street-1", properties: { id: "street-1", name: "Church Avenue", roadClass: "residential", subclass: null, release: "streets-r1", complete: true },
    geometry: { type: "LineString", coordinates: [[-87.34, 35.23], [-87.34, 35.25]] } }],
};

const parcels: ParcelFeatureCollection = {
  type: "FeatureCollection",
  features: [{ type: "Feature", id: 1, properties: { id: 1, countyFips: "47099", gislink: "parcel-1", situsAddress: null,
    propertyClass: "residential", landUse: "residential", isResidential: true },
  geometry: { type: "Polygon", coordinates: [[[-87.341,35.239],[-87.339,35.239],[-87.339,35.241],[-87.341,35.241],[-87.341,35.239]]] } }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

describe("planning layer loading", () => {
  it("publishes available streets without waiting for parcels and forwards public-map access", async () => {
    const pendingParcels = deferred<{ parcels: ParcelFeatureCollection; datasetRevision: string; complete: boolean; truncated: boolean }>();
    const events: PlanningLayerEvent[] = [];
    const fetchStreets = vi.fn().mockResolvedValue(streets);
    const fetchParcels = vi.fn().mockReturnValue(pendingParcels.promise);
    const loading = loadPlanningLayers(territory, { publicMap: true, onLayer: (event) => events.push(event) }, {
      fetchStreets, fetchParcels, getCached: vi.fn().mockResolvedValue(null), cacheComplete: vi.fn(),
    });

    await vi.waitFor(() => expect(events.map((event) => event.layer)).toEqual(["streets"]));
    expect(events[0]).toMatchObject({ layer: "streets", value: { status: "ready", live: true, complete: true } });
    expect(fetchStreets).toHaveBeenCalledWith(expect.objectContaining({ publicMap: true, boundary: territory.boundary }));
    expect(fetchParcels).toHaveBeenCalledWith(territory.boundary, expect.objectContaining({ publicMap: true }));

    pendingParcels.resolve({ parcels, datasetRevision: "parcels-r1", complete: true, truncated: false });
    await loading;
    expect(events[1]).toMatchObject({ layer: "parcels", value: { status: "ready", live: true, complete: true, revision: "parcels-r1" } });
  });

  it("keeps a successful street overlay when parcel loading fails", async () => {
    const events: PlanningLayerEvent[] = [];
    await loadPlanningLayers(territory, { onLayer: (event) => events.push(event) }, {
      fetchStreets: vi.fn().mockResolvedValue(streets),
      fetchParcels: vi.fn().mockRejectedValue(new Error("parcel inventory offline")),
      getCached: vi.fn().mockResolvedValue(null),
      cacheComplete: vi.fn(),
    });

    expect(events.find((event) => event.layer === "streets")).toMatchObject({ value: { data: streets, status: "ready", live: true } });
    expect(events.find((event) => event.layer === "parcels")).toMatchObject({ value: { data: { features: [] }, status: "unavailable", live: false } });
  });

  it("reports an authoritative complete empty inventory separately from an incomplete result", async () => {
    const events: PlanningLayerEvent[] = [];
    await loadPlanningLayers(territory, { onLayer: (event) => events.push(event) }, {
      fetchStreets: vi.fn().mockResolvedValue(streets),
      fetchParcels: vi.fn().mockResolvedValue({ parcels: { type: "FeatureCollection", features: [] }, datasetRevision: "parcels-r1", complete: true, truncated: false }),
      getCached: vi.fn().mockResolvedValue(null),
      cacheComplete: vi.fn(),
    });
    expect(events.find((event) => event.layer === "parcels")).toMatchObject({ value: { status: "empty", complete: true, live: true } });

    events.length = 0;
    await loadPlanningLayers(territory, { onLayer: (event) => events.push(event) }, {
      fetchStreets: vi.fn().mockResolvedValue(streets),
      fetchParcels: vi.fn().mockResolvedValue({ parcels: { type: "FeatureCollection", features: [] }, datasetRevision: "", complete: false, truncated: false }),
      getCached: vi.fn().mockResolvedValue(null),
      cacheComplete: vi.fn(),
    });
    expect(events.find((event) => event.layer === "parcels")).toMatchObject({ value: { status: "incomplete", complete: false, live: true } });
  });

  it("reports missing and out-of-area parcel inventory as explicitly unavailable", async () => {
    for (const availability of ["missing_inventory", "unsupported_area"]) {
      const events: PlanningLayerEvent[] = [];
      await loadPlanningLayers(territory, { onLayer: (event) => events.push(event) }, {
        fetchStreets: vi.fn().mockResolvedValue(streets),
        fetchParcels: vi.fn().mockResolvedValue({ parcels: { type: "FeatureCollection", features: [] }, datasetRevision: "parcels-r1",
          complete: false, truncated: false, availability }),
        getCached: vi.fn().mockResolvedValue(null),
        cacheComplete: vi.fn(),
      });
      expect(events.find((event) => event.layer === "parcels")).toMatchObject({
        value: { status: "unavailable", complete: false, live: true, availability },
      });
    }
    expect(planningAvailabilityMessage("missing_inventory", "parcels")).toBe("Residential parcel data has not been loaded for this area.");
    expect(planningAvailabilityMessage("unsupported_area", "parcels")).toBe("Planning data is available only in Giles, Lawrence, Lewis, and Wayne counties.");
  });

  it("does not publish or cache results after the parent request is cancelled", async () => {
    const pendingStreets = deferred<StreetSegmentCollection>();
    const pendingParcels = deferred<{ parcels: ParcelFeatureCollection; datasetRevision: string; complete: boolean; truncated: boolean }>();
    const controller = new AbortController();
    const events: PlanningLayerEvent[] = [];
    const cacheComplete = vi.fn();
    const loading = loadPlanningLayers(territory, { signal: controller.signal, onLayer: (event) => events.push(event) }, {
      fetchStreets: vi.fn().mockReturnValue(pendingStreets.promise), fetchParcels: vi.fn().mockReturnValue(pendingParcels.promise),
      getCached: vi.fn().mockResolvedValue(null), cacheComplete,
    });
    controller.abort();
    pendingStreets.resolve(streets);
    pendingParcels.resolve({ parcels, datasetRevision: "parcels-r1", complete: true, truncated: false });
    await loading;

    expect(events).toEqual([]);
    expect(cacheComplete).not.toHaveBeenCalled();
  });

  it("rejects a completed layer carrying a stale parent identity", () => {
    expect(planningLayerMatchesIdentity("old-parent:ring", "new-parent:ring")).toBe(false);
    expect(planningLayerMatchesIdentity("new-parent:ring", "new-parent:ring")).toBe(true);
  });
});
