import { outreachCommandSchema } from "./command-schema";

/** Recovery is not a volunteer bulk-export permission. Preserve originals in
 * account-scoped storage, but disclose only commands submitted by that author. */
export function authoredRecovery(data: unknown, scope: { userId: string; churchId: string }) {
  if (!data || typeof data !== "object" || !("sync" in data) || !data.sync || typeof data.sync !== "object") {
    throw new Error("This older copy needs supervised recovery. The original remains preserved on this device.");
  }
  const sync = data.sync as { commands?: unknown; legacyRecoveryRequired?: boolean };
  if (sync.legacyRecoveryRequired || !Array.isArray(sync.commands)) {
    throw new Error("Older work has no reliable author-by-transaction record. Ask a leader to arrange supervised recovery; the original remains preserved.");
  }
  const commands = sync.commands.flatMap((entry) => {
    const parsed = outreachCommandSchema.safeParse(entry && typeof entry === "object" && "command" in entry ? entry.command : null);
    return parsed.success && parsed.data.userId === scope.userId && parsed.data.churchId === scope.churchId ? [parsed.data] : [];
  });
  return { format: "neighborwalk-authored-recovery", formatVersion: 1, exportedAt: new Date().toISOString(), scope, commands,
    notice: "Only your immutable queued transactions. Not a church backup or a bulk restore file." };
}
