"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, LockKeyhole, LogOut } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { PermissionState } from "@capacitor/core";
import { useAsyncAction } from "../lib/use-async-action";
import { isMobileApp } from "../lib/mobile";
import { isSafeWebUrl, type NeighborWalkData } from "../lib/domain";
import { isSupportedMapStyleUrl } from "../lib/map-config";
import { AccountDeletion } from "./AccountDeletion";
import { ReminderSettings } from "./ReminderSettings";
import { ActionSheet, Sheet } from "./Sheet";
import { SegmentedControl } from "./ui";
import { getMobileColorTheme, setMobileColorTheme, type MobileColorThemePreference } from "../mobile/theme";
import { cancelDeviceReminders, deviceReminderPermission, FOLLOW_UP_HOUR, reconcileDeviceReminders, requestDeviceReminderPermission } from "../mobile/notifications";
import { registerRemotePush, remotePushConfigured, unregisterRemotePush } from "../mobile/push-notifications";
import { selectionTick } from "../mobile/haptics";

type Page = "main" | "church" | "records" | "data" | "map" | "account";

type Props = {
  data: NeighborWalkData;
  online: boolean;
  storageError: string | null;
  canManage: boolean;
  accountEmail?: string;
  onBack: () => void;
  onSignOut?: () => Promise<void>;
  onUpdatePassword?: (password: string) => Promise<void>;
  onUpdateChurch: (patch: Partial<NeighborWalkData["church"]>) => Promise<unknown>;
  onSetPreference: <K extends keyof NeighborWalkData["preferences"]>(key: K, value: NeighborWalkData["preferences"][K]) => Promise<unknown>;
  onExport: () => void;
  onImport: (file: File) => Promise<NeighborWalkData>;
  onClearOutreach: () => Promise<unknown>;
  onOpenDataHealth: () => void;
};

const zoneNames: Record<string, string> = {
  "America/New_York": "Eastern · New York", "America/Chicago": "Central · Chicago", "America/Denver": "Mountain · Denver", "America/Phoenix": "Arizona · Phoenix",
  "America/Los_Angeles": "Pacific · Los Angeles", "America/Anchorage": "Alaska · Anchorage", "Pacific/Honolulu": "Hawaii · Honolulu",
};
const zoneLabel = (zone: string) => zoneNames[zone] ?? zone.replaceAll("_", " ").replace("/", " · ");
const reminderTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(Date.UTC(2000, 0, 1, FOLLOW_UP_HOUR));

/** Settings (AD5): one grouped list. Simple settings sit in the row; bigger
 * ones open a small page (AD6–AD8). */
