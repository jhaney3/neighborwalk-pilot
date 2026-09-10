import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { storageKey } from "./environment";
import {
  createId,
  type ConversationGuide,
  type ConversationGuideInput,
  type GuideStep,
  type Team,
} from "./domain";
import type { Json, NeighborWalkDatabase } from "./supabase";

type GuideRow = NeighborWalkDatabase["public"]["Tables"]["conversation_guides"]["Row"];

export type GuideLibraryState = {
  guides: ConversationGuide[];
  favoriteGuideId?: string;
  teamGuideDefaults: Record<string, string>;
};

const LOCAL_GUIDE_LIBRARY_KEY = storageKey("neighborwalk-conversation-guides-v1");

const guideStepSchema: z.ZodType<GuideStep> = z.object({
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
      const guides = parsed.data.guides.filter((guide) => guide.churchId === churchId && (guide.scope === "church" || guide.ownerUserId === userId));
      return {
        guides,
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
  });
  return parsedGuide.success ? parsedGuide.data : null;
}

export async function loadConnectedGuideLibrary(
  client: SupabaseClient<NeighborWalkDatabase>,
  churchId: string,
  userId: string,
): Promise<GuideLibraryState> {
  const [guideResult, preferenceResult, teamDefaultsResult] = await Promise.all([
    client
      .from("conversation_guides")
      .select("id, church_id, scope, owner_user_id, title, description, steps, sort_order, created_by, updated_by, created_at, updated_at")
      .eq("church_id", churchId)
      .order("sort_order")
      .order("created_at"),
    client
      .from("conversation_guide_preferences")
      .select("favorite_guide_id")
      .eq("church_id", churchId)
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("conversation_guide_team_defaults")
      .select("team_id, guide_id")
      .eq("church_id", churchId),
  ]);
  if (guideResult.error) throw guideResult.error;
  if (preferenceResult.error) throw preferenceResult.error;
  if (teamDefaultsResult.error) throw teamDefaultsResult.error;
  const guides = (guideResult.data ?? []).flatMap((row) => {
    const guide = conversationGuideFromRow(row);
    return guide ? [guide] : [];
  });
  const favoriteGuideId = preferenceResult.data?.favorite_guide_id;
  return {
    guides,
    favoriteGuideId: guides.some((guide) => guide.id === favoriteGuideId) ? favoriteGuideId : undefined,
    teamGuideDefaults: Object.fromEntries(
      (teamDefaultsResult.data ?? [])
        .filter((item) => guides.some((guide) => guide.id === item.guide_id && guide.scope === "church"))
        .map((item) => [item.team_id, item.guide_id]),
    ),
  };
}

export async function saveConnectedGuide(
  client: SupabaseClient<NeighborWalkDatabase>,
  input: ConversationGuideInput,
  churchId: string,
  userId: string,
  sortOrder: number,
): Promise<ConversationGuide> {
  if (!validGuideInput(input)) throw new Error("Finish each guide step before saving.");
  const normalized = {
    title: input.title.trim(),
    description: input.description.trim(),
    steps: normalizeGuideSteps(input.steps) as unknown as Json,
  };
  const result = input.id
    ? await client
      .from("conversation_guides")
      .update(normalized)
      .eq("id", input.id)
      .select("id, church_id, scope, owner_user_id, title, description, steps, sort_order, created_by, updated_by, created_at, updated_at")
      .single()
    : await client
      .from("conversation_guides")
      .insert({
        church_id: churchId,
        scope: input.scope,
        owner_user_id: input.scope === "personal" ? userId : null,
        ...normalized,
        sort_order: sortOrder,
        created_by: userId,
        updated_by: userId,
      })
      .select("id, church_id, scope, owner_user_id, title, description, steps, sort_order, created_by, updated_by, created_at, updated_at")
      .single();
  if (result.error) throw result.error;
  const guide = conversationGuideFromRow(result.data);
  if (!guide) throw new Error("The saved guide could not be read.");
  return guide;
}

export async function deleteConnectedGuide(
  client: SupabaseClient<NeighborWalkDatabase>,
  guideId: string,
) {
  const { error } = await client.from("conversation_guides").delete().eq("id", guideId);
  if (error) throw error;
}

export async function saveConnectedFavorite(
  client: SupabaseClient<NeighborWalkDatabase>,
  churchId: string,
  userId: string,
  guideId: string,
) {
  const { error } = await client.from("conversation_guide_preferences").upsert({
    church_id: churchId,
    user_id: userId,
    favorite_guide_id: guideId,
  }, { onConflict: "church_id,user_id" });
  if (error) throw error;
}

export async function saveConnectedTeamGuideDefault(
  client: SupabaseClient<NeighborWalkDatabase>,
  churchId: string,
  userId: string,
  teamId: string,
  guideId?: string,
) {
  if (!guideId) {
    const { error } = await client
      .from("conversation_guide_team_defaults")
      .delete()
      .eq("church_id", churchId)
      .eq("team_id", teamId);
    if (error) throw error;
    return;
  }
  const { error } = await client.from("conversation_guide_team_defaults").upsert({
    church_id: churchId,
    team_id: teamId,
    guide_id: guideId,
    updated_by: userId,
  }, { onConflict: "church_id,team_id" });
  if (error) throw error;
}
