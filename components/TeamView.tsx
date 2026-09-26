"use client";

import { Check, ChevronLeft, ChevronRight, MessageCircle, X } from "lucide-react";
import { useId, useState } from "react";
import { formatPhoneNumber, type NeighborWalkData, type Team, type TeamUpdate } from "../lib/domain";
import { activeFollowUpOwner } from "../lib/follow-up-filters";
import { invitationLink } from "../lib/invitations";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { useAsyncAction } from "../lib/use-async-action";
import type { WorkspaceMembership } from "../lib/use-neighborwalk";
import { selectionTick } from "../mobile/haptics";
import { MembersPanel } from "./MembersPanel";
import { ActionSheet, Sheet, useFocusOnMount } from "./Sheet";
import { SegmentedControl, initials, useConfirm } from "./ui";

type Props = {
  data: NeighborWalkData;
  membership?: WorkspaceMembership | null;
  activeVolunteerId: string;
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenOutreach: () => void;
  onOpenToday: () => void;
  onAddTeam: (update: TeamUpdate) => Promise<unknown>;
  onUpdateTeam: (id: string, update: TeamUpdate) => Promise<unknown>;
  onDeleteTeam: (id: string) => Promise<unknown>;
  onAuthenticate: (password: string) => Promise<void>;
  onAccessChanged: () => Promise<boolean>;
};

/** Teams the church keeps, not tonight's route crews. */
export function savedTeams(data: NeighborWalkData) {
  const crews = new Set((data.assignments ?? []).filter((assignment) => assignment.targetId && assignment.assignedTeamId).map((assignment) => assignment.assignedTeamId));
  return data.teams.filter((team) => team.status !== "finished" && !crews.has(team.id));
}

function setupSteps(data: NeighborWalkData, props: Props) {
  return [
    { label: "Confirm the basics", hint: "Check your church name and timezone.", done: Boolean(data.church.name.trim() && data.church.timezone), open: props.onOpenSettings },
    { label: "Bring the team", hint: "Invite your volunteers.", done: data.volunteers.filter((volunteer) => volunteer.active).length > 1 },
    { label: "Plan a walk", hint: "Pick a neighborhood, a time and who’s coming.", done: data.events.length > 0, open: props.onOpenOutreach },
    { label: "Try a walk", hint: "Have a volunteer open the walk and log a knock.", done: data.visits.some((visit) => Boolean(visit.eventId)) },
    { label: "Close the loop", hint: "Make sure every follow-up has an owner.", done: !data.followUps.some((task) => task.status === "scheduled" && !activeFollowUpOwner(task, data)), open: props.onOpenToday },
  ];
}

/** Team & invitations (AD2): getting started until it's done, Invite someone
 * as the offset card, people with their roles, then saved teams. */
