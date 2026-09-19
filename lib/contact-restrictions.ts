import { createId, type NeighborWalkData } from "./domain";
import { indexCurrentRecords, recordFamilyIds } from "./record-aliases";
type Restriction = NonNullable<NeighborWalkData["restrictions"]>[number];
export type RestrictionInput = Pick<Restriction, "residentId" | "propertyId" | "channel" | "reason">;
export type RestrictionActions = { add: (input: RestrictionInput) => Promise<unknown>; lift: (id: string, reason: string) => Promise<unknown> };
export function contactRestricted(data: NeighborWalkData, residentId: string | undefined, channel: "visit" | "call" | "text" | "email" | "other", propertyId?: string) {
  const person = residentId ? indexCurrentRecords(data.residents).get(residentId) : undefined;
  const people = residentId ? recordFamilyIds(data.residents, residentId) : new Set<string>();
  const locations = propertyId ? recordFamilyIds(data.properties, propertyId) : new Set<string>();
  return Boolean(residentId && (!person || person.contactPermission === "do_not_contact"))
    || Boolean(propertyId && !locations.size)
    || Boolean(data.restrictions?.some((r) => r.active && ((r.residentId && people.has(r.residentId) && ["all", channel].includes(r.channel))
      || (r.propertyId && locations.has(r.propertyId) && channel === "visit" && ["all", "visit"].includes(r.channel)))));
}
export function addContactRestriction(data: NeighborWalkData, input: RestrictionInput): NeighborWalkData {
  if (Boolean(input.residentId) === Boolean(input.propertyId)) throw new Error("Choose either a person or a location for this restriction.");
  if (input.residentId && !data.residents.some((p) => p.id === input.residentId && !p.mergedIntoId) || input.propertyId && !data.properties.some((p) => p.id === input.propertyId && !p.mergedIntoId)) throw new Error("Open the current record before adding a restriction.");
  if (input.propertyId && !["all", "visit"].includes(input.channel)) throw new Error("Location restrictions apply to visits. Record other preferences on a person’s profile.");
  if (input.reason.trim().length < 3 || input.reason.trim().length > data.church.noteCharacterLimit) throw new Error("Record a brief factual reason within the church’s character limit.");
  if (data.restrictions?.some((r) => r.active && r.residentId === input.residentId && r.propertyId === input.propertyId && (r.channel === input.channel || r.channel === "all"))) throw new Error("An active restriction already covers this contact method.");
  return { ...data, restrictions: [...(data.restrictions ?? []), { ...input, reason: input.reason.trim(), id: createId("restriction"), churchId: data.church.id, active: true, createdAt: new Date().toISOString() }] };
}
export function liftContactRestriction(data: NeighborWalkData, id: string, reason: string): NeighborWalkData {
  if (!data.restrictions?.some((r) => r.id === id && r.active)) throw new Error("This restriction is no longer active. Refresh before reviewing it.");
  if (reason.trim().length < 3 || reason.trim().length > data.church.noteCharacterLimit) throw new Error("Record why this restriction may now be lifted.");
  return { ...data, restrictions: data.restrictions.map((r) => r.id === id ? { ...r, active: false, correctionReason: reason.trim(), correctedAt: new Date().toISOString() } : r) };
}
