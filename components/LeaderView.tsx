"use client";

import { Edit3, History, MapPinned, Plus, ShieldCheck, Users } from "lucide-react";
import type { NeighborWalkData, TeamUpdate } from "../lib/domain";
import type { WorkspaceMembership } from "../lib/use-neighborwalk";
import { MembersPanel } from "./MembersPanel";
import { ListGroup, ListRow, ViewHeading } from "./ui";

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
    <ViewHeading title="Team & invitations" />

    <ListGroup label={data.events.length ? "Getting started" : "Plan your first walk"} footer="Start small. Practice with sample records before adding real neighbors." className="leader-setup">
      <ListRow icon={<StepNumber n={1} />} title="Confirm the basics" subtitle="Check your church name and timezone." onClick={props.onOpenSettings} />
      <ListRow icon={<StepNumber n={2} />} title="Bring the team" subtitle="Invite your volunteers." />
      <ListRow icon={<StepNumber n={3} />} title="Plan a walk" subtitle="Pick a neighborhood, a time and who’s coming." value={activeOutings.length ? `${activeOutings.length} planned` : undefined} onClick={props.onOpenOutreach} />
      <ListRow icon={<StepNumber n={4} />} title="Try it out" subtitle="Have a volunteer open the walk and log a knock." />
      <ListRow icon={<StepNumber n={5} />} title="Close the loop" subtitle="Make sure every follow-up has an owner." onClick={props.onOpenToday} />
    </ListGroup>

    {membership?.role === "leader" ? <MembersPanel membership={membership} teams={data.teams} onAddTeam={props.onAddTeam} onUpdateTeam={props.onUpdateTeam} onDeleteTeam={props.onDeleteTeam} onAuthenticate={props.onAuthenticate} onAccessChanged={props.onAccessChanged} />
      : <ListGroup label="Sample teams" footer="Sign in to your church to invite people.">
        {data.teams.map((team) => <ListRow key={team.id} icon={<Users />} title={team.name} value={`${team.memberIds.length} ${team.memberIds.length === 1 ? "member" : "members"}`} />)}
      </ListGroup>}

    <ListGroup label="Neighborhoods" footer="Reuse these for any walk." className="leader-territories">
      {data.territories.map((territory) => {
        const saved = data.properties.filter((property) => !property.mergedIntoId && property.territoryId === territory.id).length;
        return <div key={territory.id} className="list-row territory-row" style={{ "--territory-color": territory.color } as React.CSSProperties}>
          <button type="button" className="territory-row-select" onClick={() => props.onSelectTerritory(territory.id)}>
            <span className="list-row-icon" aria-hidden="true"><MapPinned /></span>
            <span className="list-row-text"><span className="list-row-title">{territory.name}</span><span className="list-row-subtitle">{territory.kind === "list" ? "Address list" : "Map area"}, {saved} saved {saved === 1 ? "home" : "homes"}</span></span>
          </button>
          <button type="button" className="territory-row-edit" onClick={() => props.onEditTerritory(territory.id)} aria-label={`Edit ${territory.name}`}><Edit3 size={18} /></button>
        </div>;
      })}
      <ListRow className="list-row-link" icon={<Plus />} title="Draw a new neighborhood" onClick={props.onStartDrawing} chevron={false} />
    </ListGroup>

    <ListGroup label="Recent activity" footer={`Times in ${data.church.timezone}. This is not a measure of a neighbor’s faith or a volunteer’s worth.`} className="leader-activity">
      {data.audit.slice(0, 12).map((entry) => {
        const actor = data.volunteers.find((volunteer) => volunteer.id === entry.actorId)?.name ?? "Recorded actor";
        const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.church.timezone }).format(new Date(entry.createdAt));
        const access = entry.action === "access.member_updated" && entry.details
          ? `${data.volunteers.find((volunteer) => volunteer.id === "volunteer_" + entry.entityId.replaceAll("-", ""))?.name ?? "Reviewed member"}: ${entry.details.beforeActive ? "active" : "suspended"} ${entry.details.beforeRole} → ${entry.details.active ? "active" : "suspended"} ${entry.details.role}. ${entry.details.reason}`
          : null;
        return <ListRow key={entry.id} title={entry.summary.charAt(0).toUpperCase() + entry.summary.slice(1)} subtitle={<>{actor}, {when}{access && <><br />{access}</>}</>} />;
      })}
      {!data.audit.length && <ListRow title="No shared activity yet" />}
      {membership?.role === "leader" && <ListRow className="list-row-link" icon={<History />} title="Open Data & health" onClick={props.onOpenData} />}
    </ListGroup>

    <div className="privacy-banner"><ShieldCheck size={22} /><p><strong>Review access regularly</strong>When someone leaves, remove their access and reassign their follow-ups.</p></div>
  </section>;
}

function StepNumber({ n }: { n: number }) {
  return <span className="leader-step-number">{n}</span>;
}
