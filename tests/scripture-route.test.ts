import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/scripture/route";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("scripture passage endpoint", () => {
  it("loads a normalized ESV passage with the server-only key", async () => {
    const provider = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      canonical: "Ephesians 2:8–9",
      passages: ["[8] For by grace you have been saved through faith…"],
    }), { status: 200 }));
    vi.stubGlobal("fetch", provider);
    vi.stubEnv("ESV_API_KEY", "test-key");

    const response = await GET(new Request("http://localhost/api/scripture?reference=%20Ephesians%202%3A8%E2%80%939%20"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
    await expect(response.json()).resolves.toMatchObject({
      reference: "Ephesians 2:8-9",
      canonical: "Ephesians 2:8–9",
    });
    expect(provider).toHaveBeenCalledWith(
      expect.stringContaining("q=Ephesians+2%3A8-9"),
      expect.objectContaining({ headers: { Authorization: "Token test-key" } }),
    );
  });

  it("rejects invalid references before contacting the provider", async () => {
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    vi.stubEnv("ESV_API_KEY", "test-key");

    const response = await GET(new Request("http://localhost/api/scripture?reference=%3Cscript%3E"));

    expect(response.status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });

  it("reports when the server-only key is not configured", async () => {
    vi.stubEnv("ESV_API_KEY", "");

    const response = await GET(new Request("http://localhost/api/scripture?reference=John%203%3A16"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "not_configured" });
  });
});
