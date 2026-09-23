import { describe, expect, it, vi } from "vitest";
import type { DeviceNotificationAdapter } from "../mobile/notifications";
import {
  cancelDeviceReminders,
  deviceReminderPlan,
  deviceReminderTapTarget,
  reconcileDeviceReminders,
  requestDeviceReminderPermission,
  validatedDeviceReminderTarget,
} from "../mobile/notifications";
import { createSeedData } from "../lib/seed";

function connectedData() {
  const data = createSeedData();
  return { ...data, sync: { ...data.sync, mode: "connected" as const } };
}

function adapter(permission: "prompt" | "granted" | "denied" = "granted", pending: Awaited<ReturnType<DeviceNotificationAdapter["getPending"]>>["notifications"] = []) {
  return {
    checkPermissions: vi.fn(async () => ({ display: permission })),
    requestPermissions: vi.fn(async () => ({ display: "granted" as const })),
    getPending: vi.fn(async () => ({ notifications: pending })),
    cancel: vi.fn(async () => undefined),
    schedule: vi.fn(async ({ notifications }: Parameters<DeviceNotificationAdapter["schedule"]>[0]) => ({ notifications: notifications.map(({ id }) => ({ id })) })),
  } satisfies DeviceNotificationAdapter;
}

describe("iOS device reminder planning", () => {
  it("plans only accepted work owned by the signed-in volunteer with privacy-safe copy", () => {
    const data = connectedData();
    const now = new Date("2026-09-20T12:00:00.000Z");
    const volunteerId = data.preferences.activeVolunteerId;
    const accepted = { ...data.followUps[0], id: "accepted-task", assignedVolunteerId: volunteerId, acceptance: "accepted" as const, status: "scheduled" as const, dueAt: "2026-09-22" };
    const pending = { ...accepted, id: "pending-task", acceptance: "pending" as const };
    const anotherOwner = { ...accepted, id: "another-owner", assignedVolunteerId: "someone-else" };
    const completed = { ...accepted, id: "completed-task", status: "completed" as const };
    const event = { ...data.events[0], id: "accepted-walk", name: "Private outing name", status: "ready" as const, startsAt: "2026-09-21T18:00:00.000Z", endsAt: "2026-09-21T20:00:00.000Z" };
    data.followUps = [accepted, pending, anotherOwner, completed];
    data.events = [event];
    data.outingParticipants = [{ id: "participant", churchId: data.church.id, eventId: event.id, volunteerId, status: "going" }];

    const plan = deviceReminderPlan(data, now);

    expect(plan).toHaveLength(2);
    expect(plan.map((item) => item.extra.target)).toEqual([`/app/outreach/${event.id}`, "/app/followups"]);
    expect(plan.map((item) => `${item.title} ${item.body}`).join(" ")).not.toMatch(/Private|name|address|note/i);
    expect(plan[0].schedule?.at?.toISOString()).toBe("2026-09-21T17:00:00.000Z");
    expect(plan[1].schedule?.at?.toISOString()).toBe("2026-09-22T14:00:00.000Z");
  });

  it("uses stable positive 32-bit IDs and excludes demo, declined, stale, or past work", () => {
    const data = connectedData();
    const now = new Date("2026-09-20T12:00:00.000Z");
    const first = deviceReminderPlan(data, now);
    const second = deviceReminderPlan(structuredClone(data), now);
    expect(second.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
    expect(first.every(({ id }) => Number.isInteger(id) && id > 0 && id <= 2_147_483_647)).toBe(true);
    expect(deviceReminderPlan({ ...data, sync: { ...data.sync, mode: "device_only" } }, now)).toEqual([]);
  });

  it("caps the plan below the iOS pending-notification limit", () => {
    const data = connectedData();
    const volunteerId = data.preferences.activeVolunteerId;
    data.followUps = Array.from({ length: 80 }, (_, index) => ({
      ...data.followUps[0], id: `task-${index}`, assignedVolunteerId: volunteerId, acceptance: "accepted" as const,
      status: "scheduled" as const, dueAt: `2026-12-${String(index % 28 + 1).padStart(2, "0")}`,
    }));
    expect(deviceReminderPlan(data, new Date("2026-09-20T12:00:00.000Z"))).toHaveLength(60);
  });
});

describe("iOS device reminder permission and reconciliation", () => {
  it("never requests permission during background reconciliation", async () => {
    const notifications = adapter("prompt");
    const result = await reconcileDeviceReminders(connectedData(), notifications, new Date("2026-09-20T12:00:00.000Z"));
    expect(result.permission).toBe("prompt");
    expect(notifications.requestPermissions).not.toHaveBeenCalled();
    expect(notifications.getPending).not.toHaveBeenCalled();
    expect(notifications.schedule).not.toHaveBeenCalled();
  });

  it("requests permission only through the explicit permission function", async () => {
    const notifications = adapter("prompt");
    await expect(requestDeviceReminderPermission(notifications)).resolves.toBe("granted");
    expect(notifications.requestPermissions).toHaveBeenCalledOnce();
  });

  it("cancels stale NeighborWalk schedules, preserves unrelated schedules, and replaces the desired plan", async () => {
    const notifications = adapter("granted", [
      { id: 10, title: "old", body: "old", extra: { source: "neighborwalk-device-reminder-v1", target: "/app/followups" } },
      { id: 11, title: "other", body: "other", extra: { source: "another-feature" } },
    ]);
    const data = connectedData();
    const desired = deviceReminderPlan(data, new Date("2026-09-20T12:00:00.000Z"));
    const result = await reconcileDeviceReminders(data, notifications, new Date("2026-09-20T12:00:00.000Z"));
    expect(notifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 10 }] });
    expect(notifications.schedule).toHaveBeenCalledWith({ notifications: desired });
    expect(result).toMatchObject({ permission: "granted", cancelled: 1, scheduled: desired.length });
  });

  it("turning reminders off cancels only NeighborWalk device reminders", async () => {
    const notifications = adapter("granted", [
      { id: 20, title: "ours", body: "ours", extra: { source: "neighborwalk-device-reminder-v1", target: "/app/followups" } },
      { id: 21, title: "other", body: "other" },
    ]);
    await expect(cancelDeviceReminders(notifications)).resolves.toBe(1);
    expect(notifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 20 }] });
  });
});

describe("device reminder routes", () => {
  it("allows only routes handled inside the bundled app", () => {
    expect(validatedDeviceReminderTarget("/app/followups")).toBe("/app/followups");
    expect(validatedDeviceReminderTarget("/app/outreach/walk-1")).toBe("/app/outreach/walk-1");
    for (const target of ["https://evil.test/app/followups", "//evil.test/app/followups", "/app/unknown", "/app/followups?next=https://evil.test", "/app/outreach/%2e%2e/settings", 4]) {
      expect(validatedDeviceReminderTarget(target)).toBeNull();
    }
  });

  it("opens only a tapped NeighborWalk reminder with a validated target", () => {
    expect(deviceReminderTapTarget({ actionId: "tap", notification: { id: 1, title: "", body: "", extra: { source: "neighborwalk-device-reminder-v1", target: "/app/followups" } } })).toBe("/app/followups");
    expect(deviceReminderTapTarget({ actionId: "dismiss", notification: { id: 1, title: "", body: "", extra: { source: "neighborwalk-device-reminder-v1", target: "/app/followups" } } })).toBeNull();
    expect(deviceReminderTapTarget({ actionId: "tap", notification: { id: 1, title: "", body: "", extra: { source: "other", target: "/app/followups" } } })).toBeNull();
  });
});
