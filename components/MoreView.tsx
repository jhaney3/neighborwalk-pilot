"use client";

import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, CloudOff, Lock, RefreshCw, Settings2, UsersRound } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import type { NeighborWalkData } from "../lib/domain";
import { useAsyncAction } from "../lib/use-async-action";
import { RecoveryView } from "./RecoveryView";
import { initials } from "./ui";

/** Where this phone's changes stand, in words and a short mono label. */
export function syncState(data: NeighborWalkData, online: boolean) {
  const commands = data.sync.commands ?? [];
  const review = Boolean(data.sync.legacyRecoveryRequired || commands.some((queued) => queued.state === "needs_review"));
  if (data.sync.mode !== "connected") return { tone: "calm", title: "On this phone", short: "Practice", review, waiting: commands.length } as const;
  if (review) return { tone: "attention", title: "Needs your review", short: "Needs review", review, waiting: commands.length } as const;
  if (data.sync.lastError) return { tone: "attention", title: "Couldn’t send", short: "Not sent", review, waiting: commands.length } as const;
  if (!online) return { tone: "offline", title: "You’re offline", short: "Offline", review, waiting: commands.length } as const;
  if (commands.length) return { tone: "waiting", title: `${commands.length} waiting to send`, short: `${commands.length} waiting`, review, waiting: commands.length } as const;
  return { tone: "calm", title: "All sent", short: "All sent", review, waiting: 0 } as const;
}

function ago(iso: string | undefined, now = Date.now()) {
  if (!iso) return "Not sent yet";
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "Last sent just now";
  if (minutes < 60) return `Last sent ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `Last sent ${hours} hr ago` : `Last sent ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso))}`;
}

/** More (AD1): your profile card, then the church, this phone, and help. */
export function MoreView({ data, name, canManage, online, onTeam, onSettings, onSync }: {
  data: NeighborWalkData; name: string; canManage: boolean; online: boolean; onTeam: () => void; onSettings: () => void; onSync: () => void;
}) {
  const sync = syncState(data, online);
  const churchId = useId();
  const phoneId = useId();
  const helpId = useId();
  return <section className="content-view more-page" aria-labelledby="more-title">
    <h1 className="tab-title" id="more-title">More</h1>
    <div className="more-profile offset-card"><span className="more-profile-avatar" aria-hidden="true">{initials(name)}</span><span className="more-profile-copy"><strong>{name}</strong><span className="mono-meta">{canManage ? "Leader" : "Volunteer"} · {data.church.name}</span></span></div>
    {canManage && <section className="settings-group" aria-labelledby={churchId}><h2 className="mono-meta sheet-label" id={churchId}>Your church</h2><div className="grouped-rows">
      <button type="button" className="grouped-row" onClick={onTeam}><UsersRound size={19} aria-hidden="true" /><span className="grouped-row-text"><strong>Team &amp; invitations</strong></span><ChevronRight size={17} aria-hidden="true" /></button>
    </div></section>}
    <section className="settings-group" aria-labelledby={phoneId}><h2 className="mono-meta sheet-label" id={phoneId}>This phone</h2><div className="grouped-rows">
      <button type="button" className="grouped-row" onClick={onSettings}><Settings2 size={19} aria-hidden="true" /><span className="grouped-row-text"><strong>Settings</strong></span><ChevronRight size={17} aria-hidden="true" /></button>
      <button type="button" className="grouped-row" onClick={onSync}><RefreshCw size={19} aria-hidden="true" /><span className="grouped-row-text"><strong>Sync</strong></span><span className={`mono-meta${sync.tone === "attention" ? " danger" : ""}`}>{sync.short}</span><ChevronRight size={17} aria-hidden="true" /></button>
    </div></section>
    <section className="settings-group" aria-labelledby={helpId}><h2 className="mono-meta sheet-label" id={helpId}>Help</h2><div className="grouped-rows">
      <Link className="grouped-row" href="/help"><CircleHelp size={19} aria-hidden="true" /><span className="grouped-row-text"><strong>Help &amp; field guide</strong></span><ChevronRight size={17} aria-hidden="true" /></Link>
      <Link className="grouped-row" href="/trust"><Lock size={19} aria-hidden="true" /><span className="grouped-row-text"><strong>Privacy &amp; trust</strong></span><ChevronRight size={17} aria-hidden="true" /></Link>
    </div></section>
  </section>;
}

type RecoveryProps = React.ComponentProps<typeof RecoveryView>;

/** Sync (AD9): one big status, what's waiting, Recovery for the rare change
 * that couldn't send, and Sync now. */
export function SyncPage({ recovery, onBack }: { recovery: RecoveryProps; onBack: () => void }) {
  const { data, online, onSync } = recovery;
  const [details, setDetails] = useState(false);
  const [message, setMessage] = useState("");
  const [now] = useState(Date.now);
  const action = useAsyncAction();
  const sync = syncState(data, online);
  const connected = data.sync.mode === "connected";
  if (details) return <section className="content-view sync-page">
    <div className="screen-top"><button type="button" className="round-button float" aria-label="Back to sync" onClick={() => setDetails(false)}><ChevronLeft size={22} aria-hidden="true" /></button><span className="mono-meta">Sync</span></div>
    <RecoveryView {...recovery} />
  </section>;
  const Icon = sync.tone === "calm" ? CheckCircle2 : sync.tone === "offline" ? CloudOff : sync.tone === "waiting" ? RefreshCw : AlertTriangle;
  return <section className="content-view sync-page" aria-labelledby="sync-title">
    <div className="screen-top"><button type="button" className="round-button float" aria-label="Back to more" onClick={onBack}><ChevronLeft size={22} aria-hidden="true" /></button><span className="mono-meta">More</span></div>
    <h1 className="screen-title" id="sync-title">Sync</h1>
    <div className={`sync-status offset-card ${sync.tone}`} role="status">
      <span className="sync-status-icon" aria-hidden="true"><Icon size={28} /></span>
      <strong>{sync.title}</strong>
      <span className="mono-meta">{connected ? `${ago(data.sync.lastSyncedAt, now)} · ${online ? "Online" : "Offline"}` : "Practice mode · nothing is sent"}</span>
      {connected && data.sync.lastError && <small>{data.sync.lastError}</small>}
    </div>
    <div className="grouped-rows">
      <div className="grouped-row"><span className="grouped-row-text"><strong>Waiting to send</strong></span><span className="mono-meta">{sync.waiting}</span></div>
      <button type="button" className="grouped-row" onClick={() => setDetails(true)}><span className="grouped-row-text"><strong>Recovery</strong><small>Changes that couldn’t send</small></span><span className={`mono-meta${sync.review ? " danger" : ""}`}>{sync.review ? "Review" : "None"}</span><ChevronRight size={17} aria-hidden="true" /></button>
    </div>
    {message && <p role="status" className="inline-notice">{message}</p>}
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="button-outline wide" disabled={!connected || !online || action.busy} onClick={() => void action.run(async () => setMessage(await onSync() ? "Up to date." : "Not sent yet. Your changes are safe on this phone."))}><RefreshCw size={18} aria-hidden="true" className={action.busy ? "spin" : undefined} /> Sync now</button>
  </section>;
}
