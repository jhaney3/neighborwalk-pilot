import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  createId,
  type ConversationGuide,
  type ConversationGuideInput,
  type GuideStep,
} from "./domain";
import type { Json, NeighborWalkDatabase } from "./supabase";

type GuideRow = NeighborWalkDatabase["public"]["Tables"]["conversation_guides"]["Row"];

export type GuideLibraryState = {
  guides: ConversationGuide[];
  favoriteGuideId?: string;
};

const LOCAL_GUIDE_LIBRARY_KEY = "neighborwalk-conversation-guides-v1";

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

export function preferredConversationGuide(guides: ConversationGuide[], favoriteGuideId?: string) {
  return guides.find((guide) => guide.id === favoriteGuideId)
    ?? guides.find((guide) => guide.scope === "church")
    ?? guides[0];
}

export function readLocalGuideLibrary(churchId: string, legacySteps: GuideStep[]): GuideLibraryState {
  try {
    const parsed = localGuideLibrarySchema.safeParse(JSON.parse(window.localStorage.getItem(LOCAL_GUIDE_LIBRARY_KEY) ?? "null"));
    if (parsed.success && parsed.data.guides.some((guide) => guide.churchId === churchId)) {
      const guides = parsed.data.guides.filter((guide) => guide.churchId === churchId);
      return {
        guides,
        favoriteGuideId: guides.some((guide) => guide.id === parsed.data.favoriteGuideId)
          ? parsed.data.favoriteGuideId
          : undefined,
      };
    }
  } catch {
    // A malformed device cache should not prevent the field app from opening.
  }
  const fallback = legacyConversationGuide(churchId, legacySteps);
  return { guides: [fallback], favoriteGuideId: fallback.id };
}

export function writeLocalGuideLibrary(state: GuideLibraryState) {
  window.localStorage.setItem(LOCAL_GUIDE_LIBRARY_KEY, JSON.stringify(state));
}

function guideFromRow(row: GuideRow): ConversationGuide | null {
  const parsedSteps = z.array(guideStepSchema).min(1).max(24).safeParse(row.steps);
  if (!parsedSteps.success) return null;
  const parsedGuide = conversationGuideSchema.safeParse({
    id: row.id,
    churchId: row.church_id,
    scope: row.scope,
    ownerUserId: row.owner_user_id ?? undefined,
    title: row.title,
    description: row.description,
    steps: normalizeGuideSteps(parsedSteps.data),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  return parsedGuide.success ? parsedGuide.data : null;
}

export async function loadConnectedGuideLibrary(
  client: SupabaseClient<NeighborWalkDatabase>,
  churchId: string,
  userId: string,
): Promise<GuideLibraryState> {
  const [guideResult, preferenceResult] = await Promise.all([
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
  ]);
  if (guideResult.error) throw guideResult.error;
  if (preferenceResult.error) throw preferenceResult.error;
  const guides = (guideResult.data ?? []).flatMap((row) => {
    const guide = guideFromRow(row);
    return guide ? [guide] : [];
  });
  const favoriteGuideId = preferenceResult.data?.favorite_guide_id;
  return {
    guides,
    favoriteGuideId: guides.some((guide) => guide.id === favoriteGuideId) ? favoriteGuideId : undefined,
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
  const guide = guideFromRow(result.data);
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
