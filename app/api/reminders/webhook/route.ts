import { limitedRequestText, verifyReminderWebhook } from "../../../../lib/reminder-email";
import { reminderInfrastructure, reminderWorkerClient } from "../../../../lib/reminder-server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const config = reminderInfrastructure();
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const headers = { "Cache-Control": "no-store" };
  if (!config || !secret) return Response.json({ error: "Unavailable" }, { status: 503, headers });
  let event;
  try { event = verifyReminderWebhook(await limitedRequestText(request, 65536), request.headers, secret); }
  catch { return Response.json({ error: "Invalid webhook" }, { status: 400, headers }); }
  try { if (event) await reminderWorkerClient(config)("event", event); }
  catch { return Response.json({ error: "Retry later" }, { status: 503, headers }); }
  return Response.json({ received: true }, { headers });
}
