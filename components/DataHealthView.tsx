"use client";
import { Database, Download, ShieldCheck } from "lucide-react";
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
  return <section className="content-view data-health-view">
    <ViewHeading eyebrow="Church stewardship" title="Data & health" description="Review what is being kept, who is responsible, and what a bulk action will change. No background process silently deletes care records." />
    <section className="today-card"><h2><ShieldCheck size={24} /> Confirm sensitive administration</h2><p>CSV import/export, record archival, and historical-data review require a live leader membership and a sign-in within the last 15 minutes. Token refresh does not count.</p>
      <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action.run(() => onAuthenticate(password), () => { setPassword(""); setMessage("Sign-in confirmed. Sensitive actions remain checked by the server."); }); }}><label>Current password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label><button className="button quiet" disabled={!online || action.busy}>Confirm my sign-in</button></form>
      <p>Using a sign-in provider or email link? Share your pending work, sign out safely, and sign in again. Never send your password to support.</p>
      <button className="button quiet" disabled={!online || action.busy} onClick={() => void run(async () => { if (!await onRefresh()) throw new Error("Refresh did not finish. Check Sync & recovery."); setMessage("Shared records refreshed."); })}>Refresh shared records</button>
    </section>
    {pending && <section className="today-card"><h2>Preserved administration request</h2><p>{String(pending.request.action).replaceAll("_", " ")} · saved {new Date(pending.savedAt).toLocaleString()}</p><p>A previous response may have been interrupted. Retry the same immutable request to retrieve its receipt. If the server rejected it, refresh and review the shared records before starting a revised action.</p>
      <div className="care-next-actions"><button className="button primary" disabled={!online || action.busy} onClick={() => void run(() => onRun(null), () => setMessage("The preserved request was confirmed. Records were refreshed. Export requests can now be prepared again for download."))}>Retry preserved request</button>
        <button className="button quiet" disabled={!online || action.busy} onClick={() => { if (window.confirm("Have you reviewed the shared records and this request’s outcome? Preserve this original in device history without resubmitting it. This does not undo any server changes.")) void run(onReviewPending, () => setMessage("Original request preserved in device history. No undo or repeated action was performed.")); }}>I reviewed the outcome; preserve without resubmitting</button></div>
    </section>}
    <section className="today-card"><h2><Database size={24} /> Exchange only what is useful</h2><p>CSV exports omit conversation notes, faith/pathway fields, and authentication data. They are exchange files, not database backups or directly reimportable templates. Spreadsheet formula-like cells are exported as literal text.</p>
      <div className="care-next-actions">{(["people", "locations", "tasks", "backup"] as const).map((type) => <button key={type} className="button quiet" disabled={blocked} onClick={() => void run(() => onExport(type), () => setMessage("Export prepared and download requested. Keep the file private; this is not a managed database backup."))}><Download size={16} /> {type === "backup" ? "Accessible-record JSON" : type + " CSV"}</button>)}</div>
      <p>JSON includes accessible care records. It excludes authentication, provider settings, reference parcels, and separately stored guides. Restore requires a supervised review; there is no bulk overwrite button.</p>
    </section>
    <section className="today-card"><h2>Reviewed CSV import</h2><p>Up to 100 records and 2 MB per file. Creates new records only. Possible duplicates are skipped for separate review, never automatically merged. People start under your care with no additional sharing; locations start without a map or list.</p>
      <div className="list-toolbar"><label>Import kind<select value={kind} onChange={(e) => { setKind(e.target.value as ImportKind); setPreview(null); setApproved(false); }}><option value="people">People</option><option value="locations">Locations</option></select></label><button className="button quiet" onClick={() => downloadBlob(new Blob([csvTemplate(kind)], { type: "text/csv;charset=utf-8" }), "neighborwalk-" + kind + "-import-template.csv")}>Download empty template</button></div>
      <label className="form-field"><span>Choose UTF-8 CSV to preview</span><input type="file" accept="text/csv,.csv" disabled={action.busy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void action.run(async () => {
        if (file.size > 2 * 1024 * 1024) throw new Error("CSV files must be smaller than 2 MB.");
        const next = previewCsv(await file.text(), kind, data); setPreview(next); setPreviewRevision(data.sync.serverRevision ?? 0); setSelected([]); setApproved(false);
      }); }} /></label>
      {preview && <><div className="data-preview-table"><table><caption>Review each row. Nothing has been imported.</caption><thead><tr><th scope="col">Include</th><th scope="col">Record</th><th scope="col">Review</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.line}><td><input type="checkbox" aria-label={"Import CSV row " + row.line} disabled={Boolean(row.problems.length)} checked={selected.includes(row.line)} onChange={(e) => setSelected((lines) => e.target.checked ? [...lines, row.line] : lines.filter((n) => n !== row.line))} /></td><td><strong>Row {row.line} · {row.values.name ?? row.values.address}</strong><dl>{Object.entries(row.values).filter(([key]) => !["name", "address"].includes(key)).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{value || "Not provided"}</dd></div>)}</dl></td><td>{row.problems.join(" ") || "Valid — select if intended"}</td></tr>)}</tbody></table></div>
        <label className="checkbox-label"><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> I reviewed the selected rows and have authority to store these details. “Requested” means a real neighbor request, not assumed consent.</label>
        <button className="button primary" disabled={blocked || !approved || !selected.length} onClick={() => void run(() => onRun({ action: "import", expectedRevision: previewRevision, operations: csvImportOperations(preview, selected) }), () => { setMessage("Selected records imported and confirmed by the church server."); setPreview(null); setSelected([]); setApproved(false); })}>Import {selected.length} reviewed records</button>
      </>}
    </section>
    <section className="today-card"><h2>Review older outreach records</h2><p>The current threshold is {data.church.retentionDays} days. This action archives only old anonymous encounters without retained task links and old resolved, non-person tasks without retained next steps. Open responsibilities, people, private notes, and restrictions are preserved.</p><p>Archival removes records from active use; it is not permanent erasure. A church-approved deletion policy and supervised erasure process are still required for stored private records and backups.</p>
      <button className="button quiet" disabled={blocked} onClick={() => void run(async () => { setRetention(await onPreviewRetention()); setConfirmation(""); })}>Preview eligible records</button>
      {retention && <><p>{retention.encounterCount} anonymous encounters and {retention.taskCount} resolved tasks are eligible before {new Date(retention.cutoff).toLocaleDateString()}.</p><details><summary>Exact reviewed record identifiers</summary><pre>{JSON.stringify({ encounters: retention.encounters, tasks: retention.tasks }, null, 2)}</pre></details><label className="form-field"><span>Type ARCHIVE REVIEWED after checking the preview</span><input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label><button className="button quiet" disabled={blocked || confirmation !== "ARCHIVE REVIEWED" || !(retention.taskCount + retention.encounterCount)} onClick={() => void run(() => onRun({ action: "retention_archive", expectedRevision: retention.revision, reviewToken: retention.token, confirmation }), () => { setRetention(null); setMessage("Reviewed records archived. Open responsibilities and restrictions were preserved."); })}>Archive exactly the reviewed records</button></>}
    </section>
    <DuplicateReview data={data} blocked={blocked} error={action.error} onPreview={props.onPreviewDuplicates} onRun={onRun} onAction={run} />
    <EncounterCorrectionReview data={data} blocked={blocked} error={action.error} onRun={onRun} onAction={run} />
    <section className="today-card"><h2>Historical data needing review</h2><p>Original records remain preserved. Resolving a flag records your review; it does not automatically repair links or change responsibility.</p>
      {(data.migrationIssues ?? []).map((issue) => <IssueReview key={issue.entityType + issue.entityId + issue.issue} issue={issue} blocked={blocked} onOpen={() => issue.entityType === "person" ? props.onOpenPerson(issue.entityId) : props.onOpenLocation(issue.entityId)} onSave={(reason) => run(() => onRun({ action: "review_migration_issue", expectedRevision: data.sync.serverRevision ?? 0, ...issue, reason }))} />)}
      {!data.migrationIssues?.length && <p>No unresolved migration flags are visible to this leader.</p>}
    </section>
    {message && <p role="status" className="inline-notice">{message}</p>}{action.error && <p role="alert" className="inline-error">{action.error}</p>}
  </section>;
}
function IssueReview({ issue, blocked, onOpen, onSave }: { issue: NonNullable<NeighborWalkData["migrationIssues"]>[number]; blocked: boolean; onOpen: () => void; onSave: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState("");
  return <form className="form-stack migration-review" onSubmit={(e) => { e.preventDefault(); void onSave(reason); }}><strong>{issue.entityType} · {issue.entityId}</strong><p>{issue.issue.replaceAll("_", " ")}</p>{["person", "property", "location"].includes(issue.entityType) && <button type="button" className="button quiet" onClick={onOpen}>Open record</button>}<label>What did you review or correct?<textarea required minLength={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></label><button className="button quiet" disabled={blocked || reason.trim().length < 3}>Record review and resolve flag</button></form>;
}
