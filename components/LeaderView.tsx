"use client";

import { Edit3, History, MapPinned, Plus, ShieldCheck } from "lucide-react";
import type { NeighborWalkData, TeamUpdate } from "../lib/domain";
import type { WorkspaceMembership } from "../lib/use-neighborwalk";
import { MembersPanel } from "./MembersPanel";
import { ViewHeading } from "./ui";

type Props = {
  data: NeighborWalkData;
  membership?: WorkspaceMembership | null;
  onOpenOutreach: () => void;
  onOpenToday: () => void;
  onOpenSettings: () => void;
  onOpenData: () => void;
  onSelectTerritory: (id: string) => void;
  onEditTerritory: (id: string) => void;
  onStartDrawing: () => void;
  onAddTeam: (update: TeamUpdate) => Promise<unknown>;
  onUpdateTeam: (id: string, update: TeamUpdate) => Promise<unknown>;
  onDeleteTeam: (id: string) => Promise<unknown>;
  onAuthenticate: (password: string) => Promise<void>;
  onAccessChanged: () => Promise<boolean>;
};

export function LeaderView(props: Props) {
  const { data, membership } = props;
  const activeOutings = data.events.filter((outing) => ["draft", "ready", "active"].includes(outing.status));
  return <section className="content-view leader-view">
    <ViewHeading eyebrow="Church coordination" title="Groups & members" description="Prepare reusable groups and areas. Each outing has its own assignments; every next step needs a responsible person." />

    <section className="today-card leader-setup">
      <h2>{data.events.length ? "Keep the church ready" : "Prepare your first outing"}</h2>
      <p>Start with one small outreach cycle. Use fictional records for volunteer practice before adding a neighbor’s details.</p>
      <ol>
        <li><strong>Confirm the basics.</strong> Check the church timezone, minimal-data policy and leader contact. <button className="text-button" onClick={props.onOpenSettings}>Review settings</button></li>
        <li><strong>Bring the team.</strong> Invite only the members who need access. Reusable groups are optional; a named volunteer can take an assignment.</li>
        <li><strong>Prepare an outing.</strong> Add its time, purpose and meeting point, then an address list or map area and responsible volunteers. <button className="text-button" onClick={props.onOpenOutreach}>Open outreach ({activeOutings.length} in preparation or active)</button></li>
        <li><strong>Check the field flow.</strong> Ask a volunteer to accept an assignment, open the list and optional guide, and check the save indicator before going out.</li>
        <li><strong>Close the loop.</strong> Review unowned work and waiting handoffs after the outing. Agree who will follow through and when. <button className="text-button" onClick={props.onOpenToday}>Review Today</button></li>
      </ol>
    </section>

    {membership?.role === "leader" ? <MembersPanel membership={membership} teams={data.teams} onAddTeam={props.onAddTeam} onUpdateTeam={props.onUpdateTeam} onDeleteTeam={props.onDeleteTeam} onAuthenticate={props.onAuthenticate} onAccessChanged={props.onAccessChanged} />
      : <section className="today-card"><h2>Sample groups</h2><p>Invitations and account access are available only in a connected church workspace.</p><ul>{data.teams.map((team) => <li key={team.id}>{team.name} · {team.memberIds.length} members</li>)}</ul></section>}

    <section className="leader-section">
      <div className="section-heading"><div><p className="eyebrow">Reusable places</p><h2>Areas & address lists</h2></div><button className="button quiet" onClick={props.onStartDrawing}><Plus size={16} /> Draw area</button></div>
      <p>These are saved locations, not a census of every home. Assign an area for a specific outing in Outreach; it has no permanent team or lifetime completion score.</p>
      <div className="territory-grid">{data.territories.map((territory) => <article key={territory.id} className="territory-card" style={{ "--territory-color": territory.color } as React.CSSProperties}>
        <button className="territory-card-select" onClick={() => props.onSelectTerritory(territory.id)}>
          <span className="territory-card-map"><MapPinned size={22} /></span>
          <span className="territory-card-copy"><strong>{territory.name}</strong><small>{territory.kind === "list" ? "Address list" : "Map area"} · {data.properties.filter((property) => !property.mergedIntoId && property.territoryId === territory.id).length} saved locations</small></span>
        </button>
        <button className="territory-card-edit" onClick={() => props.onEditTerritory(territory.id)} aria-label={`Edit ${territory.name}`}><Edit3 size={18} /></button>
      </article>)}</div>
      {!data.territories.length && <p>No saved areas yet. Create an address list while preparing your first outing, or draw an area above.</p>}
    </section>

    <section className="leader-section activity-section">
      <div className="section-heading"><div><p className="eyebrow">Accountability</p><h2>Recent shared activity</h2></div><History size={22} /></div>
      <p>Latest recorded actions, displayed in {data.church.timezone}. This is not a measure of a neighbor’s faith or a volunteer’s worth.</p>
      <div className="activity-list">{data.audit.slice(0, 12).map((entry) => <div key={entry.id}><i /><p><strong>{entry.summary}</strong><span>{data.volunteers.find((volunteer) => volunteer.id === entry.actorId)?.name ?? "Recorded actor"} · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.church.timezone }).format(new Date(entry.createdAt))}</span>{entry.action === "access.member_updated" && entry.details && <span>{data.volunteers.find((volunteer) => volunteer.id === "volunteer_" + entry.entityId.replaceAll("-", ""))?.name ?? "Reviewed member"}: {entry.details.beforeActive ? "active" : "suspended"} {entry.details.beforeRole} → {entry.details.active ? "active" : "suspended"} {entry.details.role}. {entry.details.reason}</span>}</p></div>)}</div>
      {!data.audit.length && <p>No shared activity yet.</p>}
      {membership?.role === "leader" && <button className="button quiet" onClick={props.onOpenData}>Open data review & recovery tools</button>}
    </section>
    <div className="privacy-banner"><ShieldCheck size={22} /><p><strong>Review access regularly</strong>Leaders can see church care records. Suspend accounts that no longer need access, then review their open tasks and people. Suspension stops connected access; it cannot instantly erase an offline copy.</p></div>
  </section>;
}
