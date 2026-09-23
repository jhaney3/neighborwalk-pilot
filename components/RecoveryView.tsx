"use client";
import { AlertTriangle, CheckCircle2, CloudOff, Download, RefreshCcw, ShieldCheck, Wifi } from "lucide-react";
import { useState } from "react";
import type { NeighborWalkData } from "../lib/domain";
import { recoveryChoices } from "../lib/outreach-recovery";
import { useAsyncAction } from "../lib/use-async-action";
import { ListGroup, ListRow, ViewHeading } from "./ui";

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
  const reviewRequired = Boolean(data.sync.legacyRecoveryRequired || first?.state === "needs_review");
  const connected = data.sync.mode === "connected";
  const hasAttention = Boolean(reviewRequired || commands.length || data.sync.lastError || (connected && !online));
  const statusTone = reviewRequired || data.sync.lastError ? "attention" : connected && !online ? "offline" : commands.length ? "waiting" : "calm";
  const statusTitle = reviewRequired
    ? "A saved change needs your review"
    : data.sync.lastError
      ? "Couldn’t send changes"
      : connected && !online
        ? "You’re offline"
        : commands.length
          ? `${commands.length} ${commands.length === 1 ? "change is" : "changes are"} waiting to share`
          : connected
            ? "Everything’s sent"
            : "Practice mode";
  const statusDetail = reviewRequired
    ? "Nothing was overwritten. Compare the two versions and pick what to keep."
    : data.sync.lastError
      ? data.sync.lastError
      : connected && !online
        ? "Keep working. Changes send when you’re back online."
        : commands.length
          ? "Your changes are saved and will send in order."
          : connected
            ? "Your church has everything from this phone."
            : "Nothing here is sent to a church.";
  const lastShared = data.sync.lastSyncedAt
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.church.timezone }).format(new Date(data.sync.lastSyncedAt))
    : "Not sent yet";
  const resolve = async (keepSelected: boolean) => {
    if (!remote || confirmation !== "REVIEWED") throw new Error("Review the comparison and type REVIEWED.");
    await onResolve(remote, keepSelected ? first.command.id : null, selected, commands.map((q) => q.command.id));
    setRemote(null); setSelected([]); setConfirmation("");
    setArchives(await onArchives());
    setMessage(keepSelected ? "Your picks will send. The original is kept on this phone." : "Showing your church’s version. The old copy is kept on this phone.");
  };
  return <section className="content-view recovery-view">
    <ViewHeading title="Sync" />
    <section className={`device-status-card ${statusTone}`}>
      <header><span className="device-status-icon">{statusTone === "calm" ? <CheckCircle2 size={25} /> : statusTone === "offline" ? <CloudOff size={25} /> : <AlertTriangle size={25} />}</span><div><h2>{statusTitle}</h2><span>{statusDetail}</span></div></header>
      {connected && <div className="device-status-actions"><button className={`button ${hasAttention ? "primary" : "quiet"}`} disabled={action.busy || !online} onClick={() => void action.run(async () => { const ok = await onSync(); setMessage(ok ? "Checked." : "Your changes are still saved on this phone."); })}><RefreshCcw size={16} /> {hasAttention ? "Try again" : "Check again"}</button>{reviewRequired && <button className="button quiet" disabled={action.busy} onClick={() => void action.run(async () => onExport())}><Download size={16} /> Download recovery copy</button>}</div>}
    </section>
    <ListGroup className="device-status-facts">
      <ListRow title="Connection" value={connected ? online ? "Online" : "Offline" : "Sample mode"} />
      <ListRow title="Waiting to send" value={String(commands.length)} />
      <ListRow title="Last sent" value={connected ? lastShared : "Not connected"} />
    </ListGroup>

    {!!commands.length && <section className="device-status-panel"><div className="device-panel-heading"><span><Wifi size={20} /></span><div><p>On this phone</p><h2>Waiting to send</h2><small>Changes send in order. One that needs review holds the rest.</small></div></div><ol className="device-queue">{commands.map((queued, index) => {
      const queueState = queued.state === "needs_review" ? "Needs review" : first?.state === "needs_review" && index ? "Waiting" : "Waiting to send";
      return <li key={queued.command.id}><div className="device-queue-number">{index + 1}</div><div className="device-queue-copy"><div><strong>{queued.command.operations.map((operation) => operation.entityType.replaceAll("_", " ")).join(", ")}</strong><span className={queued.state === "needs_review" ? "attention" : ""}>{queueState}</span></div><p>Saved {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.church.timezone }).format(new Date(queued.command.createdAt))}</p>{queued.error && <p className="device-queue-error">{queued.error}</p>}<details><summary>Technical details</summary><pre>{JSON.stringify(queued.command, null, 2)}</pre></details></div></li>;
    })}</ol></section>}

    {reviewRequired && <section className="device-status-panel recovery-resolution"><div className="device-panel-heading"><span><AlertTriangle size={20} /></span><div><p>Decision required</p><h2>Compare before resolving</h2><small>Nothing is thrown away until you choose.</small></div></div>
      <p>{data.sync.legacyRecoveryRequired ? "These changes came from an older version of the app. Download a copy and ask a leader to help." : "Load your church’s version, then pick which of your changes to keep."}</p>
      <div className="device-panel-actions"><button className="button primary" disabled={action.busy || !online} onClick={() => void action.run(async () => { setRemote(await onPreview()); setSelected([]); setConfirmation(""); })}>Load church version</button><button className="button quiet" disabled={action.busy} onClick={() => void action.run(async () => onExport())}><Download size={16} /> Download recovery copy</button></div>
      {remote && <div className="recovery-review"><p className="recovery-snapshot-time">Shared records checked {new Date(remote.sync.lastSyncedAt!).toLocaleString()}.</p>
        {data.sync.legacyRecoveryRequired ? <p>Shared records include {remote.properties.length} locations, {remote.residents.length} accessible people, {remote.visits.length} encounters, and {remote.followUps.length} tasks. Reconcile the older copy with a leader before switching.</p>
          : choices.length ? <div className="recovery-comparison">{choices.map((choice) => <label key={choice.key}><div><input type="checkbox" disabled={Boolean(choice.blocked)} checked={selected.includes(choice.key)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, choice.key] : current.filter((key) => key !== choice.key))} /><strong>{choice.label}</strong></div>{choice.blocked && <p className="inline-notice">{choice.blocked}</p>}<div className="comparison-values"><section><h3>Shared</h3><pre>{JSON.stringify(choice.shared, null, 2)}</pre></section><section><h3>On this phone</h3><pre>{JSON.stringify(choice.queued, null, 2)}</pre></section></div></label>)}</div> : <p>The two versions now match. Keep your church’s version.</p>}
        <label className="form-field recovery-confirmation"><span>Type REVIEWED after checking the comparison and recovery copy</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
        <div className="device-panel-actions">{!data.sync.legacyRecoveryRequired && <button className="button primary" disabled={action.busy || !selected.length || confirmation !== "REVIEWED"} onClick={() => void action.run(() => resolve(true))}>Send my picks</button>}<button className="button quiet" disabled={action.busy || confirmation !== "REVIEWED"} onClick={() => void action.run(() => resolve(false))}>Keep church version</button></div>
      </div>}
    </section>}

    {(hasAttention || archives.length > 0) && <details className="device-advanced-tools" open={reviewRequired || undefined}><summary><span><ShieldCheck size={19} /></span><div><strong>Backups</strong><small>Download copies of your work</small></div></summary><div className="device-advanced-body"><p>Use these before switching phones. Files may contain private details, so store them carefully.</p><div className="device-panel-actions"><button className="button quiet" disabled={action.busy} onClick={() => void action.run(async () => onExport())}><Download size={16} /> Export device recovery copy</button><button className="button quiet" disabled={action.busy} onClick={() => void action.run(onAuthoredExport)}>Download my unsent work</button></div><p className="device-authored-note">Only changes you made that haven’t been sent.</p><div className="device-archive-section"><div><strong>Saved copies</strong><span>Kept on this phone for this account.</span></div><button className="button quiet" disabled={action.busy} onClick={() => void action.run(async () => setArchives(await onArchives()))}>Show copies</button></div>{archives.length > 0 && <ul className="device-archive-list">{archives.map((archive) => <li key={archive.key}><div><strong>{archive.createdAt ? new Date(archive.createdAt).toLocaleString() : "Earlier device copy"}</strong><span>{archive.reason}</span></div><button className="button quiet small" disabled={action.busy} onClick={() => void action.run(() => onDownloadArchive(archive.key))}>Download</button></li>)}</ul>}</div></details>}
    {message && <p role="status" className="inline-notice device-status-message">{message}</p>}{action.error && <p role="alert" className="inline-error device-status-message">{action.error}</p>}
  </section>;
}
