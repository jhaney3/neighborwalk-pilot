import { z } from "zod";
import { createId } from "./domain";
import type { Json } from "./database.types";
import { apiError } from "./outreach-client";
import { getSupabaseBrowserClient } from "./supabase";
import { finishAdministration, pendingAdministration, preserveAdministration, type StorageScope } from "./storage";

export const retentionPlanSchema = z.object({ cutoff: z.string(), token: z.string(), revision: z.number(), taskCount: z.number(), encounterCount: z.number(),
  tasks: z.array(z.object({ id: z.string(), version: z.number() })), encounters: z.array(z.object({ id: z.string(), version: z.number() })) });
export type RetentionPlan = z.infer<typeof retentionPlanSchema>;
export type AdminInput = { action: "record_export" | "import" | "retention_archive" | "review_migration_issue"; expectedRevision: number } & Record<string, unknown>;

export async function submitAdministration(scope: StorageScope, input: AdminInput | null) {
  const client = getSupabaseBrowserClient();
  if (!client || !navigator.onLine) throw new Error("Reviewed administration requires a connection.");
  const { data: session, error: sessionError } = await client.auth.getSession();
  if (sessionError || session.session?.user.id !== scope.userId) throw new Error("Sign into the account that owns this request.");
  const previous = await pendingAdministration(scope);
  if (previous && input) throw new Error("A previous administration request needs review. Retry it or preserve it as reviewed before starting another.");
  const request = previous?.request ?? (input ? JSON.parse(JSON.stringify({ ...input, schemaVersion: 1, churchId: scope.churchId, id: createId("admin") })) : null);
  if (!request) throw new Error("There is no pending administration request to retry.");
  await preserveAdministration(scope, request);
  const { data, error } = await client.rpc("outreach_admin_action", { request: request as Json });
  if (error) throw apiError(error);
  await finishAdministration(scope, String(request.id), data);
  return data;
}
export async function previewRetention(scope: StorageScope): Promise<RetentionPlan> {
  const client = getSupabaseBrowserClient();
  if (!client || !navigator.onLine) throw new Error("Connect and sign in again to preview archived records.");
  const { data, error } = await client.rpc("outreach_admin_action", { request: { schemaVersion: 1, churchId: scope.churchId, id: createId("preview"), action: "retention_preview" } });
  if (error) throw apiError(error);
  return retentionPlanSchema.parse(data);
}
