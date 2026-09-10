import type { SupabaseClient } from "@supabase/supabase-js";
import {
  discipleshipStageValues,
  faithStatusValues,
  type FollowUp,
  type NeighborWalkData,
  type PendingMutation,
  type PersonNote,
  type Resident,
} from "./domain";
import type { NeighborWalkDatabase } from "./supabase";

type PersonRow = NeighborWalkDatabase["public"]["Tables"]["discipleship_people"]["Row"];
type PersonInsert = NeighborWalkDatabase["public"]["Tables"]["discipleship_people"]["Insert"];
type PersonUpdate = NeighborWalkDatabase["public"]["Tables"]["discipleship_people"]["Update"];
type PersonNoteRow = NeighborWalkDatabase["public"]["Tables"]["discipleship_person_notes"]["Row"];
type PersonFollowUpRow = NeighborWalkDatabase["public"]["Tables"]["discipleship_follow_ups"]["Row"];
type PersonFollowUpInsert = NeighborWalkDatabase["public"]["Tables"]["discipleship_follow_ups"]["Insert"];
type PersonFollowUpUpdate = NeighborWalkDatabase["public"]["Tables"]["discipleship_follow_ups"]["Update"];

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
 * The workspace snapshot predates authenticated memberships, so older churches
 * can be missing the signed-in member from their volunteer directory. Keep the
 * authenticated identity visible wherever person ownership is displayed.
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

function canonicalIso(value: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function personFromRow(row: PersonRow): Resident | null {
  const createdAt = canonicalIso(row.created_at);
  const updatedAt = canonicalIso(row.updated_at);
  if (!createdAt || !updatedAt
    || !faithStatusValues.includes(row.faith_status as Resident["faithStatus"])
    || !discipleshipStageValues.includes(row.discipleship_stage as Resident["discipleshipStage"])
    || !["active", "paused", "archived"].includes(row.status)
    || !["none", "text", "call", "email"].includes(row.preferred_contact)) return null;
  return {
    id: row.id,
    churchId: row.church_id,
    propertyId: row.property_id,
    name: row.name ?? undefined,
    faithStatus: row.faith_status as Resident["faithStatus"],
    discipleshipStage: row.discipleship_stage as Resident["discipleshipStage"],
    assignedVolunteerId: volunteerIdForUser(row.assigned_to),
    createdByVolunteerId: volunteerIdForUser(row.created_by),
    sharedWithVolunteerIds: row.shared_user_ids.map(volunteerIdForUser),
    sharedWithTeamIds: row.shared_team_ids,
    status: row.status as Resident["status"],
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    preferredContact: row.preferred_contact as Resident["preferredContact"],
    lastContactAt: canonicalIso(row.last_contact_at),
    createdAt,
    updatedAt,
  };
}

function followUpFromRow(row: PersonFollowUpRow): FollowUp | null {
  const dueAt = canonicalIso(row.due_at);
  const createdAt = canonicalIso(row.created_at);
  const completedAt = canonicalIso(row.completed_at);
  if (!dueAt || !createdAt || !["scheduled", "completed", "cancelled"].includes(row.status) || !Array.isArray(row.history)) return null;
  const history = row.history.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const activity = candidate as Record<string, unknown>;
    const activityCreatedAt = typeof activity.createdAt === "string" ? canonicalIso(activity.createdAt) : undefined;
    if (typeof activity.id !== "string" || typeof activity.actorId !== "string" || !activityCreatedAt
      || !["created", "rescheduled", "note", "completed", "cancelled"].includes(String(activity.action))) return [];
    const activityDueAt = typeof activity.dueAt === "string" ? canonicalIso(activity.dueAt) : undefined;
    return [{
      id: activity.id,
      action: activity.action as FollowUp["history"][number]["action"],
      note: typeof activity.note === "string" ? activity.note : undefined,
      dueAt: activityDueAt,
      actorId: activity.actorId,
      createdAt: activityCreatedAt,
    }];
  });
  return {
    id: row.id,
    churchId: row.church_id,
    propertyId: row.property_id,
    residentId: row.person_id,
    sourceVisitId: row.source_visit_id ?? undefined,
    dueAt,
    status: row.status as FollowUp["status"],
    note: row.note ?? undefined,
    completionNote: row.completion_note ?? undefined,
    parentFollowUpId: row.parent_follow_up_id ?? undefined,
    history,
    createdAt,
    completedAt,
  };
}

