import type { Resident, ResidentInput } from "./domain";

/** A person's current record as upsert input, with a few fields changed. */
export function residentInput(resident: Resident, patch: Partial<ResidentInput> = {}): ResidentInput {
  return {
    name: resident.name, faithStatus: resident.faithStatus, discipleshipStage: resident.discipleshipStage,
    assignedVolunteerId: resident.assignedVolunteerId, sharedWithVolunteerIds: resident.sharedWithVolunteerIds, sharedWithTeamIds: resident.sharedWithTeamIds,
    status: resident.status, phone: resident.phone, email: resident.email, preferredContact: resident.preferredContact,
    contactPermission: resident.contactPermission, lastContactAt: resident.lastContactAt, ...patch,
  };
}
