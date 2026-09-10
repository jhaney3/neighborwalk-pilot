import { describe, expect, it } from "vitest";
import { preparedOfflineIdentity, WORKSPACE_CACHE_KEY } from "../lib/offline-identity";

const now = Date.parse("2026-09-10T12:00:00Z");
const userId = "00000000-0000-4000-8000-000000000001";
const auth = { access_token: "fictional-access", refresh_token: "fictional-refresh", expires_at: now / 1000 - 60,
  user: { id: userId, email: "fictional@example.test", user_metadata: { name: "Fictional", role: "leader" } } };
const workspace = { userId, churchId: "church-a", revision: 1, role: "volunteer", verifiedAt: new Date(now - 3600_000).toISOString() };
function reader(storedAuth: unknown = auth, connection: unknown = workspace) {
  return { getItem: (key: string) => JSON.stringify(key === WORKSPACE_CACHE_KEY ? connection : storedAuth) };
}
describe("prepared offline cache identity (not an authenticated Session)", () => {
  it("selects only the matching recently checked account, without tokens or claimed roles", () => {
    expect(preparedOfflineIdentity(reader(), "auth", now)).toEqual({ id: userId, email: "fictional@example.test", name: "Fictional", offlineStart: true });
  });
  it("refuses signed-out, mismatched or malformed authentication storage", () => {
    for (const value of [null, {}, { ...auth, user: { id: "another-account" } }, { ...auth, refresh_token: "" }, { ...auth, expires_at: "yesterday" }]) {
      expect(preparedOfflineIdentity(reader(value), "auth", now)).toBeNull();
    }
    expect(preparedOfflineIdentity({ getItem: () => "broken-json" }, "auth", now)).toBeNull();
    expect(preparedOfflineIdentity({ getItem: () => { throw new Error("blocked storage"); } }, "auth", now)).toBeNull();
  });
  it("refuses revoked, unverified, future and expired membership caches", () => {
    for (const value of [null, { ...workspace, userId: "another-account" }, { ...workspace, role: "admin" },
      { ...workspace, verifiedAt: "" }, { ...workspace, verifiedAt: new Date(now + 1).toISOString() },
      { ...workspace, verifiedAt: new Date(now - 24 * 3600_000).toISOString() }]) {
      expect(preparedOfflineIdentity(reader(auth, value), "auth", now)).toBeNull();
    }
  });
});
