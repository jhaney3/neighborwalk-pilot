import { afterEach, describe, expect, it, vi } from "vitest";
import {
  effectiveConnectivity,
  NATIVE_CONNECTIVITY_EVENT,
  publishNativeConnectivity,
  resetNativeConnectivityForTests,
} from "../mobile/connectivity";

afterEach(() => resetNativeConnectivityForTests());

describe("native connectivity bridge", () => {
  it("uses the browser signal until Capacitor reports a native status", () => {
    expect(effectiveConnectivity(true)).toBe(true);
    expect(effectiveConnectivity(false)).toBe(false);
  });

  it("retains the plugin's actual status even when navigator.onLine is stale", () => {
    const target = new EventTarget();
    const changed = vi.fn();
    target.addEventListener(NATIVE_CONNECTIVITY_EVENT, changed);

    publishNativeConnectivity(false, target);
    expect(effectiveConnectivity(true)).toBe(false);
    expect(changed).toHaveBeenCalledOnce();

    publishNativeConnectivity(true, target);
    expect(effectiveConnectivity(false)).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
