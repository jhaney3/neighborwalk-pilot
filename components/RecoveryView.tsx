"use client";
import { Download, RefreshCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { NeighborWalkData } from "../lib/domain";
import { recoveryChoices } from "../lib/outreach-recovery";
import { useAsyncAction } from "../lib/use-async-action";
import { ViewHeading } from "./ui";

type Archive = { key: string; reason: string; createdAt: string };
export function RecoveryView({ data, online, onPreview, onResolve, onExport, onAuthoredExport, onArchives, onDownloadArchive, onSync }: {
  data: NeighborWalkData; online: boolean;
  onPreview: () => Promise<NeighborWalkData>;
  onResolve: (reviewed: NeighborWalkData, commandId: string | null, selected: string[], expectedIds: string[]) => Promise<string>;
  onExport: () => Promise<unknown>; onArchives: () => Promise<Archive[]>; onDownloadArchive: (key: string) => Promise<void>; onSync: () => Promise<boolean>;
  onAuthoredExport: () => Promise<void>;
}) {
  const action = useAsyncAction();
  const [remote, setRemote] = useState<NeighborWalkData | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [archives, setArchives] = useState<Archive[]>([]);
  const [message, setMessage] = useState("");
  const commands = data.sync.commands ?? [];
  const first = commands[0];
  const choices = remote && first?.state === "needs_review" ? recoveryChoices(first, remote) : [];
  const resolve = async (keepSelected: boolean) => {
    if (!remote || confirmation !== "REVIEWED") throw new Error("Review the comparison and type REVIEWED.");
    await onResolve(remote, keepSelected ? first.command.id : null, selected, commands.map((q) => q.command.id));
    setRemote(null); setSelected([]); setConfirmation("");
    setArchives(await onArchives());
    setMessage(keepSelected ? "The original work was archived on this device. Selected changes are queued as a new transaction." : "Shared records are now shown. The previous device work is preserved in a downloadable recovery archive.");
  };
  return <section className="content-view recovery-view">
    <ViewHeading eyebrow="Your work stays accountable" title="Sync & recovery" description="Saved on this device and shared with your church are different states. Nothing held for review is silently overwritten." />
    <div className="today-card"><h2>{data.sync.legacyRecoveryRequired ? "Previous-version work needs a careful review" : first?.state === "needs_review" ? "A change needs your decision" : commands.length ? commands.length + " transactions waiting to share" : "No queued transactions on this device"}</h2>
      <p>{data.sync.lastError || (online ? "Connected. Shared records refresh while the app is open." : "Offline. Reconnect to share work or compare a conflict.")}</p>
      <p>Volunteer downloads contain only their own queued transactions; older copies require supervised recovery. Full leader copies require a connected sign-in within 15 minutes and an audit entry. Store downloads securely and never send them through public channels.</p>
      <div className="care-next-actions"><button className="button quiet" disabled={action.busy} onClick={() => void action.run(async () => onExport())}><Download size={16} /> Export this device’s recovery copy</button><button className="button quiet" disabled={action.busy || !online} onClick={() => void action.run(async () => { const ok = await onSync(); setMessage(ok ? "Refresh completed." : "Work remains on this device. Check the message above."); })}><RefreshCcw size={16} /> Refresh &amp; retry</button></div>
      <button className="button quiet" disabled={action.busy} onClick={() => void action.run(onAuthoredExport)}>Download only my authored work &amp; administration journal</button>
      <p>The authored-work download includes your own preserved transactions and reviewed administration requests, not the old read cache or another account’s work.</p>
    </div>
    {!!commands.length && <section className="today-card"><h2>Device queue</h2><ol>{commands.map((q, i) => <li key={q.command.id}><strong>{i + 1}. {q.state === "needs_review" ? "Needs review" : first?.state === "needs_review" && i ? "Waiting behind the held change" : "Waiting to share"}</strong><p>{q.command.operations.map((op) => op.entityType.replaceAll("_", " ")).join(", ")} · {new Date(q.command.createdAt).toLocaleString()}</p>{q.error && <p>{q.error}</p>}<details><summary>Original transaction (preserved exactly)</summary><pre>{JSON.stringify(q.command, null, 2)}</pre></details></li>)}</ol></section>}
    {(data.sync.legacyRecoveryRequired || first?.state === "needs_review") && <section className="today-card"><h2>Compare before resolving</h2>
      <p>{data.sync.legacyRecoveryRequired ? "Older devices did not keep transactional payloads. Export the recovery copy, compare it with shared records, and ask a leader to reconcile valuable unsent work. The app will not guess which copy should win." : "Review shared values against the queued values. Select only the changes you still intend. Unselected work is kept in the recovery archive, not submitted."}</p>
      <button className="button quiet" disabled={action.busy || !online} onClick={() => void action.run(async () => { setRemote(await onPreview()); setSelected([]); setConfirmation(""); })}>Load current shared records</button>
      {remote && <><p>Shared snapshot checked {new Date(remote.sync.lastSyncedAt!).toLocaleString()}. A further change requires another review.</p>
        {data.sync.legacyRecoveryRequired ? <p>Shared records: {remote.properties.length} locations, {remote.residents.length} accessible people, {remote.visits.length} encounters and {remote.followUps.length} tasks. Export your old copy before switching; reconcile its unsent entries with your leader.</p>
          : choices.length ? <div className="recovery-comparison">{choices.map((choice) => <label key={choice.key}><div><input type="checkbox" disabled={Boolean(choice.blocked)} checked={selected.includes(choice.key)} onChange={(e) => setSelected((current) => e.target.checked ? [...current, choice.key] : current.filter((key) => key !== choice.key))} /><strong>{choice.label}</strong></div>{choice.blocked && <p className="inline-notice">{choice.blocked}</p>}<div className="comparison-values"><section><h3>Shared</h3><pre>{JSON.stringify(choice.shared, null, 2)}</pre></section><section><h3>Queued on this device</h3><pre>{JSON.stringify(choice.queued, null, 2)}</pre></section></div></label>)}</div> : <p>No differing editable values remain. Keep the shared version and preserve the old transaction in the archive.</p>}
        <label className="form-field"><span>Type REVIEWED after checking the data and recovery copy</span><input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" /></label>
        <div className="care-next-actions">{!data.sync.legacyRecoveryRequired && <button className="button primary" disabled={action.busy || !selected.length || confirmation !== "REVIEWED"} onClick={() => void action.run(() => resolve(true))}>Archive original &amp; queue selected changes</button>}<button className="button quiet" disabled={action.busy || confirmation !== "REVIEWED"} onClick={() => void action.run(() => resolve(false))}>Archive all pending work &amp; keep shared records</button></div>
      </>}
    </section>}
    <section className="today-card"><h2><ShieldCheck size={22} /> Preserved recovery archives</h2><p>Archives stay on this device under this account and church. Clearing browser storage removes them; download authorized work or arrange supervised recovery before doing so.</p><button className="button quiet" disabled={action.busy} onClick={() => void action.run(async () => setArchives(await onArchives()))}>Show this account’s archives</button><ul>{archives.map((archive) => <li key={archive.key}><p>{archive.createdAt ? new Date(archive.createdAt).toLocaleString() : "Earlier device copy"} · {archive.reason}</p><button className="button quiet" disabled={action.busy} onClick={() => void action.run(() => onDownloadArchive(archive.key))}>Download preserved work</button></li>)}</ul></section>
    {message && <p role="status" className="inline-notice">{message}</p>}{action.error && <p role="alert" className="inline-error">{action.error}</p>}
  </section>;
}
