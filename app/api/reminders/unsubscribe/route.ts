import { unsubscribePreference } from "../../../../lib/reminder-email";
import { reminderInfrastructure, reminderWorkerClient } from "../../../../lib/reminder-server";

export const runtime = "nodejs";
const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", "X-Robots-Tag": "noindex, nofollow" };
function page(content: string, status = 200) {
  return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SendMe reminders</title><main><h1>SendMe reminders</h1>' + content + '</main></html>', { status, headers });
}
function validate(request: Request) {
  const config = reminderInfrastructure();
  const token = new URL(request.url).searchParams.get("token");
  const preferenceId = config ? unsubscribePreference(token, [config.unsubscribeSecret, config.previousUnsubscribeSecret]) : null;
  return { config, token, preferenceId };
}
export function GET(request: Request) {
  const { config, token, preferenceId } = validate(request);
  if (!config) return page("<p>Reminder settings are temporarily unavailable. Please try again later or turn reminders off in the signed-in app.</p>", 503);
  if (!preferenceId) return page("<p>This link is invalid. Open Settings in your signed-in SendMe app to turn reminders off.</p>", 400);
  // GET is read-only: link scanners cannot silently unsubscribe a member.
  return page('<p>Turn off daily next-step reminders for the membership associated with this link? Your church records and access will not change.</p><form method="post" action="/api/reminders/unsubscribe?token=' + encodeURIComponent(token!) + '"><button type="submit">Turn off email reminders</button></form>');
}
export async function POST(request: Request) {
  const { config, preferenceId } = validate(request);
  if (!config) return page("<p>Temporarily unavailable. Please try again.</p>", 503);
  if (!preferenceId) return page("<p>This link is invalid. Use Settings in the signed-in app.</p>", 400);
  try { await reminderWorkerClient(config)("unsubscribe", { preferenceId }); }
  catch { return page("<p>The change was not confirmed. Please retry or use Settings in the signed-in app.</p>", 503); }
  return page("<p>Email reminders are turned off. A message already in flight may still arrive. You can opt in again from Settings in your signed-in SendMe app.</p>");
}