export function SettingsView(props: Props) {
  const { data, canManage, storageError, onBack } = props;
  const [page, setPage] = useState<Page>("main");
  const [previewAs, setPreviewAs] = useState(false);
  const [colorTheme, setColorTheme] = useState<MobileColorThemePreference>(getMobileColorTheme);
  const action = useAsyncAction();
  const titleId = useId();
  const sample = data.sync.mode === "device_only";
  const leaderTools = canManage;
  const me = data.volunteers.find((volunteer) => volunteer.id === data.preferences.activeVolunteerId);
  const back = () => setPage("main");

  if (page === "church") return <ChurchProfile {...props} onBack={back} />;
  if (page === "records") return <RecordsPrivacy {...props} onBack={back} />;
  if (page === "data") return <DataPage {...props} onBack={back} />;
  if (page === "map") return <MapSettings {...props} onBack={back} />;
  if (page === "account") return <AccountPage {...props} onBack={back} />;

  return <section className="content-view settings-page" aria-labelledby={titleId}>
    <div className="screen-top"><button type="button" className="round-button float" aria-label="Back to more" onClick={onBack}><ChevronLeft size={22} aria-hidden="true" /></button></div>
    <h1 className="screen-title" id={titleId}>Settings</h1>
    {storageError && <p role="alert" className="inline-error"><AlertTriangle size={15} aria-hidden="true" /> {storageError}</p>}
    <SettingsGroup label="This phone">
      <div className="grouped-row"><span className="grouped-row-text" id={`${titleId}-appearance`}><strong>Appearance</strong></span>
        <div className="mini-seg" role="group" aria-labelledby={`${titleId}-appearance`}>
          {([["system", "Auto"], ["light", "Light"], ["dark", "Dark"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={colorTheme === value} onClick={() => { selectionTick(); setColorTheme(value); setMobileColorTheme(value); }}>{label}</button>)}
        </div>
      </div>
      <FollowUpReminders data={data} onSetPreference={props.onSetPreference} />
      <Row title="Map" detail={data.preferences.compactMapMarkers ? "Small dots on busy streets" : "Regular dots"} onClick={() => setPage("map")} />
    </SettingsGroup>
    {leaderTools && <SettingsGroup label="Church · leaders">
      <Row title="Church profile" onClick={() => setPage("church")} />
      <Row title="Records & privacy" onClick={() => setPage("records")} />
      <Row title="Data" detail="Export, import, clear" onClick={() => setPage("data")} />
    </SettingsGroup>}
    {data.sync.mode === "connected" && <SettingsGroup label="Account">
      <Row title="Signed in" detail={`${props.accountEmail || "Church member"} · ${canManage ? "Leader" : "Volunteer"}`} onClick={() => setPage("account")} />
    </SettingsGroup>}
    {sample && <SettingsGroup label="Sample church">
      <Row title="Preview as" value={me ? `${me.name} · ${me.role}` : undefined} onClick={() => setPreviewAs(true)} />
    </SettingsGroup>}
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    {previewAs && <ActionSheet title="See the app as" closeLabel="Cancel" onClose={() => setPreviewAs(false)} actions={data.volunteers.filter((volunteer) => volunteer.active).map((volunteer) => ({
      label: `${volunteer.name} · ${volunteer.role === "leader" ? "Leader" : "Volunteer"}${volunteer.id === me?.id ? " ✓" : ""}`,
      onSelect: () => { setPreviewAs(false); void action.run(() => props.onSetPreference("activeVolunteerId", volunteer.id)); },
    }))} />}
  </section>;
}

function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return <section className="settings-group" aria-labelledby={id}><h2 className="mono-meta sheet-label" id={id}>{label}</h2><div className="grouped-rows">{children}</div></section>;
}

function Row({ title, detail, value, danger, onClick }: { title: string; detail?: string; value?: string; danger?: boolean; onClick: () => void }) {
  return <button type="button" className={`grouped-row${danger ? " danger" : ""}`} onClick={onClick}>
    <span className="grouped-row-text"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>
    {value && <span className="mono-meta">{value}</span>}
    {!danger && <ChevronRight size={17} aria-hidden="true" />}
  </button>;
}

function SubPage({ title, parent = "Settings", onBack, children }: { title: string; parent?: string; onBack: () => void; children: React.ReactNode }) {
  const id = useId();
  return <section className="content-view settings-page" aria-labelledby={id}>
    <div className="screen-top"><button type="button" className="round-button float" aria-label={`Back to ${parent.toLowerCase()}`} onClick={onBack}><ChevronLeft size={22} aria-hidden="true" /></button><span className="mono-meta">{parent}</span></div>
    <h1 className="screen-title" id={id}>{title}</h1>
    {children}
  </section>;
}

/** The reminders switch: on-device reminders at the reminder hour when a
 * follow-up is due. iOS asks for permission the first time. */
function FollowUpReminders({ data, onSetPreference }: Pick<Props, "data" | "onSetPreference">) {
  const [permission, setPermission] = useState<PermissionState | "checking">(isMobileApp ? "checking" : "prompt");
  const [message, setMessage] = useState("");
  const action = useAsyncAction();
  const id = useId();
  useEffect(() => {
    if (!isMobileApp) return;
    let active = true;
    void deviceReminderPermission().then((value) => { if (active) setPermission(value); }).catch(() => { if (active) setPermission("denied"); });
    return () => { active = false; };
  }, []);
  const on = data.preferences.notificationsEnabled && (!isMobileApp || permission === "granted");
  const toggle = (enable: boolean) => action.run(async () => {
    setMessage("");
    if (!enable) {
      await onSetPreference("notificationsEnabled", false);
      if (isMobileApp) await Promise.all([cancelDeviceReminders(), unregisterRemotePush()]);
      return;
    }
    if (isMobileApp) {
      const next = await requestDeviceReminderPermission();
      setPermission(next);
      if (next !== "granted") { setMessage("Notifications are off in iOS Settings."); return; }
    }
    await onSetPreference("notificationsEnabled", true);
    if (isMobileApp) {
      await reconcileDeviceReminders(data);
      if (remotePushConfigured) await registerRemotePush().catch(() => undefined);
    }
  });
  return <div className="grouped-row">
    <span className="grouped-row-text" id={id}><strong>Follow-up reminders</strong><small>{message || (permission === "denied" && data.preferences.notificationsEnabled ? "Blocked in iOS Settings" : `${reminderTime} when something’s due`)}</small></span>
    <input type="checkbox" role="switch" aria-labelledby={id} checked={on} disabled={action.busy || permission === "checking"} onChange={(event) => { selectionTick(); void toggle(event.target.checked); }} />
  </div>;
}

const followUpChoices = [{ value: "1", label: "Tomorrow" }, { value: "3", label: "3 days" }, { value: "7", label: "1 wk" }, { value: "14", label: "2 wks" }];

/** Church profile (AD6): name, timezone, and the default follow-up timing the
 * Come back switch starts on. */
function ChurchProfile({ data, onUpdateChurch, onBack }: Props) {
  const [name, setName] = useState(data.church.name);
  const [zone, setZone] = useState(data.church.timezone);
  const [days, setDays] = useState(String(data.church.defaultFollowUpDays));
  const [picking, setPicking] = useState(false);
  const action = useAsyncAction();
  const nameId = useId();
  const zones = [...new Set([...Object.keys(zoneNames), data.church.timezone])];
  const choices = followUpChoices.some((choice) => choice.value === days) ? followUpChoices : [...followUpChoices, { value: days, label: `${days} days` }];
  return <SubPage title="Church profile" onBack={onBack}>
    <h2 className="mono-meta sheet-label" id={nameId}>Church name</h2>
    <input className="sheet-input" aria-labelledby={nameId} value={name} maxLength={120} autoComplete="off" onChange={(event) => setName(event.target.value)} />
    <h2 className="mono-meta sheet-label">Timezone</h2>
    <div className="grouped-rows"><button type="button" className="grouped-row" onClick={() => setPicking(true)}><span className="grouped-row-text"><strong>{zoneLabel(zone)}</strong></span><ChevronRight size={17} aria-hidden="true" /></button></div>
    <h2 className="mono-meta sheet-label">Default follow-up</h2>
    <SegmentedControl label="Default follow-up" value={days} onChange={(value) => { selectionTick(); setDays(value); }} options={choices} />
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy || !name.trim()} onClick={() => void action.run(() => onUpdateChurch({ name: name.trim(), timezone: zone, defaultFollowUpDays: Number(days) }), onBack)}>{action.busy ? "Saving…" : "Save"}</button>
    {picking && <ActionSheet title="Timezone" closeLabel="Cancel" onClose={() => setPicking(false)} actions={zones.map((value) => ({ label: `${zoneLabel(value)}${value === zone ? " ✓" : ""}`, onSelect: () => { setZone(value); setPicking(false); } }))} />}
  </SubPage>;
}

