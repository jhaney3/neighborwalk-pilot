import { describe, expect, it, vi } from "vitest";
import { captureInstallPrompt, requestAppInstall } from "../lib/install";

describe("install feature detection", () => {
  it("provides platform instructions when no prompt is available", async () => {
    expect(await requestAppInstall()).toContain("Safari");
  });
  it("captures a prompt before Settings opens and uses it only once", async () => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    captureInstallPrompt(event);
    expect(event.defaultPrevented).toBe(true);
    expect(await requestAppInstall()).toContain("accepted");
    expect(await requestAppInstall()).toContain("Safari");
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });
  it("handles a browser rejection without an unhandled exception", async () => {
    captureInstallPrompt(Object.assign(new Event("beforeinstallprompt"), { prompt: vi.fn().mockRejectedValue(new Error("unavailable")) }));
    expect(await requestAppInstall()).toContain("not available");
  });
});
