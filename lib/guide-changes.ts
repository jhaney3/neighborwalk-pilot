import { z } from "zod";
import { createId, type ConversationGuide, type ConversationGuideInput } from "./domain";
import { guideStepSchema, normalizeGuideSteps, validGuideInput, type GuideLibraryState } from "./conversation-guides";
import { apiError } from "./outreach-client";
import type { Json } from "./database.types";
import { getSupabaseBrowserClient } from "./supabase";
import { finishGuideChange, pendingGuideChange, preserveGuideChange, type PendingGuideChange, type StorageScope } from "./storage";

const shared = { expectedVersion: z.number().int().nonnegative(), guideId: z.string().uuid().nullable() };
export const guideChangeInputSchema = z.discriminatedUnion("action", [
  z.object({ ...shared, action: z.literal("save"), guideId: z.string().uuid(), content: z.object({
    scope: z.enum(["church", "personal"]), title: z.string().trim().min(1).max(120), description: z.string().trim().max(500),
    steps: z.array(guideStepSchema).min(1).max(24), sortOrder: z.number().int().min(0).max(10_000),
  }).strict() }).strict(),
  z.object({ ...shared, action: z.literal("archive"), guideId: z.string().uuid(), confirmation: z.literal("ARCHIVE GUIDE; KEEP HISTORY") }).strict(),
  z.object({ ...shared, action: z.literal("favorite") }).strict(),
  z.object({ ...shared, action: z.literal("group_default"), teamId: z.string().min(1).max(190) }).strict(),
]);
const guideRequestIdentity = z.object({ schemaVersion: z.literal(1), id: z.string().min(1).max(180), churchId: z.string().uuid(), userId: z.string().uuid() });
export type GuideChangeInput = z.infer<typeof guideChangeInputSchema>;
export type GuideChangeRequest = GuideChangeInput & z.infer<typeof guideRequestIdentity>;
export function parseGuideChangeRequest(value: unknown): GuideChangeRequest {
  const identity = guideRequestIdentity.parse(value);
  const input = { ...(value as Record<string, unknown>) };
  for (const key of Object.keys(identity)) delete input[key];
  return { ...guideChangeInputSchema.parse(input), ...identity };
}
const serverTimestamp = z.string().refine((value) => Number.isFinite(Date.parse(value))).transform((value) => new Date(value).toISOString());
const resultSchema = z.object({ action: z.enum(["save", "archive", "favorite", "group_default"]), guideId: z.string().uuid().nullable(), teamId: z.string().nullable(),
  version: z.number().int().positive(), revision: z.number().int().nonnegative(), savedAt: serverTimestamp, createdAt: serverTimestamp.nullable() });
export type GuideChangeResult = z.infer<typeof resultSchema>;

export function savedGuideFromReceipt(request: GuideChangeRequest, result: GuideChangeResult): ConversationGuide {
  if (request.action !== "save" || !result.createdAt) throw new Error("This receipt is not a saved guide.");
  return { id: request.guideId, churchId: request.churchId, ...request.content,
    ownerUserId: request.content.scope === "personal" ? request.userId : undefined,
    version: result.version, createdAt: result.createdAt, updatedAt: result.savedAt };
}
export function applyGuideReceipt(current: GuideLibraryState, request: GuideChangeRequest, result: GuideChangeResult): GuideLibraryState {
  // A late receipt must not replace a more recent connected refresh.
  if (current.revision !== undefined && current.revision > result.revision) return current;
  const next = { ...current, revision: result.revision };
  if (request.action === "save") {
    const saved = savedGuideFromReceipt(request, result);
    next.guides = [...current.guides.filter((guide) => guide.id !== saved.id), saved]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  } else if (request.action === "archive") {
    next.guides = current.guides.filter((guide) => guide.id !== request.guideId);
    if (current.favoriteGuideId === request.guideId) next.favoriteGuideId = undefined;
  } else if (request.action === "favorite") {
    next.favoriteGuideId = request.guideId ?? undefined; next.favoriteVersion = result.version;
  } else {
    next.teamGuideDefaults = { ...current.teamGuideDefaults };
    if (request.guideId) next.teamGuideDefaults[request.teamId] = request.guideId;
    else delete next.teamGuideDefaults[request.teamId];
    next.teamGuideVersions = { ...current.teamGuideVersions, [request.teamId]: result.version };
  }
  return next;
}

export function guideSaveInput(input: ConversationGuideInput, sortOrder: number): GuideChangeInput {
  if (!validGuideInput(input)) throw new Error("Finish each guide step before saving.");
  if (input.id && (!input.expectedVersion || !Number.isInteger(input.expectedVersion))) throw new Error("Refresh this guide and reopen the editor before saving. Its original version is unavailable.");
  return guideChangeInputSchema.parse({ action: "save", guideId: input.id ?? crypto.randomUUID(), expectedVersion: input.id ? input.expectedVersion : 0,
    content: { scope: input.scope, title: input.title, description: input.description, steps: normalizeGuideSteps(input.steps), sortOrder } });
}

/** Persist the exact request before a network write; acknowledge it only after
 * a validated receipt. Never manufacture a replacement ID when retrying. */
export async function submitGuideChange(scope: StorageScope, input: GuideChangeInput | null, onPreserved?: (entry: PendingGuideChange) => void) {
  const client = getSupabaseBrowserClient();
  if (!client || !navigator.onLine) throw new Error("Guide changes require a connection. Prepared guides remain available offline.");
  const session = await client.auth.getSession();
  if (session.error || session.data.session?.user.id !== scope.userId) throw new Error("Sign in with the account that authored this guide request.");
  const previous = await pendingGuideChange(scope);
  if (previous && input) throw new Error("A previous guide request needs review. Open Guides to retry it or preserve it as reviewed first.");
  const request = previous ? parseGuideChangeRequest(previous.request) : input ? parseGuideChangeRequest({ ...guideChangeInputSchema.parse(input),
    schemaVersion: 1, id: createId("guide_request"), churchId: scope.churchId, userId: scope.userId }) : null;
  if (!request || request.churchId !== scope.churchId || request.userId !== scope.userId) throw new Error("No pending guide request belongs to this account and church.");
  const entry = await preserveGuideChange(scope, request);
  onPreserved?.(entry);
  const { data, error } = await client.rpc("outreach_guide_action", { request: request as unknown as Json });
  if (error) throw apiError(error);
  const result = resultSchema.parse(data);
  if (result.action !== request.action || result.guideId !== request.guideId || result.teamId !== (request.action === "group_default" ? request.teamId : null)
    || (request.action === "save" && !result.createdAt)) {
    throw new Error("The guide receipt did not match this request. The original request is preserved for review.");
  }
  await finishGuideChange(scope, request.id, result);
  return { request, result };
}
