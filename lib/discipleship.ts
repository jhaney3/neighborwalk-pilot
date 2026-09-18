import type { NeighborWalkData } from "./domain";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VOLUNTEER_USER_PATTERN = /^volunteer_([0-9a-f]{32})$/i;

export function volunteerIdForUser(userId: string) {
  return `volunteer_${userId.replaceAll("-", "")}`;
}

export function userIdForVolunteer(volunteerId: string): string | null {
  const compact = volunteerId.match(VOLUNTEER_USER_PATTERN)?.[1];
  if (!compact) return null;
  const userId = `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
  return UUID_PATTERN.test(userId) ? userId : null;
}

export type AuthenticatedVolunteerMembership = {
  churchId: string;
  userId: string;
  role: "leader" | "volunteer";
  email: string;
  displayName: string;
};

/**
 * Migrated or cached workspaces can be missing the signed-in member from their
 * volunteer directory. Keep the authenticated identity visible wherever person
 * ownership is displayed.
 */
export function withAuthenticatedVolunteer(
  data: NeighborWalkData,
  membership: AuthenticatedVolunteerMembership,
): NeighborWalkData {
  if (membership.churchId !== data.church.id) return data;
  const volunteerId = volunteerIdForUser(membership.userId);
  const volunteer = {
    id: volunteerId,
    churchId: membership.churchId,
    name: membership.displayName,
    email: membership.email || undefined,
    role: membership.role,
    active: true,
  };
  const existingIndex = data.volunteers.findIndex((candidate) => candidate.id === volunteerId);
  return {
    ...data,
    volunteers: existingIndex === -1
      ? [...data.volunteers, volunteer]
      : data.volunteers.map((candidate, index) => index === existingIndex ? { ...candidate, ...volunteer } : candidate),
  };
}
