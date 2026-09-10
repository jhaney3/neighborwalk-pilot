import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { storageKey } from "./environment";
import { IncompleteCollectionError, readCompletePages } from "./complete-pages";
import {
  createId,
  type ConversationGuide,
  type ConversationGuideInput,
  type GuideStep,
  type Team,
} from "./domain";
import type { NeighborWalkDatabase } from "./supabase";

type DatabaseGuideRow = NeighborWalkDatabase["public"]["Tables"]["conversation_guides"]["Row"];
type GuideRow = Omit<DatabaseGuideRow, "version" | "archived_at"> & Partial<Pick<DatabaseGuideRow, "version" | "archived_at">>;

export class GuideLibraryReadError extends Error {}
export function guideLibraryErrorMessage(error: unknown) {
  // Only our controlled content-free messages may appear in the field UI.
  return error instanceof GuideLibraryReadError || error instanceof IncompleteCollectionError ? error.message
    : "Could not refresh guides. Reconnect and try again; saved guides have not been replaced.";
}

export type GuideLibraryState = {
  guides: ConversationGuide[];
  favoriteGuideId?: string;
  teamGuideDefaults: Record<string, string>;
  revision?: number;
  favoriteVersion?: number;
  teamGuideVersions?: Record<string, number>;
};

const LOCAL_GUIDE_LIBRARY_KEY = storageKey("neighborwalk-conversation-guides-v1");

export const guideStepSchema: z.ZodType<GuideStep> = z.object({
  id: z.string().min(1),
  order: z.number().int().min(1),
  eyebrow: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  coaching: z.string().max(800),
  sampleWords: z.string().max(1600),
  reminder: z.string().max(800),
  scriptureReferences: z.array(z.string().min(1).max(100)).max(12),
});

