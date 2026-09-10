import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/scripture/route";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("reference-only scripture compatibility", () => {
  it("directs old clients to reference links without contacting a provider", async () => {
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    vi.stubEnv("ESV_API_KEY", "unused-test-key");
    const response = await GET();
    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ code: "reference_only" });
    expect(provider).not.toHaveBeenCalled();
  });
});
