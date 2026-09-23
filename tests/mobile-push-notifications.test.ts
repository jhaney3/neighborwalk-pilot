import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushAdapter, PushRpcClient } from "../mobile/push-notifications";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
};

async function moduleUnderTest() {
  vi.stubEnv("NEXT_PUBLIC_NATIVE_APP", "true");
  vi.stubEnv("NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APNS_ENVIRONMENT", "production");
  vi.resetModules();
  return import("../mobile/push-notifications");
}

function pushAdapter(permission: "prompt" | "granted" | "denied" = "granted") {
  const listeners = new Map<string, (value: never) => void>();
  const adapter = {
    checkPermissions: vi.fn(async () => ({ receive: permission })),
    register: vi.fn(async () => {
      listeners.get("registration")?.({ value: "aabbccddeeff00112233445566778899" } as never);
    }),
    unregister: vi.fn(async () => undefined),
    addListener: vi.fn(async (name: string, listener: (value: never) => void) => {
      listeners.set(name, listener);
      return { remove: vi.fn(async () => { listeners.delete(name); }) };
    }),
  };
  return adapter as unknown as PushAdapter;
}

function rpcClient() {
  const rpc = vi.fn(async () => ({ error: null }));
  return {
    client: {
      auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: "10000000-0000-4000-8000-000000000001" } } }, error: null })) },
      rpc,
    } as unknown as PushRpcClient,
    rpc,
  };
}

beforeEach(() => {
  values.clear();
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("remote iOS notification registration", () => {
  it("keeps a stable opaque installation identifier", async () => {
    const { remotePushInstallationId } = await moduleUnderTest();
    const id = "10000000-0000-4000-8000-000000000001";
    expect(remotePushInstallationId(storage, () => id)).toBe(id);
    expect(remotePushInstallationId(storage, () => { throw new Error("must not regenerate"); })).toBe(id);
  });

  it("never prompts and does not register while permission is unresolved", async () => {
    const { registerRemotePush } = await moduleUnderTest();
    const adapter = pushAdapter("prompt");
    const { client, rpc } = rpcClient();
    await expect(registerRemotePush(adapter, client)).resolves.toMatchObject({
      registered: false,
      reason: "permission_required",
    });
    expect(adapter.register).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the fresh APNs token and installation ID only for a signed-in session", async () => {
    const { registerRemotePush } = await moduleUnderTest();
    const adapter = pushAdapter();
    const { client, rpc } = rpcClient();
    await expect(registerRemotePush(adapter, client)).resolves.toMatchObject({ registered: true });
    expect(adapter.register).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("register_apns_device", expect.objectContaining({
      target_device_token: "aabbccddeeff00112233445566778899",
      target_environment: "production",
      target_installation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }));
  });
});

describe("remote notification routes", () => {
  it("accepts only NeighborWalk tap payloads with a local validated path", async () => {
    const { remotePushTapTarget, remotePushPayloadSource } = await moduleUnderTest();
    const notification = (data: Record<string, unknown>, actionId = "tap") => ({
      actionId,
      notification: { id: "push", title: "", body: "", data },
    });
    expect(remotePushTapTarget(notification({ source: remotePushPayloadSource, path: "/app/followups/task-1" }))).toBe("/app/followups/task-1");
    expect(remotePushTapTarget(notification({ source: "other", path: "/app/followups" }))).toBeNull();
    expect(remotePushTapTarget(notification({ source: remotePushPayloadSource, path: "https://evil.invalid" }))).toBeNull();
    expect(remotePushTapTarget(notification({ source: remotePushPayloadSource, path: "/app/followups" }, "dismiss"))).toBeNull();
  });
});
