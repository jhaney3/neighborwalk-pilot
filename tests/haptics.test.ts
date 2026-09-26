import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: vi.fn(), selection: vi.fn(), impact: vi.fn(), notification: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: mocks.native } }));
vi.mock("@capacitor/haptics", () => ({
  Haptics: { selectionChanged: mocks.selection, impact: mocks.impact, notification: mocks.notification },
  ImpactStyle: { Light: "LIGHT" },
  NotificationType: { Success: "SUCCESS", Warning: "WARNING", Error: "ERROR" },
}));
import { actionFailed, cornerPlaced, destructiveAsked, pinDropped, saveSucceeded, selectionTick } from "../mobile/haptics";

let now = 1_000_000;
const later = (ms: number) => { now += ms; vi.setSystemTime(now); };
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  later(10_000);
  mocks.native.mockReturnValue(true);
  for (const effect of [mocks.selection, mocks.impact, mocks.notification]) effect.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe("haptics", () => {
  it("stays silent outside the native app", () => {
    mocks.native.mockReturnValue(false);
    selectionTick(); pinDropped(); saveSucceeded(); actionFailed();
    expect(mocks.selection).not.toHaveBeenCalled();
    expect(mocks.impact).not.toHaveBeenCalled();
    expect(mocks.notification).not.toHaveBeenCalled();
  });

  it("drops a press tick that lands right after a component's own haptic", () => {
    destructiveAsked();
    selectionTick();
    expect(mocks.notification).toHaveBeenCalledWith({ type: "WARNING" });
    expect(mocks.selection).not.toHaveBeenCalled();
    later(100);
    selectionTick();
    expect(mocks.selection).toHaveBeenCalledTimes(1);
  });

  it("plays one success when a save and its toast both report it", () => {
    saveSucceeded();
    later(50);
    saveSucceeded();
    expect(mocks.notification).toHaveBeenCalledTimes(1);
    later(1_000);
    saveSucceeded();
    expect(mocks.notification).toHaveBeenCalledTimes(2);
  });

  it("never lets a success hide a following error", () => {
    saveSucceeded();
    actionFailed();
    expect(mocks.notification.mock.calls.map(([options]) => options.type)).toEqual(["SUCCESS", "ERROR"]);
  });

  it("gives every pin and corner its own light tap", () => {
    pinDropped(); cornerPlaced(); cornerPlaced();
    expect(mocks.impact).toHaveBeenCalledTimes(3);
    expect(mocks.impact).toHaveBeenCalledWith({ style: "LIGHT" });
  });
});
