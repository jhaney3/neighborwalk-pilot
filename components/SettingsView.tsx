"use client";

import { AlertTriangle, BookOpenText, Check, Church, CloudOff, Database, Download, FileJson, LockKeyhole, LogOut, MapPinned, Moon, RefreshCcw, Save, Smartphone, Star, Trash2, Upload, Wifi } from "lucide-react";
import { useRef, useState } from "react";
import Link from "next/link";
import { useAsyncAction } from "../lib/use-async-action";
import { isMobileApp } from "../lib/mobile";
import { AccountDeletion } from "./AccountDeletion";
import { requestAppInstall } from "../lib/install";
import { isSafeWebUrl, type ConversationGuide, type NeighborWalkData } from "../lib/domain";
import { isSupportedMapStyleUrl } from "../lib/map-config";
import { Modal, ViewHeading } from "./ui";
import { ReminderSettings } from "./ReminderSettings";
import { DeviceReminderSettings } from "./DeviceReminderSettings";
import { getMobileColorTheme, setMobileColorTheme, type MobileColorThemePreference } from "../mobile/theme";

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
  const [colorTheme, setColorTheme] = useState<MobileColorThemePreference>(getMobileColorTheme);
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
    setMessage("Church profile saved.");
  };

  const saveRecordLimits = async () => {
    const parsedNoteLimit = Number(noteLimit);
    const parsedFollowUpDays = Number(followUpDays);
    if (!Number.isInteger(parsedNoteLimit) || parsedNoteLimit < 80 || parsedNoteLimit > 2000) return setMessage("Note limit must be a whole number from 80 to 2,000.");
    if (!Number.isInteger(parsedFollowUpDays) || parsedFollowUpDays < 1 || parsedFollowUpDays > 90) return setMessage("Follow-up timing must be a whole number from 1 to 90 days.");
    await onUpdateChurch({ noteCharacterLimit: parsedNoteLimit, defaultFollowUpDays: parsedFollowUpDays });
    setMessage("Saved.");
  };

  const saveMapStyle = async () => {
    const value = mapStyleUrl.trim();
    if (!isSafeWebUrl(value)) return setMessage("Enter an https map style URL.");
    if (!isSupportedMapStyleUrl(value)) return setMessage("Use OpenFreeMap, MapTiler, or the map provider configured for this deployment.");
    await onSetPreference("mapStyleUrl", new URL(value).toString());
    setMessage("Map style saved.");
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
      setMessage("Password saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The password could not be saved.");
    } finally {
      setUpdatingPassword(false);
    }
  };

  return (
    <div className="content-view settings-view">
      <ViewHeading title="Settings" />
      {message && <div className="settings-message" role="status"><Check size={15} />{message}</div>}
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      {storageError && <div className="settings-message error" role="alert"><AlertTriangle size={15} />{storageError}</div>}
      <div className="settings-grid">
        {isMobileApp && <SettingsSection icon={<Moon size={18} />} title="Appearance" description="Choose how NeighborWalk looks on this iPhone or iPad.">
          <label className="form-field"><span>Color appearance</span><select value={colorTheme} onChange={(event) => {
            const next = event.target.value as MobileColorThemePreference;
            setColorTheme(next);
            setMobileColorTheme(next);
          }}><option value="system">Match iPhone or iPad</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        </SettingsSection>}

        {data.sync.mode === "connected" && <SettingsSection icon={<LockKeyhole size={18} />} title="Account and access" description="A church leader sets your access.">
          <div className="connection-card connected"><LockKeyhole size={18} /><span><strong>Signed in as</strong>{accountEmail || "Authenticated member"} · {canManage ? "Leader access" : "Volunteer access"}</span></div>
          {onUpdatePassword && <details className="account-password"><summary>Set or change password</summary><div><p>So you can sign in without an email link.</p><label className="form-field"><span>New password</span><input type="password" minLength={8} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label className="form-field"><span>Confirm password</span><input type="password" minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label><button className="button quiet" disabled={updatingPassword} onClick={() => void saveAccountPassword()}><Save size={15} /> {updatingPassword ? "Saving…" : "Save password"}</button></div></details>}
          {isMobileApp && <AccountDeletion />}
          {onSignOut && <button className="button quiet" disabled={action.busy} onClick={() => void action.run(onSignOut)}><LogOut size={15} /> Sign out</button>}
        </SettingsSection>}

        <SettingsSection icon={<Star size={18} />} title="Favorite conversation guide" description="Used when a walk or team doesn’t have its own guide.">
          {guides.length ? <label className="form-field"><span>Default guide</span><select value={favoriteGuideId ?? ""} onChange={async (event) => { if (!event.target.value) return; try { await onSetFavoriteGuide(event.target.value); setMessage("Favorite conversation guide saved."); } catch (error) { setMessage(error instanceof Error ? error.message : "The favorite guide could not be saved."); } }}><option value="" disabled>Choose a favorite guide</option>{guides.map((guide) => <option value={guide.id} key={guide.id}>{guide.title} · {guide.scope === "church" ? "church" : "only me"}</option>)}</select></label> : <div className="data-note"><BookOpenText size={15} /><span>Create a guide first, or ask a leader to share one.</span></div>}
          <div className="data-note"><LockKeyhole size={15} /><span>Your personal guides are private. Church guides are shared.</span></div>
        </SettingsSection>

        {(canManage || data.sync.mode === "device_only") && <SettingsSection icon={<Church size={18} />} title="Church profile" description="Shown to everyone on your team.">
          <label className="form-field"><span>Church name</span><input maxLength={120} value={churchName} onChange={(event) => setChurchName(event.target.value)} /></label>
          <label className="form-field"><span>Timezone</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Chicago" /></label>
          <button className="button quiet" disabled={action.busy} onClick={() => void action.run(saveChurchProfile)}><Save size={15} /> Save church profile</button>
          {data.sync.mode === "device_only" && <>
            <label className="form-field"><span>Preview identity <small>Practice mode</small></span><select value={data.preferences.activeVolunteerId} onChange={(event) => { const value = event.target.value; void action.run(() => onSetPreference("activeVolunteerId", value)); }}>{data.volunteers.map((volunteer) => <option value={volunteer.id} key={volunteer.id}>{volunteer.name} · {volunteer.role}</option>)}</select></label>
            <div className="data-note"><LockKeyhole size={15} /><span>See the app as a volunteer or a leader.</span></div>
          </>}
        </SettingsSection>}

        {(canManage || data.sync.mode === "device_only") && <SettingsSection icon={<Database size={18} />} title="Records and retention" description="How long before old records come up for review. Nothing is deleted automatically.">
          <div className="form-row">
            <label className="form-field"><span>Retention period</span><select value={data.church.retentionDays} onChange={(event) => { const value = Number(event.target.value); void action.run(() => onUpdateChurch({ retentionDays: value })); }}><option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>1 year</option><option value={730}>2 years</option></select></label>
            <label className="form-field"><span>Note limit</span><input type="number" min={80} max={2000} value={noteLimit} onChange={(event) => setNoteLimit(event.target.value)} /></label>
          </div>
          <label className="form-field"><span>Default follow-up timing <small>Days</small></span><input type="number" min={1} max={90} value={followUpDays} onChange={(event) => setFollowUpDays(event.target.value)} /></label>
          <div className="button-row"><button className="button quiet" disabled={action.busy} onClick={() => void action.run(saveRecordLimits)}><Save size={15} /> Save limits</button>{data.sync.mode === "device_only" && <button className="button quiet" disabled={action.busy} onClick={() => void action.run(onPurge, () => setMessage("Saved."))}><Trash2 size={15} /> Apply to sample records</button>}</div>
          <label className="toggle-row"><input type="checkbox" checked={data.church.pathwayEnabled ?? false} disabled={action.busy} onChange={(event) => { const enabled = event.target.checked; void action.run(() => onUpdateChurch({ pathwayEnabled: enabled })); }} /><span><strong>Optional faith &amp; relationship fields</strong>Off by default. Turning it off hides the fields but keeps what’s saved.</span></label>
          {data.sync.mode === "connected" && <Link className="button quiet" href="/app/data">Open Data &amp; health</Link>}
        </SettingsSection>}

        <SettingsSection icon={<MapPinned size={18} />} title="Map and field use" description="Maps need a connection. Your records don’t.">
          <label className="form-field"><span>Map style URL</span><input inputMode="url" value={mapStyleUrl} onChange={(event) => setMapStyleUrl(event.target.value)} /></label>
          <button className="button quiet" disabled={action.busy} onClick={() => void action.run(saveMapStyle)}><Save size={15} /> Save map style</button>
          <label className="toggle-row"><input type="checkbox" checked={data.preferences.compactMapMarkers} onChange={(event) => { const value = event.target.checked; void action.run(() => onSetPreference("compactMapMarkers", value)); }} /><span><strong>Compact location dots</strong>Smaller dots for busy streets.</span></label>
          {!isMobileApp && <div className="button-row"><button className="button quiet" onClick={installApp}><Smartphone size={15} /> Install app</button></div>}
        </SettingsSection>

        <ReminderSettings key={data.church.id} churchId={data.church.id} timezone={data.church.timezone} online={online} connected={data.sync.mode === "connected"} />

        {isMobileApp && data.sync.mode === "connected" && <DeviceReminderSettings
          data={data}
          onSetEnabled={(enabled) => onSetPreference("notificationsEnabled", enabled)}
        />}

        <SettingsSection icon={<Database size={18} />} title="Data and synchronization" description={data.sync.mode === "connected" ? "Changes send to your church automatically." : "Practice mode keeps everything on this phone."}>
          <div className={`connection-card ${data.sync.mode}`}>
            {data.sync.mode === "connected" ? <Wifi size={18} /> : <CloudOff size={18} />}
            <span><strong>{data.sync.mode === "connected" ? "Syncing automatically" : "Practice mode"}</strong>{data.sync.mode === "connected"
              ? syncing
                ? "Sending your changes…"
                : !online
                  ? `${pendingDeviceChanges} change${pendingDeviceChanges === 1 ? " is" : "s are"} safely stored on this device until the connection returns.`
                  : pendingDeviceChanges > 0
                    ? `${pendingDeviceChanges} change${pendingDeviceChanges === 1 ? " is" : "s are"} queued for automatic sharing.`
                    : "Up to date."
              : "Everything stays on this phone."}</span>
          </div>
          {data.sync.lastError && <div className="data-note sync-warning"><AlertTriangle size={15} /><span>{data.sync.lastError}</span></div>}
          {data.sync.mode === "connected" && <button className="button quiet" onClick={() => void action.run(async () => setMessage(await onSync() ? "Refreshed." : "Not sent yet. Open Sync to see why."))} disabled={!online || saving || syncing}><RefreshCcw size={15} className={syncing ? "spin" : ""} /> {pendingDeviceChanges || data.sync.lastError ? "Try again" : "Check for updates"}</button>}
          {deviceNeedsAttention && <button className="button danger device-status-link" type="button" onClick={onOpenRecovery}><AlertTriangle size={15} /> Review device status</button>}
          {(canManage || data.sync.mode === "device_only") && <><div className="button-row">{data.sync.mode === "device_only" ? <button className="button quiet" onClick={onExport}><Download size={15} /> Export sample records</button> : <Link className="button quiet" href="/app/data">Reviewed church export &amp; CSV tools</Link>}{data.sync.mode === "device_only" && <button className="button quiet" onClick={() => fileRef.current?.click()}><Upload size={15} /> Import sample backup</button>}<input ref={fileRef} className="visually-hidden" type="file" tabIndex={-1} aria-label="Import sample backup file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const imported = await onImport(file); applyDataDrafts(imported); setMessage("Backup imported and validated."); } catch (error) { setMessage(error instanceof Error ? error.message : "The backup could not be imported."); } finally { event.target.value = ""; } }} /></div>
          <div className="data-note"><FileJson size={15} /><span>Includes everything you can see, plus unsent changes. Keep the file private.</span></div></>}
        </SettingsSection>
      </div>
      {data.sync.mode === "device_only" && <section className="danger-zone"><div><strong>Clear outreach records</strong><span>Removes homes, visits, follow-ups and people. Settings, teams and neighborhoods stay.</span></div><button className="button danger" onClick={() => setClearing(true)}><Trash2 size={15} /> Clear records</button></section>}
      {clearing && <Modal title="Clear outreach records?" description="This only affects this phone. Export a copy first if you need it." onClose={() => { setClearing(false); setClearConfirmation(""); }}>
        <div className="clear-data-summary"><div><strong>{data.properties.length}</strong><span>locations</span></div><div><strong>{data.visits.length}</strong><span>visits</span></div><div><strong>{data.followUps.length}</strong><span>follow-ups</span></div><div><strong>{data.residents.length}</strong><span>people</span></div></div>
        <label className="form-field"><span>Type <strong>CLEAR</strong> to confirm</span><input autoComplete="off" value={clearConfirmation} onChange={(event) => setClearConfirmation(event.target.value)} /></label>
        <div className="modal-actions"><button className="button quiet" onClick={() => { setClearing(false); setClearConfirmation(""); }}>Cancel</button><button className="button danger" disabled={clearConfirmation !== "CLEAR"} onClick={() => void action.run(onClearOutreach, () => { setClearing(false); setClearConfirmation(""); setMessage("Cleared."); })}><Trash2 size={15} /> Permanently clear records</button></div>
      </Modal>}
    </div>
  );
}

function SettingsSection({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <section className="settings-section"><div className="settings-section-heading"><span>{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div><div className="settings-section-body">{children}</div></section>;
}
