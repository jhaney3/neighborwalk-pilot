import { formatPhoneNumber, type FollowUp, type NeighborWalkData, type Property, type Resident } from "./domain";
import { indexCurrentRecords } from "./record-aliases";
import { calendarDate, formatCalendarDate } from "./calendar";

export type PersonFollowUpGroup = {
  key: string;
  person?: Resident;
  property?: Property;
  label: string;
  address?: string;
  earliestDueAt: string;
  tasks: FollowUp[];
};

export function followUpDateBlock(dueAt: string, timezone: string) {
  const date = calendarDate(dueAt, timezone);
  return {
    date,
    day: formatCalendarDate(date, { day: "numeric" }),
    month: formatCalendarDate(date, { month: "short" }),
    weekday: formatCalendarDate(date, { weekday: "long" }),
  };
}

export type FollowUpContactCue = {
  kind: NonNullable<FollowUp["channel"]>;
  label: string;
  detail?: string;
  keepDetailTogether?: boolean;
};

export function followUpContactCue(task: FollowUp, person?: Resident, property?: Property): FollowUpContactCue {
  const preferredChannel = person && person.preferredContact !== "none" ? person.preferredContact : undefined;
  const channel = preferredChannel ?? task.channel ?? "visit";

  if (channel === "text") {
    return {
      kind: channel,
      label: "Text",
      detail: person?.phone && formatPhoneNumber(person.phone),
      keepDetailTogether: true,
    };
  }
  if (channel === "call") {
    return {
      kind: channel,
      label: "Phone",
      detail: person?.phone && formatPhoneNumber(person.phone),
      keepDetailTogether: true,
    };
  }
  if (channel === "email") {
    return { kind: channel, label: "Email", detail: person?.email };
  }
  if (channel === "visit") {
    const address = property ? `${property.address}${property.unit ? ` · ${property.unit}` : ""}` : undefined;
    return { kind: channel, label: "In person", detail: address };
  }

  return { kind: channel, label: "Contact not set" };
}

/**
 * Builds display-only task groups. Historical task links remain untouched; the
 * alias indexes are used only to show the current accessible person/property.
 */
export function groupFollowUpsByPerson(tasks: readonly FollowUp[], data: NeighborWalkData): PersonFollowUpGroup[] {
  const people = indexCurrentRecords(data.residents);
  const properties = indexCurrentRecords(data.properties);
  const groups = new Map<string, PersonFollowUpGroup>();

  for (const task of tasks) {
    const person = people.get(task.residentId ?? "");
    const property = properties.get(task.propertyId ?? "")
      ?? properties.get(person?.propertyId ?? "");
    const key = person
      ? `person:${person.id}`
      : property
        ? `property:${property.id}`
        : `task:${task.id}`;
    const existing = groups.get(key);

    if (existing) {
      existing.tasks.push(task);
      if (task.dueAt < existing.earliestDueAt) existing.earliestDueAt = task.dueAt;
      continue;
    }

    groups.set(key, {
      key,
      person,
      property,
      label: person?.name || "Name not known",
      address: property ? `${property.address}${property.unit ? ` · ${property.unit}` : ""}` : undefined,
      earliestDueAt: task.dueAt,
      tasks: [task],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      tasks: group.tasks.toSorted((left, right) => left.dueAt.localeCompare(right.dueAt) || left.id.localeCompare(right.id)),
    }))
    .toSorted((left, right) => left.earliestDueAt.localeCompare(right.earliestDueAt) || left.label.localeCompare(right.label));
}
