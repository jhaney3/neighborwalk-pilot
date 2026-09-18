import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", () => ({ getSupabaseBrowserClient: () => ({ rpc }) }));

import { fetchStreetSegmentsForBoundary, parseStreetSegmentResponse, streetSegmentDisplayLines } from "../lib/street-segments";
describe("street segment responses", () => {
  beforeEach(() => rpc.mockReset());

  it("retains complete-result metadata and canonical geometry", () => {
    const result = parseStreetSegmentResponse({ release: "r1", source: "Overture transportation", complete: true, truncated: false, features: [{ id: "gers-1", name: "Oak", road_class: "residential", geometry: { type: "LineString", coordinates: [[1,2],[3,4]] }, display_geometry: { type: "LineString", coordinates: [[1.5,2.5],[2.5,3.5]] } }] });
    expect(result.features[0].properties.id).toBe("gers-1");
    expect(result.features[0].geometry.coordinates).toEqual([[1,2],[3,4]]);
    expect(streetSegmentDisplayLines(result.features[0])[0].coordinates).toEqual([[1.5,2.5],[2.5,3.5]]);
    expect(result.metadata).toMatchObject({ release: "r1", source: "Overture transportation", complete: true, truncated: false });
  });
  it("rejects malformed envelopes", () => expect(() => parseStreetSegmentResponse([])).toThrow());
  it("accepts clipped multiline geometry from the cache RPC", () => {
    const result = parseStreetSegmentResponse({ release:"r", complete:true, features:[{ id:"one", geometry:{ type:"MultiLineString", coordinates:[[[0,0],[1,1]]] } }] });
    expect(result.features[0].geometry.type).toBe("MultiLineString");
  });
  it("does not treat an absent release manifest or a truncated result as complete", () => {
    expect(parseStreetSegmentResponse({ complete: true, features: [] }).metadata?.complete).toBe(false);
    expect(parseStreetSegmentResponse({ release: "r", complete: true, truncated: true, features: [] }).metadata?.complete).toBe(false);
  });
  it("sends a closed GeoJSON Polygon to the street RPC", async () => {
    rpc.mockResolvedValue({ data: { release: "r", complete: true, truncated: false, features: [] }, error: null });
    await fetchStreetSegmentsForBoundary({ boundary: [[-87,35],[-86,35],[-86,36],[-87,36]] });
    expect(rpc).toHaveBeenCalledWith("street_segments_for_boundary_v1", { territory_boundary: {
      type: "Polygon", coordinates: [[[-87,35],[-86,35],[-86,36],[-87,36],[-87,35]]],
    } });
  });
});
