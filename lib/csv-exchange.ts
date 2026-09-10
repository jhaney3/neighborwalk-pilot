import { createId, type NeighborWalkData } from "./domain";
import type { CommandOperation } from "./command-schema";
import { calendarDate } from "./calendar";

export type ImportKind = "people" | "locations";
export type CsvPreviewRow = { line: number; values: Record<string, string>; problems: string[]; duplicate: boolean };
export type CsvPreview = { kind: ImportKind; rows: CsvPreviewRow[] };
const columns: Record<ImportKind, string[]> = {
  people: ["name", "phone", "email", "preferred_contact", "contact_permission"],
  locations: ["address", "unit"],
};
export const normalizeExchangeValue = (value: string | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const phoneKey = (value: string | undefined) => (value ?? "").replace(/\D/g, "");

/** RFC-style quoted cells, including embedded commas, quotes and line breaks.
 * This parser never evaluates data or silently repairs malformed quoting. */
export function parseCsv(input: string): string[][] {
  if (new TextEncoder().encode(input).length > 2 * 1024 * 1024) throw new Error("CSV files must be smaller than 2 MB.");
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false; let closedQuote = false;
  const pushField = () => { row.push(field); field = ""; closedQuote = false; };
  const pushRow = () => { pushField(); if (row.some((cell) => cell.trim())) rows.push(row); row = []; if (rows.length > 101) throw new Error("Import at most 100 records per reviewed file."); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closedQuote = true; } }
      else field += c;
    } else if (c === ',') pushField();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else if (c === '"' && !field && !closedQuote) quoted = true;
    else { if (closedQuote || c === '"') throw new Error("Malformed CSV quoting. Export as standard UTF-8 CSV and try again."); field += c; }
  }
  if (quoted) throw new Error("A quoted CSV cell was not closed.");
  if (field || row.length || closedQuote) pushRow();
  return rows;
}

/** Quoting alone does not prevent spreadsheet formula execution. Prefix a
 * literal apostrophe whenever a cell could be interpreted as a formula. */
