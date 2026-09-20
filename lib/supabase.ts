import { isMobileApp } from "./mobile";
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
  assertSafeSupabaseUrl(supabaseUrl, isProductionApp, (isMobileApp && window.location.protocol === "capacitor:" && window.location.hostname === "localhost") ? undefined : window.location.hostname);
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
  assertSafeSupabaseUrl(supabaseUrl, isProductionApp, (isMobileApp && window.location.protocol === "capacitor:" && window.location.hostname === "localhost") ? undefined : window.location.hostname);
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

/** Separate in-memory PKCE flow: never replace the website's auth behavior or
 * persist provider tokens. Only the verified Supabase session is handed back. */
export function createMobileGoogleClient() {
  if (!isMobileApp || !getSupabaseBrowserClient() || !supabaseUrl || !supabasePublishableKey) throw new Error("The app connection is unavailable.");
  return createClient<NeighborWalkDatabase>(supabaseUrl, supabasePublishableKey, {
    auth: { storageKey: authStorageKey() + "-google-flow", flowType: "pkce", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
