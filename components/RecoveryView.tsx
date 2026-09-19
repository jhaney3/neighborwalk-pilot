"use client";
import { AlertTriangle, CheckCircle2, CloudOff, Download, RefreshCcw, ShieldCheck, Wifi } from "lucide-react";
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
  const reviewRequired = Boolean(data.sync.legacyRecoveryRequired || first?.state === "needs_review");
  const connected = data.sync.mode === "connected";
  const hasAttention = Boolean(reviewRequired || commands.length || data.sync.lastError || (connected && !online));
  const statusTone = reviewRequired || data.sync.lastError ? "attention" : connected && !online ? "offline" : commands.length ? "waiting" : "calm";
  const statusTitle = reviewRequired
    ? "A saved change needs your review"
    : data.sync.lastError
      ? "Sharing needs attention"
      : connected && !online
        ? "This device is offline"
        : commands.length
          ? `${commands.length} ${commands.length === 1 ? "change is" : "changes are"} waiting to share`
          : connected
            ? "Everything is shared"
            : "Sample records stay on this device";
  const statusDetail = reviewRequired
    ? "Nothing has been overwritten. Compare the saved change with the church workspace before deciding what to keep."
    : data.sync.lastError
      ? data.sync.lastError
      : connected && !online
        ? "You can keep working. Saved changes will share automatically after the connection returns."
        : commands.length
          ? "Your work is safely stored here and will share in order when the connection is available."
          : connected
            ? "Work saved on this device has reached the church workspace."
            : "This fictional workspace does not send records to a church account.";
  const lastShared = data.sync.lastSyncedAt
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.church.timezone }).format(new Date(data.sync.lastSyncedAt))
    : "Not yet shared";
  const resolve = async (keepSelected: boolean) => {
    if (!remote || confirmation !== "REVIEWED") throw new Error("Review the comparison and type REVIEWED.");
    await onResolve(remote, keepSelected ? first.command.id : null, selected, commands.map((q) => q.command.id));
    setRemote(null); setSelected([]); setConfirmation("");
    setArchives(await onArchives());
    setMessage(keepSelected ? "The original work was archived on this device. Selected changes are queued as a new transaction." : "Shared records are now shown. The previous device work is preserved in a downloadable recovery archive.");
  };
  return <section className="content-view recovery-view">
    <ViewHeading eyebrow="This device" title="Device status" description="See whether work saved here has reached your church workspace. Recovery tools appear only when they are useful." />
    <section className={`device-status-card ${statusTone}`}>
      <header><span className="device-status-icon">{statusTone === "calm" ? <CheckCircle2 size={25} /> : statusTone === "offline" ? <CloudOff size={25} /> : <AlertTriangle size={25} />}</span><div><p>{hasAttention ? "Check this device" : "Up to date"}</p><h2>{statusTitle}</h2><span>{statusDetail}</span></div><strong className="device-status-pill">{connected ? online ? "Connected" : "Offline" : "Device only"}</strong></header>
      <div className="device-status-facts"><div><small>Connection</small><strong>{connected ? online ? "Online" : "Offline" : "Sample mode"}</strong></div><div><small>Waiting to share</small><strong>{commands.length}</strong></div><div><small>Last shared</small><strong>{connected ? lastShared : "Not connected"}</strong></div></div>
      {connected && <div className="device-status-actions"><button className={`button ${hasAttention ? "primary" : "quiet"}`} disabled={action.busy || !online} onClick={() => void action.run(async () => { const ok = await onSync(); setMessage(ok ? "Device status refreshed." : "Work remains safely stored on this device."); })}><RefreshCcw size={16} /> {hasAttention ? "Retry sharing" : "Check again"}</button>{reviewRequired && <button className="button quiet" disabled={action.busy} onClick={() => void action.run(async () => onExport())}><Download size={16} /> Download recovery copy</button>}</div>}
    </section>

    {!!commands.length && <section className="device-status-panel"><div className="device-panel-heading"><span><Wifi size={20} /></span><div><p>Saved locally</p><h2>Changes waiting on this device</h2><small>Changes share in order. A held item pauses anything behind it so the sequence stays reliable.</small></div></div><ol className="device-queue">{commands.map((queued, index) => {
      const queueState = queued.state === "needs_review" ? "Needs review" : first?.state === "needs_review" && index ? "Waiting behind review" : "Waiting to share";
      return <li key={queued.command.id}><div className="device-queue-number">{index + 1}</div><div className="device-queue-copy"><div><strong>{queued.command.operations.map((operation) => operation.entityType.replaceAll("_", " ")).join(", ")}</strong><span className={queued.state === "needs_review" ? "attention" : ""}>{queueState}</span></div><p>Saved {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.church.timezone }).format(new Date(queued.command.createdAt))}</p>{queued.error && <p className="device-queue-error">{queued.error}</p>}<details><summary>Technical details</summary><pre>{JSON.stringify(queued.command, null, 2)}</pre></details></div></li>;
    })}</ol></section>}

    {reviewRequired && <section className="device-status-panel recovery-resolution"><div className="device-panel-heading"><span><AlertTriangle size={20} /></span><div><p>Decision required</p><h2>Compare before resolving</h2><small>NeighborWalk will not guess which version should win or silently discard the version saved here.</small></div></div>
      <p>{data.sync.legacyRecoveryRequired ? "This work came from an older app version. Download a recovery copy, compare it with shared records, and ask a leader to reconcile anything valuable." : "Load the church’s current values, then select only the device changes you still intend to share. Everything else remains preserved in an archive."}</p>
      <div className="device-panel-actions"><button className="button primary" disabled={action.busy || !online} onClick={() => void action.run(async () => { setRemote(await onPreview()); setSelected([]); setConfirmation(""); })}>Load shared records</button><button className="button quiet" disabled={action.busy} onClick={() => void action.run(async () => onExport())}><Download size={16} /> Download recovery copy</button></div>
      {remote && <div className="recovery-review"><p className="recovery-snapshot-time">Shared records checked {new Date(remote.sync.lastSyncedAt!).toLocaleString()}.</p>
        {data.sync.legacyRecoveryRequired ? <p>Shared records include {remote.properties.length} locations, {remote.residents.length} accessible people, {remote.visits.length} encounters, and {remote.followUps.length} tasks. Reconcile the older copy with a leader before switching.</p>
          : choices.length ? <div className="recovery-comparison">{choices.map((choice) => <label key={choice.key}><div><input type="checkbox" disabled={Boolean(choice.blocked)} checked={selected.includes(choice.key)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, choice.key] : current.filter((key) => key !== choice.key))} /><strong>{choice.label}</strong></div>{choice.blocked && <p className="inline-notice">{choice.blocked}</p>}<div className="comparison-values"><section><h3>Shared</h3><pre>{JSON.stringify(choice.shared, null, 2)}</pre></section><section><h3>Saved on this device</h3><pre>{JSON.stringify(choice.queued, null, 2)}</pre></section></div></label>)}</div> : <p>No differing editable values remain. Keep the shared version and preserve the old transaction in the archive.</p>}
        <label className="form-field recovery-confirmation"><span>Type REVIEWED after checking the comparison and recovery copy</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
        <div className="device-panel-actions">{!data.sync.legacyRecoveryRequired && <button className="button primary" disabled={action.busy || !selected.length || confirmation !== "REVIEWED"} onClick={() => void action.run(() => resolve(true))}>Queue selected changes</button>}<button className="button quiet" disabled={action.busy || confirmation !== "REVIEWED"} onClick={() => void action.run(() => resolve(false))}>Keep shared records</button></div>
      </div>}
    </section>}

    {(hasAttention || archives.length > 0) && <details className="device-advanced-tools" open={reviewRequired || undefined}><summary><span><ShieldCheck size={19} /></span><div><strong>Advanced recovery tools</strong><small>Secure exports and preserved device archives</small></div></summary><div className="device-advanced-body"><p>Use these tools before clearing browser storage, replacing a device, or during a supervised recovery. Downloads may contain sensitive records; store them securely.</p><div className="device-panel-actions"><button className="button quiet" disabled={action.busy} onClick={() => void action.run(async () => onExport())}><Download size={16} /> Export device recovery copy</button><button className="button quiet" disabled={action.busy} onClick={() => void action.run(onAuthoredExport)}>Download only my authored work</button></div><p className="device-authored-note">The authored download includes your transactions, administration requests, and guide-change journal—not another account’s work or the old read cache.</p><div className="device-archive-section"><div><strong>Preserved archives</strong><span>Archives remain under this account and church until browser storage is cleared.</span></div><button className="button quiet" disabled={action.busy} onClick={() => void action.run(async () => setArchives(await onArchives()))}>Show archives</button></div>{archives.length > 0 && <ul className="device-archive-list">{archives.map((archive) => <li key={archive.key}><div><strong>{archive.createdAt ? new Date(archive.createdAt).toLocaleString() : "Earlier device copy"}</strong><span>{archive.reason}</span></div><button className="button quiet small" disabled={action.busy} onClick={() => void action.run(() => onDownloadArchive(archive.key))}>Download</button></li>)}</ul>}</div></details>}
    {message && <p role="status" className="inline-notice device-status-message">{message}</p>}{action.error && <p role="alert" className="inline-error device-status-message">{action.error}</p>}
  </section>;
}
