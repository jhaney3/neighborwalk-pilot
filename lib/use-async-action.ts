"use client";
import { useRef, useState } from "react";

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
    catch (failure) { setError(failure instanceof Error ? failure.message : "This change could not be saved. Your form is still here; please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return { busy, error, run, clearError: () => setError(null) };
}
