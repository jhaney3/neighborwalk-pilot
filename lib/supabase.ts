import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertSafeSupabaseUrl, isProductionApp, storageKey } from "./environment";

import type { Database } from "./database.types";
export type { Json } from "./database.types";
export type NeighborWalkDatabase = Database;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
let browserClient: SupabaseClient<NeighborWalkDatabase> | null = null;

// Preserve the SDK's existing production key; test environments remain isolated.
export function authStorageKey() {
  return isProductionApp && supabaseUrl ? `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token` : storageKey("neighborwalk-auth");
}

/** Only a failed/aborted network request permits the explicit offline option.
 * Any HTTP response (including an auth denial) proves connectivity, not access. */
export async function authServiceUnreachable() {
  if (!supabaseUrl || !supabasePublishableKey) return false;
  assertSafeSupabaseUrl(supabaseUrl, isProductionApp, window.location.hostname);
  try {
    await fetch(`${supabaseUrl}/auth/v1/health`, { headers: { apikey: supabasePublishableKey },
      credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(3000) });
    return false;
  } catch { return true; }
}

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabasePublishableKey);
}

export function getSupabaseBrowserClient(): SupabaseClient<NeighborWalkDatabase> | null {
  if (!supabaseUrl || !supabasePublishableKey || typeof window === "undefined") return null;
  assertSafeSupabaseUrl(supabaseUrl, isProductionApp, window.location.hostname);
  browserClient ??= createClient<NeighborWalkDatabase>(supabaseUrl, supabasePublishableKey, {
    auth: {
      storageKey: authStorageKey(),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}
