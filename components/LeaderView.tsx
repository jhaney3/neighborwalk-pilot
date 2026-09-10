"use client";

import { CalendarClock, ClipboardCheck, Edit3, History, MapPinned, Navigation, Plus, ShieldCheck, Users } from "lucide-react";
import { formatDateTime, outcomeMeta, type NeighborWalkData, type Outcome, type Territory, type TeamUpdate } from "../lib/domain";
import { coverageForTerritory, type TerritoryCoverageById } from "../lib/territory-coverage";
import type { WorkspaceMembership } from "../lib/use-neighborwalk";
import { MembersPanel } from "./MembersPanel";
import { ViewHeading } from "./ui";

export function LeaderView({ data, coverageByTerritory, membership, activeTerritory, onSelectTerritory, onEditTerritory, onStartDrawing, onAddTeam, onUpdateTeam, onDeleteTeam }: {
  data: NeighborWalkData;
  coverageByTerritory: TerritoryCoverageById;
  membership?: WorkspaceMembership | null;
  activeTerritory: Territory;
  onSelectTerritory: (id: string) => void;
  onEditTerritory: (id: string) => void;
  onStartDrawing: () => void;
  onAddTeam: (update: TeamUpdate) => string;
  onUpdateTeam: (teamId: string, update: TeamUpdate) => void;
  onDeleteTeam: (teamId: string) => void;
}) {
  const activeCoverage = coverageByTerritory[activeTerritory.id]
    ?? coverageForTerritory(data, activeTerritory.id);
  const activeProperties = data.properties.filter((property) => property.territoryId === activeTerritory.id);
  const touchedLocations = activeProperties.filter((property) => property.currentOutcome !== "unvisited").length;
  const count = (outcome: Outcome) => activeProperties.filter((property) => property.currentOutcome === outcome).length;
  const scheduledFollowUps = data.followUps.filter((followUp) => followUp.status === "scheduled").length;

  return (
    <div className="content-view leader-view">
      <ViewHeading eyebrow={`${activeTerritory.name} · Coordination`} title="Leader view" description="Plan territories and support volunteers without ranking residents or spiritual outcomes." aside={<button className="button primary" onClick={onStartDrawing}><Plus size={15} /> Draw territory</button>} />
      <div className="leader-metrics">
        <Metric icon={<Navigation size={19} />} label="Residential coverage" value={`${activeCoverage.percent}%`} detail={`${activeCoverage.touched} of ${activeCoverage.total} residential properties touched`} progress={activeCoverage.percent} />
        <Metric icon={<CalendarClock size={19} />} label="Open follow-ups" value={String(scheduledFollowUps)} detail="Scheduled return visits" tone="amber" />
        <Metric icon={<Users size={19} />} label="Active teams" value={String(data.teams.filter((team) => team.status === "active").length)} detail={`${data.volunteers.filter((volunteer) => volunteer.active).length} volunteers available`} tone="blue" />
      </div>

      {membership?.role === "leader" && <MembersPanel membership={membership} teams={data.teams} onAddTeam={onAddTeam} onUpdateTeam={onUpdateTeam} onDeleteTeam={onDeleteTeam} />}

      <section className="leader-section">
        <div className="section-heading"><div><p className="eyebrow">Assignments</p><h2>Territories</h2></div><span>{data.territories.length} total</span></div>
        <div className="territory-grid">
          {data.territories.map((territory) => {
            const coverage = coverageByTerritory[territory.id]
              ?? coverageForTerritory(data, territory.id);
            const team = data.teams.find((item) => item.id === territory.assignedTeamId);
            return (
              <div key={territory.id} className={`territory-card${territory.id === activeTerritory.id ? " active" : ""}`} style={{ "--territory-color": territory.color } as React.CSSProperties}>
                <button className="territory-card-select" onClick={() => onSelectTerritory(territory.id)} aria-label={`Open ${territory.name}`}>
                  <span className="territory-card-map"><MapPinned size={21} /><span>{coverage.percent}%</span></span>
                  <span className="territory-card-copy"><strong>{territory.name}</strong><small>{team?.name ?? "Unassigned"}</small></span>
                  <span className="tiny-progress"><i style={{ width: `${coverage.percent}%` }} /></span>
                  <span className="territory-remaining">{coverage.remaining} residential left</span>
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
            {(["conversation", "no_answer", "follow_up", "declined", "do_not_visit", "inaccessible"] as Outcome[]).map((outcome) => <div className="outcome-bar" key={outcome}><span>{outcomeMeta[outcome].label}</span><div><i style={{ width: `${Math.max(count(outcome) ? 8 : 0, (count(outcome) / Math.max(1, touchedLocations)) * 100)}%`, background: outcomeMeta[outcome].color }} /></div><strong>{count(outcome)}</strong></div>)}
          </div>
        </section>
        <section className="leader-section panel">
          <div className="section-heading"><div><p className="eyebrow">In the field</p><h2>Volunteer teams</h2></div><Users size={19} /></div>
          <div className="team-list">
            {data.teams.map((team) => {
              const territory = data.territories.find((item) => team.territoryIds.includes(item.id));
              const teamCoverage = territory
                ? coverageByTerritory[territory.id] ?? coverageForTerritory(data, territory.id)
                : null;
              return <div key={team.id}><span className={`team-initial ${team.status}`}>{team.name.replace("Team ", "").charAt(0)}</span><p><strong>{team.name}</strong><small>{territory?.name ?? "No territory"} · {team.memberIds.length} volunteers</small></p><b>{teamCoverage ? `${teamCoverage.touched}/${teamCoverage.total}` : "—"}</b></div>;
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
