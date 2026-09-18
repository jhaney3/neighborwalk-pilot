import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", () => ({ getSupabaseBrowserClient: () => ({ rpc }) }));
import { fetchPlanningParcelsForBoundary } from "../lib/target-parcels";
import { fetchStreetSegmentsForBoundary } from "../lib/street-segments";

const boundary: [number, number][] = [[-87.34, 35.24], [-87.33, 35.24], [-87.33, 35.25], [-87.34, 35.25]];
const payload = { datasetRevision: "real-r1", release: "real-r1", complete: true, truncated: false, features: [] };

describe("real planning RPC access", () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: payload, error: null }); });

  it("uses the member parcel API by default", async () => {
    await fetchPlanningParcelsForBoundary(boundary);
    expect(rpc).toHaveBeenCalledWith("planning_parcels_for_boundary_v1", {
      territory_boundary: { type: "Polygon", coordinates: [[...boundary, boundary[0]]] },
    });
  });

  it("uses public GIS-only APIs for demo, never generated placeholders", async () => {
    const parcels = await fetchPlanningParcelsForBoundary(boundary, { publicMap: true });
    const streets = await fetchStreetSegmentsForBoundary({ boundary, publicMap: true });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["public_map_parcels_for_boundary_v1", "public_map_streets_for_boundary_v1"]);
    expect(parcels.parcels.features).toEqual([]);
    expect(streets.features).toEqual([]);
  });

  it("propagates request cancellation to both real GIS APIs", async () => {
    const signal = new AbortController().signal;
    const abortSignal = vi.fn().mockResolvedValue({ data: payload, error: null });
    rpc.mockReturnValue({ abortSignal });
    await fetchPlanningParcelsForBoundary(boundary, { publicMap: true, signal });
    await fetchStreetSegmentsForBoundary({ boundary, publicMap: true, signal });
    expect(abortSignal).toHaveBeenCalledTimes(2);
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("does not replace a failed real-data request with demo geometry", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("Data unavailable") });
    await expect(fetchPlanningParcelsForBoundary(boundary, { publicMap: true })).rejects.toThrow("Data unavailable");
    await expect(fetchStreetSegmentsForBoundary({ boundary, publicMap: true })).rejects.toThrow("Data unavailable");
  });
});
