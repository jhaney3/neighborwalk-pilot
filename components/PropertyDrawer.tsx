"use client";

import {
  AlertOctagon,
  ArrowRight,
  BookOpenText,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  History,
  MapPin,
  MessageCircle,
  PencilLine,
  Phone,
  Plus,
  Save,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  dateInputValue,
  discipleshipStageLabels,
  discipleshipStageValues,
  dueDateFromNow,
  faithStatusLabels,
  faithStatusValues,
  formatDateTime,
  outcomeMeta,
  type FollowUp,
  type ConversationGuide,
  type NeighborWalkData,
  type Outcome,
  type Property,
  type Resident,
  type ResidentInput,
  type Visit,
} from "../lib/domain";
import { ScriptureReader } from "./ScriptureReader";

type VisitInput = {
  propertyId: string;
  outcome: Exclude<Outcome, "unvisited">;
  objectiveNote?: string;
  followUpDate?: string;
  assignedTeamId?: string;
  residentId?: string;
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
  conversationGuide,
  conversationGuideContext,
  canManage,
  activeVolunteerId,
  startGuided = false,
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
  conversationGuide?: ConversationGuide;
  conversationGuideContext?: string;
  canManage: boolean;
  activeVolunteerId: string;
  startGuided?: boolean;
  onClose: () => void;
  onViewParcel?: () => void;
  onAddDwelling?: () => void;
  onRecordVisit: (input: VisitInput) => void;
  onUpdateProperty: (propertyId: string, patch: Pick<Property, "address" | "unit">) => void;
  onDeleteProperty: (propertyId: string) => void;
  onUpsertResident: (propertyId: string, input: ResidentInput, residentId?: string) => string;
  onDeleteResident: (residentId: string) => void;
}) {
  const [tab, setTab] = useState<"record" | "people" | "history">("record");
  const guideSteps = useMemo(() => [...(conversationGuide?.steps ?? [])].sort((first, second) => first.order - second.order), [conversationGuide]);
  const [workflowStage, setWorkflowStage] = useState<"record" | "guide" | "name">(
    startGuided && guideSteps.length ? "guide" : "record",
  );
  const [guideIndex, setGuideIndex] = useState(0);
  const [guidedPersonEntry, setGuidedPersonEntry] = useState(false);
  const [workflowNotice, setWorkflowNotice] = useState("");
  const [outcome, setOutcome] = useState<Exclude<Outcome, "unvisited">>("conversation");
  const [note, setNote] = useState("");
  const [followUpDate, setFollowUpDate] = useState(dateInputValue(dueDateFromNow(data.church.defaultFollowUpDays)));
  const [assignedTeamId, setAssignedTeamId] = useState(property.territoryId ? data.territories.find((territory) => territory.id === property.territoryId)?.assignedTeamId ?? "" : "");
  const [linkedResidentId, setLinkedResidentId] = useState("");
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

  const beginGuide = () => {
    setGuideIndex(0);
    setWorkflowNotice("");
    setWorkflowStage("guide");
    setTab("record");
  };

  const continueToPerson = () => {
    setGuidedPersonEntry(true);
    setEditingResident("new");
    setTab("people");
  };

  const finishGuidedPersonEntry = (message: string) => {
    setEditingResident(null);
    setGuidedPersonEntry(false);
    setWorkflowStage("record");
    setWorkflowNotice(message);
    setTab("record");
  };

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
      assignedTeamId: outcome === "follow_up" && !linkedResidentId ? assignedTeamId || undefined : undefined,
      residentId: outcome === "follow_up" ? linkedResidentId || undefined : undefined,
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
          {workflowStage === "guide" && guideSteps.length ? (
            <GuidedConversation
              guideTitle={conversationGuide?.title ?? "Conversation guide"}
              guideContext={conversationGuideContext}
              steps={guideSteps}
              index={guideIndex}
              onChangeIndex={setGuideIndex}
              onFinish={() => setWorkflowStage("name")}
              onRecordWithoutGuide={() => setWorkflowStage("record")}
            />
          ) : workflowStage === "name" ? (
            <NamePrompt
              onBack={() => setWorkflowStage("guide")}
              onAddPerson={continueToPerson}
              onSkip={() => {
                setWorkflowStage("record");
                setWorkflowNotice("Name skipped — record what happened at this door.");
              }}
            />
          ) : (
            <>
          {workflowNotice && <div className="workflow-notice" role="status"><Check size={15} /><span>{workflowNotice}</span></div>}
          {guideSteps.length > 0 && (
            <button className="guided-entry-card" type="button" onClick={beginGuide}>
              <span><BookOpenText size={17} /></span>
              <span><strong>Need a prompt?</strong><small>{conversationGuideContext ? `${conversationGuideContext} · ` : ""}Open {conversationGuide?.title ?? "your favorite guide"} at step one.</small></span>
              <ChevronRight size={16} />
            </button>
          )}
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
            <span>Visit note <small>Optional · saved only in visit history</small></span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={data.church.noteCharacterLimit + 1}
              placeholder="A brief fact about this visit—not a person care note."
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
                  <span>Who is this for? <small>Optional</small></span>
                  <div className="select-wrap"><select value={linkedResidentId} onChange={(event) => setLinkedResidentId(event.target.value)}><option value="">Location follow-up</option>{residents.map((resident) => <option value={resident.id} key={resident.id}>{resident.name || "Name not provided"}</option>)}</select><ChevronDown size={15} /></div>
                </label>
                {!linkedResidentId && <label className="form-field">
                  <span>Assign team</span>
                  <div className="select-wrap"><select value={assignedTeamId} onChange={(event) => setAssignedTeamId(event.target.value)}><option value="">Unassigned</option>{data.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select><ChevronDown size={15} /></div>
                </label>}
              </div>
              <small className="followup-link-help">{linkedResidentId ? "This task will stay private with the person and follow their discipleship owner." : "Location follow-ups remain visible to the assigned outreach team."}</small>
            </div>
          )}

          <div className="drawer-actions">
            <button className="text-danger" onClick={markDoNotVisit}><AlertOctagon size={14} /> Do not revisit</button>
            <button className="button primary" onClick={saveVisit} disabled={!canSave}><Save size={16} /> Save visit</button>
          </div>

          {canManage && property.visitCount === 0 && property.source !== "seed" && residents.length === 0 && (
            <button className="delete-location" onClick={() => {
              if (window.confirm("Remove this unvisited location from the territory?")) {
                onDeleteProperty(property.id);
                onClose();
              }
            }}><Trash2 size={14} /> Remove unvisited location</button>
          )}
            </>
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
              volunteers={data.volunteers.filter((volunteer) => volunteer.active)}
              activeVolunteerId={activeVolunteerId}
              autoFocusName={guidedPersonEntry}
              onCancel={() => {
                if (guidedPersonEntry) finishGuidedPersonEntry("Name skipped — record what happened at this door.");
                else setEditingResident(null);
              }}
              onSave={(input) => {
                const residentId = onUpsertResident(property.id, input, editingResident === "new" ? undefined : editingResident.id);
                if (editingResident === "new") setLinkedResidentId(residentId);
                if (guidedPersonEntry) finishGuidedPersonEntry("Person saved — now record what happened at this door.");
                else setEditingResident(null);
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
                    {(canManage || resident.createdByVolunteerId === activeVolunteerId || resident.assignedVolunteerId === activeVolunteerId) && <button className="button quiet small" onClick={() => setEditingResident(resident)}>Edit</button>}
                    {(canManage || resident.createdByVolunteerId === activeVolunteerId) && <button className="small-icon-button danger" aria-label={`Delete ${resident.name || "person record"}`} onClick={() => {
                      if (window.confirm("Delete this person record? This cannot be undone.")) onDeleteResident(resident.id);
                    }}><Trash2 size={14} /></button>}
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

function GuidedConversation({ guideTitle, guideContext, steps, index, onChangeIndex, onFinish, onRecordWithoutGuide }: {
  guideTitle: string;
  guideContext?: string;
  steps: NeighborWalkData["guide"];
  index: number;
  onChangeIndex: (index: number) => void;
  onFinish: () => void;
  onRecordWithoutGuide: () => void;
}) {
  const step = steps[index];
  if (!step) return null;
  const finalStep = index === steps.length - 1;

  return (
    <section className="doorstep-guide" aria-labelledby="doorstep-guide-title">
      <div className="doorstep-guide-heading">
        <div><p>{guideContext ? `${guideContext} · ` : ""}{guideTitle}</p><h2 id="doorstep-guide-title">{step.title}</h2></div>
        <button type="button" onClick={onRecordWithoutGuide}>Record without guide</button>
      </div>
      <div className="doorstep-progress" aria-label={`Step ${index + 1} of ${steps.length}`}>
        {steps.map((item, itemIndex) => (
          <button
            type="button"
            key={item.id}
            className={itemIndex === index ? "active" : itemIndex < index ? "complete" : ""}
            onClick={() => onChangeIndex(itemIndex)}
            aria-label={`Open step ${itemIndex + 1}: ${item.title}`}
            aria-current={itemIndex === index ? "step" : undefined}
          ><span>{itemIndex + 1}</span></button>
        ))}
      </div>
      {step.sampleWords && <div className="doorstep-script-card">
        <span><MessageCircle size={18} /> Words you can use</span>
        <blockquote>“{step.sampleWords}”</blockquote>
      </div>}
      <ScriptureReader references={step.scriptureReferences} theme="light" />
      <button className="skip-to-wrap" type="button" onClick={onFinish}>Conversation is wrapping up</button>
      <div className="doorstep-guide-actions">
        <button className="button quiet" type="button" disabled={index === 0} onClick={() => onChangeIndex(Math.max(0, index - 1))}>Previous</button>
        <button className="button primary" type="button" onClick={() => finalStep ? onFinish() : onChangeIndex(index + 1)}>
          {finalStep ? "Wrap up" : "Next prompt"} <ArrowRight size={15} />
        </button>
      </div>
    </section>
  );
}

function NamePrompt({ onBack, onAddPerson, onSkip }: { onBack: () => void; onAddPerson: () => void; onSkip: () => void }) {
  return (
    <section className="name-prompt" aria-labelledby="name-prompt-title">
      <div className="name-prompt-mark"><UserRound size={21} /></div>
      <p>Before you leave</p>
      <h2 id="name-prompt-title">Ask their name, if it feels natural.</h2>
      <blockquote>“Before I go, may I ask your first name?”</blockquote>
      <span>Only save what they choose to share. You can skip this and record the visit immediately.</span>
      <div className="name-prompt-actions">
        <button className="button primary" type="button" onClick={onAddPerson}><UserRound size={15} /> Add person details</button>
        <button className="button quiet" type="button" onClick={onSkip}>Skip for now</button>
      </div>
      <button className="name-prompt-back" type="button" onClick={onBack}>Back to the guide</button>
    </section>
  );
}

function ResidentForm({ resident, volunteers, activeVolunteerId, autoFocusName = false, onCancel, onSave }: {
  resident?: Resident;
  volunteers: NeighborWalkData["volunteers"];
  activeVolunteerId: string;
  autoFocusName?: boolean;
  onCancel: () => void;
  onSave: (input: ResidentInput) => void;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(resident?.name ?? "");
  const [faithStatus, setFaithStatus] = useState(resident?.faithStatus ?? "not_discussed");
  const [discipleshipStage, setDiscipleshipStage] = useState(resident?.discipleshipStage ?? "new_connection");
  const [assignedVolunteerId, setAssignedVolunteerId] = useState(resident?.assignedVolunteerId ?? activeVolunteerId);
  const [status, setStatus] = useState(resident?.status ?? "active");
  const [phone, setPhone] = useState(resident?.phone ?? "");
  const [email, setEmail] = useState(resident?.email ?? "");
  const [preferredContact, setPreferredContact] = useState(resident?.preferredContact ?? "none");
  const contactMethodValid = preferredContact === "email" ? Boolean(email.trim())
    : preferredContact === "text" || preferredContact === "call" ? Boolean(phone.trim()) : true;
  const canSave = contactMethodValid;
  const activeOwner = volunteers.find((volunteer) => volunteer.id === activeVolunteerId);

  useEffect(() => {
    if (autoFocusName) nameInputRef.current?.focus();
  }, [autoFocusName]);

  return (
    <div className="resident-form">
      <div className="form-stack">
        <label className="form-field"><span>Name <small>Optional</small></span><input ref={nameInputRef} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Only if they choose to share it" /></label>
        <label className="form-field"><span>Faith status <small>Self-described only</small></span><select value={faithStatus} onChange={(event) => setFaithStatus(event.target.value as Resident["faithStatus"])}>{faithStatusValues.map((value) => <option value={value} key={value}>{faithStatusLabels[value]}</option>)}</select></label>
        {resident ? <label className="form-field"><span>Discipleship owner</span><select value={assignedVolunteerId} onChange={(event) => setAssignedVolunteerId(event.target.value)}>{volunteers.map((volunteer) => <option value={volunteer.id} key={volunteer.id}>{volunteer.name}</option>)}</select></label> : <div className="form-field person-owner-confirmation"><span>Discipleship owner</span><strong><UserRound size={15} /> {activeOwner?.name ?? "You"}</strong><small>You will own this relationship because you are adding it.</small></div>}
        <label className="form-field"><span>Relationship stage</span><select value={discipleshipStage} onChange={(event) => setDiscipleshipStage(event.target.value as Resident["discipleshipStage"])}>{discipleshipStageValues.map((value) => <option value={value} key={value}>{discipleshipStageLabels[value]}</option>)}</select></label>
      </div>
      <div className="contact-fields">
        <label className="form-field"><span>Phone <small>Optional</small></span><input inputMode="tel" autoComplete="off" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
        <label className="form-field"><span>Email <small>Optional</small></span><input type="email" inputMode="email" autoComplete="off" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="form-field"><span>Preferred contact</span><select value={preferredContact} onChange={(event) => setPreferredContact(event.target.value as Resident["preferredContact"])}><option value="none">No preference</option><option value="text">Text message</option><option value="call">Phone call</option><option value="email">Email</option></select></label>
      </div>
      <label className="form-field"><span>Tracking status</span><select value={status} onChange={(event) => setStatus(event.target.value as Resident["status"])}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label>
      {!contactMethodValid && <p className="form-warning">Enter the phone number or email needed for the selected contact method.</p>}
      <div className="modal-actions"><button className="button quiet" onClick={onCancel}>Cancel</button><button className="button primary" disabled={!canSave} onClick={() => onSave({
        name: name.trim() || undefined,
        faithStatus,
        discipleshipStage,
        assignedVolunteerId,
        sharedWithVolunteerIds: resident?.sharedWithVolunteerIds ?? [],
        sharedWithTeamIds: resident?.sharedWithTeamIds ?? [],
        status,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        preferredContact,
        lastContactAt: resident?.lastContactAt,
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
