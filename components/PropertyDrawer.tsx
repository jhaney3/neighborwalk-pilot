"use client";

import {
  AlertOctagon,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  History,
  MapPin,
  PencilLine,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  dateInputValue,
  dueDateFromNow,
  formatDateTime,
  outcomeMeta,
  type FollowUp,
  type NeighborWalkData,
  type Outcome,
  type Property,
  type Visit,
} from "../lib/domain";

type VisitInput = {
  propertyId: string;
  outcome: Exclude<Outcome, "unvisited">;
  objectiveNote?: string;
  followUpConsent: boolean;
  followUpDate?: string;
  assignedTeamId?: string;
};

const recordableOutcomes: Exclude<Outcome, "unvisited">[] = [
  "no_answer",
  "conversation",
  "follow_up",
  "declined",
  "inaccessible",
];

export function PropertyDrawer({
  property,
  parcelDwellings,
  data,
  visits,
  openFollowUp,
  canManage,
  onClose,
  onViewParcel,
  onAddDwelling,
  onRecordVisit,
  onUpdateProperty,
  onDeleteProperty,
}: {
  property: Property;
  parcelDwellings: Property[];
  data: NeighborWalkData;
  visits: Visit[];
  openFollowUp?: FollowUp;
  canManage: boolean;
  onClose: () => void;
  onViewParcel?: () => void;
  onAddDwelling?: () => void;
  onRecordVisit: (input: VisitInput) => void;
  onUpdateProperty: (propertyId: string, patch: Pick<Property, "address" | "unit">) => void;
  onDeleteProperty: (propertyId: string) => void;
}) {
  const [tab, setTab] = useState<"record" | "history">("record");
  const [outcome, setOutcome] = useState<Exclude<Outcome, "unvisited">>("conversation");
  const [note, setNote] = useState("");
  const [followUpConsent, setFollowUpConsent] = useState(false);
  const [followUpDate, setFollowUpDate] = useState(dateInputValue(dueDateFromNow(data.church.defaultFollowUpDays)));
  const [assignedTeamId, setAssignedTeamId] = useState(property.territoryId ? data.territories.find((territory) => territory.id === property.territoryId)?.assignedTeamId ?? "" : "");
  const [editingAddress, setEditingAddress] = useState(property.address === "Confirm this address");
  const [address, setAddress] = useState(property.address);
  const [unit, setUnit] = useState(property.unit ?? "");

  const noteRemaining = data.church.noteCharacterLimit - note.length;
  const canSave = address.trim().length > 2
    && noteRemaining >= 0
    && (outcome !== "follow_up" || !data.church.requireFollowUpConsent || followUpConsent)
    && (outcome !== "follow_up" || Boolean(followUpDate));

  const volunteerNames = useMemo(() => new Map(data.volunteers.map((volunteer) => [volunteer.id, volunteer.name])), [data.volunteers]);

  const saveVisit = () => {
    if (!canSave) return;
    if (address.trim() !== property.address || unit.trim() !== (property.unit ?? "")) {
      onUpdateProperty(property.id, { address, unit });
    }
    onRecordVisit({
      propertyId: property.id,
      outcome,
      objectiveNote: note,
      followUpConsent: outcome === "follow_up" ? followUpConsent : false,
      followUpDate: outcome === "follow_up" ? followUpDate : undefined,
      assignedTeamId: outcome === "follow_up" ? assignedTeamId || undefined : undefined,
    });
    onClose();
  };

  const markDoNotVisit = () => {
    if (!window.confirm("Mark this location as do not revisit? This status stays visible even after ordinary visit records expire.")) return;
    onRecordVisit({ propertyId: property.id, outcome: "do_not_visit", followUpConsent: false });
    onClose();
  };

  return (
    <aside className="property-drawer" aria-label={`Location details for ${property.address}`}>
      <div className="drawer-handle" aria-hidden="true" />
      <div className="drawer-heading">
        <div className="property-symbol"><MapPin size={19} /></div>
        <div className="drawer-address">
          <span className="status-label" data-outcome={property.currentOutcome}>{outcomeMeta[property.currentOutcome].label}</span>
          {editingAddress ? (
            <div className="address-edit-row">
              <input value={address} onChange={(event) => setAddress(event.target.value)} aria-label="Street address" />
              <input value={unit} onChange={(event) => setUnit(event.target.value)} aria-label="Dwelling label or unit" placeholder="Unit or label" />
              <button className="small-icon-button" onClick={() => setEditingAddress(false)} aria-label="Finish editing address"><Check size={16} /></button>
            </div>
          ) : (
            <button className="address-button" onClick={() => setEditingAddress(true)}>
              <strong>{property.address}{property.unit ? ` · ${property.unit}` : ""}</strong><PencilLine size={13} />
            </button>
          )}
          <small>{property.visitCount ? `${property.visitCount} visit${property.visitCount === 1 ? "" : "s"} recorded` : "No visits recorded"}</small>
        </div>
        <button className="close-button" onClick={onClose} aria-label="Close location details"><X size={19} /></button>
      </div>

      {property.parcel && parcelDwellings.length > 0 && (
        <div className="drawer-parcel-row">
          <button onClick={onViewParcel} disabled={!onViewParcel}>
            <Building2 size={17} />
            <span><strong>{parcelDwellings.length} {parcelDwellings.length === 1 ? "dwelling" : "dwellings"} on this parcel</strong><small>View every doorstep and its visit status</small></span>
            <ChevronRight size={16} />
          </button>
          {onAddDwelling && <button className="drawer-add-dwelling" onClick={onAddDwelling} aria-label="Add another dwelling to this parcel"><Plus size={16} /></button>}
        </div>
      )}

      {property.currentOutcome === "do_not_visit" && (
        <div className="do-not-visit-banner"><AlertOctagon size={17} /><span><strong>Do not approach this location</strong>The resident’s preference should be honored.</span></div>
      )}

      {openFollowUp && (
        <div className="drawer-followup-banner"><CalendarClock size={16} /><span><strong>Return visit scheduled</strong>{formatDateTime(openFollowUp.dueAt, { weekday: "short", month: "short", day: "numeric" })}</span></div>
      )}

      <div className="drawer-tabs" role="tablist" aria-label="Location record sections">
        <button role="tab" aria-selected={tab === "record"} className={tab === "record" ? "active" : ""} onClick={() => setTab("record")}><ClipboardList size={15} /> Record visit</button>
        <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><History size={15} /> History <span>{visits.length}</span></button>
      </div>

      {tab === "record" ? (
        <div className="drawer-record" role="tabpanel">
          <fieldset className="outcome-fieldset">
            <legend>What happened?</legend>
            <div className="outcome-options">
              {recordableOutcomes.map((value) => (
                <button
                  type="button"
                  key={value}
                  className={outcome === value ? "active" : ""}
                  data-outcome={value}
                  onClick={() => {
                    setOutcome(value);
                    if (value !== "follow_up") setFollowUpConsent(false);
                  }}
                >
                  <i />
                  <span>{outcomeMeta[value].short}</span>
                </button>
              ))}
            </div>
            <p>{outcomeMeta[outcome].description}</p>
          </fieldset>

          <label className="form-field">
            <span>Brief, objective note <small>Optional</small></span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={data.church.noteCharacterLimit + 1}
              placeholder="Only record what the next volunteer needs to know."
            />
            <em className={noteRemaining < 0 ? "over" : ""}>{noteRemaining} characters remaining</em>
          </label>

          {outcome === "follow_up" && (
            <div className="followup-form">
              <label className="consent-check">
                <input type="checkbox" checked={followUpConsent} onChange={(event) => setFollowUpConsent(event.target.checked)} />
                <span><ShieldCheck size={16} /><strong>Permission received</strong>The person clearly agreed to another visit.</span>
              </label>
              <div className="form-row">
                <label className="form-field">
                  <span>Return date</span>
                  <input type="date" min={new Date().toISOString().slice(0, 10)} value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
                </label>
                <label className="form-field">
                  <span>Assign team</span>
                  <div className="select-wrap"><select value={assignedTeamId} onChange={(event) => setAssignedTeamId(event.target.value)}><option value="">Unassigned</option>{data.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select><ChevronDown size={15} /></div>
                </label>
              </div>
            </div>
          )}

          {outcome === "follow_up" && data.church.requireFollowUpConsent && !followUpConsent && (
            <p className="form-warning">Confirm permission before scheduling a follow-up.</p>
          )}

          <div className="drawer-actions">
            <button className="text-danger" onClick={markDoNotVisit}><AlertOctagon size={14} /> Do not revisit</button>
            <button className="button primary" onClick={saveVisit} disabled={!canSave}><Save size={16} /> Save visit</button>
          </div>

          {canManage && property.visitCount === 0 && property.source !== "seed" && (
            <button className="delete-location" onClick={() => {
              if (window.confirm("Remove this unvisited location from the territory?")) {
                onDeleteProperty(property.id);
                onClose();
              }
            }}><Trash2 size={14} /> Remove unvisited location</button>
          )}
        </div>
      ) : (
        <div className="history-list" role="tabpanel">
          {visits.length ? visits.map((visit) => (
            <VisitHistoryItem visit={visit} volunteerName={volunteerNames.get(visit.volunteerId) ?? "Volunteer"} key={visit.id} />
          )) : (
            <div className="empty-mini"><History size={21} /><strong>No visit history</strong><span>The first saved visit will appear here.</span></div>
          )}
        </div>
      )}
    </aside>
  );
}

function VisitHistoryItem({ visit, volunteerName }: { visit: Visit; volunteerName: string }) {
  return (
    <article className="history-item">
      <i data-outcome={visit.outcome} />
      <div>
        <div><strong>{outcomeMeta[visit.outcome].label}</strong><span><Clock3 size={12} /> {formatDateTime(visit.recordedAt)}</span></div>
        {visit.objectiveNote && <p>{visit.objectiveNote}</p>}
        <small>Recorded by {volunteerName}{visit.followUpConsent ? " · Follow-up permission confirmed" : ""}</small>
      </div>
    </article>
  );
}
