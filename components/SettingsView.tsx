"use client";

import { AlertTriangle, BookOpenText, Check, Church, CloudOff, Database, Download, FileJson, LockKeyhole, LogOut, MapPinned, RefreshCcw, Save, Smartphone, Star, Trash2, Upload, Wifi } from "lucide-react";
import { useRef, useState } from "react";
import Link from "next/link";
import { useAsyncAction } from "../lib/use-async-action";
import { requestAppInstall } from "../lib/install";
import { isSafeWebUrl, type ConversationGuide, type NeighborWalkData } from "../lib/domain";
import { isSupportedMapStyleUrl } from "../lib/map-config";
import { Modal, ViewHeading } from "./ui";
import { ReminderSettings } from "./ReminderSettings";

export function SettingsView({
  data,
  online,
  saving,
  syncing,
  storageError,
  canManage,
  guides,
  favoriteGuideId,
  accountEmail,
  onSignOut,
  onUpdatePassword,
  onUpdateChurch,
  onSetPreference,
  onSetFavoriteGuide,
  onExport,
  onImport,
  onPurge,
  onClearOutreach,
  onSync,
  onOpenRecovery,
}: {
  data: NeighborWalkData;
  online: boolean;
  saving: boolean;
  syncing: boolean;
  storageError: string | null;
  canManage: boolean;
  guides: ConversationGuide[];
  favoriteGuideId?: string;
  accountEmail?: string;
  onSignOut?: () => Promise<void>;
  onUpdatePassword?: (password: string) => Promise<void>;
  onUpdateChurch: (patch: Partial<NeighborWalkData["church"]>) => Promise<unknown>;
  onSetPreference: <K extends keyof NeighborWalkData["preferences"]>(key: K, value: NeighborWalkData["preferences"][K]) => Promise<unknown>;
  onSetFavoriteGuide: (guideId: string) => Promise<void>;
  onExport: () => void;
  onImport: (file: File) => Promise<NeighborWalkData>;
  onPurge: () => Promise<unknown>;
  onClearOutreach: () => Promise<unknown>;
  onSync: () => Promise<boolean>;
  onOpenRecovery: () => void;
}) {
  const action = useAsyncAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [churchName, setChurchName] = useState(data.church.name);
  const [timezone, setTimezone] = useState(data.church.timezone);
  const [noteLimit, setNoteLimit] = useState(String(data.church.noteCharacterLimit));
  const [followUpDays, setFollowUpDays] = useState(String(data.church.defaultFollowUpDays));
  const [mapStyleUrl, setMapStyleUrl] = useState(data.preferences.mapStyleUrl);
  const [clearing, setClearing] = useState(false);
  const [clearConfirmation, setClearConfirmation] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const pendingDeviceChanges = data.sync.commands?.length ?? data.sync.pending.length;
  const deviceNeedsAttention = Boolean(data.sync.legacyRecoveryRequired || pendingDeviceChanges || data.sync.lastError || (data.sync.mode === "connected" && !online));

  const installApp = async () => {
    setMessage(await requestAppInstall());
  };

  const saveChurchProfile = async () => {
    const name = churchName.trim();
    const zone = timezone.trim();
    if (!name || name.length > 120) return setMessage("Enter a church name between 1 and 120 characters.");
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: zone }).format();
    } catch {
      return setMessage("Enter a valid IANA timezone, such as America/Chicago.");
    }
    await onUpdateChurch({ name, timezone: zone });
    setMessage("Church profile saved on this device; check sync status for sharing.");
  };

  const saveRecordLimits = async () => {
    const parsedNoteLimit = Number(noteLimit);
    const parsedFollowUpDays = Number(followUpDays);
    if (!Number.isInteger(parsedNoteLimit) || parsedNoteLimit < 80 || parsedNoteLimit > 2000) return setMessage("Note limit must be a whole number from 80 to 2,000.");
    if (!Number.isInteger(parsedFollowUpDays) || parsedFollowUpDays < 1 || parsedFollowUpDays > 90) return setMessage("Follow-up timing must be a whole number from 1 to 90 days.");
    await onUpdateChurch({ noteCharacterLimit: parsedNoteLimit, defaultFollowUpDays: parsedFollowUpDays });
    setMessage("Record and follow-up limits saved on this device.");
  };

  const saveMapStyle = async () => {
    const value = mapStyleUrl.trim();
    if (!isSafeWebUrl(value)) return setMessage("Enter a secure https map style URL (http is allowed only for localhost development).");
    if (!isSupportedMapStyleUrl(value)) return setMessage("Use OpenFreeMap, MapTiler, or the map provider configured for this deployment.");
    await onSetPreference("mapStyleUrl", new URL(value).toString());
    setMessage("Map style saved. The map will reload when you return to it.");
  };

  const applyDataDrafts = (next: NeighborWalkData) => {
    setChurchName(next.church.name);
    setTimezone(next.church.timezone);
    setNoteLimit(String(next.church.noteCharacterLimit));
    setFollowUpDays(String(next.church.defaultFollowUpDays));
    setMapStyleUrl(next.preferences.mapStyleUrl);
  };

  const saveAccountPassword = async () => {
    if (!onUpdatePassword) return;
    if (newPassword.length < 8) return setMessage("Use a password with at least 8 characters.");
    if (newPassword !== confirmPassword) return setMessage("The passwords do not match.");
    setUpdatingPassword(true);
    try {
      await onUpdatePassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password saved. You can now sign in without requesting an email link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The password could not be saved.");
    } finally {
      setUpdatingPassword(false);
    }
  };

  return (
    <div className="content-view settings-view">
      <ViewHeading eyebrow="Church and device" title="Settings" description={canManage ? "Set ministry guardrails, prepare offline use, and manage workspace data." : "Manage your account, map, reminders, and this device."} />
      {message && <div className="settings-message" role="status"><Check size={15} />{message}</div>}
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      {storageError && <div className="settings-message error" role="alert"><AlertTriangle size={15} />{storageError}</div>}
      <div className="settings-grid">
        {data.sync.mode === "connected" && <SettingsSection icon={<LockKeyhole size={18} />} title="Account and access" description="Your access level is assigned by a church leader.">
          <div className="connection-card connected"><LockKeyhole size={18} /><span><strong>Signed-in church account</strong>{accountEmail || "Authenticated member"} · {canManage ? "Leader access" : "Volunteer access"}</span></div>
          {onUpdatePassword && <details className="account-password"><summary>Set or change password</summary><div><p>Use a password for routine sign-in without waiting for an email.</p><label className="form-field"><span>New password</span><input type="password" minLength={8} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label className="form-field"><span>Confirm password</span><input type="password" minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label><button className="button quiet" disabled={updatingPassword} onClick={() => void saveAccountPassword()}><Save size={15} /> {updatingPassword ? "Saving…" : "Save password"}</button></div></details>}
          {onSignOut && <button className="button quiet" disabled={action.busy} onClick={() => void action.run(onSignOut)}><LogOut size={15} /> Sign out</button>}
        </SettingsSection>}

        <SettingsSection icon={<Star size={18} />} title="Favorite conversation guide" description="Your personal preference applies when an outing or assigned group has not selected a church guide. Clear it from Conversation guides to return to the church fallback.">
          {guides.length ? <label className="form-field"><span>Default guide</span><select value={favoriteGuideId ?? ""} onChange={async (event) => { if (!event.target.value) return; try { await onSetFavoriteGuide(event.target.value); setMessage("Favorite conversation guide saved."); } catch (error) { setMessage(error instanceof Error ? error.message : "The favorite guide could not be saved."); } }}><option value="" disabled>Choose a favorite guide</option>{guides.map((guide) => <option value={guide.id} key={guide.id}>{guide.title} · {guide.scope === "church" ? "church" : "only me"}</option>)}</select></label> : <div className="data-note"><BookOpenText size={15} /><span>Create a personal guide or ask a leader to publish a church guide first.</span></div>}
          <div className="data-note"><LockKeyhole size={15} /><span>Personal guides stay private to your account. Church guides are shared with this church workspace.</span></div>
        </SettingsSection>

        {(canManage || data.sync.mode === "device_only") && <SettingsSection icon={<Church size={18} />} title="Church profile" description="Shown to volunteers in this workspace.">
          <label className="form-field"><span>Church name</span><input maxLength={120} value={churchName} onChange={(event) => setChurchName(event.target.value)} /></label>
          <label className="form-field"><span>Timezone</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Chicago" /></label>
          <button className="button quiet" disabled={action.busy} onClick={() => void action.run(saveChurchProfile)}><Save size={15} /> Save church profile</button>
          {data.sync.mode === "device_only" && <>
            <label className="form-field"><span>Preview identity <small>Device-only demo</small></span><select value={data.preferences.activeVolunteerId} onChange={(event) => { const value = event.target.value; void action.run(() => onSetPreference("activeVolunteerId", value)); }}>{data.volunteers.map((volunteer) => <option value={volunteer.id} key={volunteer.id}>{volunteer.name} · {volunteer.role}</option>)}</select></label>
            <div className="data-note"><LockKeyhole size={15} /><span>This selector previews volunteer and leader experiences. A connected deployment must derive roles from the authenticated backend session.</span></div>
          </>}
        </SettingsSection>}

        {(canManage || data.sync.mode === "device_only") && <SettingsSection icon={<Database size={18} />} title="Records and retention" description="Set an archival review threshold and keep notes concise. Changing the threshold does not delete records.">
          <div className="form-row">
            <label className="form-field"><span>Retention period</span><select value={data.church.retentionDays} onChange={(event) => { const value = Number(event.target.value); void action.run(() => onUpdateChurch({ retentionDays: value })); }}><option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>1 year</option><option value={730}>2 years</option></select></label>
            <label className="form-field"><span>Note limit</span><input type="number" min={80} max={2000} value={noteLimit} onChange={(event) => setNoteLimit(event.target.value)} /></label>
          </div>
          <label className="form-field"><span>Default follow-up timing <small>Days</small></span><input type="number" min={1} max={90} value={followUpDays} onChange={(event) => setFollowUpDays(event.target.value)} /></label>
          <div className="button-row"><button className="button quiet" disabled={action.busy} onClick={() => void action.run(saveRecordLimits)}><Save size={15} /> Save limits</button>{data.sync.mode === "device_only" && <button className="button quiet" disabled={action.busy} onClick={() => void action.run(onPurge, () => setMessage("Sample-data retention applied on this device."))}><Trash2 size={15} /> Apply to sample records</button>}</div>
          <label className="toggle-row"><input type="checkbox" checked={data.church.pathwayEnabled ?? false} disabled={action.busy} onChange={(event) => { const enabled = event.target.checked; void action.run(() => onUpdateChurch({ pathwayEnabled: enabled })); }} /><span><strong>Optional faith &amp; relationship fields</strong>Default off. Turning this off hides these fields without deleting historical data. Do not use them as conversion scores.</span></label>
          {data.sync.mode === "connected" && <Link className="button quiet" href="/app/data">Open reviewed data &amp; health tools</Link>}
        </SettingsSection>}

        <SettingsSection icon={<MapPinned size={18} />} title="Map and field use" description="Map tiles need a connection; saved records do not.">
          <label className="form-field"><span>Map style URL</span><input inputMode="url" value={mapStyleUrl} onChange={(event) => setMapStyleUrl(event.target.value)} /></label>
          <button className="button quiet" disabled={action.busy} onClick={() => void action.run(saveMapStyle)}><Save size={15} /> Save map style</button>
          <label className="toggle-row"><input type="checkbox" checked={data.preferences.compactMapMarkers} onChange={(event) => { const value = event.target.checked; void action.run(() => onSetPreference("compactMapMarkers", value)); }} /><span><strong>Compact location dots</strong>Use smaller status dots in dense neighborhoods.</span></label>
          <div className="button-row"><button className="button quiet" onClick={installApp}><Smartphone size={15} /> Install app</button></div>
        </SettingsSection>

        <ReminderSettings key={data.church.id} churchId={data.church.id} timezone={data.church.timezone} online={online} connected={data.sync.mode === "connected"} />

        <SettingsSection icon={<Database size={18} />} title="Data and synchronization" description={data.sync.mode === "connected" ? "Changes save to the church workspace automatically. Manual sync remains available as a fallback." : "This build is device-only until your backend is connected."}>
          <div className={`connection-card ${data.sync.mode}`}>
            {data.sync.mode === "connected" ? <Wifi size={18} /> : <CloudOff size={18} />}
            <span><strong>{data.sync.mode === "connected" ? "Automatic sync on" : "Device-only mode"}</strong>{data.sync.mode === "connected"
              ? syncing
                ? "Updating the shared church workspace now."
                : !online
                  ? `${pendingDeviceChanges} change${pendingDeviceChanges === 1 ? " is" : "s are"} safely stored on this device until the connection returns.`
                  : pendingDeviceChanges > 0
                    ? `${pendingDeviceChanges} change${pendingDeviceChanges === 1 ? " is" : "s are"} queued for automatic sharing.`
                    : "This device is up to date with the church workspace."
              : "Records remain on this device until a workspace is connected."}</span>
          </div>
          {data.sync.lastError && <div className="data-note sync-warning"><AlertTriangle size={15} /><span>{data.sync.lastError}</span></div>}
          {data.sync.mode === "connected" && <button className="button quiet" onClick={() => void action.run(async () => setMessage(await onSync() ? "Refresh completed. Check the last-shared time." : "Not shared yet. Open Device status to review what needs attention."))} disabled={!online || saving || syncing}><RefreshCcw size={15} className={syncing ? "spin" : ""} /> {pendingDeviceChanges || data.sync.lastError ? "Retry sharing" : "Check for updates"}</button>}
          {deviceNeedsAttention && <button className="button danger device-status-link" type="button" onClick={onOpenRecovery}><AlertTriangle size={15} /> Review device status</button>}
          {(canManage || data.sync.mode === "device_only") && <><div className="button-row">{data.sync.mode === "device_only" ? <button className="button quiet" onClick={onExport}><Download size={15} /> Export sample records</button> : <Link className="button quiet" href="/app/data">Reviewed church export &amp; CSV tools</Link>}{data.sync.mode === "device_only" && <button className="button quiet" onClick={() => fileRef.current?.click()}><Upload size={15} /> Import sample backup</button>}<input ref={fileRef} className="visually-hidden" type="file" tabIndex={-1} aria-label="Import sample backup file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const imported = await onImport(file); applyDataDrafts(imported); setMessage("Backup imported and validated."); } catch (error) { setMessage(error instanceof Error ? error.message : "The backup could not be imported."); } finally { event.target.value = ""; } }} /></div>
          <div className="data-note"><FileJson size={15} /><span>This export contains the records visible to this account, including unsent work. It is not a full database, authentication or guide-library backup. Protect the readable JSON file.</span></div></>}
        </SettingsSection>
      </div>
      {data.sync.mode === "device_only" && <section className="danger-zone"><div><strong>Clear outreach records</strong><span>Delete mapped locations, visits, follow-ups, and person records. Church settings, groups, members, territories, and the guide remain.</span></div><button className="button danger" onClick={() => setClearing(true)}><Trash2 size={15} /> Clear records</button></section>}
      {clearing && <Modal title="Clear outreach records?" description="This removes sample records on this device only. Export a copy first if you need it." onClose={() => { setClearing(false); setClearConfirmation(""); }}>
        <div className="clear-data-summary"><div><strong>{data.properties.length}</strong><span>locations</span></div><div><strong>{data.visits.length}</strong><span>visits</span></div><div><strong>{data.followUps.length}</strong><span>follow-ups</span></div><div><strong>{data.residents.length}</strong><span>people</span></div></div>
        <label className="form-field"><span>Type <strong>CLEAR</strong> to confirm</span><input autoComplete="off" value={clearConfirmation} onChange={(event) => setClearConfirmation(event.target.value)} /></label>
        <div className="modal-actions"><button className="button quiet" onClick={() => { setClearing(false); setClearConfirmation(""); }}>Cancel</button><button className="button danger" disabled={clearConfirmation !== "CLEAR"} onClick={() => void action.run(onClearOutreach, () => { setClearing(false); setClearConfirmation(""); setMessage("Sample records cleared on this device only."); })}><Trash2 size={15} /> Permanently clear records</button></div>
      </Modal>}
    </div>
  );
}

function SettingsSection({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <section className="settings-section"><div className="settings-section-heading"><span>{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div><div className="settings-section-body">{children}</div></section>;
}
