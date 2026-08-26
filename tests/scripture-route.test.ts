import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/scripture/route";

const originalApiKey = process.env.ESV_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.ESV_API_KEY;
  else process.env.ESV_API_KEY = originalApiKey;
  vi.unstubAllGlobals();
});

describe("scripture route", () => {
  it("rejects invalid references before calling the provider", async () => {
    process.env.ESV_API_KEY = "test-key";
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);

    const response = await GET(new Request("http://localhost/api/scripture?reference=%3Cscript%3E"));

    expect(response.status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });

  it("reports when the server key is not configured", async () => {
    delete process.env.ESV_API_KEY;

    const response = await GET(new Request("http://localhost/api/scripture?reference=James%201%3A19"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "not_configured" });
  });

  it("keeps the key server-side and returns the ESV passage", async () => {
    process.env.ESV_API_KEY = "test-key";
    const provider = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      canonical: "James 1:19",
      passages: ["[19] Know this, my beloved brothers: let every person be quick to hear. (ESV)"],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", provider);

    const response = await GET(new Request("http://localhost/api/scripture?reference=James%201%3A19"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ canonical: "James 1:19", reference: "James 1:19" });
    expect(provider).toHaveBeenCalledOnce();
    const [url, options] = provider.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://api.esv.org/v3/passage/text/");
    expect(url).toContain("q=James+1%3A19");
    expect(options.headers).toEqual({ Authorization: "Token test-key" });
  });
});