function noteFromRow(row: PersonNoteRow): PersonNote | null {
  const createdAt = canonicalIso(row.created_at);
  if (!createdAt || !["conversation", "prayer", "milestone", "general"].includes(row.kind)) return null;
  return {
    id: row.id,
    churchId: row.church_id,
    residentId: row.person_id,
    authorId: volunteerIdForUser(row.author_id),
    kind: row.kind as PersonNote["kind"],
    body: row.body,
    createdAt,
  };
}

export async function loadConnectedDiscipleship(
  client: SupabaseClient<NeighborWalkDatabase>,
  churchId: string,
): Promise<Pick<NeighborWalkData, "residents" | "personNotes" | "followUps">> {
  const [peopleResult, notesResult, followUpsResult] = await Promise.all([
    client.from("discipleship_people").select("*").eq("church_id", churchId).order("updated_at", { ascending: false }),
    client.from("discipleship_person_notes").select("*").eq("church_id", churchId).order("created_at", { ascending: false }),
    client.from("discipleship_follow_ups").select("*").eq("church_id", churchId).order("due_at", { ascending: true }),
  ]);
  if (peopleResult.error) throw peopleResult.error;
  if (notesResult.error) throw notesResult.error;
  if (followUpsResult.error) throw followUpsResult.error;
  const residents = (peopleResult.data ?? []).flatMap((row) => {
    const person = personFromRow(row);
    return person ? [person] : [];
  });
  const visibleIds = new Set(residents.map((resident) => resident.id));
  const personNotes = (notesResult.data ?? []).flatMap((row) => {
    const note = noteFromRow(row);
    return note && visibleIds.has(note.residentId) ? [note] : [];
  });
  const personFollowUps = (followUpsResult.data ?? []).flatMap((row) => {
    const followUp = followUpFromRow(row);
    return followUp && followUp.residentId && visibleIds.has(followUp.residentId) ? [followUp] : [];
  });
  return { residents, personNotes, followUps: personFollowUps };
}

function personInsert(person: Resident, churchId: string, fallbackUserId: string): PersonInsert {
  const assignedTo = userIdForVolunteer(person.assignedVolunteerId) ?? fallbackUserId;
  const createdBy = userIdForVolunteer(person.createdByVolunteerId) ?? fallbackUserId;
  return {
    id: person.id,
    church_id: churchId,
    property_id: person.propertyId,
    created_by: createdBy,
    assigned_to: assignedTo,
    shared_user_ids: [...new Set(person.sharedWithVolunteerIds.map(userIdForVolunteer).filter((value): value is string => Boolean(value)))],
    shared_team_ids: [...new Set(person.sharedWithTeamIds)],
    name: person.name ?? null,
    faith_status: person.faithStatus,
    discipleship_stage: person.discipleshipStage,
    status: person.status,
    phone: person.phone ?? null,
    email: person.email ?? null,
    preferred_contact: person.preferredContact,
    next_step: null,
    next_step_due_at: null,
    last_contact_at: person.lastContactAt ?? null,
    created_at: person.createdAt,
    updated_at: person.updatedAt,
  };
}

export function personInsertForCreator(person: Resident, churchId: string, userId: string): PersonInsert {
  return {
    ...personInsert(person, churchId, userId),
    created_by: userId,
    assigned_to: userId,
  };
}

function latestDiscipleshipMutations(pending: PendingMutation[]) {
  const latest = new Map<string, PendingMutation>();
  for (const item of pending) {
    if (item.entityType === "resident" || item.entityType === "person_note" || item.entityType === "person_follow_up") {
      latest.set(`${item.entityType}:${item.entityId}`, item);
    }
  }
  return [...latest.values()];
}

