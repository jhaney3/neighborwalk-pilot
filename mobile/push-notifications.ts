import { Capacitor, type PermissionState, type PluginListenerHandle } from "@capacitor/core";
import {
  PushNotifications,
  type ActionPerformed,
  type PushNotificationsPlugin,
  type RegistrationError,
  type Token,
} from "@capacitor/push-notifications";
import { storageKey } from "../lib/environment";
import { isMobileApp } from "../lib/mobile";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { randomUuid } from "../lib/platform";
import { validatedDeviceReminderTarget } from "./notifications";

const PUSH_SOURCE = "neighborwalk-remote-push-v1";
export const REMOTE_PUSH_REFRESH_EVENT = "neighborwalk-remote-push-refresh";
const INSTALLATION_KEY = storageKey("neighborwalk-push-installation-id");
const TOKEN_TIMEOUT_MS = 12_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[0-9a-f]{16,512}$/i;

export const remotePushConfigured = isMobileApp
  && process.env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "true";

export type RemotePushRegistration = {
  permission: PermissionState;
  registered: boolean;
  reason?: "not_configured" | "not_native" | "permission_required";
};
let nativeRegistrationInFlight: Promise<RemotePushRegistration> | null = null;

export type PushAdapter = Pick<PushNotificationsPlugin,
  "addListener" | "checkPermissions" | "register" | "unregister">;

export type PushRpcClient = {
  auth: { getSession(): PromiseLike<{ data: { session: { user: { id: string } } | null }; error: { message?: string } | null }> };
  rpc(name: "register_apns_device", args: {
    target_installation_id: string;
    target_device_token: string;
    target_environment: "sandbox" | "production";
  }): PromiseLike<{ error: { message?: string } | null }>;
  rpc(name: "unregister_apns_device", args: {
    target_installation_id: string;
  }): PromiseLike<{ error: { message?: string } | null }>;
};

function configuredEnvironment(): "sandbox" | "production" {
  return process.env.NEXT_PUBLIC_APNS_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
}

export function remotePushInstallationId(
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
  create: () => string = randomUuid,
) {
  const existing = storage.getItem(INSTALLATION_KEY);
  if (existing && UUID_PATTERN.test(existing)) return existing.toLowerCase();
  const next = create().toLowerCase();
  if (!UUID_PATTERN.test(next)) throw new Error("A secure installation identifier could not be created.");
  storage.setItem(INSTALLATION_KEY, next);
  return next;
}

function existingInstallationId(storage: Pick<Storage, "getItem"> = window.localStorage) {
  const value = storage.getItem(INSTALLATION_KEY);
  return value && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

async function registrationToken(adapter: PushAdapter) {
  let resolveToken: (token: Token) => void = () => {};
  let rejectToken: (error: Error) => void = () => {};
  const result = new Promise<Token>((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });
  const handles: PluginListenerHandle[] = [];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    handles.push(await adapter.addListener("registration", resolveToken));
    handles.push(await adapter.addListener("registrationError", (error: RegistrationError) => {
      rejectToken(new Error(error.error || "iOS could not register this device for notifications."));
    }));
    timeout = setTimeout(() => rejectToken(new Error("iOS notification registration timed out.")), TOKEN_TIMEOUT_MS);
    await adapter.register();
    const token = await result;
    if (!TOKEN_PATTERN.test(token.value) || token.value.length % 2 !== 0) {
      throw new Error("iOS returned an invalid notification token.");
    }
    return token.value.toLowerCase();
  } finally {
    if (timeout) clearTimeout(timeout);
    await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
  }
}

/** Refresh an existing opt-in. This function never presents a permission prompt. */
async function performRemotePushRegistration(
  adapter: PushAdapter = PushNotifications,
  rpcClient = getSupabaseBrowserClient() as unknown as PushRpcClient | null,
): Promise<RemotePushRegistration> {
  if (!remotePushConfigured) return { permission: "denied", registered: false, reason: "not_configured" };
  if (!Capacitor.isNativePlatform() && adapter === PushNotifications) {
    return { permission: "denied", registered: false, reason: "not_native" };
  }
  const permission = (await adapter.checkPermissions()).receive;
  if (permission !== "granted") return { permission, registered: false, reason: "permission_required" };
  if (!rpcClient) throw new Error("The church workspace connection is unavailable.");
  const { data, error: sessionError } = await rpcClient.auth.getSession();
  if (sessionError || !data.session) throw new Error("Sign in again before enabling assignment alerts.");
  const deviceToken = await registrationToken(adapter);
  const { error } = await rpcClient.rpc("register_apns_device", {
    target_installation_id: remotePushInstallationId(),
    target_device_token: deviceToken,
    target_environment: configuredEnvironment(),
  });
  if (error) throw new Error("This deployment could not register assignment alerts.");
  return { permission, registered: true };
}

export function registerRemotePush(
  adapter: PushAdapter = PushNotifications,
  rpcClient = getSupabaseBrowserClient() as unknown as PushRpcClient | null,
): Promise<RemotePushRegistration> {
  if (adapter !== PushNotifications) return performRemotePushRegistration(adapter, rpcClient);
  if (nativeRegistrationInFlight) return nativeRegistrationInFlight;
  nativeRegistrationInFlight = performRemotePushRegistration(adapter, rpcClient).finally(() => {
    nativeRegistrationInFlight = null;
  });
  return nativeRegistrationInFlight;
}

/** Detach server routing while the session is live, then invalidate the APNs token. */
export async function unregisterRemotePush(
  adapter: PushAdapter = PushNotifications,
  rpcClient = getSupabaseBrowserClient() as unknown as PushRpcClient | null,
) {
  const installationId = typeof window === "undefined" ? null : existingInstallationId();
  let detached = false;
  try {
    if (remotePushConfigured && installationId && rpcClient) {
      const { data } = await rpcClient.auth.getSession();
      if (data.session) {
        const { error } = await rpcClient.rpc("unregister_apns_device", { target_installation_id: installationId });
        detached = !error;
      }
    }
  } finally {
    if ((Capacitor.isNativePlatform() || adapter !== PushNotifications) && remotePushConfigured) {
      await adapter.unregister().catch(() => undefined);
    }
  }
  return detached;
}

export function remotePushTapTarget(action: Pick<ActionPerformed, "actionId" | "notification">) {
  if (action.actionId !== "tap") return null;
  const data = action.notification.data;
  if (!data || data.source !== PUSH_SOURCE) return null;
  return validatedDeviceReminderTarget(data.path);
}

/** Install once at native startup. Payload paths remain constrained to local app routes. */
export function addRemotePushTapListener(onTarget: (target: string) => void | Promise<void>) {
  if (!remotePushConfigured || !Capacitor.isNativePlatform()) return Promise.resolve(null);
  return PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const target = remotePushTapTarget(action);
    if (target) void onTarget(target);
  });
}

export const remotePushPayloadSource = PUSH_SOURCE;