/** Records & privacy (AD7): when old records come up for review, the note
 * limit, and the optional faith fields. */
function RecordsPrivacy({ data, onUpdateChurch, onBack }: Props) {
  const [review, setReview] = useState(String(data.church.retentionDays));
  const [limit, setLimit] = useState(String(data.church.noteCharacterLimit));
  const [faith, setFaith] = useState(data.church.pathwayEnabled ?? false);
  const action = useAsyncAction();
  const faithId = useId();
  const withCurrent = (options: { value: string; label: string }[], current: string, label: string) => options.some((option) => option.value === current) ? options : [...options, { value: current, label }];
  const reviews = withCurrent([{ value: "365", label: "1 year" }, { value: "730", label: "2 years" }, { value: "1825", label: "5 years" }], review, `${review} days`);
  const limits = withCurrent([{ value: "280", label: "280" }, { value: "500", label: "500" }, { value: "1000", label: "1,000" }], limit, limit);
  return <SubPage title="Records & privacy" onBack={onBack}>
    <h2 className="mono-meta sheet-label">Review records after</h2>
    <SegmentedControl label="Review records after" value={review} onChange={(value) => { selectionTick(); setReview(value); }} options={reviews} />
    <p className="sheet-copy">Old records come up for a leader’s review. Nothing is deleted automatically.</p>
    <h2 className="mono-meta sheet-label">Note limit</h2>
    <SegmentedControl label="Note limit" value={limit} onChange={(value) => { selectionTick(); setLimit(value); }} options={limits} />
    <div className="grouped-rows"><div className="grouped-row"><span className="grouped-row-text" id={faithId}><strong>Faith &amp; relationship fields</strong><small>Off hides them but keeps what’s saved</small></span><input type="checkbox" role="switch" aria-labelledby={faithId} checked={faith} onChange={(event) => setFaith(event.target.checked)} /></div></div>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy} onClick={() => void action.run(() => onUpdateChurch({ retentionDays: Number(review), noteCharacterLimit: Number(limit), pathwayEnabled: faith }), onBack)}>{action.busy ? "Saving…" : "Save"}</button>
  </SubPage>;
}

