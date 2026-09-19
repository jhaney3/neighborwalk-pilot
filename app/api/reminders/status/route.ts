import { reminderDeliveryConfig } from "../../../../lib/reminder-server";
export function GET() {
  return Response.json({ available: Boolean(reminderDeliveryConfig()) }, { headers: { "Cache-Control": "no-store" } });
}
