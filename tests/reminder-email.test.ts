import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildReminderEmail, limitedRequestText, sendReminder, unsubscribePreference, unsubscribeToken, verifyReminderWebhook } from "../lib/reminder-email";
import { reminderDeliveryConfig, reminderInfrastructure, runReminders } from "../lib/reminder-server";
import { GET as run } from "../app/api/reminders/run/route";
import { GET as unsubscribePage, POST as unsubscribePost } from "../app/api/reminders/unsubscribe/route";
import { POST as webhook } from "../app/api/reminders/webhook/route";

vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllEnvs());
const job = { id: "50000000-0000-4000-8000-000000000001", preferenceId: "50000000-0000-4000-8000-000000000002", recipient: "fictional@neighborwalk.test", lease: "50000000-0000-4000-8000-000000000003" };
const emailId = "50000000-0000-4000-8000-000000000004";
const secret = "fictional-only-unsubscribe-secret-123456789";
const signingKey = Buffer.from("fictional-only-provider-signing-secret");
const webhookSecret = "whsec_" + signingKey.toString("base64");
const env = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "fictional-service-key",
  NEXT_PUBLIC_APP_ENV: "sandbox", REMINDER_UNSUBSCRIBE_SECRET: secret, NEIGHBORWALK_REMINDERS_ENABLED: "true",
  NEIGHBORWALK_EMAIL_VERIFIED: "true", NEIGHBORWALK_OPERATOR_NAME: "Fictional operator", NEIGHBORWALK_SUPPORT_EMAIL: "support@neighborwalk.test",
  NEIGHBORWALK_POLICIES_APPROVED: "true", RESEND_API_KEY: "fictional-api-key", RESEND_WEBHOOK_SECRET: webhookSecret,
  CRON_SECRET: "fictional-cron-secret-longer-than-32-characters", REMINDER_FROM_EMAIL: "reminders@neighborwalk.test", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3013" };
const config = reminderDeliveryConfig(env)!;
const payload = buildReminderEmail(job, config);
function setEnvironment() { for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value); }
function signed(raw: string, offset = 0) {
  const timestamp = String(Math.floor(Date.now() / 1000) + offset);
  return new Headers({ "svix-id": "msg_fictional_event", "svix-timestamp": timestamp,
    "svix-signature": "v1," + createHmac("sha256", signingKey).update("msg_fictional_event." + timestamp + "." + raw).digest("base64") });
}