export function TeamView(props: Props) {
  const { data, membership, activeVolunteerId, onBack } = props;
  const [sheet, setSheet] = useState<"invite" | "setup" | { team: Team | "new" } | { person: string } | null>(null);
  const [page, setPage] = useState<"team" | "access">("team");
  const connectedLeader = membership?.role === "leader";
  const steps = setupSteps(data, props);
  const done = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done);
  const people = [...data.volunteers.filter((volunteer) => volunteer.active)].sort((a, b) => Number(b.id === activeVolunteerId) - Number(a.id === activeVolunteerId));
  const teams = savedTeams(data);
  const person = sheet && typeof sheet === "object" && "person" in sheet ? data.volunteers.find((volunteer) => volunteer.id === sheet.person) : undefined;

  if (page === "access" && membership) return <section className="content-view team-view" aria-labelledby="access-title">
    <div className="screen-top"><button type="button" className="round-button float" aria-label="Back to team" onClick={() => setPage("team")}><ChevronLeft size={22} aria-hidden="true" /></button><span className="mono-meta">Team</span></div>
    <h1 className="screen-title" id="access-title">Access</h1>
    <MembersPanel membership={membership} teams={data.teams} showTeams={false} onAddTeam={props.onAddTeam} onUpdateTeam={props.onUpdateTeam} onDeleteTeam={props.onDeleteTeam} onAuthenticate={props.onAuthenticate} onAccessChanged={props.onAccessChanged} />
  </section>;

  return <section className="content-view team-view" aria-labelledby="team-title">
    <div className="screen-top"><button type="button" className="round-button float" aria-label="Back to more" onClick={onBack}><ChevronLeft size={22} aria-hidden="true" /></button></div>
    <h1 className="screen-title" id="team-title">Team</h1>
    {next && <div className="grouped-rows"><button type="button" className="grouped-row" onClick={() => setSheet("setup")}><span className="grouped-row-text"><strong>Getting started</strong><small>{done} of {steps.length} done · next: {next.label.toLowerCase()}</small></span><ChevronRight size={17} aria-hidden="true" /></button></div>}
    <div className="invite-card offset-card">
      <span><strong>Invite someone</strong><small>They get a text with a one-time link</small></span>
      <button type="button" className="button-ink" onClick={() => setSheet("invite")}>Invite</button>
    </div>
    <div className="list-section-head"><h2 className="section-title">People</h2><span className="mono-meta">{people.length}</span></div>
    <div className="grouped-rows">{people.map((volunteer) => <button key={volunteer.id} type="button" className="grouped-row" onClick={() => connectedLeader ? setPage("access") : setSheet({ person: volunteer.id })}>
      <span className="avatar-dot small" aria-hidden="true">{initials(volunteer.name)}</span>
      <span className="grouped-row-text"><strong>{volunteer.name}</strong><small>{[volunteer.role === "leader" ? "Leader" : "Volunteer", volunteer.id === activeVolunteerId ? "you" : undefined].filter(Boolean).join(" · ")}</small></span>
      <ChevronRight size={17} aria-hidden="true" />
    </button>)}</div>
    <div className="list-section-head"><h2 className="section-title">Saved teams</h2><button type="button" className="mono-meta hedge" onClick={() => setSheet({ team: "new" })}>+ New</button></div>
    {teams.length ? <div className="grouped-rows">{teams.map((team) => {
      const faces = team.memberIds.map((id) => data.volunteers.find((volunteer) => volunteer.id === id)?.name).filter((name): name is string => Boolean(name));
      return <button key={team.id} type="button" className="grouped-row saved-team-row" onClick={() => setSheet({ team })}>
        <span className="grouped-row-text"><strong>{team.name}</strong></span>
        <span className="face-stack" aria-label={`${faces.length} ${faces.length === 1 ? "person" : "people"}`}>{faces.slice(0, 3).map((name) => <span key={name} aria-hidden="true">{initials(name)}</span>)}{faces.length > 3 && <span className="more" aria-hidden="true">+{faces.length - 3}</span>}</span>
      </button>;
    })}</div> : <p className="home-empty">Save a team to invite the same people together.</p>}

    {sheet === "setup" && <ActionSheet title={`Getting started · ${done} of ${steps.length} done`} closeLabel="Close" onClose={() => setSheet(null)} actions={steps.map((step) => ({
      label: `${step.done ? "✓ " : ""}${step.label}`, disabled: step.done || (!step.open && step.label !== "Bring the team"),
      onSelect: () => { setSheet(step.label === "Bring the team" ? "invite" : null); step.open?.(); },
    }))} />}
    {sheet === "invite" && <InviteSheet data={data} onClose={() => setSheet(null)} onSent={props.onAccessChanged} />}
    {sheet && typeof sheet === "object" && "team" in sheet && <SavedTeamSheet data={data} team={sheet.team === "new" ? undefined : sheet.team}
      onSave={(update) => sheet.team === "new" ? props.onAddTeam(update) : props.onUpdateTeam(sheet.team.id, update)}
      onDelete={sheet.team === "new" ? undefined : () => props.onDeleteTeam((sheet.team as Team).id)} onClose={() => setSheet(null)} />}
    {person && <ActionSheet title={`${person.name} · ${person.role === "leader" ? "Leader" : "Volunteer"}. Roles change once you sign in to your church.`} closeLabel="Close" onClose={() => setSheet(null)} actions={[
      { label: "Preview the app as someone else", onSelect: () => { setSheet(null); props.onOpenSettings(); } },
    ]} />}
  </section>;
}

/** US numbers can be typed without the +1. */
function phoneE164(value: string) {
  const digits = value.replace(/\D/g, "");
  if (value.trim().startsWith("+")) return `+${digits}`;
  return digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : "";
}

/** Invite someone (AD3): name, cell phone and role. The link goes out by text,
 * works once and expires in 7 days. */
