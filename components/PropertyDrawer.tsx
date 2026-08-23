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
  Phone,
  Plus,
  Save,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  dateInputValue,
  dueDateFromNow,
  faithStatusLabels,
  faithStatusValues,
  formatDateTime,
  outcomeMeta,
  type FollowUp,
  type NeighborWalkData,
  type Outcome,
  type Property,
  type Resident,
  type ResidentInput,
  type Visit,
} from "../lib/domain";

type VisitInput = {
  propertyId: string;
  outcome: Exclude<Outcome, "unvisited">;
  objectiveNote?: string;
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
  onUpsertResident,
  onDeleteResident,
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
  onUpsertResident: (propertyId: string, input: ResidentInput, residentId?: string) => void;
  onDeleteResident: (residentId: string) => void;
}) {
  const [tab, setTab] = useState<"record" | "people" | "history">("record");
  const [outcome, setOutcome] = useState<Exclude<Outcome, "unvisited">>("conversation");
  const [note, setNote] = useState("");
  const [followUpDate, setFollowUpDate] = useState(dateInputValue(dueDateFromNow(data.church.defaultFollowUpDays)));
  const [assignedTeamId, setAssignedTeamId] = useState(property.territoryId ? data.territories.find((territory) => territory.id === property.territoryId)?.assignedTeamId ?? "" : "");
  const [editingAddress, setEditingAddress] = useState(property.address === "Confirm this address");
  const [address, setAddress] = useState(property.address);
  const [unit, setUnit] = useState(property.unit ?? "");
  const [editingResident, setEditingResident] = useState<Resident | "new" | null>(null);
  const residents = data.residents.filter((resident) => resident.propertyId === property.id);

  const noteRemaining = data.church.noteCharacterLimit - note.length;
  const canSave = address.trim().length > 2
    && noteRemaining >= 0
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
      followUpDate: outcome === "follow_up" ? followUpDate : undefined,
      assignedTeamId: outcome === "follow_up" ? assignedTeamId || undefined : undefined,
    });
    onClose();
  };

  const markDoNotVisit = () => {
    if (!window.confirm("Mark this location as do not revisit? This status stays visible even after ordinary visit records expire.")) return;
    onRecordVisit({ propertyId: property.id, outcome: "do_not_visit" });
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
        <button role="tab" aria-selected={tab === "people"} className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}><Users size={15} /> People <span>{residents.length}</span></button>
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
                  onClick={() => setOutcome(value)}
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
      ) : tab === "history" ? (
        <div className="history-list" role="tabpanel">
          {visits.length ? visits.map((visit) => (
            <VisitHistoryItem visit={visit} volunteerName={volunteerNames.get(visit.volunteerId) ?? "Volunteer"} key={visit.id} />
          )) : (
            <div className="empty-mini"><History size={21} /><strong>No visit history</strong><span>The first saved visit will appear here.</span></div>
          )}
        </div>
      ) : (
        <div className="people-panel" role="tabpanel">
          {editingResident ? (
            <ResidentForm
              resident={editingResident === "new" ? undefined : editingResident}
              noteLimit={data.church.noteCharacterLimit}
              onCancel={() => setEditingResident(null)}
              onSave={(input) => {
                onUpsertResident(property.id, input, editingResident === "new" ? undefined : editingResident.id);
                setEditingResident(null);
              }}
            />
          ) : (
            <>
              <button className="button primary people-add" onClick={() => setEditingResident("new")}><UserRound size={16} /> Add person</button>
              <div className="resident-list">
                {residents.map((resident) => (
                  <article className="resident-card" key={resident.id}>
                    <span className="resident-avatar">{resident.name?.charAt(0).toUpperCase() || <UserRound size={17} />}</span>
                    <div>
                      <strong>{resident.name || "Name not provided"}</strong>
                      <small>{faithStatusLabels[resident.faithStatus]}</small>
                      {(resident.phone || resident.email) && <p><Phone size={12} /> {resident.preferredContact === "none" ? "Contact details saved" : `Prefers ${resident.preferredContact}`}</p>}
                    </div>
                    <button className="button quiet small" onClick={() => setEditingResident(resident)}>Edit</button>
                    <button className="small-icon-button danger" aria-label={`Delete ${resident.name || "person record"}`} onClick={() => {
                      if (window.confirm("Delete this person record? This cannot be undone.")) onDeleteResident(resident.id);
                    }}><Trash2 size={14} /></button>
                  </article>
                ))}
                {!residents.length && <div className="empty-mini"><Users size={21} /><strong>No people added</strong></div>}
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function ResidentForm({ resident, noteLimit, onCancel, onSave }: {
  resident?: Resident;
  noteLimit: number;
  onCancel: () => void;
  onSave: (input: ResidentInput) => void;
}) {
  const [name, setName] = useState(resident?.name ?? "");
  const [faithStatus, setFaithStatus] = useState(resident?.faithStatus ?? "not_discussed");
  const [notes, setNotes] = useState(resident?.notes ?? "");
  const [phone, setPhone] = useState(resident?.phone ?? "");
  const [email, setEmail] = useState(resident?.email ?? "");
  const [preferredContact, setPreferredContact] = useState(resident?.preferredContact ?? "none");
  const contactMethodValid = preferredContact === "email" ? Boolean(email.trim())
    : preferredContact === "text" || preferredContact === "call" ? Boolean(phone.trim()) : true;
  const canSave = notes.length <= noteLimit && contactMethodValid;

  return (
    <div className="resident-form">
      <div className="form-stack">
        <label className="form-field"><span>Name <small>Optional</small></span><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Only if they choose to share it" /></label>
        <label className="form-field"><span>Faith status <small>Self-described only</small></span><select value={faithStatus} onChange={(event) => setFaithStatus(event.target.value as Resident["faithStatus"])}>{faithStatusValues.map((value) => <option value={value} key={value}>{faithStatusLabels[value]}</option>)}</select></label>
        <label className="form-field"><span>Objective note <small>Optional</small></span><textarea rows={2} maxLength={noteLimit + 1} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Record only what helps honor their request." /><em className={notes.length > noteLimit ? "over" : ""}>{noteLimit - notes.length} characters remaining</em></label>
      </div>
      <div className="contact-fields">
        <label className="form-field"><span>Phone <small>Optional</small></span><input inputMode="tel" autoComplete="off" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
        <label className="form-field"><span>Email <small>Optional</small></span><input type="email" inputMode="email" autoComplete="off" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="form-field"><span>Preferred contact</span><select value={preferredContact} onChange={(event) => setPreferredContact(event.target.value as Resident["preferredContact"])}><option value="none">No preference</option><option value="text">Text message</option><option value="call">Phone call</option><option value="email">Email</option></select></label>
      </div>
      {!contactMethodValid && <p className="form-warning">Enter the phone number or email needed for the selected contact method.</p>}
      <div className="modal-actions"><button className="button quiet" onClick={onCancel}>Cancel</button><button className="button primary" disabled={!canSave} onClick={() => onSave({
        name: name.trim() || undefined,
        faithStatus,
        notes: notes.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        preferredContact,
      })}><Save size={15} /> Save person</button></div>
    </div>
  );
}

function VisitHistoryItem({ visit, volunteerName }: { visit: Visit; volunteerName: string }) {
  return (
    <article className="history-item">
      <i data-outcome={visit.outcome} />
      <div>
        <div><strong>{outcomeMeta[visit.outcome].label}</strong><span><Clock3 size={12} /> {formatDateTime(visit.recordedAt)}</span></div>
        {visit.objectiveNote && <p>{visit.objectiveNote}</p>}
        <small>Recorded by {volunteerName}</small>
      </div>
    </article>
  );
}
