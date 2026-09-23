export type OfflineShellState = "preparing" | "ready" | "update_waiting" | "unavailable" | "development";

/** Observe the worker's actual precache, not merely successful registration. */
export function observeOfflineShell(script: string, publish: (state: OfflineShellState) => void) {
  let disposed = false;
  let registration: ServiceWorkerRegistration | undefined;
  const cleanup: (() => void)[] = [];
  let requestNumber = 0;
  const report = (state: OfflineShellState) => { if (!disposed) publish(state); };
  const check = () => {
    if (!registration || disposed) return;
    const currentRequest = ++requestNumber;
    if (registration.waiting) { report("update_waiting"); return; }
    if (!registration.active) { report(registration.installing ? "preparing" : "unavailable"); return; }
    const channel = new MessageChannel();
    const close = () => { channel.port1.close(); channel.port2.close(); };
    const timer = window.setTimeout(() => { close(); if (currentRequest === requestNumber) report("unavailable"); }, 5000);
    cleanup.push(() => { clearTimeout(timer); close(); });
    channel.port1.onmessage = (event) => { clearTimeout(timer); close(); if (currentRequest === requestNumber) report(event.data?.ready === true ? "ready" : "unavailable"); };
    try { registration.active.postMessage({ type: "OFFLINE_STATUS" }, [channel.port2]); }
    catch { clearTimeout(timer); close(); report("unavailable"); }
  };
  queueMicrotask(() => report("preparing"));
  void navigator.serviceWorker.register(script, { updateViaCache: "none" }).then((value) => {
    if (disposed) return;
    registration = value;
    const watch = () => {
      const installing = registration?.installing;
      if (installing) { installing.addEventListener("statechange", check); cleanup.push(() => installing.removeEventListener("statechange", check)); }
      check();
    };
    registration.addEventListener("updatefound", watch);
    navigator.serviceWorker.addEventListener("controllerchange", check);
    cleanup.push(() => { value.removeEventListener("updatefound", watch); navigator.serviceWorker.removeEventListener("controllerchange", check); });
    watch();
  }).catch(() => report("unavailable"));
  return () => { disposed = true; cleanup.forEach((dispose) => dispose()); };
}

export const offlineShellCopy: Record<OfflineShellState, string> = {
  preparing: "Getting ready to work offline. Keep this page open.",
  ready: "Ready to reopen offline. Maps still need a connection.",
  update_waiting: "An update is ready. Close all NeighborWalk tabs and reopen to use it.",
  unavailable: "Offline use isn’t ready yet. Reconnect and check again.",
  development: "Offline use is only available in the production build.",
};
