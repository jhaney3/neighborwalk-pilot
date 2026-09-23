"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { PermissionState } from "@capacitor/core";
import type { NeighborWalkData } from "../lib/domain";
import {
  cancelDeviceReminders,
  deviceReminderPermission,
  deviceReminderPlan,
  reconcileDeviceReminders,
  requestDeviceReminderPermission,
} from "../mobile/notifications";
import { registerRemotePush, remotePushConfigured, unregisterRemotePush } from "../mobile/push-notifications";

export function DeviceReminderSettings({
  data,
  onSetEnabled,
}: {
  data: NeighborWalkData;
  onSetEnabled: (enabled: boolean) => Promise<unknown>;
}) {
  const [permission, setPermission] = useState<PermissionState | "checking">("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const eligible = deviceReminderPlan(data).length;
  const enabled = data.preferences.notificationsEnabled;

  useEffect(() => {
    let active = true;
    void deviceReminderPermission()
      .then((value) => { if (active) setPermission(value); })
      .catch(() => { if (active) setPermission("denied"); });
    return () => { active = false; };
  }, []);

  const enable = async () => {
    setBusy(true); setMessage("");
    try {
      const nextPermission = await requestDeviceReminderPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        setMessage("Notifications are off in iOS Settings.");
        return;
      }
      await onSetEnabled(true);
      const result = await reconcileDeviceReminders(data);
      let nextMessage = result.scheduled
        ? `${result.scheduled} device reminder${result.scheduled === 1 ? "" : "s"} scheduled.`
        : "Reminders are on. Nothing is due yet.";
      if (remotePushConfigured) {
        try {
          const remote = await registerRemotePush();
          if (remote.registered) nextMessage += " New invitation and assignment alerts are connected.";
        } catch {
          nextMessage += " New assignment alerts could not connect yet; reopen Settings after checking your connection.";
        }
      }
      setMessage(nextMessage);
    } catch {
      setMessage("Couldn’t turn on reminders. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true); setMessage("");
    try {
      await onSetEnabled(false);
      const [cancelled] = await Promise.all([cancelDeviceReminders(), unregisterRemotePush()]);
      setMessage(cancelled
        ? `${cancelled} pending device reminder${cancelled === 1 ? " was" : "s were"} removed.`
        : "Reminders are off.");
    } catch {
      setMessage("Couldn’t turn off reminders. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const active = enabled && permission === "granted";
  const blocked = enabled && permission === "denied";
  const needsPermission = enabled && permission !== "checking" && permission !== "granted";
  return <section className="settings-section">
    <div className="settings-section-heading"><span><Bell size={18} /></span><div><h2>iPhone &amp; iPad notifications</h2><p>Alerts for walk invitations and your follow-ups.</p></div></div>
    <div className="settings-section-body">
      <div className={`connection-card ${active ? "connected" : "device_only"}`}>
        {active ? <Bell size={18} /> : <BellOff size={18} />}
        <span><strong>{blocked ? "Blocked in iOS Settings" : needsPermission ? "Permission required" : active ? "Notifications on" : "Notifications off"}</strong>{enabled
          ? `${eligible} accepted upcoming item${eligible === 1 ? " is" : "s are"} currently eligible for an on-device reminder.`
          : "iOS will ask for permission when you turn these on."}</span>
      </div>
      <p className="settings-help">Names, addresses and notes never show on your lock screen.</p>
      <button className="button quiet" type="button" disabled={busy || permission === "checking"} onClick={() => void (active ? disable() : enable())}>
        {active ? <BellOff size={15} /> : <Bell size={15} />}{busy ? "Updating…" : active ? "Turn off notifications" : needsPermission ? "Check notification access" : "Enable notifications"}
      </button>
      {needsPermission && <button className="button quiet" type="button" disabled={busy} onClick={() => void disable()}><BellOff size={15} />Turn off notifications</button>}
      {message && <p role="status">{message}</p>}
    </div>
  </section>;
}
