import { describe, expect, it } from "vitest";

import { MAPLIBRE_WORKER_URL } from "../lib/map-worker";

describe("MapLibre worker configuration", () => {
  it("always supplies MapLibre with a same-origin URL string", () => {
    expect(typeof MAPLIBRE_WORKER_URL).toBe("string");
    expect(MAPLIBRE_WORKER_URL).toBe("/maplibre-gl-worker.mjs");
  });
});
