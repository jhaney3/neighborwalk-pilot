import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type NeighborWalkDatabase = {
  public: {
    Tables: {
      churches: {
        Row: {
          id: string;
          name: string;
          timezone: string;
          retention_days: number;
          default_follow_up_days: number;
          require_follow_up_consent: boolean;
          note_character_limit: number;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          timezone?: string;
          retention_days?: number;
          default_follow_up_days?: number;
          require_follow_up_consent?: boolean;
          note_character_limit?: number;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<NeighborWalkDatabase["public"]["Tables"]["churches"]["Insert"]>;
        Relationships: [];
      };
      church_memberships: {
        Row: { church_id: string; user_id: string; role: "leader" | "volunteer"; active: boolean; joined_at: string };
        Insert: { church_id: string; user_id: string; role: "leader" | "volunteer"; active?: boolean; joined_at?: string };
        Update: { role?: "leader" | "volunteer"; active?: boolean };
        Relationships: [];
      };
      workspace_snapshots: {
        Row: { church_id: string; schema_version: number; data: Json; revision: number; updated_by: string; updated_at: string };
        Insert: { church_id: string; schema_version: number; data: Json; revision?: number; updated_by: string; updated_at?: string };
        Update: { schema_version?: number; data?: Json };
        Relationships: [];
      };
      parcels: {
        Row: {
          id: number;
          county_fips: string;
          gislink: string;
          situs_address: string | null;
          property_class: string | null;
          land_use: string | null;
          is_residential: boolean | null;
          geometry: unknown;
          source_updated_on: string | null;
          imported_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_church_workspace: {
        Args: { workspace_name: string; initial_data: Json; initial_schema_version: number };
        Returns: { church_id: string; role: "leader"; revision: number; data: Json }[];
      };
      parcels_in_view: {
        Args: {
          min_lat: number;
          min_long: number;
          max_lat: number;
          max_long: number;
          target_county_fips?: string;
          result_limit?: number;
        };
        Returns: {
          id: number;
          gislink: string;
          situs_address: string | null;
          property_class: string | null;
          land_use: string | null;
          is_residential: boolean | null;
          geometry: Json;
        }[];
      };
      parcels_in_view_v2: {
        Args: {
          min_lat: number;
          min_long: number;
          max_lat: number;
          max_long: number;
          result_limit?: number;
        };
        Returns: {
          id: number;
          county_fips: string;
          gislink: string;
          situs_address: string | null;
          property_class: string | null;
          land_use: string | null;
          is_residential: boolean | null;
          geometry: Json;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
let browserClient: SupabaseClient<NeighborWalkDatabase> | null = null;

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabasePublishableKey);
}

export function getSupabaseBrowserClient(): SupabaseClient<NeighborWalkDatabase> | null {
  if (!supabaseUrl || !supabasePublishableKey || typeof window === "undefined") return null;
  browserClient ??= createClient<NeighborWalkDatabase>(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}