export function csvCell(value: unknown) {
  const text = String(value ?? "");
  // eslint-disable-next-line no-control-regex -- Deliberate spreadsheet-injection protection against control-prefixed formulas.
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function csvDocument(headers: string[], rows: unknown[][]) {
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
export function csvTemplate(kind: ImportKind) { return csvDocument(columns[kind], []); }
export function previewCsv(input: string, kind: ImportKind, data: NeighborWalkData): CsvPreview {
  const [rawHeaders, ...rows] = parseCsv(input);
  if (!rawHeaders || !rows.length) throw new Error("Include a header row and at least one record.");
  const headers = rawHeaders.map(normalizeExchangeValue);
  if (new Set(headers).size !== headers.length || headers.some((h) => !columns[kind].includes(h)) || !headers.includes(columns[kind][0])) {
    throw new Error("Use the supported template headers: " + columns[kind].join(", ") + ". Extra columns are not silently discarded.");
  }
  const names = new Set(data.residents.map((p) => normalizeExchangeValue(p.name)).filter(Boolean));
  const emails = new Set(data.residents.map((p) => normalizeExchangeValue(p.email)).filter(Boolean));
  const phones = new Set(data.residents.map((p) => phoneKey(p.phone)).filter(Boolean));
  const addresses = new Set(data.properties.map((p) => normalizeExchangeValue(p.address) + "|" + normalizeExchangeValue(p.unit)));
  return { kind, rows: rows.map((cells, i) => {
    const values = Object.fromEntries(headers.map((h, j) => [h, (cells[j] ?? "").trim()]));
    const problems: string[] = [];
    if (cells.length !== headers.length) problems.push("The number of cells does not match the header.");
    // eslint-disable-next-line no-control-regex -- Reject embedded binary/control characters, retaining normal CSV line endings.
    if (Object.values(values).some((v) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))) problems.push("Unsupported control characters.");
    let duplicate = false;
    if (kind === "people") {
      if (!values.name || values.name.length > 120) problems.push("A name or useful description of 1–120 characters is required.");
      if (values.phone && (values.phone.length < 3 || values.phone.length > 40)) problems.push("Phone length must be 3–40 characters.");
      if (values.email && (values.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))) problems.push("Check the email address.");
      const preference = values.preferred_contact || "none";
      if (!["none", "call", "text", "email"].includes(preference)) problems.push("Contact method must be none, call, text, or email.");
      if (preference === "email" && !values.email || ["call", "text"].includes(preference) && !values.phone) problems.push("The selected contact method needs a matching contact detail.");
      if (!["", "not_recorded", "requested", "do_not_contact"].includes(values.contact_permission ?? "")) problems.push("Use not_recorded, requested, or do_not_contact for permission.");
      const name = normalizeExchangeValue(values.name), email = normalizeExchangeValue(values.email), phone = phoneKey(values.phone);
      duplicate = names.has(name) || Boolean(email && emails.has(email)) || Boolean(phone && phones.has(phone));
      if (name) names.add(name); if (email) emails.add(email); if (phone) phones.add(phone);
    } else {
      if (!values.address || values.address.length > 240) problems.push("Address length must be 1–240 characters.");
      if ((values.unit?.length ?? 0) > 60) problems.push("Unit length must not exceed 60 characters.");
      const key = normalizeExchangeValue(values.address) + "|" + normalizeExchangeValue(values.unit);
      duplicate = addresses.has(key); addresses.add(key);
    }
    if (duplicate) problems.push("Possible duplicate in this church or earlier in this file. Review separately; this row will not be imported.");
    return { line: i + 2, values, problems, duplicate };
  }) };
}
export function csvImportOperations(preview: CsvPreview, selectedLines: number[]): CommandOperation[] {
  const selected = preview.rows.filter((r) => selectedLines.includes(r.line));
  if (!selected.length || selected.length !== selectedLines.length || selected.some((r) => r.problems.length)) throw new Error("Select valid, nonduplicate rows after reviewing them.");
  return selected.map(({ values: v }) => preview.kind === "people" ? {
    entityType: "resident", entityId: createId("person"), expectedVersion: 0, operation: "upsert", record: {
      name: v.name, phone: v.phone || undefined, email: v.email || undefined, preferredContact: v.preferred_contact || "none",
      contactPermission: v.contact_permission || "not_recorded", status: "active", sharedWithVolunteerIds: [], sharedWithTeamIds: [],
    },
  } : { entityType: "property", entityId: createId("location"), expectedVersion: 0, operation: "upsert",
    record: { address: v.address, unit: v.unit || undefined, source: "import" } });
}
export function exportCsv(data: NeighborWalkData, kind: ImportKind | "tasks") {
  if (kind === "people") return csvDocument(["id", "name", "phone", "email", "preferred_contact", "contact_permission", "restricted_channels", "location_visit_restricted", "tracking_status", "owner", "location_id"],
    data.residents.filter((p) => !p.mergedIntoId).map((p) => [p.id, p.name, p.phone, p.email, p.preferredContact, p.contactPermission,
      (data.restrictions ?? []).filter((r) => r.active && r.residentId === p.id).map((r) => r.channel).join(" | "),
      data.properties.some((l) => l.id === p.propertyId && l.currentOutcome === "do_not_visit"), p.status, data.volunteers.find((v) => v.id === p.assignedVolunteerId)?.name, p.propertyId]));
  if (kind === "locations") return csvDocument(["id", "address", "unit", "list_id", "visit_restricted"], data.properties.filter((p) => !p.mergedIntoId).map((p) => [p.id, p.address, p.unit, p.territoryId, p.currentOutcome === "do_not_visit"]));
  return csvDocument(["id", "person_id", "location_id", "owner", "due_date", "status", "channel", "acceptance"], data.followUps.map((t) => [t.id, t.residentId, t.propertyId,
    data.volunteers.find((v) => v.id === t.assignedVolunteerId)?.name, calendarDate(t.dueAt, data.church.timezone), t.status, t.channel, t.acceptance]));
}
