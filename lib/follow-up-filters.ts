import type { FollowUp, NeighborWalkData } from "./domain";
export type FollowUpScope = "mine" | "all" | "team" | "unowned" | "declined";
export function followUpScope(value: string | null | undefined): FollowUpScope {
  return ["all", "team", "unowned", "declined"].includes(value ?? "") ? value as FollowUpScope : "mine";
}
export function taskMatchesScope(task: FollowUp, scope: FollowUpScope, data: NeighborWalkData, actor: string) {
  if (scope === "mine") return task.assignedVolunteerId === actor;
  if (scope === "team") return data.teams.some((t) => t.id === task.assignedTeamId && t.memberIds.includes(actor));
  if (scope === "unowned") return !task.assignedVolunteerId || !data.volunteers.some((v) => v.id === task.assignedVolunteerId && v.active);
  if (scope === "declined") return task.acceptance === "declined";
  return true;
}
export function followUpsHref(id?: string, personId?: string, scope: FollowUpScope = "mine") {
  const query = new URLSearchParams();
  if (personId) query.set("person", personId);
  if (scope !== "mine") query.set("scope", scope);
  return "/app/followups" + (id ? "/" + encodeURIComponent(id) : "") + (query.size ? "?" + query : "");
}
