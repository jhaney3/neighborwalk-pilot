"use client";

import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpenText,
  CalendarClock,
  Check,
  ChevronRight,
  Church,
  ClipboardCheck,
  CloudOff,
  Database,
  Download,
  Edit3,
  FileJson,
  History,
  LockKeyhole,
  LogOut,
  Map as MapIcon,
  MapPinned,
  MessageCircle,
  Navigation,
  Plus,
  RefreshCcw,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  Users,
  Wifi,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  coverageForTerritory,
  dateInputValue,
  formatDateTime,
  isFollowUpOverdue,
  isSafeWebUrl,
  outcomeMeta,
  type FollowUp,
  type FollowUpCompletionInput,
  type GuideStep,
  type NeighborWalkData,
  type Outcome,
  type Property,
  type Territory,
  type TeamUpdate,
} from "../lib/domain";
import type { WorkspaceMembership } from "../lib/use-neighborwalk";
import { MembersPanel } from "./MembersPanel";

export function FollowUpsView({
  data,
  onOpenProperty,
  onComplete,
  onReschedule,
  onCancel,
}: {
  data: NeighborWalkData;
  onOpenProperty: (propertyId: string) => void;
  onComplete: (followUpId: string, input: FollowUpCompletionInput) => void;
  onReschedule: (followUpId: string, date: string, note?: string) => void;
  onCancel: (followUpId: string, note?: string) => void;
}) {
  const [filter, setFilter] = useState<"open" | "overdue" | "today" | "upcoming" | "completed" | "cancelled">("open");
  const [query, setQuery] = useState("");
  const propertyMap = useMemo(() => new Map(data.properties.map((property) => [property.id, property])), [data.properties]);
  const teamMap = useMemo(() => new Map(data.teams.map((team) => [team.id, team.name])), [data.teams]);
  const today = new Date().toISOString().slice(0, 10);
  const tasks = data.followUps
    .filter((followUp) => {
      const dueDate = followUp.dueAt.slice(0, 10);
      if (filter === "completed") return followUp.status === "completed";
      if (filter === "cancelled") return followUp.status === "cancelled";
      if (followUp.status !== "scheduled") return false;
      if (filter === "overdue") return isFollowUpOverdue(followUp) && dueDate !== today;
      if (filter === "today") return dueDate === today;
      if (filter === "upcoming") return dueDate > today;
      return true;
    })
    .filter((followUp) => {
      const property = propertyMap.get(followUp.propertyId);
      return !query || property?.address.toLowerCase().includes(query.toLowerCase()) || followUp.note?.toLowerCase().includes(query.toLowerCase());
    })
    .sort((a, b) => filter === "completed" || filter === "cancelled"
      ? b.createdAt.localeCompare(a.createdAt)
      : a.dueAt.localeCompare(b.dueAt));

  return (
    <div className="content-view followups-view">
      <ViewHeading eyebrow="Care continues" title="Follow-ups" description="Return only where someone clearly invited another conversation." aside={<div className="heading-count"><CalendarClock size={18} /><strong>{data.followUps.filter((item) => item.status === "scheduled").length}</strong><span>open</span></div>} />
      <div className="list-toolbar">
        <div className="segmented-control" aria-label="Follow-up date filter">
          {(["open", "overdue", "today", "upcoming", "completed", "cancelled"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        </div>
        <input className="search-field" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search address or note" aria-label="Search follow-ups" />
      </div>

      {tasks.length ? (
        <div className="followup-list">
          {tasks.map((followUp) => {
            const property = propertyMap.get(followUp.propertyId);
            if (!property) return null;
            return <FollowUpCard key={followUp.id} followUp={followUp} property={property} teams={data.teams} teamName={followUp.assignedTeamId ? teamMap.get(followUp.assignedTeamId) : undefined} noteLimit={data.church.noteCharacterLimit} onOpen={() => onOpenProperty(property.id)} onComplete={(input) => onComplete(followUp.id, input)} onReschedule={(date, note) => onReschedule(followUp.id, date, note)} onCancel={(note) => onCancel(followUp.id, note)} />;
          })}
        </div>
      ) : (
        <EmptyState icon={<ClipboardCheck size={25} />} title="Nothing in this view" copy={filter === "open" ? "New permission-based return visits will appear here." : "Try another filter or clear your search."} />
      )}
    </div>
  );
}

function FollowUpCard({ followUp, property, teams, teamName, noteLimit, onOpen, onComplete, onReschedule, onCancel }: {
  followUp: FollowUp;
  property: Property;
  teams: NeighborWalkData["teams"];
  teamName?: string;
  noteLimit: number;
  onOpen: () => void;
  onComplete: (input: FollowUpCompletionInput) => void;
  onReschedule: (date: string, note?: string) => void;
  onCancel: (note?: string) => void;
}) {
  const [editingDate, setEditingDate] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [date, setDate] = useState(dateInputValue(followUp.dueAt));
  const [rescheduleNote, setRescheduleNote] = useState("");
  const overdue = isFollowUpOverdue(followUp) && followUp.dueAt.slice(0, 10) !== new Date().toISOString().slice(0, 10);
  const validDate = Boolean(date) && date >= new Date().toISOString().slice(0, 10);
  return (
    <article className={`followup-card${overdue ? " overdue" : ""}`}>
      <div className="followup-date">
        <span>{followUp.status === "completed" ? "Completed" : followUp.status === "cancelled" ? "Cancelled" : overdue ? "Overdue" : followUp.dueAt.slice(0, 10) === new Date().toISOString().slice(0, 10) ? "Today" : "Scheduled"}</span>
        <strong>{formatDateTime(followUp.dueAt, { month: "short", day: "numeric" })}</strong>
        <small>{formatDateTime(followUp.dueAt, { weekday: "short" })}</small>
      </div>
      <div className="followup-copy">
        <h2>{property.address}{property.unit ? ` · ${property.unit}` : ""}</h2>
        <p>{followUp.note || "A return visit was requested. No additional note was recorded."}</p>
        <div><Users size={13} /> {teamName || "Unassigned"}<span>·</span><ShieldCheck size={13} /> Permission recorded</div>
        {followUp.completionNote && <p className="completion-note"><Check size={13} /> {followUp.completionNote}</p>}
        {followUp.history.length > 1 && <details className="followup-history"><summary>{followUp.history.length} updates</summary>{followUp.history.slice().reverse().map((activity) => <div key={activity.id}><strong>{activity.action.replaceAll("_", " ")}</strong><span>{activity.note || (activity.dueAt ? formatDateTime(activity.dueAt, { month: "short", day: "numeric" }) : "No note")}</span><small>{formatDateTime(activity.createdAt)}</small></div>)}</details>}
      </div>
      {followUp.status !== "scheduled" ? (
        <div className="followup-actions"><button className="button quiet small" onClick={onOpen}><MapIcon size={14} /> Map</button></div>
      ) : editingDate ? (
        <div className="inline-date-editor">
          <input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} aria-label="New follow-up date" />
          <input value={rescheduleNote} maxLength={noteLimit} onChange={(event) => setRescheduleNote(event.target.value)} placeholder="Reason or note (optional)" aria-label="Reschedule note" />
          <button className="button primary small" disabled={!validDate} onClick={() => { onReschedule(date, rescheduleNote); setEditingDate(false); }}><Save size={14} /> Save</button>
          <button className="icon-text-button" onClick={() => setEditingDate(false)}>Cancel</button>
        </div>
      ) : (
        <div className="followup-actions">
          <button className="button quiet small" onClick={onOpen}><MapIcon size={14} /> Map</button>
          <button className="button quiet small" onClick={() => setEditingDate(true)}><CalendarClock size={14} /> Reschedule</button>
          <button className="button primary small" onClick={() => setCompleting(true)}><Check size={15} /> Complete</button>
          <button className="more-danger" onClick={() => {
            const note = window.prompt("Optional cancellation note. Select Cancel to keep the follow-up open.");
            if (note !== null && window.confirm("Cancel this follow-up? The visit record will remain.")) onCancel(note);
          }} aria-label="Cancel follow-up"><Trash2 size={15} /></button>
        </div>
      )}
      {completing && <CompleteFollowUpModal followUp={followUp} teams={teams} noteLimit={noteLimit} onClose={() => setCompleting(false)} onSave={(input) => { onComplete(input); setCompleting(false); }} />}
    </article>
  );
}

function CompleteFollowUpModal({ followUp, teams, noteLimit, onClose, onSave }: {
  followUp: FollowUp;
  teams: NeighborWalkData["teams"];
  noteLimit: number;
  onClose: () => void;
  onSave: (input: FollowUpCompletionInput) => void;
}) {
  const [completionNote, setCompletionNote] = useState("");
  const [scheduleAnother, setScheduleAnother] = useState(false);
  const [nextDate, setNextDate] = useState("");
  const [nextNote, setNextNote] = useState("");
  const [assignedTeamId, setAssignedTeamId] = useState(followUp.assignedTeamId ?? "");
  const valid = completionNote.length <= noteLimit && nextNote.length <= noteLimit
    && (!scheduleAnother || Boolean(nextDate) && nextDate >= new Date().toISOString().slice(0, 10));
  return <Modal title="Complete follow-up" description="Record the result and, if invited, schedule the next conversation now." onClose={onClose}>
    <div className="form-stack">
      <label className="form-field"><span>Completion note <small>Optional</small></span><textarea rows={3} maxLength={noteLimit + 1} value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} placeholder="Briefly record what happened or what was requested." /></label>
      <label className="toggle-row"><input type="checkbox" checked={scheduleAnother} onChange={(event) => setScheduleAnother(event.target.checked)} /><span><strong>Schedule an additional follow-up</strong>Use only when the person invited another contact.</span></label>
      {scheduleAnother && <div className="followup-form">
        <div className="form-row">
          <label className="form-field"><span>Next date</span><input type="date" min={new Date().toISOString().slice(0, 10)} value={nextDate} onChange={(event) => setNextDate(event.target.value)} /></label>
          <label className="form-field"><span>Assign group</span><select value={assignedTeamId} onChange={(event) => setAssignedTeamId(event.target.value)}><option value="">Unassigned</option>{teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label>
        </div>
        <label className="form-field"><span>Next-step note <small>Optional</small></span><textarea rows={2} maxLength={noteLimit + 1} value={nextNote} onChange={(event) => setNextNote(event.target.value)} /></label>
      </div>}
    </div>
    <div className="modal-actions"><button className="button quiet" onClick={onClose}>Cancel</button><button className="button primary" disabled={!valid} onClick={() => onSave({ completionNote: completionNote.trim() || undefined, nextFollowUp: scheduleAnother ? { dueAt: new Date(`${nextDate}T17:00:00`).toISOString(), note: nextNote.trim() || undefined, assignedTeamId: assignedTeamId || undefined } : undefined })}><Check size={15} /> Complete follow-up</button></div>
  </Modal>;
}

export function GuideView({ data, canManage, onUpdate }: { data: NeighborWalkData; canManage: boolean; onUpdate: (stepId: string, patch: Partial<GuideStep>) => void }) {
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const step = data.guide[index] ?? data.guide[0];
  if (!step) return <EmptyState icon={<BookOpenText size={25} />} title="No guide published" copy="A leader can add church-approved conversation guidance." />;

  return (
    <div className="content-view guide-view">
      <ViewHeading eyebrow="A steadying hand in the moment" title="Conversation guide" description="Church-approved sample language—not a substitute for listening with care." aside={canManage ? <button className="button quiet" onClick={() => setEditing(true)}><Edit3 size={15} /> Edit this step</button> : <div className="privacy-chip"><LockKeyhole size={14} /> Approved content</div>} />
      <div className="guide-layout">
        <div className="guide-step-list" role="tablist" aria-label="Conversation steps">
          {data.guide.map((item, itemIndex) => (
            <button key={item.id} className={itemIndex === index ? "active" : ""} onClick={() => setIndex(itemIndex)} role="tab" aria-selected={itemIndex === index}>
              <span>{itemIndex + 1}</span><div><small>{item.eyebrow}</small><strong>{item.title}</strong></div><ChevronRight size={16} />
            </button>
          ))}
        </div>
        <article className="guide-card" role="tabpanel">
          <div className="guide-progress"><span style={{ width: `${((index + 1) / data.guide.length) * 100}%` }} /></div>
          <p className="eyebrow">Step {index + 1} of {data.guide.length} · {step.eyebrow}</p>
          <h2>{step.title}</h2>
          <p className="guide-coaching">{step.coaching}</p>
          <blockquote><MessageCircle size={20} /><p>“{step.sampleWords}”</p></blockquote>
          {step.scriptureReferences.length > 0 && <div className="scripture-list"><BookOpenText size={15} /><span>{step.scriptureReferences.join(" · ")}</span></div>}
          <div className="guide-reminder"><Church size={17} /><p><strong>Remember</strong>{step.reminder}</p></div>
          <div className="guide-actions"><button className="button inverted" disabled={index === 0} onClick={() => setIndex((current) => Math.max(0, current - 1))}>Previous</button><button className="button amber" disabled={index === data.guide.length - 1} onClick={() => setIndex((current) => Math.min(data.guide.length - 1, current + 1))}>Next step <ArrowRight size={15} /></button></div>
        </article>
      </div>
      {editing && <GuideEditor step={step} onClose={() => setEditing(false)} onSave={(patch) => { onUpdate(step.id, patch); setEditing(false); }} />}
    </div>
  );
}

function GuideEditor({ step, onClose, onSave }: { step: GuideStep; onClose: () => void; onSave: (patch: Partial<GuideStep>) => void }) {
  const [draft, setDraft] = useState(step);
  const valid = draft.eyebrow.trim().length > 0 && draft.eyebrow.length <= 80
    && draft.title.trim().length > 0 && draft.title.length <= 120
    && draft.coaching.trim().length > 0 && draft.coaching.length <= 800
    && draft.sampleWords.trim().length > 0 && draft.sampleWords.length <= 1600
    && draft.reminder.trim().length > 0 && draft.reminder.length <= 800
    && draft.scriptureReferences.length <= 12
    && draft.scriptureReferences.every((reference) => reference.length <= 100);
  return (
    <Modal title="Edit conversation step" description="Changes save to this device until a shared database is connected." onClose={onClose}>
      <div className="form-stack">
        <label className="form-field"><span>Stage label</span><input maxLength={80} value={draft.eyebrow} onChange={(event) => setDraft({ ...draft, eyebrow: event.target.value })} /></label>
        <label className="form-field"><span>Title</span><input maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="form-field"><span>Coaching</span><textarea maxLength={800} rows={3} value={draft.coaching} onChange={(event) => setDraft({ ...draft, coaching: event.target.value })} /></label>
        <label className="form-field"><span>Sample words</span><textarea maxLength={1600} rows={5} value={draft.sampleWords} onChange={(event) => setDraft({ ...draft, sampleWords: event.target.value })} /></label>
        <label className="form-field"><span>Reminder</span><textarea maxLength={800} rows={3} value={draft.reminder} onChange={(event) => setDraft({ ...draft, reminder: event.target.value })} /></label>
        <label className="form-field"><span>Scripture references <small>Up to 12, separated with commas</small></span><input maxLength={1200} value={draft.scriptureReferences.join(", ")} onChange={(event) => setDraft({ ...draft, scriptureReferences: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label>
      </div>
      <div className="modal-actions"><button className="button quiet" onClick={onClose}>Cancel</button><button className="button primary" onClick={() => onSave(draft)} disabled={!valid}><Save size={15} /> Save step</button></div>
    </Modal>
  );
}

export function LeaderView({ data, membership, activeTerritory, onSelectTerritory, onEditTerritory, onStartDrawing, onAddTeam, onUpdateTeam, onDeleteTeam }: {
  data: NeighborWalkData;
  membership?: WorkspaceMembership | null;
  activeTerritory: Territory;
  onSelectTerritory: (id: string) => void;
  onEditTerritory: (id: string) => void;
  onStartDrawing: () => void;
  onAddTeam: (update: TeamUpdate) => string;
  onUpdateTeam: (teamId: string, update: TeamUpdate) => void;
  onDeleteTeam: (teamId: string) => void;
}) {
  const activeCoverage = coverageForTerritory(data, activeTerritory.id);
  const activeProperties = data.properties.filter((property) => property.territoryId === activeTerritory.id);
  const count = (outcome: Outcome) => activeProperties.filter((property) => property.currentOutcome === outcome).length;
  const scheduledFollowUps = data.followUps.filter((followUp) => followUp.status === "scheduled").length;

  return (
    <div className="content-view leader-view">
      <ViewHeading eyebrow={`${activeTerritory.name} · Coordination`} title="Leader view" description="Plan territories and support volunteers without ranking residents or spiritual outcomes." aside={<button className="button primary" onClick={onStartDrawing}><Plus size={15} /> Draw territory</button>} />
      <div className="leader-metrics">
        <Metric icon={<Navigation size={19} />} label="Territory coverage" value={`${activeCoverage.percent}%`} detail={`${activeCoverage.visited} of ${activeCoverage.total} locations`} progress={activeCoverage.percent} />
        <Metric icon={<CalendarClock size={19} />} label="Open follow-ups" value={String(scheduledFollowUps)} detail="Permission-based return visits" tone="amber" />
        <Metric icon={<Users size={19} />} label="Active teams" value={String(data.teams.filter((team) => team.status === "active").length)} detail={`${data.volunteers.filter((volunteer) => volunteer.active).length} volunteers available`} tone="blue" />
      </div>

      {membership?.role === "leader" && <MembersPanel membership={membership} teams={data.teams} onAddTeam={onAddTeam} onUpdateTeam={onUpdateTeam} onDeleteTeam={onDeleteTeam} />}

      <section className="leader-section">
        <div className="section-heading"><div><p className="eyebrow">Assignments</p><h2>Territories</h2></div><span>{data.territories.length} total</span></div>
        <div className="territory-grid">
          {data.territories.map((territory) => {
            const coverage = coverageForTerritory(data, territory.id);
            const team = data.teams.find((item) => item.id === territory.assignedTeamId);
            return (
              <div key={territory.id} className={`territory-card${territory.id === activeTerritory.id ? " active" : ""}`} style={{ "--territory-color": territory.color } as React.CSSProperties}>
                <button className="territory-card-select" onClick={() => onSelectTerritory(territory.id)} aria-label={`Open ${territory.name}`}>
                  <span className="territory-card-map"><MapPinned size={21} /><span>{coverage.percent}%</span></span>
                  <span className="territory-card-copy"><strong>{territory.name}</strong><small>{team?.name ?? "Unassigned"}</small></span>
                  <span className="tiny-progress"><i style={{ width: `${coverage.percent}%` }} /></span>
                  <span className="territory-remaining">{coverage.remaining} remaining</span>
                </button>
                <button className="territory-card-edit" onClick={() => onEditTerritory(territory.id)} aria-label={`Edit ${territory.name}`}><Edit3 size={15} /></button>
              </div>
            );
          })}
        </div>
      </section>

      <div className="leader-panels">
        <section className="leader-section panel">
          <div className="section-heading"><div><p className="eyebrow">Today’s work</p><h2>Coverage by outcome</h2></div><ClipboardCheck size={19} /></div>
          <div className="outcome-bars">
            {(["conversation", "no_answer", "follow_up", "declined", "do_not_visit", "inaccessible"] as Outcome[]).map((outcome) => <div className="outcome-bar" key={outcome}><span>{outcomeMeta[outcome].label}</span><div><i style={{ width: `${Math.max(count(outcome) ? 8 : 0, (count(outcome) / Math.max(1, activeCoverage.visited)) * 100)}%`, background: outcomeMeta[outcome].color }} /></div><strong>{count(outcome)}</strong></div>)}
          </div>
        </section>
        <section className="leader-section panel">
          <div className="section-heading"><div><p className="eyebrow">In the field</p><h2>Volunteer teams</h2></div><Users size={19} /></div>
          <div className="team-list">
            {data.teams.map((team) => {
              const territory = data.territories.find((item) => team.territoryIds.includes(item.id));
              const teamCoverage = territory ? coverageForTerritory(data, territory.id) : null;
              return <div key={team.id}><span className={`team-initial ${team.status}`}>{team.name.replace("Team ", "").charAt(0)}</span><p><strong>{team.name}</strong><small>{territory?.name ?? "No territory"} · {team.memberIds.length} volunteers</small></p><b>{teamCoverage ? `${teamCoverage.visited}/${teamCoverage.total}` : "—"}</b></div>;
            })}
          </div>
        </section>
      </div>

      <section className="leader-section activity-section">
        <div className="section-heading"><div><p className="eyebrow">Accountability</p><h2>Recent activity</h2></div><History size={19} /></div>
        <div className="activity-list">{data.audit.slice(0, 8).map((entry) => <div key={entry.id}><i /><p><strong>{entry.summary}</strong><span>{data.volunteers.find((volunteer) => volunteer.id === entry.actorId)?.name ?? "Volunteer"} · {formatDateTime(entry.createdAt)}</span></p></div>)}</div>
      </section>
      <div className="privacy-banner"><ShieldCheck size={20} /><p><strong>Measure coverage, not people</strong>NeighborWalk reports the work completed and requested next steps. It intentionally avoids “receptiveness scores,” conversion rankings, and volunteer leaderboards.</p></div>
    </div>
  );
}

function Metric({ icon, label, value, detail, progress, tone = "green" }: { icon: React.ReactNode; label: string; value: string; detail: string; progress?: number; tone?: "green" | "amber" | "blue" }) {
  return <article className={`metric-card ${tone}`}><span className="metric-icon">{icon}</span><p>{label}</p><strong>{value}</strong>{progress !== undefined && <div className="metric-progress"><i style={{ width: `${progress}%` }} /></div>}<small>{detail}</small></article>;
}

export function SettingsView({
  data,
  online,
  saving,
  syncing,
  storageError,
  canManage,
  accountEmail,
  onSignOut,
  onUpdateChurch,
  onSetPreference,
  onExport,
  onImport,
  onPurge,
  onClearOutreach,
  onSync,
}: {
  data: NeighborWalkData;
  online: boolean;
  saving: boolean;
  syncing: boolean;
  storageError: string | null;
  canManage: boolean;
  accountEmail?: string;
  onSignOut?: () => Promise<void>;
  onUpdateChurch: (patch: Partial<NeighborWalkData["church"]>) => void;
  onSetPreference: <K extends keyof NeighborWalkData["preferences"]>(key: K, value: NeighborWalkData["preferences"][K]) => void;
  onExport: () => void;
  onImport: (file: File) => Promise<NeighborWalkData>;
  onPurge: () => void;
  onClearOutreach: () => void;
  onSync: () => Promise<boolean>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [churchName, setChurchName] = useState(data.church.name);
  const [timezone, setTimezone] = useState(data.church.timezone);
  const [noteLimit, setNoteLimit] = useState(String(data.church.noteCharacterLimit));
  const [followUpDays, setFollowUpDays] = useState(String(data.church.defaultFollowUpDays));
  const [mapStyleUrl, setMapStyleUrl] = useState(data.preferences.mapStyleUrl);
  const [clearing, setClearing] = useState(false);
  const [clearConfirmation, setClearConfirmation] = useState("");

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  }, []);

  const requestNotifications = async () => {
    if (!("Notification" in window)) return setMessage("Notifications are not available in this browser.");
    const permission = await Notification.requestPermission();
    onSetPreference("notificationsEnabled", permission === "granted");
    setMessage(permission === "granted" ? "Follow-up notifications are enabled on this device." : "Notification permission was not granted.");
  };

  const installApp = async () => {
    const prompt = installPrompt as Event & { prompt?: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
    if (prompt.prompt) {
      await prompt.prompt();
      setMessage("Install request opened.");
    } else {
      setMessage("Use your browser’s Add to Home Screen command to install NeighborWalk.");
    }
  };

  const saveChurchProfile = () => {
    const name = churchName.trim();
    const zone = timezone.trim();
    if (!name || name.length > 120) return setMessage("Enter a church name between 1 and 120 characters.");
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: zone }).format();
    } catch {
      return setMessage("Enter a valid IANA timezone, such as America/Chicago.");
    }
    onUpdateChurch({ name, timezone: zone });
    setMessage("Church profile saved.");
  };

  const savePrivacyLimits = () => {
    const parsedNoteLimit = Number(noteLimit);
    const parsedFollowUpDays = Number(followUpDays);
    if (!Number.isInteger(parsedNoteLimit) || parsedNoteLimit < 80 || parsedNoteLimit > 2000) return setMessage("Note limit must be a whole number from 80 to 2,000.");
    if (!Number.isInteger(parsedFollowUpDays) || parsedFollowUpDays < 1 || parsedFollowUpDays > 90) return setMessage("Follow-up timing must be a whole number from 1 to 90 days.");
    onUpdateChurch({ noteCharacterLimit: parsedNoteLimit, defaultFollowUpDays: parsedFollowUpDays });
    setMessage("Privacy and follow-up limits saved.");
  };

  const saveMapStyle = () => {
    const value = mapStyleUrl.trim();
    if (!isSafeWebUrl(value)) return setMessage("Enter a secure https map style URL (http is allowed only for localhost development).");
    onSetPreference("mapStyleUrl", new URL(value).toString());
    setMessage("Map style saved. The map will reload when you return to it.");
  };

  const applyDataDrafts = (next: NeighborWalkData) => {
    setChurchName(next.church.name);
    setTimezone(next.church.timezone);
    setNoteLimit(String(next.church.noteCharacterLimit));
    setFollowUpDays(String(next.church.defaultFollowUpDays));
    setMapStyleUrl(next.preferences.mapStyleUrl);
  };

  return (
    <div className="content-view settings-view">
      <ViewHeading eyebrow="Church and device" title="Settings" description={canManage ? "Set ministry guardrails, prepare offline use, and manage workspace data." : "Manage your account, map, reminders, and this device."} />
      {message && <div className="settings-message" role="status"><Check size={15} />{message}</div>}
      {storageError && <div className="settings-message error" role="alert"><AlertTriangle size={15} />{storageError}</div>}
      <div className="settings-grid">
        {data.sync.mode === "connected" && <SettingsSection icon={<LockKeyhole size={18} />} title="Account and access" description="Your access level is assigned by a church leader.">
          <div className="connection-card connected"><LockKeyhole size={18} /><span><strong>Signed-in church account</strong>{accountEmail || "Authenticated member"} · {canManage ? "Leader access" : "Volunteer access"}</span></div>
          {onSignOut && <button className="button quiet" onClick={() => void onSignOut()}><LogOut size={15} /> Sign out</button>}
        </SettingsSection>}

        {(canManage || data.sync.mode === "device_only") && <SettingsSection icon={<Church size={18} />} title="Church profile" description="Shown to volunteers in this workspace.">
          <label className="form-field"><span>Church name</span><input maxLength={120} value={churchName} onChange={(event) => setChurchName(event.target.value)} /></label>
          <label className="form-field"><span>Timezone</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Chicago" /></label>
          <button className="button quiet" onClick={saveChurchProfile}><Save size={15} /> Save church profile</button>
          {data.sync.mode === "device_only" && <>
            <label className="form-field"><span>Preview identity <small>Device-only demo</small></span><select value={data.preferences.activeVolunteerId} onChange={(event) => onSetPreference("activeVolunteerId", event.target.value)}>{data.volunteers.map((volunteer) => <option value={volunteer.id} key={volunteer.id}>{volunteer.name} · {volunteer.role}</option>)}</select></label>
            <div className="data-note"><LockKeyhole size={15} /><span>This selector previews volunteer and leader experiences. A connected deployment must derive roles from the authenticated backend session.</span></div>
          </>}
        </SettingsSection>}

        {(canManage || data.sync.mode === "device_only") && <SettingsSection icon={<ShieldCheck size={18} />} title="Privacy guardrails" description="Applied to every field record on this device.">
          <div className="form-row">
            <label className="form-field"><span>Retention period</span><select value={data.church.retentionDays} onChange={(event) => onUpdateChurch({ retentionDays: Number(event.target.value) })}><option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>1 year</option><option value={730}>2 years</option></select></label>
            <label className="form-field"><span>Note limit</span><input type="number" min={80} max={2000} value={noteLimit} onChange={(event) => setNoteLimit(event.target.value)} /></label>
          </div>
          <label className="form-field"><span>Default follow-up timing <small>Days</small></span><input type="number" min={1} max={90} value={followUpDays} onChange={(event) => setFollowUpDays(event.target.value)} /></label>
          <label className="toggle-row"><input type="checkbox" checked={data.church.requireFollowUpConsent} onChange={(event) => onUpdateChurch({ requireFollowUpConsent: event.target.checked })} /><span><strong>Require explicit follow-up permission</strong>Volunteers cannot schedule a return without confirming consent.</span></label>
          <div className="button-row"><button className="button quiet" onClick={savePrivacyLimits}><Save size={15} /> Save limits</button><button className="button quiet" onClick={() => { onPurge(); setMessage("The retention policy was applied."); }}><Trash2 size={15} /> Apply retention now</button></div>
        </SettingsSection>}

        <SettingsSection icon={<MapPinned size={18} />} title="Map and field use" description="Map tiles need a connection; saved records do not.">
          <label className="form-field"><span>Map style URL</span><input inputMode="url" value={mapStyleUrl} onChange={(event) => setMapStyleUrl(event.target.value)} /></label>
          <button className="button quiet" onClick={saveMapStyle}><Save size={15} /> Save map style</button>
          <label className="toggle-row"><input type="checkbox" checked={data.preferences.compactMapMarkers} onChange={(event) => onSetPreference("compactMapMarkers", event.target.checked)} /><span><strong>Compact location dots</strong>Use smaller status dots in dense neighborhoods.</span></label>
          <div className="button-row"><button className="button quiet" onClick={requestNotifications}><Bell size={15} /> Enable reminders</button><button className="button quiet" onClick={installApp}><Smartphone size={15} /> Install app</button></div>
        </SettingsSection>

        <SettingsSection icon={<Database size={18} />} title="Data and synchronization" description={data.sync.mode === "connected" ? "Changes save to the church workspace automatically. Manual sync remains available as a fallback." : "This build is device-only until your backend is connected."}>
          <div className={`connection-card ${data.sync.mode}`}>
            {data.sync.mode === "connected" ? <Wifi size={18} /> : <CloudOff size={18} />}
            <span><strong>{data.sync.mode === "connected" ? "Automatic sync on" : "Device-only mode"}</strong>{data.sync.mode === "connected"
              ? syncing
                ? "Updating the shared church workspace now."
                : !online
                  ? `${data.sync.pending.length} change${data.sync.pending.length === 1 ? " is" : "s are"} safely stored on this device until the connection returns.`
                  : data.sync.pending.length > 0
                    ? `${data.sync.pending.length} change${data.sync.pending.length === 1 ? " is" : "s are"} queued for automatic sync.`
                    : "This device is up to date with the church workspace."
              : "Records remain on this device until a workspace is connected."}</span>
          </div>
          {data.sync.lastError && <div className="data-note sync-warning"><AlertTriangle size={15} /><span>{data.sync.lastError}</span></div>}
          {data.sync.mode === "connected" && <button className="button quiet" onClick={async () => setMessage(await onSync() ? "Changes synchronized." : "Changes remain safe on this device; automatic retry is still active.")} disabled={!online || saving || syncing}><RefreshCcw size={15} className={syncing ? "spin" : ""} /> {data.sync.pending.length || data.sync.lastError ? "Retry sync" : "Sync now"}</button>}
          {(canManage || data.sync.mode === "device_only") && <><div className="button-row"><button className="button quiet" onClick={onExport}><Download size={15} /> Export backup</button><button className="button quiet" onClick={() => fileRef.current?.click()}><Upload size={15} /> Import backup</button><input ref={fileRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const imported = await onImport(file); applyDataDrafts(imported); setMessage("Backup imported and validated."); } catch (error) { setMessage(error instanceof Error ? error.message : "The backup could not be imported."); } finally { event.target.value = ""; } }} /></div>
          <div className="data-note"><FileJson size={15} /><span>Backups contain ministry records in readable JSON. Store them securely and delete old copies.</span></div></>}
        </SettingsSection>
      </div>
      {(canManage || data.sync.mode === "device_only") && <section className="danger-zone"><div><strong>Clear sample and outreach records</strong><span>Delete mapped locations, visits, follow-ups, and permission-based person records. Church settings, groups, members, territories, and the guide remain.</span></div><button className="button danger" onClick={() => setClearing(true)}><Trash2 size={15} /> Clear records</button></section>}
      {clearing && <Modal title="Clear outreach records?" description="This removes the shared records listed below. Export a backup first if you may need them later." onClose={() => { setClearing(false); setClearConfirmation(""); }}>
        <div className="clear-data-summary"><div><strong>{data.properties.length}</strong><span>locations</span></div><div><strong>{data.visits.length}</strong><span>visits</span></div><div><strong>{data.followUps.length}</strong><span>follow-ups</span></div><div><strong>{data.residents.length}</strong><span>people</span></div></div>
        <label className="form-field"><span>Type <strong>CLEAR</strong> to confirm</span><input autoComplete="off" value={clearConfirmation} onChange={(event) => setClearConfirmation(event.target.value)} /></label>
        <div className="modal-actions"><button className="button quiet" onClick={() => { setClearing(false); setClearConfirmation(""); }}>Cancel</button><button className="button danger" disabled={clearConfirmation !== "CLEAR"} onClick={() => { onClearOutreach(); setClearing(false); setClearConfirmation(""); setMessage("Outreach records cleared. Automatic sync will update the shared workspace."); }}><Trash2 size={15} /> Permanently clear records</button></div>
      </Modal>}
    </div>
  );
}

function SettingsSection({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <section className="settings-section"><div className="settings-section-heading"><span>{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div><div className="settings-section-body">{children}</div></section>;
}

export function Modal({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><h2 id="modal-title">{title}</h2>{description && <p>{description}</p>}</div><button className="close-button" onClick={onClose} aria-label="Close dialog">×</button></div>{children}</section></div>;
}

export function ViewHeading({ eyebrow, title, description, aside }: { eyebrow: string; title: string; description: string; aside?: React.ReactNode }) {
  return <div className="view-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{aside}</div>;
}

function EmptyState({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) {
  return <div className="empty-state">{icon}<h2>{title}</h2><p>{copy}</p></div>;
}
