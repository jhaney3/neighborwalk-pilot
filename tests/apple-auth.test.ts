import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ platform: vi.fn(), native: vi.fn(), exchange: vi.fn(), update: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: mocks.platform }, registerPlugin: () => ({ signIn: mocks.native }) }));
vi.mock("../lib/supabase", () => ({ getSupabaseBrowserClient: () => ({ auth: { signInWithIdToken: mocks.exchange, updateUser: mocks.update } }) }));
import { signInWithApple } from "../mobile/apple-auth";
beforeEach(() => { vi.clearAllMocks(); mocks.platform.mockReturnValue("ios"); mocks.native.mockResolvedValue({ identityToken: "apple-token", fullName: "Test Member" }); mocks.exchange.mockResolvedValue({ error: null }); mocks.update.mockResolvedValue({ error: null }); });
describe("native Apple authentication", () => {
  it("sends the hashed nonce to Apple and the original nonce to Supabase", async () => {
    await signInWithApple();
    const appleNonce = mocks.native.mock.calls[0][0].nonce;
    const exchange = mocks.exchange.mock.calls[0][0];
    expect(exchange.provider).toBe("apple"); expect(exchange.token).toBe("apple-token");
    expect(exchange.nonce).toMatch(/^[a-f0-9]{64}$/);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(exchange.nonce));
    expect(appleNonce).toBe(Buffer.from(hash).toString("hex"));
    expect(mocks.update).toHaveBeenCalledWith({ data: { full_name: "Test Member" } });
    await signInWithApple();
    expect(mocks.native.mock.calls[1][0].nonce).not.toBe(appleNonce);
  });
  it("does not exchange tokens after cancellation or on a browser", async () => {
    mocks.native.mockRejectedValueOnce(new Error("Cancelled"));
    await expect(signInWithApple()).rejects.toThrow("Cancelled"); expect(mocks.exchange).not.toHaveBeenCalled();
    mocks.platform.mockReturnValue("web");
    await expect(signInWithApple()).rejects.toThrow("iPhone or iPad"); expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("does not write profile metadata when token verification fails", async () => {
    mocks.exchange.mockResolvedValue({ error: new Error("Invalid nonce") });
    await expect(signInWithApple()).rejects.toThrow("Invalid nonce"); expect(mocks.update).not.toHaveBeenCalled();
  });
});
