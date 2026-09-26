import type { AddressWorksheetPage, AddressWorksheetRow } from "../lib/target-address-list";

const WORKSHEET_OUTCOMES = ["No answer", "Talked", "Follow-up", "Declined", "Inaccessible", "Do not revisit"];

export type FieldWorksheetContext = {
  outingName: string;
  targetName: string;
  eventId: string;
  targetId?: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  meetingPoint?: string;
  ownerLabel: string;
};

export function FieldWorksheet({ churchName, context, pages, printedAt }: {
  churchName: string;
  context: FieldWorksheetContext;
  pages: AddressWorksheetPage[];
  printedAt?: string;
}) {
  const schedule = `${formatDate(context.startsAt, context.timezone)} · ${formatTime(context.startsAt, context.timezone)}–${formatTime(context.endsAt, context.timezone)}`;
  const printed = printedAt ? `${formatDate(printedAt, context.timezone)} · ${formatTime(printedAt, context.timezone)}` : "Added when printing";
  const totalRows = pages.reduce((total, current) => total + current.rows.length, 0);
  return <div className="field-worksheet-packet" aria-hidden="true">
    {pages.map((page) => <section className="field-worksheet-sheet" key={page.number}>
      <header className="field-worksheet-header">
        <div className="field-worksheet-brand"><div><strong>{churchName}</strong><span>Offline field worksheet</span></div><b>Page {page.number} of {pages.length}</b></div>
        <div className="field-worksheet-title"><h1>{context.outingName}</h1><span>Addresses {page.rows.at(0)?.sequenceLabel}–{page.rows.at(-1)?.sequenceLabel} of {totalRows}</span></div>
        <dl className="field-worksheet-meta">
          <div><dt>Target</dt><dd>{context.targetName}</dd></div>
          <div><dt>Schedule</dt><dd>{schedule}</dd></div>
          <div><dt>Meet</dt><dd>{context.meetingPoint || "Not specified"}</dd></div>
          <div><dt>Assigned to</dt><dd>{context.ownerLabel}</dd></div>
          <div><dt>Printed</dt><dd>{printed}</dd></div>
        </dl>
        <p className="field-worksheet-confidential"><strong>Confidential when completed.</strong> Keep with the assigned team, return promptly, enter into SendMe, and shred securely. Do not record medical, counseling, or other sensitive care details.</p>
      </header>
      <div className="field-worksheet-records">
        {page.rows.map((row) => <FieldWorksheetRecord key={row.entry.key} row={row} />)}
      </div>
      <footer className="field-worksheet-footer">Use one outcome per address. Check the app for current restrictions before beginning the walk.</footer>
    </section>)}
  </div>;
}

function FieldWorksheetRecord({ row }: { row: AddressWorksheetRow }) {
  const unavailable = row.entry.address === "Address unavailable";
  return <article className={`field-worksheet-record${row.restricted ? " restricted" : ""}${row.recordedThisWalk ? " recorded" : ""}${unavailable ? " unavailable" : ""}`}>
    <header>
      <span className="field-worksheet-sequence">{row.sequenceLabel}</span>
      <div><h2>{row.entry.address}{row.entry.unit ? ` · ${row.entry.unit}` : ""}</h2><p>App status at print: <strong>{row.statusLabel}</strong></p></div>
    </header>
    {row.restricted ? <div className="field-worksheet-stop"><strong>DO NOT APPROACH</strong><span>This location has an active do-not-visit instruction. Leave this record blank.</span></div>
      : unavailable ? <div className="field-worksheet-stop unavailable"><strong>ADDRESS UNAVAILABLE</strong><span>Identify this parcel in SendMe before using the worksheet.</span></div>
      : row.recordedThisWalk ? <div className="field-worksheet-stop recorded"><strong>ALREADY ENTERED FOR THIS WALK</strong><span>Do not create a duplicate visit. Review the app if a correction is needed.</span></div>
      : <>
        <div className="field-worksheet-outcomes"><strong>Outcome—choose one</strong><div>{WORKSHEET_OUTCOMES.map((label) => <WorksheetChoice label={label} key={label} />)}</div></div>
        <div className="field-worksheet-contact">
          <span className="wide"><b>Name</b><i /></span><span><b>Phone</b><i /></span><span><b>Email</b><i /></span>
          <span className="preference"><b>Preferred</b><WorksheetChoice label="Text" /><WorksheetChoice label="Call" /><WorksheetChoice label="Email" /><WorksheetChoice label="None" /></span>
          <span className="return-date"><b>Return by</b><i /></span>
        </div>
        <div className="field-worksheet-notes"><b>Objective note / requested next step</b><i /><i /></div>
        <footer><span>Volunteer initials <i /></span><span className="field-worksheet-entered"><WorksheetChoice label="Entered in app" /><span>Initials <i /></span><span>Date <i /></span></span></footer>
      </>}
  </article>;
}

function WorksheetChoice({ label }: { label: string }) {
  return <span className="field-worksheet-choice"><i />{label}</span>;
}

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timezone }).format(new Date(value));
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}
