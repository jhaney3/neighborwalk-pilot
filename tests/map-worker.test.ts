import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { MAPLIBRE_WORKER_URL } from "../lib/map-worker";

describe("MapLibre worker configuration", () => {
  it("always supplies MapLibre with a same-origin URL string", () => {
    expect(typeof MAPLIBRE_WORKER_URL).toBe("string");
    expect(MAPLIBRE_WORKER_URL).toBe("/maplibre-gl-worker.mjs");
  });

  it("publishes every relative module imported by the worker", async () => {
    const publicDirectory = resolve(process.cwd(), "public");
    const worker = await readFile(
      resolve(publicDirectory, "maplibre-gl-worker.mjs"),
      "utf8",
    );
    const relativeModules = [
      ...worker.matchAll(/from["']\.\/([^"']+\.mjs)["']/g),
    ].map((match) => match[1]);

    expect(relativeModules).toContain("maplibre-gl-shared.mjs");

    for (const moduleName of relativeModules) {
      const moduleStats = await stat(resolve(publicDirectory, moduleName));
      expect(moduleStats.size).toBeGreaterThan(0);
    }
  });
});
