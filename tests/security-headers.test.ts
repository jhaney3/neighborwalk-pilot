import { afterEach, describe, expect, it } from "vitest";
import { securityHeaders } from "../lib/security-headers";
import { PRODUCTION_SUPABASE_HOST } from "../lib/environment";

const originalMapStyle = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
const originalGeocoder = process.env.NEXT_PUBLIC_GEOCODER_URL;

afterEach(() => {
  if (originalMapStyle === undefined) delete process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  else process.env.NEXT_PUBLIC_MAP_STYLE_URL = originalMapStyle;
  if (originalGeocoder === undefined) delete process.env.NEXT_PUBLIC_GEOCODER_URL;
  else process.env.NEXT_PUBLIC_GEOCODER_URL = originalGeocoder;
});

describe("security headers", () => {
  it("protects production framing, MIME types, referrers and transport", () => {
    const headers = Object.fromEntries(securityHeaders(true).map(({ key, value }) => [key, value]));
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain(PRODUCTION_SUPABASE_HOST);
    expect(headers["Content-Security-Policy"]).not.toContain("unsafe-eval");
  });
  it("keeps production database access excluded from sandbox connections", () => {
    expect(securityHeaders(false).find((header) => header.key === "Content-Security-Policy")?.value).not.toContain(PRODUCTION_SUPABASE_HOST);
  });
  it("permits the configured production map and geocoder origins", () => {
    process.env.NEXT_PUBLIC_MAP_STYLE_URL = "https://maps.example.test/styles/field.json";
    process.env.NEXT_PUBLIC_GEOCODER_URL = "https://geocoder.example.test/reverse";
    const csp = securityHeaders(true).find((header) => header.key === "Content-Security-Policy")?.value;
    expect(csp).toContain("https://maps.example.test");
    expect(csp).toContain("https://geocoder.example.test");
    expect(csp).toContain("img-src 'self' blob: data: https://api.maptiler.com https://*.maptiler.com https://tiles.openfreemap.org");
  });
});
