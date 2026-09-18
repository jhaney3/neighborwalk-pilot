import { afterEach, describe, expect, it } from "vitest";
import { isSupportedMapStyleUrl } from "../lib/map-config";

const originalStyle = process.env.NEXT_PUBLIC_MAP_STYLE_URL;

afterEach(() => {
  if (originalStyle === undefined) delete process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  else process.env.NEXT_PUBLIC_MAP_STYLE_URL = originalStyle;
});

describe("map style configuration", () => {
  it("accepts built-in providers and the deployment-configured origin", () => {
    process.env.NEXT_PUBLIC_MAP_STYLE_URL = "https://maps.example.test/styles/default.json";
    expect(isSupportedMapStyleUrl("https://tiles.openfreemap.org/styles/bright")).toBe(true);
    expect(isSupportedMapStyleUrl("https://api.maptiler.com/maps/streets-v4/style.json?key=public-key")).toBe(true);
    expect(isSupportedMapStyleUrl("https://maps.example.test/styles/field.json")).toBe(true);
  });

  it("rejects a runtime origin that production CSP cannot authorize", () => {
    process.env.NEXT_PUBLIC_MAP_STYLE_URL = "https://maps.example.test/styles/default.json";
    expect(isSupportedMapStyleUrl("https://unconfigured.example.test/style.json")).toBe(false);
    expect(isSupportedMapStyleUrl("javascript:alert(1)")).toBe(false);
  });
});
