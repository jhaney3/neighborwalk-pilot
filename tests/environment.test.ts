import { connect } from "node:net";
import { describe, expect, it } from "vitest";
import { assertSafeSupabaseUrl, environmentStorageKey, LOCAL_SUPABASE_URL, PRODUCTION_SUPABASE_HOST } from "../lib/environment";

describe("production isolation", () => {
  const productionUrl = `https://${PRODUCTION_SUPABASE_HOST}`;

  it("only allows the local database for local and preview builds", () => {
    expect(() => assertSafeSupabaseUrl(LOCAL_SUPABASE_URL, false)).not.toThrow();
    expect(() => assertSafeSupabaseUrl(undefined, false)).not.toThrow();
    for (const url of [productionUrl, "https://another-project.supabase.co", "http://127.0.0.1:54322", "http://127.0.0.1:54321.example.com", `${LOCAL_SUPABASE_URL}/proxy`, "https://127.0.0.1:54321"]) {
      expect(() => assertSafeSupabaseUrl(url, false)).toThrow();
    }
  });

  it("allows the production deployment but blocks running it on localhost", () => {
    expect(() => assertSafeSupabaseUrl(productionUrl, true, "neighborwalk-pilot.vercel.app")).not.toThrow();
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(() => assertSafeSupabaseUrl(productionUrl, true, host)).toThrow();
    }
    expect(() => assertSafeSupabaseUrl(LOCAL_SUPABASE_URL, true)).toThrow();
  });

  it("keeps test records, sessions and queues away from existing production storage", () => {
    for (const name of ["neighborwalk", "neighborwalk-supabase-workspace", "neighborwalk-auth", "neighborwalk-parcel-cache", "neighborwalk-conversation-guides-v1"]) {
      const live = environmentStorageKey(name, productionUrl, true);
      const local = environmentStorageKey(name, LOCAL_SUPABASE_URL, false);
      expect(live).toBe(name);
      expect(local).not.toBe(live);
      expect(local).not.toBe(environmentStorageKey(name, undefined, false));
    }
  });

  it("blocks unmocked network calls from the unit test suite", () => {
    expect(() => fetch(`${productionUrl}/auth/v1/health`)).toThrow("Unit tests cannot access the network");
    expect(() => connect({ host: PRODUCTION_SUPABASE_HOST, port: 443 })).toThrow("Unit tests cannot access the network");
  });
});
