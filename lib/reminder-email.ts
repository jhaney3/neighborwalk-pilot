import { createHmac, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { z } from "zod";

export const reminderJobSchema = z.object({ id: z.uuid(), preferenceId: z.uuid(), recipient: z.email(), lease: z.uuid() });
export type ReminderJob = z.infer<typeof reminderJobSchema>;
export const reminderPayloadSchema = z.object({
  from: z.string().max(400), to: z.array(z.email()).length(1), subject: z.enum(["Your SendMe next steps", "Your NeighborWalk next steps"]),
  text: z.string().max(4000), headers: z.record(z.string(), z.string()),
  tags: z.array(z.object({ name: z.literal("neighborwalk_reminder_id"), value: z.uuid() }).strict()).length(1),
}).strict();
export type ReminderPayload = z.infer<typeof reminderPayloadSchema>;

export function sameSecret(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function unsubscribeToken(preferenceId: string, secret: string) {
  if (!z.uuid().safeParse(preferenceId).success || secret.length < 32) throw new Error("Invalid unsubscribe configuration.");
  return preferenceId + "." + createHmac("sha256", secret).update("neighborwalk-reminder-unsubscribe:v1:" + preferenceId).digest("base64url");
}
export function unsubscribePreference(token: string | null, secrets: string[]) {
  if (!token || !/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const id = token.split(".")[0];
  if (!z.uuid().safeParse(id).success) return null;
  return secrets.some((secret) => secret.length >= 32 && sameSecret(token, unsubscribeToken(id, secret))) ? id : null;
}

/** Takes only the recipient envelope: care records cannot enter this template. */
export function buildReminderEmail(job: ReminderJob, config: { from: string; origin: string; unsubscribeSecret: string }): ReminderPayload {
  const unsubscribe = config.origin + "/api/reminders/unsubscribe?token=" + unsubscribeToken(job.preferenceId, config.unsubscribeSecret);
  return {
    from: "SendMe <" + config.from + ">", to: [job.recipient], subject: "Your SendMe next steps",
    text: "You asked SendMe to remind you when your next steps need attention.\n\nSign in to review your own due work or an assignment waiting for your acceptance:\n"
      + config.origin + "/app/followups?scope=mine\n\nThis message intentionally contains no neighbor details. A reminder is not an emergency or a guarantee that a task is still available.\n\nTurn off these reminders:\n" + unsubscribe,
    headers: { "List-Unsubscribe": "<" + unsubscribe + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    tags: [{ name: "neighborwalk_reminder_id", value: job.id }],
  };
}

export async function sendReminder(jobId: string, payload: ReminderPayload, apiKey: string, transport: typeof fetch = fetch): Promise<{ providerId: string } | { error: "temporary" | "rejected" }> {
  try {
    const response = await transport("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(8000),
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json", "Idempotency-Key": "neighborwalk-reminder/" + jobId },
      body: JSON.stringify(reminderPayloadSchema.parse(payload)), redirect: "error", cache: "no-store" });
    if (response.ok) {
      const parsed = z.object({ id: z.uuid() }).safeParse(await response.json());
      return parsed.success ? { providerId: parsed.data.id } : { error: "temporary" };
    }
    // A timeout, 429, server error or concurrent idempotent request may already
    // have been accepted. Never rotate the key/payload to get past an error.
    return { error: response.status >= 500 || [408, 409, 425, 429].includes(response.status) ? "temporary" : "rejected" };
  } catch { return { error: "temporary" }; }
}

const deliveryEvent = z.object({ type: z.enum(["email.delivered", "email.bounced", "email.complained", "email.failed", "email.suppressed"]),
  created_at: z.iso.datetime({ offset: true }), data: z.object({ email_id: z.uuid(), tags: z.object({ neighborwalk_reminder_id: z.uuid().optional() }).optional() }) });
export function verifyReminderWebhook(raw: string, headers: Headers, secret: string) {
  const id = headers.get("svix-id") || "";
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("Invalid webhook.");
  // The maintained provider verifier checks the raw body, signature and replay
  // timestamp. Its parsed result still needs a bounded application schema.
  const verified = new Resend("verification-only").webhooks.verify({ payload: raw, webhookSecret: secret,
    headers: { id, timestamp: headers.get("svix-timestamp") || "", signature: headers.get("svix-signature") || "" } });
  if (!["email.delivered", "email.bounced", "email.complained", "email.failed", "email.suppressed"].includes(verified.type)) return null;
  const event = deliveryEvent.parse(verified);
  const jobId = event.data.tags?.neighborwalk_reminder_id;
  if (!jobId) return null; // a different sender's valid provider event
  return { eventId: id, jobId, providerId: event.data.email_id, kind: event.type, occurredAt: event.created_at };
}

export async function limitedRequestText(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new Error("Request too large.");
  const reader = request.body?.getReader();
  if (!reader) return "";
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new Error("Request too large."); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}