export async function persistConnectedDiscipleship(
  client: SupabaseClient<NeighborWalkDatabase>,
  churchId: string,
  userId: string,
  data: NeighborWalkData,
) {
  const mutations = latestDiscipleshipMutations(data.sync.pending);
  if (!mutations.length) return;

  for (const item of mutations.filter((mutation) => mutation.entityType === "person_note" && mutation.operation === "delete")) {
    const result = await client.from("discipleship_person_notes").delete().eq("church_id", churchId).eq("id", item.entityId);
    if (result.error) throw result.error;
  }
  for (const item of mutations.filter((mutation) => mutation.entityType === "person_follow_up" && mutation.operation === "delete")) {
    const result = await client.from("discipleship_follow_ups").delete().eq("church_id", churchId).eq("id", item.entityId);
    if (result.error) throw result.error;
  }
  for (const item of mutations.filter((mutation) => mutation.entityType === "resident" && mutation.operation === "delete")) {
    const result = await client.from("discipleship_people").delete().eq("church_id", churchId).eq("id", item.entityId);
    if (result.error) throw result.error;
  }

  for (const item of mutations.filter((mutation) => mutation.entityType === "resident" && mutation.operation === "upsert")) {
    const person = data.residents.find((resident) => resident.id === item.entityId);
    if (!person) continue;
    const insert = personInsert(person, churchId, userId);
    const update: PersonUpdate = {
      property_id: insert.property_id,
      assigned_to: insert.assigned_to,
      shared_user_ids: insert.shared_user_ids,
      shared_team_ids: insert.shared_team_ids,
      name: insert.name,
      faith_status: insert.faith_status,
      discipleship_stage: insert.discipleship_stage,
      status: insert.status,
      phone: insert.phone,
      email: insert.email,
      preferred_contact: insert.preferred_contact,
      next_step: null,
      next_step_due_at: null,
      last_contact_at: insert.last_contact_at,
      updated_at: insert.updated_at,
    };
    const updated = await client.from("discipleship_people").update(update).eq("church_id", churchId).eq("id", person.id).select("id").maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) {
      const inserted = await client.from("discipleship_people").insert(personInsertForCreator(person, churchId, userId));
      if (inserted.error) throw inserted.error;
    }
  }

  for (const item of mutations.filter((mutation) => mutation.entityType === "person_follow_up" && mutation.operation === "upsert")) {
    const followUp = data.followUps.find((candidate) => candidate.id === item.entityId && candidate.residentId);
    if (!followUp?.residentId) continue;
    const insert: PersonFollowUpInsert = {
      id: followUp.id,
      church_id: churchId,
      person_id: followUp.residentId,
      property_id: followUp.propertyId,
      source_visit_id: followUp.sourceVisitId ?? null,
      created_by: userId,
      due_at: followUp.dueAt,
      status: followUp.status,
      note: followUp.note ?? null,
      completion_note: followUp.completionNote ?? null,
      parent_follow_up_id: followUp.parentFollowUpId ?? null,
      history: followUp.history,
      created_at: followUp.createdAt,
      completed_at: followUp.completedAt ?? null,
      updated_at: item.changedAt,
    };
    const update: PersonFollowUpUpdate = {
      property_id: insert.property_id,
      source_visit_id: insert.source_visit_id,
      due_at: insert.due_at,
      status: insert.status,
      note: insert.note,
      completion_note: insert.completion_note,
      parent_follow_up_id: insert.parent_follow_up_id,
      history: insert.history,
      completed_at: insert.completed_at,
      updated_at: insert.updated_at,
    };
    const updated = await client.from("discipleship_follow_ups").update(update).eq("church_id", churchId).eq("id", followUp.id).select("id").maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) {
      const inserted = await client.from("discipleship_follow_ups").insert(insert);
      if (inserted.error) throw inserted.error;
    }
  }

  for (const item of mutations.filter((mutation) => mutation.entityType === "person_note" && mutation.operation === "upsert")) {
    const note = data.personNotes.find((candidate) => candidate.id === item.entityId);
    if (!note) continue;
    const inserted = await client.from("discipleship_person_notes").upsert({
      id: note.id,
      church_id: churchId,
      person_id: note.residentId,
      author_id: userId,
      kind: note.kind,
      body: note.body,
      created_at: note.createdAt,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (inserted.error) throw inserted.error;
  }
}

export function withoutSnapshotDiscipleship(data: NeighborWalkData): NeighborWalkData {
  return {
    ...data,
    followUps: data.followUps.filter((followUp) => !followUp.residentId),
    residents: [],
    personNotes: [],
    audit: data.audit.filter((entry) => entry.entityType !== "resident" && entry.entityType !== "person_note" && entry.entityType !== "person_follow_up"),
    sync: {
      ...data.sync,
      pending: data.sync.pending.filter((item) => item.entityType !== "resident" && item.entityType !== "person_note" && item.entityType !== "person_follow_up"),
    },
  };
}

/** Rejoin the member-visible records after loading or saving a shared snapshot. */
export function withSnapshotDiscipleship(
  snapshot: NeighborWalkData,
  people: Pick<NeighborWalkData, "residents" | "personNotes" | "followUps">,
): NeighborWalkData {
  return {
    ...snapshot,
    residents: people.residents,
    personNotes: people.personNotes,
    followUps: [
      ...snapshot.followUps.filter((task) => !task.residentId),
      ...people.followUps.filter((task) => task.residentId),
    ],
  };
}