/** Data (AD8): export, import, and Clear outreach records, which asks for the
 * church name. */
function DataPage({ data, onExport, onImport, onClearOutreach, onOpenDataHealth, onBack }: Props) {
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const action = useAsyncAction();
  const sample = data.sync.mode === "device_only";
  return <SubPage title="Data" onBack={onBack}>
    <div className="grouped-rows">
      <Row title="Export records" detail="A file with everything you can see" onClick={() => sample ? onExport() : onOpenDataHealth()} />
      {sample && <Row title="Import a backup" onClick={() => file.current?.click()} />}
      {!sample && <Row title="Review records" detail="Old records, duplicates and reviewed exports" onClick={onOpenDataHealth} />}
    </div>
    <input ref={file} className="visually-hidden" type="file" tabIndex={-1} aria-label="Import a backup file" accept="application/json,.json" onChange={(event) => {
      const chosen = event.target.files?.[0];
      event.target.value = "";
      if (chosen) void action.run(async () => { await onImport(chosen); setMessage("Backup imported and checked."); });
    }} />
    <p className="privacy-line quiet"><LockKeyhole size={13} aria-hidden="true" /> Exports include names and notes. Keep the file private.</p>
    {sample && <div className="grouped-rows"><Row title="Clear outreach records" detail="Homes, visits, follow-ups and people. Settings, teams and neighborhoods stay." danger onClick={() => setClearing(true)} /></div>}
    {message && <p role="status" className="inline-notice">{message}</p>}
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    {clearing && <ClearRecordsSheet data={data} onClear={onClearOutreach} onDone={() => { setClearing(false); setMessage("Outreach records cleared."); }} onClose={() => setClearing(false)} />}
  </SubPage>;
}

