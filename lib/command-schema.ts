import { z } from "zod";

export const commandEntitySchema = z.enum([
  "event", "team", "territory", "assignment", "property", "visit", "resident",
  "person_note", "follow_up", "restriction", "handoff", "settings",
]);
export const commandOperationSchema = z.object({
  entityType: commandEntitySchema,
  entityId: z.string().min(1).max(240),
  operation: z.enum(["upsert", "delete"]),
  expectedVersion: z.number().int().nonnegative(),
  record: z.record(z.string(), z.unknown()).optional(),
  destinationTerritoryId: z.string().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});
export const outreachCommandSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(190),
  churchId: z.string().uuid(),
  userId: z.string().uuid(),
  createdAt: z.string().datetime(),
  operations: z.array(commandOperationSchema).min(1).max(100),
});
export const queuedCommandSchema = z.object({
  command: outreachCommandSchema,
  state: z.enum(["queued", "needs_review"]).default("queued"),
  error: z.string().optional(),
});
export type CommandEntity = z.infer<typeof commandEntitySchema>;
export type CommandOperation = z.infer<typeof commandOperationSchema>;
export type OutreachCommand = z.infer<typeof outreachCommandSchema>;
export type QueuedCommand = z.infer<typeof queuedCommandSchema>;
export const versionKey = (kind: string, id: string) => JSON.stringify([kind === "handoff" ? "resident" : kind, id]);
