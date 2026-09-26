"use client";
import { useRef, useState } from "react";
import { actionFailed, saveSucceeded } from "../mobile/haptics";

/** Prevent double submissions and keep failed forms open with their input. */
export function useAsyncAction() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>, onSuccess?: () => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try { await action(); onSuccess?.(); }
    catch (failure) { actionFailed(); setError(failure instanceof Error ? failure.message : "This change could not be saved. Your form is still here; please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  /** `run` for a change the person made: a success tap once it has saved. */
  const save = (action: () => Promise<unknown>, onSuccess?: () => void) => run(action, () => { saveSucceeded(); onSuccess?.(); });
  return { busy, error, run, save, clearError: () => setError(null) };
}
