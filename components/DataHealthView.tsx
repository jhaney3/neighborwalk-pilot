"use client";
import { Archive, ChevronDown, Cloud, CloudOff, Download, FileSpreadsheet, GitMerge, History, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { csvImportOperations, csvTemplate, previewCsv, type CsvPreview, type ImportKind } from "../lib/csv-exchange";
import type { NeighborWalkData } from "../lib/domain";
import type { AdminInput, DuplicateKind, DuplicatePlan, RetentionPlan } from "../lib/administration";
import { DuplicateReview } from "./DuplicateReview";
import { EncounterCorrectionReview } from "./EncounterCorrectionReview";
import type { PendingAdministration } from "../lib/storage";
import { downloadBlob } from "../lib/download";
import { useAsyncAction } from "../lib/use-async-action";
import { ViewHeading } from "./ui";

type Props = {
  data: NeighborWalkData; online: boolean;
  onRun: (input: AdminInput | null) => Promise<unknown>;
  onExport: (kind: ImportKind | "tasks" | "backup") => Promise<void>;
  onAuthenticate: (password: string) => Promise<void>;
  onPending: () => Promise<PendingAdministration | null>;
  onReviewPending: () => Promise<void>;
  onPreviewRetention: () => Promise<RetentionPlan>;
  onPreviewDuplicates: (kind: DuplicateKind, source: string, target: string) => Promise<DuplicatePlan>;
  onRefresh: () => Promise<boolean>;
  onOpenPerson: (id: string) => void;
  onOpenLocation: (id: string) => void;
};
export function DataHealthView(props: Props) {
  const { data, online, onRun, onExport, onAuthenticate, onPending, onReviewPending, onPreviewRetention, onRefresh } = props;
  const action = useAsyncAction();
  const [pending, setPending] = useState<PendingAdministration | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<ImportKind>("people");
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [previewRevision, setPreviewRevision] = useState<number>(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [approved, setApproved] = useState(false);
  const [retention, setRetention] = useState<RetentionPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    let active = true;
    if (online) void onPending().then((result) => { if (active) setPending(result); }).catch(() => undefined);
    return () => { active = false; };
  }, [online, onPending]);
  const run = (operation: () => Promise<unknown>, success?: () => void) => action.run(async () => {
    try { return await operation(); } finally { if (online) setPending(await onPending()); }
  }, success);
  const blocked = !online || action.busy || Boolean(pending);
  const pendingChanges = data.sync.pending.length;
  const migrationIssueCount = data.migrationIssues?.length ?? 0;
  return <section className="content-view data-health-view">
    <ViewHeading eyebrow="Church stewardship" title="Data & health" description="Import or export records, fix mistakes, and review older data. Choose one task to get started." />
    <div className="data-health-topline">
      <section className={`data-connection-card ${online ? "is-online" : "is-offline"}`} aria-labelledby="data-connection-title">
        <span className="data-connection-icon" aria-hidden="true">{online ? <Cloud size={22} /> : <CloudOff size={22} />}</span>
        <div><p className="eyebrow">Workspace status</p><h2 id="data-connection-title">{online ? "Connected to shared records" : "You’re working offline"}</h2><p>{online
          ? pendingChanges ? `${pendingChanges} device ${pendingChanges === 1 ? "change is" : "changes are"} still waiting to be shared.` : "No device changes are waiting to be shared."
          : "Reconnect before importing, exporting, correcting, or archiving records."}</p></div>
        <button type="button" className="button quiet" disabled={!online || action.busy} onClick={() => void run(async () => { if (!await onRefresh()) throw new Error("Refresh did not finish. Check Device status."); setMessage("Shared records refreshed."); })}><RefreshCw size={16} /> Refresh</button>
      </section>
      <section className="data-admin-check" aria-labelledby="data-admin-check-title">
        <span className="data-admin-check-icon" aria-hidden="true"><ShieldCheck size={22} /></span>
        <div><p className="eyebrow">Protected actions</p><h2 id="data-admin-check-title">Recent sign-in required</h2><p>Reconfirm if your last sign-in was more than 15 minutes ago.</p></div>
        <details>
          <summary role="button">Confirm sign-in <ChevronDown size={16} aria-hidden="true" /></summary>
          <form className="data-auth-form" onSubmit={(e) => { e.preventDefault(); void action.run(() => onAuthenticate(password), () => { setPassword(""); setMessage("Sign-in confirmed. Sensitive actions remain checked by the server."); }); }}>
            <label>Current password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <button className="button quiet" disabled={!online || action.busy}>Confirm my sign-in</button>
          </form>
          <p className="data-help-copy">Use a sign-in provider or email link? Share pending work, sign out safely, and sign in again. Never send your password to support.</p>
        </details>
      </section>
    </div>
    {message && <p role="status" className="inline-notice data-health-message">{message}</p>}{action.error && <p role="alert" className="inline-error data-health-message">{action.error}</p>}
    {pending && <section className="today-card data-pending-card"><h2>Preserved administration request</h2><p>{String(pending.request.action).replaceAll("_", " ")} · saved {new Date(pending.savedAt).toLocaleString()}</p><p>A previous response may have been interrupted. Retry the same immutable request to retrieve its receipt. If the server rejected it, refresh and review the shared records before starting a revised action.</p>
      <div className="care-next-actions"><button className="button primary" disabled={!online || action.busy} onClick={() => void run(() => onRun(null), () => setMessage("The preserved request was confirmed. Records were refreshed. Export requests can now be prepared again for download."))}>Retry preserved request</button>
        <button className="button quiet" disabled={!online || action.busy} onClick={() => { if (window.confirm("Have you reviewed the shared records and this request’s outcome? Preserve this original in device history without resubmitting it. This does not undo any server changes.")) void run(onReviewPending, () => setMessage("Original request preserved in device history. No undo or repeated action was performed.")); }}>I reviewed the outcome; preserve without resubmitting</button></div>
    </section>}
    <section className="data-tool-picker" aria-labelledby="data-tool-picker-title">
      <header><p className="eyebrow">Available tools</p><h2 id="data-tool-picker-title">What do you need to do?</h2><p>Open a task to see its controls and safety checks.</p></header>
      <div className="data-tool-list">
        <details className="data-tool-card">
          <summary role="button"><span className="data-tool-icon"><Download size={21} /></span><span><strong>Export records</strong><small>Download people, locations, tasks, or an accessible-record copy.</small></span><ChevronDown className="data-tool-chevron" size={19} /></summary>
          <div className="data-tool-body">
            <h3>Choose a file to download</h3><p>Use CSV for a spreadsheet. Use JSON when a supervised review needs a broader copy of the records you can access.</p>
            <div className="data-export-grid">{(["people", "locations", "tasks", "backup"] as const).map((type) => <button type="button" key={type} className="button quiet" disabled={blocked} onClick={() => void run(() => onExport(type), () => setMessage("Export prepared and download requested. Keep the file private; this is not a managed database backup."))}><Download size={16} /> {type === "backup" ? "Accessible-record JSON" : type[0].toUpperCase() + type.slice(1) + " CSV"}</button>)}</div>
            <details className="data-help-details"><summary role="button">What is included?</summary><p>CSV exports omit conversation notes, faith/pathway fields, and authentication data. Formula-like spreadsheet cells are exported as literal text. JSON includes accessible care records, but excludes authentication, provider settings, reference parcels, and separately stored guides. These files are not managed database backups or directly reimportable templates.</p></details>
          </div>
        </details>
        <details className="data-tool-card">
          <summary role="button"><span className="data-tool-icon"><Upload size={21} /></span><span><strong>Import a spreadsheet</strong><small>Preview new people or locations before anything is added.</small></span><ChevronDown className="data-tool-chevron" size={19} /></summary>
          <div className="data-tool-body">
            <div className="data-tool-intro"><h3>Import new records in three reviewed steps</h3><p>Imports create new records only. Possible duplicates are skipped for separate review and never merged automatically. Limit: 100 records and 2 MB.</p></div>
            <ol className="data-import-steps">
              <li><div><strong>Choose the record type and get the template</strong><span>People start under your care with no additional sharing. Locations start without a map or list.</span></div><div className="data-import-toolbar"><label>Record type<select value={kind} onChange={(e) => { setKind(e.target.value as ImportKind); setPreview(null); setApproved(false); }}><option value="people">People</option><option value="locations">Locations</option></select></label><button type="button" className="button quiet" onClick={() => downloadBlob(new Blob([csvTemplate(kind)], { type: "text/csv;charset=utf-8" }), "sendme-" + kind + "-import-template.csv")}><FileSpreadsheet size={16} /> Download template</button></div></li>
              <li><div><strong>Choose a completed CSV</strong><span>The file is previewed on this screen before any records are added.</span></div><label className="data-file-field"><span>UTF-8 CSV file</span><input type="file" accept="text/csv,.csv" disabled={action.busy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void action.run(async () => {
                if (file.size > 2 * 1024 * 1024) throw new Error("CSV files must be smaller than 2 MB.");
                const next = previewCsv(await file.text(), kind, data); setPreview(next); setPreviewRevision(data.sync.serverRevision ?? 0); setSelected([]); setApproved(false);
              }); }} /></label></li>
              {preview && <li><div><strong>Review and approve the rows</strong><span>Nothing has been imported yet.</span></div><div className="data-preview-table"><table><caption>Review each row. Nothing has been imported.</caption><thead><tr><th scope="col">Include</th><th scope="col">Record</th><th scope="col">Review</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.line}><td><input type="checkbox" aria-label={"Import CSV row " + row.line} disabled={Boolean(row.problems.length)} checked={selected.includes(row.line)} onChange={(e) => setSelected((lines) => e.target.checked ? [...lines, row.line] : lines.filter((n) => n !== row.line))} /></td><td><strong>Row {row.line} · {row.values.name ?? row.values.address}</strong><dl>{Object.entries(row.values).filter(([key]) => !["name", "address"].includes(key)).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{value || "Not provided"}</dd></div>)}</dl></td><td>{row.problems.join(" ") || "Valid — select if intended"}</td></tr>)}</tbody></table></div>
                <label className="checkbox-label"><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> I reviewed the selected rows and have authority to store these details. “Requested” means a real neighbor request, not assumed consent.</label>
                <button type="button" className="button primary" disabled={blocked || !approved || !selected.length} onClick={() => void run(() => onRun({ action: "import", expectedRevision: previewRevision, operations: csvImportOperations(preview, selected) }), () => { setMessage("Selected records imported and confirmed by the church server."); setPreview(null); setSelected([]); setApproved(false); })}>Import {selected.length} reviewed records</button></li>}
            </ol>
          </div>
        </details>
        <details className="data-tool-card">
          <summary role="button"><span className="data-tool-icon"><GitMerge size={21} /></span><span><strong>Correct records</strong><small>Combine duplicates, correct an encounter, or resolve older data flags.</small></span>{migrationIssueCount > 0 && <b className="data-tool-count">{migrationIssueCount}</b>}<ChevronDown className="data-tool-chevron" size={19} /></summary>
          <div className="data-tool-body data-correction-tools">
            <details className="data-subtool-card"><summary role="button"><span><strong>Combine duplicate records</strong><small>Preserve one person or location as history and keep the other current.</small></span><ChevronDown size={17} /></summary><DuplicateReview data={data} blocked={blocked} error={action.error} onPreview={props.onPreviewDuplicates} onRun={onRun} onAction={run} /></details>
            <details className="data-subtool-card"><summary role="button"><span><strong>Correct an encounter</strong><small>Append a factual correction while preserving the original entry.</small></span><ChevronDown size={17} /></summary><EncounterCorrectionReview data={data} blocked={blocked} error={action.error} onRun={onRun} onAction={run} /></details>
            <details className="data-subtool-card"><summary role="button"><span><strong>Review older data flags</strong><small>{migrationIssueCount ? `${migrationIssueCount} ${migrationIssueCount === 1 ? "flag needs" : "flags need"} review.` : "No unresolved flags are visible."}</small></span><ChevronDown size={17} /></summary><section className="data-migration-panel" aria-labelledby="historical-data-title"><h3 id="historical-data-title"><History size={19} /> Historical data needing review</h3><p>Original records remain preserved. Resolving a flag records your review; it does not automatically repair links or change responsibility.</p>
              {(data.migrationIssues ?? []).map((issue) => <IssueReview key={issue.entityType + issue.entityId + issue.issue} issue={issue} blocked={blocked} onOpen={() => issue.entityType === "person" ? props.onOpenPerson(issue.entityId) : props.onOpenLocation(issue.entityId)} onSave={(reason) => run(() => onRun({ action: "review_migration_issue", expectedRevision: data.sync.serverRevision ?? 0, ...issue, reason }))} />)}
              {!data.migrationIssues?.length && <p className="data-empty-note">You’re all caught up. There are no older data flags to review.</p>}
            </section></details>
          </div>
        </details>
        <details className="data-tool-card">
          <summary role="button"><span className="data-tool-icon"><Archive size={21} /></span><span><strong>Archive older records</strong><small>Preview records covered by your church’s {data.church.retentionDays}-day policy.</small></span><ChevronDown className="data-tool-chevron" size={19} /></summary>
          <div className="data-tool-body">
            <h3>Preview before anything is archived</h3><p>This tool only finds old anonymous encounters without retained task links and old resolved, non-person tasks without retained next steps.</p>
            <details className="data-help-details"><summary role="button">What stays protected?</summary><p>Open responsibilities, people, private notes, and contact restrictions are preserved. Archiving removes eligible records from active use; it is not permanent erasure. Stored private records and backups still require a church-approved deletion policy and supervised erasure process.</p></details>
            <button type="button" className="button quiet" disabled={blocked} onClick={() => void run(async () => { setRetention(await onPreviewRetention()); setConfirmation(""); })}>Preview eligible records</button>
            {retention && <div className="data-retention-preview"><p><strong>{retention.encounterCount} anonymous encounters</strong> and <strong>{retention.taskCount} resolved tasks</strong> are eligible before {new Date(retention.cutoff).toLocaleDateString()}.</p><details className="data-help-details"><summary role="button">Exact reviewed record identifiers</summary><pre>{JSON.stringify({ encounters: retention.encounters, tasks: retention.tasks }, null, 2)}</pre></details><label className="form-field"><span>Type ARCHIVE REVIEWED after checking the preview</span><input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label><button type="button" className="button quiet" disabled={blocked || confirmation !== "ARCHIVE REVIEWED" || !(retention.taskCount + retention.encounterCount)} onClick={() => void run(() => onRun({ action: "retention_archive", expectedRevision: retention.revision, reviewToken: retention.token, confirmation }), () => { setRetention(null); setMessage("Reviewed records archived. Open responsibilities and restrictions were preserved."); })}>Archive exactly the reviewed records</button></div>}
          </div>
        </details>
      </div>
    </section>
  </section>;
}
function IssueReview({ issue, blocked, onOpen, onSave }: { issue: NonNullable<NeighborWalkData["migrationIssues"]>[number]; blocked: boolean; onOpen: () => void; onSave: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState("");
  return <form className="form-stack migration-review" onSubmit={(e) => { e.preventDefault(); void onSave(reason); }}><strong>{issue.entityType} · {issue.entityId}</strong><p>{issue.issue.replaceAll("_", " ")}</p>{["person", "property", "location"].includes(issue.entityType) && <button type="button" className="button quiet" onClick={onOpen}>Open record</button>}<label>What did you review or correct?<textarea required minLength={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></label><button className="button quiet" disabled={blocked || reason.trim().length < 3}>Record review and resolve flag</button></form>;
}
