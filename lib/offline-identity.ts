import { offlineMembershipValid } from "./offline-access";
import { storageKey } from "./environment";

export const WORKSPACE_CACHE_KEY = storageKey("neighborwalk-supabase-workspace");
export type PreparedIdentity = { id: string; email: string; name?: string; offlineStart: true };
type Reader = Pick<Storage, "getItem">;

/** A selector for an already prepared, device-local cache, NOT authentication.
 * Never returns tokens, creates a Session or authorizes a server operation.
 * SDK sign-out/removal and mismatched/expired membership invalidate it. */
export function preparedOfflineIdentity(storage: Reader, authKey: string, now = Date.now()): PreparedIdentity | null {
  try {
    const auth = JSON.parse(storage.getItem(authKey) ?? "null");
    const workspace = JSON.parse(storage.getItem(WORKSPACE_CACHE_KEY) ?? "null");
    if (!auth || !workspace || typeof auth.access_token !== "string" || !auth.access_token
      || typeof auth.refresh_token !== "string" || !auth.refresh_token
      || typeof auth.expires_at !== "number" || !Number.isFinite(auth.expires_at)
      || typeof auth.user?.id !== "string" || !/^[a-f0-9-]{36}$/i.test(auth.user.id)
      || workspace.userId !== auth.user.id || typeof workspace.churchId !== "string" || !workspace.churchId
      || !["leader", "volunteer"].includes(workspace.role) || !Number.isInteger(workspace.revision)
      || !offlineMembershipValid(workspace.verifiedAt, now)) return null;
    const metadata = auth.user.user_metadata;
    return { id: auth.user.id, email: typeof auth.user.email === "string" ? auth.user.email : "",
      name: typeof metadata?.full_name === "string" ? metadata.full_name : typeof metadata?.name === "string" ? metadata.name : undefined,
      offlineStart: true };
  } catch { return null; }
}