describe("opt-in reminder delivery", () => {
  it("fails closed without provider, verified domain, policies, secret or isolated database", () => {
    expect(reminderDeliveryConfig({})).toBeNull();
    for (const key of ["RESEND_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEIGHBORWALK_EMAIL_VERIFIED", "NEIGHBORWALK_POLICIES_APPROVED", "CRON_SECRET", "REMINDER_UNSUBSCRIBE_SECRET"]) {
      expect(reminderDeliveryConfig({ ...env, [key]: "" })).toBeNull();
    }
    expect(reminderDeliveryConfig(env)).not.toBeNull();
    expect(reminderInfrastructure({ ...env, NEXT_PUBLIC_SUPABASE_URL: "https://llhrbtlkcneldgrhkwpf.supabase.co" })).toBeNull();
    expect(reminderDeliveryConfig({ ...env, NEXT_PUBLIC_SITE_URL: "https://unexpected.test" })).toBeNull();
    expect(reminderInfrastructure({ ...env, VERCEL_ENV: "production" })).toBeNull();
  });
  it("uses only a single recipient envelope, generic content and a protected own-work link", () => {
    expect(payload.to).toEqual([job.recipient]);
    expect(payload.subject).toBe("Your NeighborWalk next steps");
    expect(payload.text).toContain("/app/followups?scope=mine");
    expect(payload.text).not.toContain(job.recipient);
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(Object.keys(payload).sort()).toEqual(["from", "headers", "subject", "tags", "text", "to"]);
    expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
  it("rejects forged unsubscribe links and supports explicit signing-key rotation", () => {
    const token = unsubscribeToken(job.preferenceId, secret);
    expect(unsubscribePreference(token, [secret])).toBe(job.preferenceId);
    expect(unsubscribePreference(token.replace(job.preferenceId, job.id), [secret])).toBeNull();
    expect(unsubscribePreference(token, ["different-secret-that-is-at-least-32-characters", secret])).toBe(job.preferenceId);
    expect(unsubscribePreference(token, ["different-secret-that-is-at-least-32-characters"])).toBeNull();
    expect(unsubscribePreference("<script>invalid</script>", [secret])).toBeNull();
  });
  it("preserves idempotency key and payload after a lost response", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce(Response.json({ id: emailId }));
    expect(await sendReminder(job.id, payload, "fictional-key", transport)).toEqual({ error: "temporary" });
    expect(await sendReminder(job.id, payload, "fictional-key", transport)).toEqual({ providerId: emailId });
    const [first, second] = transport.mock.calls;
    expect(first[1]?.body).toBe(second[1]?.body);
    expect(new Headers(first[1]?.headers).get("Idempotency-Key")).toBe(new Headers(second[1]?.headers).get("Idempotency-Key"));
    expect(new Headers(first[1]?.headers).get("Idempotency-Key")).toContain(job.id);
  });
  it.each([408, 409, 429, 500, 503])("keeps ambiguous provider response %i retryable", async (status) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("Provider body must not be logged", { status }));
    expect(await sendReminder(job.id, payload, "fictional-key", transport)).toEqual({ error: "temporary" });
  });
  it("stops permanent rejection without exposing provider response content", async () => {
    expect(await sendReminder(job.id, payload, "fictional-key", vi.fn<typeof fetch>().mockResolvedValue(new Response("private provider response", { status: 422 })))).toEqual({ error: "rejected" });
  });
  it("sends the persisted envelope, not a changed deployment template", async () => {
    const persisted = { ...payload, text: "Previously persisted generic message" };
    const worker = vi.fn().mockResolvedValueOnce([job]).mockResolvedValueOnce(persisted).mockResolvedValueOnce(null);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: emailId }));
    expect(await runReminders(config, worker, transport)).toEqual({ claimed: 1, accepted: 1, deferred: 0, skipped: 0 });
    expect(JSON.parse(transport.mock.calls[0][1]!.body as string)).toEqual(persisted);
    expect(worker.mock.calls[2][1]).toEqual({ id: job.id, lease: job.lease, providerId: emailId });
  });
  it("does not send a leased job cancelled by an opt-out or access change", async () => {
    const worker = vi.fn().mockResolvedValueOnce([job]).mockResolvedValueOnce(null);
    const transport = vi.fn<typeof fetch>();
    expect(await runReminders(config, worker, transport)).toEqual({ claimed: 1, accepted: 0, deferred: 0, skipped: 1 });
    expect(transport).not.toHaveBeenCalled();
  });
  it("verifies raw provider signatures and discards all recipient/tracking content", () => {
    const raw = JSON.stringify({ type: "email.bounced", created_at: "2026-09-10T12:00:00Z", data: { email_id: emailId, tags: { neighborwalk_reminder_id: job.id }, to: [job.recipient], subject: "Must not persist", bounce: { message: "Must not log" } } });
    expect(verifyReminderWebhook(raw, signed(raw), webhookSecret)).toEqual({ eventId: "msg_fictional_event", jobId: job.id, providerId: emailId, kind: "email.bounced", occurredAt: "2026-09-10T12:00:00Z" });
    expect(() => verifyReminderWebhook(raw + " ", signed(raw), webhookSecret)).toThrow();
    expect(() => verifyReminderWebhook(raw, signed(raw, -600), webhookSecret)).toThrow();
    expect(() => verifyReminderWebhook(raw, signed(raw, 600), webhookSecret)).toThrow();
  });
  it("rejects malformed relevant events instead of silently acknowledging lost delivery evidence", () => {
    const raw = JSON.stringify({ type: "email.bounced", data: { email_id: "invalid" } });
    expect(() => verifyReminderWebhook(raw, signed(raw), webhookSecret)).toThrow();
    const unrelated = JSON.stringify({ type: "email.opened", data: { email_id: emailId } });
    expect(verifyReminderWebhook(unrelated, signed(unrelated), webhookSecret)).toBeNull();
  });
  it("bounds raw webhook bodies even without a trustworthy content-length", async () => {
    await expect(limitedRequestText(new Request("http://127.0.0.1", { method: "POST", body: "123456" }), 5)).rejects.toThrow("too large");
    expect(await limitedRequestText(new Request("http://127.0.0.1", { method: "POST", body: "12345" }), 5)).toBe("12345");
  });
  it("rejects unauthorized cron requests before any storage or provider call", async () => {
    setEnvironment();
    expect((await run(new Request("http://127.0.0.1/api/reminders/run"))).status).toBe(401);
    vi.stubEnv("NEIGHBORWALK_REMINDERS_ENABLED", "false");
    expect((await run(new Request("http://127.0.0.1/api/reminders/run", { headers: { Authorization: "Bearer " + env.CRON_SECRET } }))).status).toBe(503);
  });
  it("keeps scanner GET read-only, rejects forged POST and verifies signatures before storage", async () => {
    setEnvironment();
    const url = "http://127.0.0.1/api/reminders/unsubscribe?token=" + unsubscribeToken(job.preferenceId, secret);
    const response = unsubscribePage(new Request(url));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('method="post"');
    expect((await unsubscribePost(new Request(url + "x", { method: "POST" }))).status).toBe(400);
    expect((await webhook(new Request("http://127.0.0.1/api/reminders/webhook", { method: "POST", body: "{}" }))).status).toBe(400);
  });
});
