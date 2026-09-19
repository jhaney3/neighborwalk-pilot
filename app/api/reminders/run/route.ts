import { sameSecret } from "../../../../lib/reminder-email";
import { reminderDeliveryConfig, reminderWorkerClient, runReminders } from "../../../../lib/reminder-server";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const headers = { "Cache-Control": "no-store" };
  if (secret.length < 32 || !sameSecret(request.headers.get("authorization") || "", "Bearer " + secret)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const config = reminderDeliveryConfig();
  if (!config) return Response.json({ disabled: true }, { status: 503, headers });
  try { return Response.json(await runReminders(config, reminderWorkerClient(config)), { headers }); }
  catch { return Response.json({ error: "Reminder run incomplete. Durable jobs remain available for retry." }, { status: 503, headers }); }
}
