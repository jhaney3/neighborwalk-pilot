import { describe, expect, it } from "vitest";
import { securityHeaders } from "../lib/security-headers";
import { PRODUCTION_SUPABASE_HOST } from "../lib/environment";

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
});