const conversationGuideSchema: z.ZodType<ConversationGuide> = z.object({
  id: z.string().min(1),
  churchId: z.string().min(1),
  scope: z.enum(["church", "personal"]),
  ownerUserId: z.string().min(1).optional(),
  title: z.string().min(1).max(120),
  description: z.string().max(500),
  steps: z.array(guideStepSchema).min(1).max(24),
  sortOrder: z.number().int().min(0).max(10000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive().optional(),
}).superRefine((guide, context) => {
  if (guide.scope === "personal" && !guide.ownerUserId) {
    context.addIssue({ code: "custom", path: ["ownerUserId"], message: "Personal guides require an owner." });
  }
  if (guide.scope === "church" && guide.ownerUserId) {
    context.addIssue({ code: "custom", path: ["ownerUserId"], message: "Church guides cannot have a personal owner." });
  }
});

const localGuideLibrarySchema = z.object({
  guides: z.array(conversationGuideSchema),
  favoriteGuideId: z.string().min(1).optional(),
  teamGuideDefaults: z.record(z.string(), z.string()).default({}),
  revision: z.number().int().nonnegative().optional(),
  favoriteVersion: z.number().int().nonnegative().optional(),
  teamGuideVersions: z.record(z.string(), z.number().int().positive()).optional(),
});

export function makeBlankGuideStep(order: number): GuideStep {
  return {
    id: createId("guide_step"),
    order,
    eyebrow: `Step ${order}`,
    title: "",
    coaching: "",
    sampleWords: "",
    reminder: "",
    scriptureReferences: [],
  };
}

export function normalizeGuideSteps(steps: GuideStep[]): GuideStep[] {
  return steps.map((step, index) => ({
    ...step,
    order: index + 1,
    eyebrow: step.eyebrow.trim(),
    title: step.title.trim(),
    coaching: step.coaching.trim(),
    sampleWords: step.sampleWords.trim(),
    reminder: step.reminder.trim(),
    scriptureReferences: [...new Set(step.scriptureReferences.map((reference) => reference.trim()).filter(Boolean))],
  }));
}

export function validGuideInput(input: ConversationGuideInput): boolean {
  const steps = normalizeGuideSteps(input.steps);
  return input.title.trim().length > 0
    && input.title.trim().length <= 120
    && input.description.trim().length <= 500
    && steps.length >= 1
    && steps.length <= 24
    && steps.every((step) => guideStepSchema.safeParse(step).success
      && (step.sampleWords.length > 0 || step.scriptureReferences.length > 0));
}

export function legacyConversationGuide(churchId: string, steps: GuideStep[]): ConversationGuide {
  const now = new Date().toISOString();
  return {
    id: "legacy_church_guide",
    churchId,
    scope: "church",
    title: "Listen, share, invite",
    description: "A permission-first guide for listening well, sharing clearly, and leaving room for a next step.",
    steps: normalizeGuideSteps(steps),
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function preferredConversationGuide(
  guides: ConversationGuide[],
  favoriteGuideId?: string,
  teamDefaultGuideId?: string,
) {
  return resolveFieldGuide(guides, { favoriteGuideId, teamDefaultGuideId }).guide;
}

/** The label comes from the guide actually available, never from a stale ID.
 * Outings/groups may select church guides, not a private member's library. */
export function resolveFieldGuide(guides: ConversationGuide[], options: { outingGuideId?: string; teamDefaultGuideId?: string; favoriteGuideId?: string }) {
  const outing = guides.find((guide) => guide.id === options.outingGuideId && guide.scope === "church");
  if (outing) return { guide: outing, source: "outing" as const };
  const group = guides.find((guide) => guide.id === options.teamDefaultGuideId && guide.scope === "church");
  if (group) return { guide: group, source: "group" as const };
  const favorite = guides.find((guide) => guide.id === options.favoriteGuideId);
  if (favorite) return { guide: favorite, source: "favorite" as const };
  const church = guides.find((guide) => guide.scope === "church");
  if (church) return { guide: church, source: "church" as const };
  return guides[0] ? { guide: guides[0], source: "personal" as const } : { guide: undefined, source: undefined };
}

export function conversationGuideTeam(
  teams: Team[],
  volunteerId: string,
  territoryTeamId?: string,
) {
  const memberships = teams.filter((team) => team.memberIds.includes(volunteerId));
  return memberships.find((team) => team.id === territoryTeamId)
    ?? memberships.find((team) => team.status === "active")
    ?? memberships.find((team) => team.status === "ready")
    ?? memberships[0];
}

function guideStorageKey(churchId: string, userId?: string) {
  return `${LOCAL_GUIDE_LIBRARY_KEY}:${JSON.stringify([userId ?? "demo", churchId])}`;
}

export function readLocalGuideLibrary(churchId: string, legacySteps: GuideStep[], userId?: string): GuideLibraryState {
  try {
    const parsed = localGuideLibrarySchema.safeParse(JSON.parse(window.localStorage.getItem(guideStorageKey(churchId, userId)) ?? "null"));
    if (parsed.success) {
      const guides = parsed.data.guides.filter((guide) => guide.churchId === churchId && (guide.scope === "church" || !userId || guide.ownerUserId === userId));
      return {
        guides,
        revision: parsed.data.revision,
        favoriteVersion: parsed.data.favoriteVersion,
        teamGuideVersions: parsed.data.teamGuideVersions,
        favoriteGuideId: guides.some((guide) => guide.id === parsed.data.favoriteGuideId)
          ? parsed.data.favoriteGuideId
          : undefined,
        teamGuideDefaults: Object.fromEntries(
          Object.entries(parsed.data.teamGuideDefaults)
            .filter(([, guideId]) => guides.some((guide) => guide.id === guideId && guide.scope === "church")),
        ),
      };
    }
  } catch {
    // A malformed device cache should not prevent the field app from opening.
  }
  if (userId) return { guides: [], teamGuideDefaults: {} };
  const fallback = legacyConversationGuide(churchId, legacySteps);
  return { guides: [fallback], favoriteGuideId: fallback.id, teamGuideDefaults: {} };
}

export function writeLocalGuideLibrary(state: GuideLibraryState, churchId = state.guides[0]?.churchId ?? "demo", userId?: string) {
  window.localStorage.setItem(guideStorageKey(churchId, userId), JSON.stringify(state));
}

function canonicalIsoTimestamp(value: string): string | null {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

export function conversationGuideFromRow(row: GuideRow): ConversationGuide | null {
  if (row.archived_at) return null;
  const parsedSteps = z.array(guideStepSchema).min(1).max(24).safeParse(row.steps);
  const createdAt = canonicalIsoTimestamp(row.created_at);
  const updatedAt = canonicalIsoTimestamp(row.updated_at);
  if (!parsedSteps.success || !createdAt || !updatedAt) return null;
  const parsedGuide = conversationGuideSchema.safeParse({
    id: row.id,
    churchId: row.church_id,
    scope: row.scope,
    ownerUserId: row.owner_user_id ?? undefined,
    title: row.title,
    description: row.description,
    steps: normalizeGuideSteps(parsedSteps.data),
    sortOrder: row.sort_order,
    createdAt,
    updatedAt,
    version: row.version,
  });
  return parsedGuide.success ? parsedGuide.data : null;
}

const guideStateSchema = z.object({
  apiVersion: z.literal(1), churchId: z.string().uuid(), userId: z.string().uuid(),
  revision: z.number().int().nonnegative(), favoriteVersion: z.number().int().nonnegative(),
  favoriteGuideId: z.string().uuid().nullable(),
});
export async function connectedGuideState(client: SupabaseClient<NeighborWalkDatabase>, churchId: string, userId: string) {
  const { data, error } = await client.rpc("outreach_guide_state", { target_church: churchId });
  if (error) throw error;
  const state = guideStateSchema.parse(data);
  if (state.churchId !== churchId || state.userId !== userId) throw new GuideLibraryReadError("Guide access changed. Sign in again before refreshing this library.");
  return state;
}

export async function loadConnectedGuideLibrary(
  client: SupabaseClient<NeighborWalkDatabase>,
  churchId: string,
  userId: string,
): Promise<GuideLibraryState> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await connectedGuideState(client, churchId, userId);
    const [guideResult, teamDefaultsResult] = await Promise.all([
      readCompletePages((cursor) => {
        const query = client.from("conversation_guides")
          .select("id, church_id, scope, owner_user_id, title, description, steps, sort_order, created_by, updated_by, created_at, updated_at, version, archived_at")
          .eq("church_id", churchId).is("archived_at", null).order("id").limit(100);
        return cursor ? query.gt("id", cursor) : query;
      }, (row) => row.id),
      readCompletePages((cursor) => {
        const query = client.from("conversation_guide_team_defaults")
          .select("team_id, guide_id, version, outreach_teams!conversation_guide_team_normalized_fk!inner(deleted_at)")
          .eq("church_id", churchId).is("outreach_teams.deleted_at", null).order("team_id").limit(100);
        return cursor ? query.gt("team_id", cursor) : query;
      }, (row) => row.team_id),
    ]);
    const after = await connectedGuideState(client, churchId, userId);
    if (before.revision !== after.revision) continue;
    const guides = guideResult.map((row) => {
      const guide = conversationGuideFromRow(row);
      if (!guide || !guide.version || guide.churchId !== churchId || (guide.scope === "personal" && guide.ownerUserId !== userId)) {
        throw new GuideLibraryReadError("A guide could not be safely read. The saved library was not replaced; ask your leader to review guide content and access.");
      }
      return guide;
    }).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const accessible = new Map(guides.map((guide) => [guide.id, guide]));
    const favoriteGuideId = after.favoriteGuideId ?? undefined;
    if ((favoriteGuideId && !accessible.has(favoriteGuideId)) || teamDefaultsResult.some((item) =>
      !Number.isSafeInteger(item.version) || item.version < 1 || (item.guide_id !== null && accessible.get(item.guide_id)?.scope !== "church"))) {
      throw new GuideLibraryReadError("Guide choices changed or contain an unavailable reference. Refresh before continuing; the saved library was not replaced.");
    }
    return {
      guides, favoriteGuideId, revision: after.revision, favoriteVersion: after.favoriteVersion,
      teamGuideDefaults: Object.fromEntries(teamDefaultsResult.filter((item) => item.guide_id !== null).map((item) => [item.team_id, item.guide_id!])),
      teamGuideVersions: Object.fromEntries(teamDefaultsResult.map((item) => [item.team_id, item.version])),
    };
  }
  throw new GuideLibraryReadError("The church changed repeatedly while guides were loading. Try again shortly; the saved library was not replaced.");
}
