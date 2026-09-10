export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      church_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          church_id: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          invited_email: string
          revoked_at: string | null
          role: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          church_id: string
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          invited_email: string
          revoked_at?: string | null
          role: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          church_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          invited_email?: string
          revoked_at?: string | null
          role?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "church_invitations_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
      church_memberships: {
        Row: {
          active: boolean
          church_id: string
          display_name: string | null
          joined_at: string
          member_email: string | null
          role: string
          user_id: string
        }
        Insert: {
          active?: boolean
          church_id: string
          display_name?: string | null
          joined_at?: string
          member_email?: string | null
          role: string
          user_id: string
        }
        Update: {
          active?: boolean
          church_id?: string
          display_name?: string | null
          joined_at?: string
          member_email?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "church_memberships_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
      churches: {
        Row: {
          created_at: string
          created_by: string
          default_follow_up_days: number
          id: string
          name: string
          note_character_limit: number
          outreach_revision: number
          outreach_version: number
          pathway_enabled: boolean
          retention_days: number
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          default_follow_up_days?: number
          id?: string
          name: string
          note_character_limit?: number
          outreach_revision?: number
          outreach_version?: number
          pathway_enabled?: boolean
          retention_days?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          default_follow_up_days?: number
          id?: string
          name?: string
          note_character_limit?: number
          outreach_revision?: number
          outreach_version?: number
          pathway_enabled?: boolean
          retention_days?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversation_guide_preferences: {
        Row: {
          church_id: string
          favorite_guide_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          church_id: string
          favorite_guide_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          church_id?: string
          favorite_guide_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_guide_preferences_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_guide_preferences_guide_fkey"
            columns: ["favorite_guide_id", "church_id"]
            isOneToOne: false
            referencedRelation: "conversation_guides"
            referencedColumns: ["id", "church_id"]
          },
        ]
      }
      conversation_guide_team_defaults: {
        Row: {
          church_id: string
          guide_id: string
          team_id: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          church_id: string
          guide_id: string
          team_id: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          church_id?: string
          guide_id?: string
          team_id?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_guide_team_defaults_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_guide_team_defaults_guide_fkey"
            columns: ["guide_id", "church_id"]
            isOneToOne: false
            referencedRelation: "conversation_guides"
            referencedColumns: ["id", "church_id"]
          },
          {
            foreignKeyName: "conversation_guide_team_normalized_fk"
            columns: ["church_id", "team_id"]
            isOneToOne: true
            referencedRelation: "outreach_teams"
            referencedColumns: ["church_id", "id"]
          },
        ]
      }
      conversation_guides: {
        Row: {
          church_id: string
          created_at: string
          created_by: string
          description: string
          id: string
          owner_user_id: string | null
          scope: string
          sort_order: number
          steps: Json
          title: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          church_id: string
          created_at?: string
          created_by: string
          description?: string
          id?: string
          owner_user_id?: string | null
          scope: string
          sort_order?: number
          steps: Json
          title: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          church_id?: string
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          owner_user_id?: string | null
          scope?: string
          sort_order?: number
          steps?: Json
          title?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_guides_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
      discipleship_follow_ups: {
        Row: {
          church_id: string
          completed_at: string | null
          completion_note: string | null
          created_at: string
          created_by: string
          due_at: string
          history: Json
          id: string
          note: string | null
          parent_follow_up_id: string | null
          person_id: string
          property_id: string
          source_visit_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          church_id: string
          completed_at?: string | null
          completion_note?: string | null
          created_at?: string
          created_by: string
          due_at: string
          history?: Json
          id: string
          note?: string | null
          parent_follow_up_id?: string | null
          person_id: string
          property_id: string
          source_visit_id?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          church_id?: string
          completed_at?: string | null
          completion_note?: string | null
          created_at?: string
          created_by?: string
          due_at?: string
          history?: Json
          id?: string
          note?: string | null
          parent_follow_up_id?: string | null
          person_id?: string
          property_id?: string
          source_visit_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discipleship_follow_ups_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discipleship_follow_ups_person_fkey"
            columns: ["person_id", "church_id"]
            isOneToOne: false
            referencedRelation: "discipleship_people"
            referencedColumns: ["id", "church_id"]
          },
        ]
      }
      discipleship_people: {
        Row: {
          assigned_to: string
          church_id: string
          contact_permission: string
          created_at: string
          created_by: string
          deleted_at: string | null
          discipleship_stage: string
          email: string | null
          faith_status: string
          handoff_requested_at: string | null
          id: string
          last_contact_at: string | null
          legacy_creator_access: boolean
          legacy_property_id: string | null
          merged_at: string | null
          merged_into_id: string | null
          name: string | null
          next_step: string | null
          next_step_due_at: string | null
          pending_owner_id: string | null
          phone: string | null
          preferred_contact: string
          property_id: string | null
          shared_team_ids: string[]
          shared_user_ids: string[]
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          assigned_to: string
          church_id: string
          contact_permission?: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          discipleship_stage: string
          email?: string | null
          faith_status: string
          handoff_requested_at?: string | null
          id: string
          last_contact_at?: string | null
          legacy_creator_access?: boolean
          legacy_property_id?: string | null
          merged_at?: string | null
          merged_into_id?: string | null
          name?: string | null
          next_step?: string | null
          next_step_due_at?: string | null
          pending_owner_id?: string | null
          phone?: string | null
          preferred_contact: string
          property_id?: string | null
          shared_team_ids?: string[]
          shared_user_ids?: string[]
          status: string
          updated_at?: string
          version?: number
        }
        Update: {
          assigned_to?: string
          church_id?: string
          contact_permission?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          discipleship_stage?: string
          email?: string | null
          faith_status?: string
          handoff_requested_at?: string | null
          id?: string
          last_contact_at?: string | null
          legacy_creator_access?: boolean
          legacy_property_id?: string | null
          merged_at?: string | null
          merged_into_id?: string | null
          name?: string | null
          next_step?: string | null
          next_step_due_at?: string | null
          pending_owner_id?: string | null
          phone?: string | null
          preferred_contact?: string
          property_id?: string | null
          shared_team_ids?: string[]
          shared_user_ids?: string[]
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "discipleship_merge_tenant_fk"
            columns: ["merged_into_id", "church_id"]
            isOneToOne: false
            referencedRelation: "discipleship_people"
            referencedColumns: ["id", "church_id"]
          },
          {
            foreignKeyName: "discipleship_pending_owner_church_fkey"
            columns: ["church_id", "pending_owner_id"]
            isOneToOne: false
            referencedRelation: "church_memberships"
            referencedColumns: ["church_id", "user_id"]
          },
          {
            foreignKeyName: "discipleship_people_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discipleship_person_location_church_fkey"
            columns: ["church_id", "property_id"]
            isOneToOne: false
            referencedRelation: "outreach_locations"
            referencedColumns: ["church_id", "id"]
          },
        ]
      }
      discipleship_person_notes: {
        Row: {
          author_id: string
          body: string
          church_id: string
          created_at: string
          deleted_at: string | null
          id: string
          kind: string
          person_id: string
          version: number
        }
        Insert: {
          author_id: string
          body: string
          church_id: string
          created_at?: string
          deleted_at?: string | null
          id: string
          kind: string
          person_id: string
          version?: number
        }
        Update: {
          author_id?: string
          body?: string
          church_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: string
          person_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "discipleship_person_notes_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discipleship_person_notes_person_fkey"
            columns: ["person_id", "church_id"]
            isOneToOne: false
            referencedRelation: "discipleship_people"
            referencedColumns: ["id", "church_id"]
          },
        ]
      }
      outreach_assignments: {
        Row: {
          assignee_id: string | null
          church_id: string
          deleted_at: string | null
          id: string
          outing_id: string
          status: string
          team_id: string | null
          territory_id: string
          version: number
        }
        Insert: {
          assignee_id?: string | null
          church_id: string
          deleted_at?: string | null
          id: string
          outing_id: string
          status?: string
          team_id?: string | null
          territory_id: string
          version?: number
        }
        Update: {
          assignee_id?: string | null
          church_id?: string
          deleted_at?: string | null
          id?: string
          outing_id?: string
          status?: string
          team_id?: string | null
          territory_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_assignments_church_id_assignee_id_fkey"
            columns: ["church_id", "assignee_id"]
            isOneToOne: false
            referencedRelation: "church_memberships"
            referencedColumns: ["church_id", "user_id"]
          },
          {
            foreignKeyName: "outreach_assignments_church_id_outing_id_fkey"
            columns: ["church_id", "outing_id"]
            isOneToOne: false
            referencedRelation: "outreach_outings"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_assignments_church_id_team_id_fkey"
            columns: ["church_id", "team_id"]
            isOneToOne: false
            referencedRelation: "outreach_teams"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_assignments_church_id_territory_id_fkey"
            columns: ["church_id", "territory_id"]
            isOneToOne: false
            referencedRelation: "outreach_territories"
            referencedColumns: ["church_id", "id"]
          },
        ]
      }
      outreach_audit: {
        Row: {
          action: string
          actor_id: string
          church_id: string
          command_id: string
          details: Json
          entity_id: string
          entity_type: string
          occurred_at: string
          sequence: number
        }
        Insert: {
          action: string
          actor_id: string
          church_id: string
          command_id: string
          details?: Json
          entity_id: string
          entity_type: string
          occurred_at?: string
          sequence?: never
        }
        Update: {
          action?: string
          actor_id?: string
          church_id?: string
          command_id?: string
          details?: Json
          entity_id?: string
          entity_type?: string
          occurred_at?: string
          sequence?: never
        }
        Relationships: [
          {
            foreignKeyName: "outreach_audit_church_id_actor_id_fkey"
            columns: ["church_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "church_memberships"
            referencedColumns: ["church_id", "user_id"]
          },
          {
            foreignKeyName: "outreach_audit_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_encounters: {
        Row: {
          actor_id: string | null
          actor_key: string
          church_id: string
          context: string
          corrections: Json
          deleted_at: string | null
          device_id: string
          id: string
          legacy_links: Json
          location_id: string | null
          objective_note: string | null
          occurred_at: string
          outcome: string
          outing_id: string | null
          person_id: string | null
          received_at: string
          territory_id: string | null
          version: number
        }
        Insert: {
          actor_id?: string | null
          actor_key: string
          church_id: string
          context?: string
          corrections?: Json
          deleted_at?: string | null
          device_id: string
          id: string
          legacy_links?: Json
          location_id?: string | null
          objective_note?: string | null
          occurred_at: string
          outcome: string
          outing_id?: string | null
          person_id?: string | null
          received_at?: string
          territory_id?: string | null
          version?: number
        }
        Update: {
          actor_id?: string | null
          actor_key?: string
          church_id?: string
          context?: string
          corrections?: Json
          deleted_at?: string | null
          device_id?: string
          id?: string
          legacy_links?: Json
          location_id?: string | null
          objective_note?: string | null
          occurred_at?: string
          outcome?: string
          outing_id?: string | null
          person_id?: string | null
          received_at?: string
          territory_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_encounters_church_id_actor_id_fkey"
            columns: ["church_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "church_memberships"
            referencedColumns: ["church_id", "user_id"]
          },
          {
            foreignKeyName: "outreach_encounters_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_encounters_church_id_location_id_fkey"
            columns: ["church_id", "location_id"]
            isOneToOne: false
            referencedRelation: "outreach_locations"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_encounters_church_id_outing_id_fkey"
            columns: ["church_id", "outing_id"]
            isOneToOne: false
            referencedRelation: "outreach_outings"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_encounters_church_id_territory_id_fkey"
            columns: ["church_id", "territory_id"]
            isOneToOne: false
            referencedRelation: "outreach_territories"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_encounters_person_id_church_id_fkey"
            columns: ["person_id", "church_id"]
            isOneToOne: false
            referencedRelation: "discipleship_people"
            referencedColumns: ["id", "church_id"]
          },
        ]
      }
      outreach_locations: {
        Row: {
          address: string
          building_geometry: Json | null
          church_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          latitude: number | null
          legacy_territory_id: string | null
          longitude: number | null
          merged_at: string | null
          merged_into_id: string | null
          parcel_reference: Json | null
          source: string
          territory_id: string | null
          unit: string | null
          updated_at: string
          version: number
        }
        Insert: {
          address: string
          building_geometry?: Json | null
          church_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id: string
          latitude?: number | null
          legacy_territory_id?: string | null
          longitude?: number | null
          merged_at?: string | null
          merged_into_id?: string | null
          parcel_reference?: Json | null
          source?: string
          territory_id?: string | null
          unit?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          address?: string
          building_geometry?: Json | null
          church_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          latitude?: number | null
          legacy_territory_id?: string | null
          longitude?: number | null
          merged_at?: string | null
          merged_into_id?: string | null
          parcel_reference?: Json | null
          source?: string
          territory_id?: string | null
          unit?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_location_merge_tenant_fk"
            columns: ["church_id", "merged_into_id"]
            isOneToOne: false
            referencedRelation: "outreach_locations"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_locations_church_id_created_by_fkey"
            columns: ["church_id", "created_by"]
            isOneToOne: false
            referencedRelation: "church_memberships"
            referencedColumns: ["church_id", "user_id"]
          },
          {
            foreignKeyName: "outreach_locations_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_locations_church_id_territory_id_fkey"
            columns: ["church_id", "territory_id"]
            isOneToOne: false
            referencedRelation: "outreach_territories"
            referencedColumns: ["church_id", "id"]
          },
        ]
      }
      outreach_migration_issues: {
        Row: {
          church_id: string
          entity_id: string
          entity_type: string
          issue: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          church_id: string
          entity_id: string
          entity_type: string
          issue: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          church_id?: string
          entity_id?: string
          entity_type?: string
          issue?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_migration_issues_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_outings: {
        Row: {
          church_id: string
          debrief: string
          deleted_at: string | null
          ends_at: string
          guide_id: string | null
          id: string
          leader_contact: string
          meeting_point: string
          name: string
          purpose: string
          starts_at: string
          status: string
          timezone: string
          version: number
        }
        Insert: {
          church_id: string
          debrief?: string
          deleted_at?: string | null
          ends_at: string
          guide_id?: string | null
          id: string
          leader_contact?: string
          meeting_point?: string
          name: string
          purpose?: string
          starts_at: string
          status?: string
          timezone?: string
          version?: number
        }
        Update: {
          church_id?: string
          debrief?: string
          deleted_at?: string | null
          ends_at?: string
          guide_id?: string | null
          id?: string
          leader_contact?: string
          meeting_point?: string
          name?: string
          purpose?: string
          starts_at?: string
          status?: string
          timezone?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_outings_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_outings_guide_church_fkey"
            columns: ["guide_id", "church_id"]
            isOneToOne: false
            referencedRelation: "conversation_guides"
            referencedColumns: ["id", "church_id"]
          },
        ]
      }
      outreach_restrictions: {
        Row: {
          active: boolean
          channel: string
          church_id: string
          corrected_at: string | null
          corrected_by: string | null
          correction_reason: string | null
          created_at: string
          created_by: string | null
          id: string
          location_id: string | null
          origin_location_id: string | null
          origin_person_id: string | null
          person_id: string | null
          reason: string
          version: number
        }
        Insert: {
          active?: boolean
          channel: string
          church_id: string
          corrected_at?: string | null
          corrected_by?: string | null
          correction_reason?: string | null
          created_at?: string
          created_by?: string | null
          id: string
          location_id?: string | null
          origin_location_id?: string | null
          origin_person_id?: string | null
          person_id?: string | null
          reason: string
          version?: number
        }
        Update: {
          active?: boolean
          channel?: string
          church_id?: string
          corrected_at?: string | null
          corrected_by?: string | null
          correction_reason?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          origin_location_id?: string | null
          origin_person_id?: string | null
          person_id?: string | null
          reason?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_restriction_origin_location_fk"
            columns: ["church_id", "origin_location_id"]
            isOneToOne: false
            referencedRelation: "outreach_locations"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_restriction_origin_person_fk"
            columns: ["origin_person_id", "church_id"]
            isOneToOne: false
            referencedRelation: "discipleship_people"
            referencedColumns: ["id", "church_id"]
          },
          {
            foreignKeyName: "outreach_restrictions_church_id_corrected_by_fkey"
            columns: ["church_id", "corrected_by"]
            isOneToOne: false
            referencedRelation: "church_memberships"
            referencedColumns: ["church_id", "user_id"]
          },
          {
            foreignKeyName: "outreach_restrictions_church_id_created_by_fkey"
            columns: ["church_id", "created_by"]
            isOneToOne: false
            referencedRelation: "church_memberships"
            referencedColumns: ["church_id", "user_id"]
          },
          {
            foreignKeyName: "outreach_restrictions_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_restrictions_church_id_location_id_fkey"
            columns: ["church_id", "location_id"]
            isOneToOne: false
            referencedRelation: "outreach_locations"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_restrictions_person_id_church_id_fkey"
            columns: ["person_id", "church_id"]
            isOneToOne: false
            referencedRelation: "discipleship_people"
            referencedColumns: ["id", "church_id"]
          },
        ]
      }
      outreach_task_activity: {
        Row: {
          action: string
          actor_id: string | null
          actor_key: string
          church_id: string
          due_date: string | null
          id: string
          note: string | null
          occurred_at: string
          task_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_key: string
          church_id: string
          due_date?: string | null
          id: string
          note?: string | null
          occurred_at?: string
          task_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_key?: string
          church_id?: string
          due_date?: string | null
          id?: string
          note?: string | null
          occurred_at?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_task_activity_church_id_actor_id_fkey"
            columns: ["church_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "church_memberships"
            referencedColumns: ["church_id", "user_id"]
          },
          {
            foreignKeyName: "outreach_task_activity_church_id_task_id_fkey"
            columns: ["church_id", "task_id"]
            isOneToOne: false
            referencedRelation: "outreach_tasks"
            referencedColumns: ["church_id", "id"]
          },
        ]
      }
      outreach_tasks: {
        Row: {
          acceptance: string
          channel: string
          church_id: string
          completed_at: string | null
          completion_note: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          due_date: string
          encounter_id: string | null
          id: string
          legacy_due_at: string | null
          legacy_links: Json
          location_id: string | null
          note: string | null
          outing_id: string | null
          owner_id: string | null
          parent_task_id: string | null
          person_id: string | null
          status: string
          team_id: string | null
          version: number
        }
        Insert: {
          acceptance?: string
          channel?: string
          church_id: string
          completed_at?: string | null
          completion_note?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          due_date: string
          encounter_id?: string | null
          id: string
          legacy_due_at?: string | null
          legacy_links?: Json
          location_id?: string | null
          note?: string | null
          outing_id?: string | null
          owner_id?: string | null
          parent_task_id?: string | null
          person_id?: string | null
          status?: string
          team_id?: string | null
          version?: number
        }
        Update: {
          acceptance?: string
          channel?: string
          church_id?: string
          completed_at?: string | null
          completion_note?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          due_date?: string
          encounter_id?: string | null
          id?: string
          legacy_due_at?: string | null
          legacy_links?: Json
          location_id?: string | null
          note?: string | null
          outing_id?: string | null
          owner_id?: string | null
          parent_task_id?: string | null
          person_id?: string | null
          status?: string
          team_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_tasks_church_id_created_by_fkey"
            columns: ["church_id", "created_by"]
            isOneToOne: false
            referencedRelation: "church_memberships"
            referencedColumns: ["church_id", "user_id"]
          },
          {
            foreignKeyName: "outreach_tasks_church_id_encounter_id_fkey"
            columns: ["church_id", "encounter_id"]
            isOneToOne: false
            referencedRelation: "outreach_encounters"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_tasks_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_tasks_church_id_location_id_fkey"
            columns: ["church_id", "location_id"]
            isOneToOne: false
            referencedRelation: "outreach_locations"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_tasks_church_id_outing_id_fkey"
            columns: ["church_id", "outing_id"]
            isOneToOne: false
            referencedRelation: "outreach_outings"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_tasks_church_id_owner_id_fkey"
            columns: ["church_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "church_memberships"
            referencedColumns: ["church_id", "user_id"]
          },
          {
            foreignKeyName: "outreach_tasks_church_id_team_id_fkey"
            columns: ["church_id", "team_id"]
            isOneToOne: false
            referencedRelation: "outreach_teams"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_tasks_parent_tenant_fk"
            columns: ["church_id", "parent_task_id"]
            isOneToOne: false
            referencedRelation: "outreach_tasks"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_tasks_person_id_church_id_fkey"
            columns: ["person_id", "church_id"]
            isOneToOne: false
            referencedRelation: "discipleship_people"
            referencedColumns: ["id", "church_id"]
          },
        ]
      }
      outreach_team_members: {
        Row: {
          church_id: string
          team_id: string
          user_id: string | null
          volunteer_id: string
        }
        Insert: {
          church_id: string
          team_id: string
          user_id?: string | null
          volunteer_id: string
        }
        Update: {
          church_id?: string
          team_id?: string
          user_id?: string | null
          volunteer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_team_members_church_id_team_id_fkey"
            columns: ["church_id", "team_id"]
            isOneToOne: false
            referencedRelation: "outreach_teams"
            referencedColumns: ["church_id", "id"]
          },
          {
            foreignKeyName: "outreach_team_members_church_id_user_id_fkey"
            columns: ["church_id", "user_id"]
            isOneToOne: false
            referencedRelation: "church_memberships"
            referencedColumns: ["church_id", "user_id"]
          },
        ]
      }
      outreach_teams: {
        Row: {
          church_id: string
          deleted_at: string | null
          id: string
          legacy_event_id: string | null
          name: string
          status: string
          version: number
        }
        Insert: {
          church_id: string
          deleted_at?: string | null
          id: string
          legacy_event_id?: string | null
          name: string
          status?: string
          version?: number
        }
        Update: {
          church_id?: string
          deleted_at?: string | null
          id?: string
          legacy_event_id?: string | null
          name?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_teams_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_territories: {
        Row: {
          boundary: Json
          church_id: string
          color: string
          deleted_at: string | null
          id: string
          kind: string
          latitude: number | null
          legacy_event_id: string | null
          longitude: number | null
          name: string
          version: number
          zoom: number
        }
        Insert: {
          boundary?: Json
          church_id: string
          color?: string
          deleted_at?: string | null
          id: string
          kind?: string
          latitude?: number | null
          legacy_event_id?: string | null
          longitude?: number | null
          name: string
          version?: number
          zoom?: number
        }
        Update: {
          boundary?: Json
          church_id?: string
          color?: string
          deleted_at?: string | null
          id?: string
          kind?: string
          latitude?: number | null
          legacy_event_id?: string | null
          longitude?: number | null
          name?: string
          version?: number
          zoom?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_territories_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
      parcels: {
        Row: {
          county_fips: string
          geometry: unknown
          gislink: string
          id: number
          imported_at: string
          is_residential: boolean | null
          land_use: string | null
          property_class: string | null
          situs_address: string | null
          source_updated_on: string | null
        }
        Insert: {
          county_fips: string
          geometry: unknown
          gislink: string
          id?: never
          imported_at?: string
          is_residential?: boolean | null
          land_use?: string | null
          property_class?: string | null
          situs_address?: string | null
          source_updated_on?: string | null
        }
        Update: {
          county_fips?: string
          geometry?: unknown
          gislink?: string
          id?: never
          imported_at?: string
          is_residential?: boolean | null
          land_use?: string | null
          property_class?: string | null
          situs_address?: string | null
          source_updated_on?: string | null
        }
        Relationships: []
      }
      workspace_snapshots: {
        Row: {
          church_id: string
          data: Json
          revision: number
          schema_version: number
          updated_at: string
          updated_by: string
        }
        Insert: {
          church_id: string
          data: Json
          revision?: number
          schema_version: number
          updated_at?: string
          updated_by: string
        }
        Update: {
          church_id?: string
          data?: Json
          revision?: number
          schema_version?: number
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_snapshots_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: true
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_church_invitation: {
        Args: { invitation_token: string }
        Returns: {
          church_id: string
          display_name: string
          member_email: string
          role: string
          user_id: string
        }[]
      }
      create_church_invitation: {
        Args: {
          invitation_role?: string
          invited_email: string
          valid_for_hours?: number
        }
        Returns: {
          email: string
          expires_at: string
          invitation_id: string
          invitation_token: string
          role: string
        }[]
      }
      create_church_workspace: {
        Args: {
          initial_data: Json
          initial_schema_version: number
          workspace_name: string
        }
        Returns: {
          church_id: string
          data: Json
          revision: number
          role: string
        }[]
      }
      outreach_admin_action: { Args: { request: Json }; Returns: Json }
      outreach_apply_command: { Args: { command: Json }; Returns: Json }
      outreach_read_records: {
        Args: {
          after_id?: string
          entity_kind: string
          page_size?: number
          target_church: string
        }
        Returns: {
          id: string
          record: Json
          version: number
        }[]
      }
      outreach_reminder_preference: {
        Args: { enabled?: boolean; target_church: string }
        Returns: Json
      }
      outreach_reminder_worker: {
        Args: { action: string; args?: Json }
        Returns: Json
      }
      outreach_update_member: {
        Args: {
          expected_active: boolean
          expected_role: string
          member_active: boolean
          member_role: string
          reason: string
          target_user_id: string
        }
        Returns: Json
      }
      outreach_workspace_info: {
        Args: { target_church: string }
        Returns: Json
      }
      parcel_dataset_revision_v1: { Args: never; Returns: string }
      parcels_for_territory_v1: {
        Args: {
          buffer_meters?: number
          result_limit?: number
          territory_geometry: Json
        }
        Returns: Json
      }
      parcels_in_view: {
        Args: {
          max_lat: number
          max_long: number
          min_lat: number
          min_long: number
          result_limit?: number
          target_county_fips?: string
        }
        Returns: {
          geometry: Json
          gislink: string
          id: number
          is_residential: boolean
          land_use: string
          property_class: string
          situs_address: string
        }[]
      }
      parcels_in_view_v2: {
        Args: {
          max_lat: number
          max_long: number
          min_lat: number
          min_long: number
          result_limit?: number
        }
        Returns: {
          county_fips: string
          geometry: Json
          gislink: string
          id: number
          is_residential: boolean
          land_use: string
          property_class: string
          situs_address: string
        }[]
      }
      revoke_church_invitation: {
        Args: { invitation_id: string }
        Returns: boolean
      }
      update_church_member: {
        Args: {
          member_active: boolean
          member_role: string
          target_user_id: string
        }
        Returns: {
          active: boolean
          role: string
          user_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
