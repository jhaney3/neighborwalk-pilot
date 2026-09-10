import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "./database.types";
import { assertSafeSupabaseUrl } from "./environment";
import { publicSiteConfig } from "./site-config";
import { buildReminderEmail, reminderJobSchema, reminderPayloadSchema, sendReminder } from "./reminder-email";

export function reminderInfrastructure(env: Record<string, string | undefined> = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const unsubscribeSecret = env.REMINDER_UNSUBSCRIBE_SECRET || "";
  if (!url || !serviceKey || unsubscribeSecret.length < 32) return null;
  const production = env.NEXT_PUBLIC_APP_ENV === "production";
  if (env.VERCEL_ENV && (env.VERCEL_ENV === "production") !== production) return null;
  try { assertSafeSupabaseUrl(url, production); } catch { return null; }
  return { url, serviceKey, unsubscribeSecret, previousUnsubscribeSecret: env.REMINDER_UNSUBSCRIBE_PREVIOUS_SECRET || "" };
}

export function reminderDeliveryConfig(env: Record<string, string | undefined> = process.env) {
  const infrastructure = reminderInfrastructure(env);
  if (!infrastructure || env.NEIGHBORWALK_REMINDERS_ENABLED !== "true" || env.NEIGHBORWALK_EMAIL_VERIFIED !== "true"
    || !publicSiteConfig(env).policiesApproved || !env.RESEND_API_KEY || !env.RESEND_WEBHOOK_SECRET || (env.CRON_SECRET?.length || 0) < 32
    || !z.email().safeParse(env.REMINDER_FROM_EMAIL).success) return null;
  try {
    const origin = new URL(env.NEXT_PUBLIC_SITE_URL || "");
    const production = env.NEXT_PUBLIC_APP_ENV === "production";
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/"
      || (production ? origin.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
        : !["http://127.0.0.1:3011", "http://127.0.0.1:3013"].includes(origin.origin))) return null;
    return { ...infrastructure, origin: origin.origin, from: env.REMINDER_FROM_EMAIL!, apiKey: env.RESEND_API_KEY };
  } catch { return null; }
}

export function reminderWorkerClient(config: NonNullable<ReturnType<typeof reminderInfrastructure>>) {
  const client = createClient<Database>(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
  });
  return async (action: string, args: Json = {}) => {
    const { data, error } = await client.rpc("outreach_reminder_worker", { action, args });
    if (error) throw new Error("Reminder storage operation failed."); // no recipient/payload/provider errors in logs
    return data;
  };
}
type Worker = ReturnType<typeof reminderWorkerClient>;
export async function runReminders(config: NonNullable<ReturnType<typeof reminderDeliveryConfig>>, worker: Worker, transport: typeof fetch = fetch) {
  const jobs = z.array(reminderJobSchema).max(10).parse(await worker("claim"));
  const counts = { claimed: jobs.length, accepted: 0, deferred: 0, skipped: 0 };
  // Five bounded parallel sends: durable leases handle overlapping cron calls,
  // process crashes and provider acknowledgement lost before the DB receipt.
  for (let start = 0; start < jobs.length; start += 5) {
    await Promise.all(jobs.slice(start, start + 5).map(async (job) => {
      const stored = await worker("prepare", { id: job.id, lease: job.lease, payload: buildReminderEmail(job, config) });
      if (!stored) { counts.skipped++; return; }
      const result = await sendReminder(job.id, reminderPayloadSchema.parse(stored), config.apiKey, transport);
      await worker("finish", { id: job.id, lease: job.lease, ...result });
      if ("providerId" in result) counts.accepted++; else counts.deferred++;
    }));
  }
  return counts;
}
