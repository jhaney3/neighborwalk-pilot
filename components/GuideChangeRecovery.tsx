"use client";

import { RefreshCcw } from "lucide-react";
import type { PendingGuideChange } from "../lib/storage";
import { useAsyncAction } from "../lib/use-async-action";

export function GuideChangeRecovery({ pending, online, busy, onRefresh, onRetry, onReview }: {
  pending: PendingGuideChange | null; online: boolean; busy: boolean;
  onRefresh: () => Promise<void>; onRetry: () => Promise<unknown>; onReview: () => Promise<void>;
}) {
  const action = useAsyncAction();
  const disabled = !online || busy || action.busy;
  return <section className={pending ? "today-card guide-change-recovery" : "guide-recovery-tools"} aria-label="Guide refresh and recovery">
    {pending && <>
      <h2>A guide request needs confirmation</h2>
      <p>The original request is saved on this device for this account. It may already have reached the church. Review or retry it before starting another guide change.</p>
      <details><summary>Original guide request (preserved exactly)</summary><pre>{JSON.stringify(pending.request, null, 2)}</pre></details>
      <p>Retry sends the same request ID and content. Preserving it as reviewed stops retries but does not undo anything already saved.</p>
    </>}
    <div className="care-next-actions">
      <button className="button quiet" disabled={disabled} onClick={() => void action.run(onRefresh)}><RefreshCcw size={16} /> Refresh guides</button>
      {pending && <>
        <button className="button primary" disabled={disabled} onClick={() => void action.run(async () => { await onRetry(); })}>Retry original guide request</button>
        <button className="button quiet" disabled={disabled} onClick={() => {
          if (window.confirm("Preserve this exact request in this account’s recovery history and stop retrying it? This will not undo a guide change that already reached the church. Review the shared library before starting another edit.")) void action.run(onReview);
        }}>Preserve request as reviewed</button>
      </>}
    </div>
    {!online && <p>Prepared guides are still readable. Reconnect to refresh or change the library.</p>}
    {action.error && <p role="alert">{action.error}</p>}
  </section>;
}
