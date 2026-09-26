import type { OutreachEvent } from "./domain";

function stamp(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** A calendar file for "Add to calendar" after a walker says they're in. */
export function walkCalendarFile(outing: Pick<OutreachEvent, "id" | "name" | "startsAt" | "endsAt" | "meetingPoint" | "purpose">, churchName: string, now = new Date()) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NeighborWalk//Walk//EN",
    "BEGIN:VEVENT",
    `UID:${outing.id}@neighborwalk.app`,
    `DTSTAMP:${stamp(now.toISOString())}`,
    `DTSTART:${stamp(outing.startsAt)}`,
    `DTEND:${stamp(outing.endsAt)}`,
    `SUMMARY:${escapeText(outing.name)}`,
    outing.meetingPoint ? `LOCATION:${escapeText(outing.meetingPoint)}` : undefined,
    `DESCRIPTION:${escapeText([churchName, outing.purpose].filter(Boolean).join(" — "))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => Boolean(line));
  return lines.join("\r\n") + "\r\n";
}
