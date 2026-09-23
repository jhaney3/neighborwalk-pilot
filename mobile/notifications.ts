import { Capacitor } from "@capacitor/core";
import {
  LocalNotifications,
  type ActionPerformed,
  type LocalNotificationSchema,
  type PendingLocalNotificationSchema,
  type PermissionStatus,
} from "@capacitor/local-notifications";
import { validAppSegments } from "../lib/app-routes";
import { churchDateTimeToIso } from "../lib/calendar";
import type { NeighborWalkData } from "../lib/domain";

const REMINDER_SOURCE = "neighborwalk-device-reminder-v1";
const MAX_DEVICE_REMINDERS = 60;
const FOLLOW_UP_HOUR = 9;
const WALK_NOTICE_MILLISECONDS = 60 * 60 * 1000;

export type DeviceNotificationAdapter = Pick<typeof LocalNotifications,
  "cancel" | "checkPermissions" | "getPending" | "requestPermissions" | "schedule">;

export type DeviceReminderResult = {
  permission: PermissionStatus["display"];
  eligible: number;
  scheduled: number;
  cancelled: number;
};

type ReminderExtra = {
  source: typeof REMINDER_SOURCE;
  target: string;
};

function stableNotificationId(kind: "follow-up" | "walk", churchId: string, volunteerId: string, recordId: string) {
  const value = `${REMINDER_SOURCE}:${kind}:${churchId}:${volunteerId}:${recordId}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // Capacitor requires a signed 32-bit integer on Android. Stay positive and
  // reserve zero so IDs are portable even though this app currently ships on iOS.
  return (hash >>> 0) % 2_147_483_646 + 1;
}

function followUpReminderDate(dueAt: string, timezone: string): Date | null {
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) {
      return new Date(churchDateTimeToIso(`${dueAt}T${String(FOLLOW_UP_HOUR).padStart(2, "0")}:00`, timezone));
    }
    const instant = new Date(dueAt);
    return Number.isFinite(instant.getTime()) ? instant : null;
  } catch {
    return null;
  }
}

function managedReminder(notification: PendingLocalNotificationSchema) {
  const extra = notification.extra;
  return Boolean(extra && typeof extra === "object" && extra.source === REMINDER_SOURCE);
}

function reminderTarget(notification: PendingLocalNotificationSchema) {
  const extra = notification.extra;
  return extra && typeof extra === "object" && typeof extra.target === "string" ? extra.target : null;
}

/**
 * Build only privacy-safe, accepted work reminders for the active signed-in
 * volunteer. iOS retains at most 64 pending local notifications, so NeighborWalk
 * uses the earliest 60 and leaves a little system/plugin headroom.
 */
export function deviceReminderPlan(data: NeighborWalkData, now = new Date()): LocalNotificationSchema[] {
  if (data.sync.mode !== "connected") return [];
  const volunteerId = data.preferences.activeVolunteerId;
  const nowTime = now.getTime();
  const reminders: LocalNotificationSchema[] = [];

  for (const task of data.followUps) {
    if (task.status !== "scheduled" || task.assignedVolunteerId !== volunteerId
      || (task.acceptance !== undefined && task.acceptance !== "accepted")) continue;
    const at = followUpReminderDate(task.dueAt, data.church.timezone);
    if (!at || at.getTime() <= nowTime) continue;
    const target = "/app/followups";
    reminders.push({
      id: stableNotificationId("follow-up", data.church.id, volunteerId, task.id),
      title: "Next step due",
      body: "Open NeighborWalk to review an accepted follow-up.",
      schedule: { at },
      sound: "default",
      interruptionLevel: "active",
      threadIdentifier: "neighborwalk-follow-ups",
      extra: { source: REMINDER_SOURCE, target } satisfies ReminderExtra,
    });
  }

  const acceptedEventIds = new Set(data.outingParticipants
    .filter((participant) => participant.volunteerId === volunteerId && ["going", "checked_in"].includes(participant.status))
    .map((participant) => participant.eventId));
  for (const outing of data.events) {
    const startsAt = new Date(outing.startsAt);
    if (!acceptedEventIds.has(outing.id) || !["scheduled", "ready", "active"].includes(outing.status)
      || !Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= nowTime) continue;
    const advance = new Date(startsAt.getTime() - WALK_NOTICE_MILLISECONDS);
    const at = advance.getTime() > nowTime ? advance : startsAt;
    const target = `/app/outreach/${encodeURIComponent(outing.id)}`;
    reminders.push({
      id: stableNotificationId("walk", data.church.id, volunteerId, outing.id),
      title: "Walk coming up",
      body: "An accepted NeighborWalk outing starts soon. Open the app for current details.",
      schedule: { at },
      sound: "default",
      interruptionLevel: "active",
      threadIdentifier: "neighborwalk-walks",
      extra: { source: REMINDER_SOURCE, target } satisfies ReminderExtra,
    });
  }

  return [...reminders]
    .sort((left, right) => left.schedule!.at!.getTime() - right.schedule!.at!.getTime() || left.id - right.id)
    .slice(0, MAX_DEVICE_REMINDERS);
}

export function deviceReminderFingerprint(data: NeighborWalkData, now = new Date()) {
  return JSON.stringify(deviceReminderPlan(data, now).map((reminder) => [
    reminder.id,
    reminder.schedule?.at?.toISOString(),
    (reminder.extra as ReminderExtra).target,
  ]));
}

/** Check the OS setting without presenting a permission prompt. */
export async function deviceReminderPermission(adapter: DeviceNotificationAdapter = LocalNotifications) {
  if (!Capacitor.isNativePlatform() && adapter === LocalNotifications) return "denied" as const;
  return (await adapter.checkPermissions()).display;
}

/** Call only from a direct user gesture such as the Settings enable button. */
export async function requestDeviceReminderPermission(adapter: DeviceNotificationAdapter = LocalNotifications) {
  const current = await deviceReminderPermission(adapter);
  if (current !== "prompt" && current !== "prompt-with-rationale") return current;
  return (await adapter.requestPermissions()).display;
}

export async function reconcileDeviceReminders(
  data: NeighborWalkData,
  adapter: DeviceNotificationAdapter = LocalNotifications,
  now = new Date(),
): Promise<DeviceReminderResult> {
  const desired = deviceReminderPlan(data, now);
  const permission = await deviceReminderPermission(adapter);
  if (permission !== "granted") return { permission, eligible: desired.length, scheduled: 0, cancelled: 0 };

  const pending = await adapter.getPending();
  const existing = pending.notifications.filter(managedReminder);
  if (existing.length) await adapter.cancel({ notifications: existing.map(({ id }) => ({ id })) });
  if (desired.length) await adapter.schedule({ notifications: desired });
  return { permission, eligible: desired.length, scheduled: desired.length, cancelled: existing.length };
}

export async function cancelDeviceReminders(adapter: DeviceNotificationAdapter = LocalNotifications) {
  const pending = await adapter.getPending();
  const existing = pending.notifications.filter(managedReminder);
  if (existing.length) await adapter.cancel({ notifications: existing.map(({ id }) => ({ id })) });
  return existing.length;
}

/** Accept a path only when the bundled application router can handle it locally. */
export function validatedDeviceReminderTarget(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/app/") || value.length > 500) return null;
  try {
    if (decodeURIComponent(value).split("/").some((segment) => segment === "." || segment === "..")) return null;
    const base = new URL("https://neighborwalk.invalid");
    const url = new URL(value, base);
    if (url.origin !== base.origin || url.username || url.password || url.port || url.search || url.hash) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[0] === "app" && validAppSegments(parts.slice(1)) ? url.pathname : null;
  } catch {
    return null;
  }
}

export function deviceReminderTapTarget(action: Pick<ActionPerformed, "actionId" | "notification">) {
  if (action.actionId !== "tap") return null;
  const extra = action.notification.extra;
  if (!extra || typeof extra !== "object" || extra.source !== REMINDER_SOURCE) return null;
  return validatedDeviceReminderTarget(reminderTarget(action.notification));
}

/** Install this once at native application startup; it never requests permission. */
export function addDeviceReminderTapListener(onTarget: (target: string) => void | Promise<void>) {
  return LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const target = deviceReminderTapTarget(action);
    if (target) void onTarget(target);
  });
}
