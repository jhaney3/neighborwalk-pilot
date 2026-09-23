import type { NeighborWalkData, OutreachEvent } from "./domain";

type Tone = "neutral" | "tint" | "accent" | "danger";
type Assignment = NonNullable<NeighborWalkData["assignments"]>[number];
type Team = NeighborWalkData["teams"][number];

/** People see plain words for record states, never the stored enum values. */
export const walkStatusLabels: Record<OutreachEvent["status"], { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Upcoming", tone: "neutral" },
  ready: { label: "Ready", tone: "tint" },
  active: { label: "Live", tone: "accent" },
  completed: { label: "Done", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
  archived: { label: "Archived", tone: "neutral" },
};

export const assignmentStatusLabels: Record<Assignment["status"], string> = {
  assigned: "Assigned",
  accepted: "Accepted",
  completed: "Finished",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const teamStatusLabels: Record<Team["status"], string> = {
  ready: "Ready",
  active: "Walking",
  finished: "Finished",
};
