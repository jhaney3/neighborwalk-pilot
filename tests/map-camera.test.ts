import { describe, expect, it } from "vitest";
import { shouldNavigateToTerritory } from "../lib/map-camera";

describe("map camera navigation", () => {
  it("preserves the camera when sync refreshes the current territory", () => {
    expect(shouldNavigateToTerritory("territory-1", "territory-1")).toBe(false);
  });

  it("navigates when the user selects a different territory", () => {
    expect(shouldNavigateToTerritory("territory-1", "territory-2")).toBe(true);
  });
});