function InviteSheet({ data, onClose, onSent }: { data: NeighborWalkData; onClose: () => void; onSent: () => Promise<unknown> }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"volunteer" | "leader">("volunteer");
  const [notice, setNotice] = useState("");
  const action = useAsyncAction();
  const titleId = useId();
  const nameId = useId();
  const phoneId = useId();
  const field = useFocusOnMount<HTMLInputElement>();
  const number = phoneE164(phone);
  const send = () => action.run(async () => {
    setNotice("");
    if (data.sync.mode !== "connected") { setNotice("The sample church can’t send invites. Sign in to your church to invite people."); return; }
    if (!/^\+[1-9]\d{6,14}$/.test(number)) throw new Error("Check the number. Include the country code outside the US.");
    const origin = process.env.NEXT_PUBLIC_INVITE_ORIGIN;
    if (!origin || new URL(origin).protocol !== "https:") throw new Error("Invitations aren’t set up yet.");
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Reconnect to invite someone.");
    const { data: created, error } = await client.rpc("create_shared_invitation", { contact_kind: "phone", contact_value: number, recipient_name: name.trim(), invitation_role: role });
    if (error) throw new Error(error.message || "The invite wasn’t created. If it asks, confirm your sign-in in Team › Access.");
    const link = invitationLink(origin, (created as { token: string }).token, "join");
    const text = `${name.trim() ? `Hi ${name.trim()}! ` : ""}Join ${data.church.name} on NeighborWalk. This link works once and expires in 7 days.\n${link}`;
    await onSent();
    window.location.href = `sms:${number}&body=${encodeURIComponent(text)}`;
    onClose();
  });
  return <Sheet className="home-sheet form" modal labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <div className="home-sheet-head"><h2 className="pin-title" id={titleId}>Invite someone</h2><button type="button" className="round-line" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    <h3 className="mono-meta sheet-label" id={nameId}>Name</h3>
    <input ref={field} className="sheet-input" aria-labelledby={nameId} value={name} maxLength={120} autoComplete="off" enterKeyHint="next" onChange={(event) => setName(event.target.value)} placeholder="Who’s joining you?" />
    <h3 className="mono-meta sheet-label" id={phoneId}>Cell phone</h3>
    <input className="sheet-input" aria-labelledby={phoneId} type="tel" inputMode="tel" autoComplete="off" enterKeyHint="done" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} onBlur={() => { if (phoneE164(phone).startsWith("+1")) setPhone(formatPhoneNumber(phone)); }} placeholder="(555) 000-0000" />
    <h3 className="mono-meta sheet-label">Role</h3>
    <SegmentedControl label="Role" value={role} onChange={(value) => { selectionTick(); setRole(value); }} options={[{ value: "volunteer", label: "Volunteer" }, { value: "leader", label: "Leader" }]} />
    <p className="sheet-copy">Volunteers walk and follow up. Leaders also plan walks and manage people.</p>
    {notice && <p role="status" className="inline-notice">{notice}</p>}
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy || phone.replace(/\D/g, "").length < 7} onClick={() => void send()}><MessageCircle size={19} aria-hidden="true" />{action.busy ? "Creating…" : "Text the invite"}</button>
    <p className="mono-meta sheet-foot">Works once · expires in 7 days</p>
  </Sheet>;
}

/** Saved team (AD4): name, member check rows, Delete team. */
function SavedTeamSheet({ data, team, onSave, onDelete, onClose }: { data: NeighborWalkData; team?: Team; onSave: (update: TeamUpdate) => Promise<unknown>; onDelete?: () => Promise<unknown>; onClose: () => void }) {
  const [name, setName] = useState(team?.name ?? "");
  const [memberIds, setMemberIds] = useState<string[]>(team?.memberIds ?? []);
  const action = useAsyncAction();
  const confirm = useConfirm();
  const titleId = useId();
  const nameId = useId();
  const people = data.volunteers.filter((volunteer) => volunteer.active);
  const flip = (id: string) => { selectionTick(); setMemberIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]); };
  return <Sheet className="home-sheet form" modal detent="medium" labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <div className="home-sheet-head"><h2 className="pin-title" id={titleId}>{team?.name || "New team"}</h2><button type="button" className="round-line" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    <h3 className="mono-meta sheet-label" id={nameId}>Name</h3>
    <input className="sheet-input" aria-labelledby={nameId} value={name} maxLength={120} autoComplete="off" enterKeyHint="done" onChange={(event) => setName(event.target.value)} placeholder="Team Barnabas" />
    <h3 className="mono-meta sheet-label">Members · {memberIds.filter((id) => people.some((person) => person.id === id)).length}</h3>
    <div className="grouped-rows check-rows" role="group" aria-label="Members">
      {people.map((person) => <button key={person.id} type="button" className="grouped-row" role="checkbox" aria-checked={memberIds.includes(person.id)} onClick={() => flip(person.id)}><span className="check-box" aria-hidden="true">{memberIds.includes(person.id) && <Check size={16} strokeWidth={3} />}</span><span className="grouped-row-text"><strong>{person.name}</strong></span></button>)}
      {onDelete && <button type="button" className="grouped-row danger" disabled={action.busy} onClick={() => void confirm({ title: `Delete ${team?.name}?`, message: "Its walk assignments are cancelled. People keep their follow-ups and history.", confirmLabel: "Delete team", destructive: true }).then((yes) => { if (yes) void action.run(onDelete, onClose); })}><span className="grouped-row-text"><strong>Delete team</strong></span></button>}
    </div>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy || name.trim().length < 2} onClick={() => void action.run(() => onSave({ name: name.trim(), memberIds, status: team?.status ?? "ready" }), onClose)}>{action.busy ? "Saving…" : "Save"}</button>
  </Sheet>;
}

