"use client";
import { serviceUrl } from "../lib/mobile";
import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { useAsyncAction } from "../lib/use-async-action";
import { timeoutSignal } from "../lib/platform";

const preferenceSchema = z.object({ enabled: z.boolean(), emailVerified: z.boolean(), suppressed: z.boolean().nullable(),
  lastState: z.string().nullable(), lastUpdatedAt: z.string().nullable() });
type Preference = z.infer<typeof preferenceSchema>;
const deliveryLabels: Record<string, string> = { pending: "Waiting for processing", leased: "Processing", retry: "Waiting for another delivery attempt",
  accepted: "Accepted by the email provider (delivery not yet confirmed)", delivered: "Delivery confirmed by the email provider", failed: "Delivery failed",
  unknown: "Delivery could not be confirmed; automatic retries stopped", suppressed: "Not sent or delivery paused", bounced: "Email bounced; reminders paused", complained: "Marked unwanted; reminders paused" };

export function ReminderSettings({ churchId, timezone, online, connected }: { churchId: string; timezone: string; online: boolean; connected: boolean }) {
  const [preference, setPreference] = useState<Preference | null>(null);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const action = useAsyncAction();
  useEffect(() => {
    if (!connected || !online) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let active = true;
    void Promise.all([
      client.rpc("outreach_reminder_preference", { target_church: churchId }).abortSignal(controller.signal),
      fetch(serviceUrl("/api/reminders/status"), { cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Reminder availability could not be checked.");
        return z.object({ available: z.boolean() }).parse(await response.json());
      }),
    ]).then(([result, status]) => {
      if (result.error) throw new Error("Reminder settings could not be loaded.");
      const parsed = preferenceSchema.parse(result.data);
      if (active) { setPreference(parsed); setAvailable(status.available); setError(""); }
    }).catch(() => { if (active) { setPreference(null); setAvailable(false); setError("Reminder settings could not be loaded. Reconnect and retry."); } })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [churchId, connected, online, refresh]);

  const save = async (enabled: boolean) => {
    const client = getSupabaseBrowserClient();
    if (!client || !online) throw new Error("Reconnect to change email reminders.");
    const { data, error } = await client.rpc("outreach_reminder_preference", { target_church: churchId, enabled }).abortSignal(timeoutSignal(10000));
    if (error) throw new Error(error.code === "22023" ? error.message : "The change was not confirmed. Reload settings before retrying.");
    setPreference(preferenceSchema.parse(data));
    setMessage(enabled ? "Email reminders are on." : "Email reminders are off. A message already in flight may still arrive.");
  };
  return <section className="settings-section">
    <div className="settings-section-heading"><span><Mail size={18} /></span><div><h2>Email reminders</h2><p>Daily reminders for your own next steps.</p></div></div>
    <div className="settings-section-body">
      <p>Get at most one email a day when work is due or a handoff needs your response. Checks run during daytime hours in {timezone}.</p>
      <p>Only you can opt in. Emails contain a protected link—never neighbor details.</p>
      {!connected ? <p>Email reminders aren’t available in the demo.</p> : !online ? <p>Reconnect to manage email reminders.</p> : <>
        {!available && <p role="status">Email reminders aren’t available on this deployment.</p>}
        {error && <p role="alert">{error}</p>}
        {preference && <>
          <p><strong>{preference.enabled ? "Reminders are on." : "Reminders are off."}</strong>{!preference.emailVerified && " Verify your email to turn them on."}{preference.suppressed && " Delivery is paused after an email problem. Contact support to resume it."}</p>
          {preference.lastState && <p>Last reminder: {deliveryLabels[preference.lastState] || "Status unavailable"}.</p>}
          <button className="button quiet" disabled={action.busy || (!preference.enabled && (!available || !preference.emailVerified || Boolean(preference.suppressed)))} onClick={() => void action.run(() => save(!preference.enabled))}>{action.busy ? "Saving…" : preference.enabled ? "Turn off email reminders" : "Enable daily email reminders"}</button>
        </>}
        <button className="button quiet" disabled={action.busy} onClick={() => setRefresh((value) => value + 1)}>Reload reminder settings</button>
      </>}
      {action.error && <p role="alert">{action.error}</p>}{message && <p role="status">{message}</p>}
    </div>
  </section>;
}
