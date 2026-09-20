import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ platform: vi.fn(), native: vi.fn(), create: vi.fn(), save: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: mocks.platform }, registerPlugin: () => ({ signIn: mocks.native }) }));
vi.mock("../lib/supabase", () => ({ createMobileGoogleClient: mocks.create, getSupabaseBrowserClient: () => ({ auth: { setSession: mocks.save } }) }));
import { googleCallbackCode, signInWithGoogleNative } from "../mobile/google-auth";
const account = { id: "google-user", email: "different@gmail.com", app_metadata: { provider: "google" }, user_metadata: {}, aud: "authenticated", created_at: new Date().toISOString() };
let exchangeBody: { auth_code: string; code_verifier: string } | null;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  vi.clearAllMocks(); exchangeBody = null;
  mocks.platform.mockReturnValue("ios"); mocks.save.mockResolvedValue({ error: null });
  mocks.native.mockResolvedValue({ callbackUrl: "neighborwalk://google-auth?code=test-code" });
  fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    exchangeBody = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ access_token: "supabase-access", refresh_token: "supabase-refresh", provider_token: "do-not-persist-google-token", token_type: "bearer", expires_in: 3600, user: account }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  mocks.create.mockImplementation(() => createClient("https://test.supabase.co", "public-test-key", { global: { fetch: fetcher }, auth: { storageKey: "google-test-" + crypto.randomUUID(), persistSession: false, flowType: "pkce", autoRefreshToken: false, detectSessionInUrl: false } }));
});
describe("iOS Google sign-in", () => {
  it("uses the SDK's real PKCE challenge and exchanges only its callback code", async () => {
    await signInWithGoogleNative();
    const authorize = new URL(mocks.native.mock.calls[0][0].url);
    expect(authorize.searchParams.get("provider")).toBe("google");
    expect(authorize.searchParams.get("redirect_to")).toBe("neighborwalk://google-auth");
    expect(authorize.searchParams.get("prompt")).toBe("select_account");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("s256");
    expect(exchangeBody!.auth_code).toBe("test-code");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(exchangeBody!.code_verifier));
    expect(authorize.searchParams.get("code_challenge")).toBe(Buffer.from(digest).toString("base64url"));
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ access_token: "supabase-access", refresh_token: "supabase-refresh" });
  });
  it("cancels without changing the session and permits a fresh attempt", async () => {
    mocks.native.mockRejectedValueOnce({ code: "CANCELLED" });
    await signInWithGoogleNative(); expect(fetcher).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    await signInWithGoogleNative(); expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("rejects mismatched, credential-bearing, implicit-token and duplicate-code callbacks", () => {
    for (const value of ["https://evil.test?code=a", "neighborwalk://auth?code=a", "neighborwalk://google-auth/extra?code=a", "neighborwalk://user@google-auth?code=a", "neighborwalk://google-auth:80?code=a", "neighborwalk://google-auth#access_token=a", "neighborwalk://google-auth?code=a&code=b", "neighborwalk://google-auth?code=", "neighborwalk://google-auth?error=access_denied&code=a"]) expect(() => googleCallbackCode(value)).toThrow();
  });
  it("does not establish a session on an invalid callback or failed code exchange", async () => {
    mocks.native.mockResolvedValueOnce({ callbackUrl: "neighborwalk://auth?code=wrong-flow" });
    await expect(signInWithGoogleNative()).rejects.toThrow("invalid"); expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ msg: "Code expired" }), { status: 400 }));
    await expect(signInWithGoogleNative()).rejects.toThrow(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects non-iOS environments without starting authentication", async () => {
    mocks.platform.mockReturnValue("web"); await expect(signInWithGoogleNative()).rejects.toThrow("iPhone or iPad"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("prevents overlapping sign-in attempts", async () => {
    let finish!: (value: { callbackUrl: string }) => void;
    mocks.native.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = signInWithGoogleNative();
    await vi.waitFor(() => expect(mocks.native).toHaveBeenCalled());
    await expect(signInWithGoogleNative()).rejects.toThrow("already open");
    finish({ callbackUrl: "neighborwalk://google-auth?code=test-code" }); await first;
  });
});
