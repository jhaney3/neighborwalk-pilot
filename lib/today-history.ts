import { calendarDate } from "./calendar";
import { conversationContextLabels, conversationNeedLabels, outcomeMeta, type NeighborWalkData, type OutreachEvent, type Outcome } from "./domain";
import { reviewedEncounter } from "./encounter-history";
import { indexCurrentRecords } from "./record-aliases";
import { targetCoverage } from "./target-coverage";

type Assignment = NonNullable<NeighborWalkData["assignments"]>[number];

export type PersonalHistoryEntry = {
  id: string;
  recordedAt: string;
  outcome: Exclude<Outcome, "unvisited">;
  title: string;
  detail?: string;
};

/** Today's History is personal: only the signed-in person's own encounters,
 * recorded on the church's calendar day, newest first. Team activity belongs
 * on the walk page. */
export function personalHistory(data: NeighborWalkData, volunteerId: string, now = new Date(), limit = 6): PersonalHistoryEntry[] {
  const timezone = data.church.timezone;
  const today = calendarDate(now, timezone);
  const people = indexCurrentRecords(data.residents);
  const homes = indexCurrentRecords(data.properties);
  return data.visits
    .map(reviewedEncounter)
    .filter((visit) => visit.volunteerId === volunteerId && !visit.voided && calendarDate(visit.recordedAt, timezone) === today)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .slice(0, limit)
    .map((visit) => {
      const home = visit.propertyId ? homes.get(visit.propertyId) : undefined;
      const person = visit.residentId ? people.get(visit.residentId) : undefined;
      const place = visit.context === "door"
        ? home?.address ?? "A home"
        : visit.placeLabel ?? conversationContextLabels[visit.context];
      const detail = [person?.name, ...(visit.needs ?? []).map((need) => conversationNeedLabels[need])].filter(Boolean).join(" · ");
      return { id: visit.id, recordedAt: visit.recordedAt, outcome: visit.outcome, title: `${outcomeMeta[visit.outcome].short} · ${place}`, detail: detail || undefined };
    });
}

export type TodayWalkSummary = {
  /** Minutes since a live walk started; absent before it starts. */
  minutes?: number;
  touched?: number;
  total?: number;
  partners: string[];
};

/** What Today's walk card needs: how long it has run, route progress for the
 * person's own route, and who they are walking with. */
export function todayWalkSummary(data: NeighborWalkData, outing: OutreachEvent, assignment: Assignment | undefined, volunteerId: string, now = new Date()): TodayWalkSummary {
  const started = Date.parse(outing.startsAt);
  const minutes = outing.status === "active" && started <= now.getTime() ? Math.floor((now.getTime() - started) / 60000) : undefined;
  const target = assignment?.targetId ? data.walkTargets.find((item) => item.id === assignment.targetId) : undefined;
  const coverage = target ? targetCoverage(data, target) : undefined;
  const team = assignment?.assignedTeamId ? data.teams.find((item) => item.id === assignment.assignedTeamId) : undefined;
  const partners = (team?.memberIds ?? [])
    .filter((id) => id !== volunteerId)
    .map((id) => data.volunteers.find((volunteer) => volunteer.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  return { minutes, touched: coverage?.touched, total: coverage?.total, partners };
}

export function elapsedLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}
