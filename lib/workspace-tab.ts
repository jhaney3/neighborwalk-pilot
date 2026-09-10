/** One live writer per account and browser profile. Separate devices can still
 * collaborate through server transactions. The browser releases the lock on
 * process/tab termination; no persistent flag can strand a device after a crash. */
export function acquireWorkspaceTab(locks: Pick<LockManager, "request"> | undefined, key: string): Promise<() => void> {
  if (!locks) return Promise.reject(new Error("This browser cannot safely coordinate saved work across tabs. Open NeighborWalk in an up-to-date browser; existing device work has not been cleared."));
  return new Promise((resolve, reject) => {
    void locks.request(key, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) { reject(new Error("This account’s workspace is already open in another tab or window. Use that tab, or close it and try again here. This prevents one tab from overwriting another tab’s saved fieldwork.")); return; }
      await new Promise<void>((release) => { resolve(release); });
    }).catch(reject);
  });
}