function ClearRecordsSheet({ data, onClear, onDone, onClose }: { data: NeighborWalkData; onClear: () => Promise<unknown>; onDone: () => void; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const action = useAsyncAction();
  const titleId = useId();
  const fieldId = useId();
  const matches = typed.trim().toLowerCase() === data.church.name.trim().toLowerCase();
  return <Sheet className="home-sheet form" modal labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <div className="home-sheet-head"><h2 className="pin-title" id={titleId}>Clear outreach records?</h2></div>
    <p className="sheet-copy">Removes {data.properties.length} homes, {data.visits.length} visits, {data.followUps.length} follow-ups and {data.residents.length} people from this phone. Export a copy first if you need it.</p>
    <h3 className="mono-meta sheet-label" id={fieldId}>Type {data.church.name} to confirm</h3>
    <input className="sheet-input" aria-labelledby={fieldId} value={typed} autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save danger" disabled={action.busy || !matches} onClick={() => void action.run(onClear, onDone)}>{action.busy ? "Clearing…" : "Clear records"}</button>
    <button type="button" className="button-outline wide" disabled={action.busy} onClick={onClose}>Cancel</button>
  </Sheet>;
}

/** Map: dot size and the map style. */
function MapSettings({ data, onSetPreference, onBack }: Props) {
  const [styleUrl, setStyleUrl] = useState(data.preferences.mapStyleUrl);
  const action = useAsyncAction();
  const compactId = useId();
  const styleId = useId();
  const saveStyle = async () => {
    const value = styleUrl.trim();
    if (!isSafeWebUrl(value)) throw new Error("Enter an https map style URL.");
    if (!isSupportedMapStyleUrl(value)) throw new Error("Use OpenFreeMap, MapTiler, or the map provider set up for your church.");
    await onSetPreference("mapStyleUrl", new URL(value).toString());
  };
  return <SubPage title="Map" onBack={onBack}>
    <div className="grouped-rows"><div className="grouped-row"><span className="grouped-row-text" id={compactId}><strong>Small dots</strong><small>For busy streets</small></span><input type="checkbox" role="switch" aria-labelledby={compactId} checked={data.preferences.compactMapMarkers} onChange={(event) => { const value = event.target.checked; void action.run(() => onSetPreference("compactMapMarkers", value)); }} /></div></div>
    <h2 className="mono-meta sheet-label" id={styleId}>Map style</h2>
    <input className="sheet-input" aria-labelledby={styleId} inputMode="url" autoComplete="off" value={styleUrl} onChange={(event) => setStyleUrl(event.target.value)} />
    <p className="sheet-copy">Maps need a connection. Your records don’t.</p>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy || styleUrl.trim() === data.preferences.mapStyleUrl} onClick={() => void action.run(saveStyle, onBack)}>Save</button>
  </SubPage>;
}

/** Account (connected only): who you're signed in as, a password, email
 * reminders, Delete account and Sign out. */
function AccountPage({ data, online, canManage, accountEmail, onSignOut, onUpdatePassword, onBack }: Props) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [message, setMessage] = useState("");
  const action = useAsyncAction();
  const passwordId = useId();
  const savePassword = async () => {
    if (!onUpdatePassword) return;
    if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
    if (password !== again) throw new Error("The passwords don’t match.");
    await onUpdatePassword(password);
    setPassword(""); setAgain(""); setMessage("Password saved.");
  };
  return <SubPage title="Account" onBack={onBack}>
    <div className="grouped-rows"><div className="grouped-row"><span className="grouped-row-text"><strong>{accountEmail || "Church member"}</strong><small>{canManage ? "Leader" : "Volunteer"} · {data.church.name}</small></span></div></div>
    {onUpdatePassword && <>
      <h2 className="mono-meta sheet-label" id={passwordId}>Password</h2>
      <input className="sheet-input" aria-labelledby={passwordId} type="password" minLength={8} autoComplete="new-password" value={password} placeholder="New password" onChange={(event) => setPassword(event.target.value)} />
      <input className="sheet-input" aria-label="Confirm new password" type="password" minLength={8} autoComplete="new-password" value={again} placeholder="Confirm new password" onChange={(event) => setAgain(event.target.value)} />
      <button type="button" className="button-outline wide" disabled={action.busy || !password} onClick={() => void action.run(savePassword)}>Save password</button>
    </>}
    <ReminderSettings key={data.church.id} churchId={data.church.id} timezone={data.church.timezone} online={online} connected={data.sync.mode === "connected"} />
    {message && <p role="status" className="inline-notice">{message}</p>}
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    {onSignOut && <button type="button" className="button-outline wide" disabled={action.busy} onClick={() => void action.run(onSignOut)}><LogOut size={17} aria-hidden="true" /> Sign out</button>}
    {isMobileApp && <AccountDeletion />}
  </SubPage>;
}
