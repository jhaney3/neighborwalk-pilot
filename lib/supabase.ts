import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertSafeSupabaseUrl, isProductionApp, storageKey } from "./environment";

import type { Database } from "./database.types";
export type { Json } from "./database.types";
export type NeighborWalkDatabase = Database;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
let browserClient: SupabaseClient<NeighborWalkDatabase> | null = null;

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabasePublishableKey);
}

export function getSupabaseBrowserClient(): SupabaseClient<NeighborWalkDatabase> | null {
  if (!supabaseUrl || !supabasePublishableKey || typeof window === "undefined") return null;
  assertSafeSupabaseUrl(supabaseUrl, isProductionApp, window.location.hostname);
  browserClient ??= createClient<NeighborWalkDatabase>(supabaseUrl, supabasePublishableKey, {
    auth: {
      ...(!isProductionApp && { storageKey: storageKey("neighborwalk-auth") }),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}
