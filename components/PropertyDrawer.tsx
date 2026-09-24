"use client";
import { useConfirm } from "./ui";
import { reviewedEncounter } from "../lib/encounter-history";
import { calendarDaysFromNow } from "../lib/calendar";

import {
  AlertOctagon,
  ArrowLeft,
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
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { navigateTabs } from "../lib/tab-navigation";
import { contactRestricted } from "../lib/contact-restrictions";
import { useAsyncAction } from "../lib/use-async-action";

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

const addResidentOptionValue = "__add_resident__";

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
  onBack,
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
  onBack?: () => void;
  onClose: () => void;
  onViewParcel?: () => void;
  onAddDwelling?: () => void;
  onRecordVisit: (input: VisitInput) => Promise<unknown>;
  onUpdateProperty: (propertyId: string, patch: Pick<Property, "address" | "unit">) => Promise<unknown>;
  onDeleteProperty: (propertyId: string) => Promise<unknown>;
  onUpsertResident: (propertyId: string, input: ResidentInput, residentId?: string) => Promise<string>;
  onDeleteResident: (residentId: string) => Promise<unknown>;
}) {
  const confirm = useConfirm();
  const drawer = useRef<HTMLDialogElement>(null);
  const action = useAsyncAction();
  useEffect(() => {
    const element = drawer.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    element?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    return () => { element?.close(); previousFocus?.focus({ preventScroll: true }); };
  }, []);
  const requestClose = () => { if (!action.busy && !drawer.current?.querySelector('[aria-busy="true"]')) onClose(); };
  const [tab, setTab] = useState<"record" | "people" | "history">("record");
  const tabsId = useId();
  const sections = ["record", "people", "history"] as const;
  const panelProps = { role: "tabpanel", id: `${tabsId}-panel`, "aria-labelledby": `${tabsId}-${tab}`, tabIndex: 0 };
  const guideSteps = useMemo(() => [...(conversationGuide?.steps ?? [])].sort((first, second) => first.order - second.order), [conversationGuide]);
  const [workflowStage, setWorkflowStage] = useState<"record" | "guide" | "name">(
    startGuided && guideSteps.length ? "guide" : "record",
  );
  const [guideIndex, setGuideIndex] = useState(0);
  const [guidedPersonEntry, setGuidedPersonEntry] = useState(false);
  const [visitPersonEntry, setVisitPersonEntry] = useState(false);
  const [workflowNotice, setWorkflowNotice] = useState("");
  // No outcome is preselected; "No answer" saves in one tap.
  const [outcome, setOutcome] = useState<Exclude<Outcome, "unvisited"> | null>(startGuided && guideSteps.length ? "conversation" : null);
  const choice = outcome ?? "conversation";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [note, setNote] = useState("");
  const [followUpDate, setFollowUpDate] = useState(dateInputValue(dueDateFromNow(data.church.defaultFollowUpDays, data.church.timezone)));
  const [assignedTeamId, setAssignedTeamId] = useState(property.territoryId ? data.territories.find((territory) => territory.id === property.territoryId)?.assignedTeamId ?? "" : "");
  const [linkedResidentId, setLinkedResidentId] = useState("");
  const [editingAddress, setEditingAddress] = useState(property.address === "Confirm this address");
  const [address, setAddress] = useState(property.address);
  const [unit, setUnit] = useState(property.unit ?? "");
  const [editingResident, setEditingResident] = useState<Resident | "new" | null>(null);
  const residents = data.residents.filter((resident) => !resident.mergedIntoId && resident.propertyId === property.id);
  const selectedResident = residents.find((resident) => resident.id === linkedResidentId);
  const followUpRestricted = outcome === "follow_up" && Boolean(selectedResident)
    && contactRestricted(data, selectedResident?.id, "visit", property.id);

  const noteRemaining = data.church.noteCharacterLimit - note.length;
  const canRecord = !action.busy && property.currentOutcome !== "do_not_visit" && address.trim().length > 2;
  const canSave = canRecord && outcome !== null
    && noteRemaining >= 0
    && !followUpRestricted
    && (outcome !== "follow_up" || Boolean(followUpDate));

  const volunteerNames = useMemo(() => new Map(data.volunteers.map((volunteer) => [volunteer.id, volunteer.name])), [data.volunteers]);

  const beginGuide = () => {
    setOutcome((current) => current ?? "conversation");
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

  const finishVisitPersonEntry = (message?: string) => {
    setEditingResident(null);
    setVisitPersonEntry(false);
    if (message) setWorkflowNotice(message);
    setTab("record");
  };

  const saveNoAnswer = () => {
    if (!canRecord) return;
    setOutcome("no_answer");
    void action.run(async () => {
      if (address.trim() !== property.address || unit.trim() !== (property.unit ?? "")) await onUpdateProperty(property.id, { address, unit });
      await onRecordVisit({ propertyId: property.id, outcome: "no_answer" });
    }, onClose);
  };

  const saveVisit = () => {
    if (!canSave || !outcome) return;
    void action.run(async () => {
      if (address.trim() !== property.address || unit.trim() !== (property.unit ?? "")) await onUpdateProperty(property.id, { address, unit });
      await onRecordVisit({ propertyId: property.id, outcome, objectiveNote: outcome === "no_answer" ? undefined : note,
        followUpDate: outcome === "follow_up" ? followUpDate : undefined,
        assignedTeamId: outcome === "follow_up" && !linkedResidentId ? assignedTeamId || undefined : undefined,
        residentId: ["conversation", "follow_up"].includes(outcome) ? linkedResidentId || undefined : undefined });
    }, onClose);
  };
  const markDoNotVisit = async () => {
    const confirmed = await confirm({ title: "Don’t knock here again?", message: "Open return visits are cancelled. Only a leader can lift this.", confirmLabel: "Don’t knock", destructive: true });
    if (confirmed) void action.run(() => onRecordVisit({ propertyId: property.id, outcome: "do_not_visit" }), onClose);
  };

  return (
    <dialog ref={drawer} className="property-drawer" aria-label={`Home details for ${property.address}`} onCancel={(event) => { event.preventDefault(); requestClose(); }}>
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      <div className="drawer-handle" aria-hidden="true" />
      {onBack && <button type="button" className="drawer-people-return" disabled={action.busy} onClick={onBack} aria-label="Back to People"><ArrowLeft size={20} aria-hidden="true" /><span>People</span></button>}
      <div className="drawer-heading">
        <div className="property-symbol"><MapPin size={19} /></div>
        <div className="drawer-address">
          <span className="status-label" data-outcome={property.currentOutcome}>{outcomeMeta[property.currentOutcome].label}</span>
          {editingAddress ? (
            <div className="address-edit-row">
              <input value={address} onChange={(event) => setAddress(event.target.value)} aria-label="Street address" />
              <input value={unit} onChange={(event) => setUnit(event.target.value)} aria-label="Unit or label" placeholder="Apt 2, rear house" />
              <button className="small-icon-button" onClick={() => setEditingAddress(false)} aria-label="Finish editing address"><Check size={16} /></button>
            </div>
          ) : (
            <button className="address-button" onClick={() => setEditingAddress(true)}>
              <strong>{property.address}{property.unit ? ` · ${property.unit}` : ""}</strong><PencilLine size={13} />
            </button>
          )}
          <small>{property.visitCount ? `${property.visitCount} visit${property.visitCount === 1 ? "" : "s"} recorded` : "No visits recorded"}</small>
        </div>
        <button className="close-button" disabled={action.busy} onClick={requestClose} aria-label="Close"><X size={19} /></button>
      </div>

      {property.parcel && parcelDwellings.length > 0 && (
        <div className="drawer-parcel-row">
          <button onClick={onViewParcel} disabled={!onViewParcel}>
            <Building2 size={14} />
            <span>{parcelDwellings.length} {parcelDwellings.length === 1 ? "home" : "homes"} at this address</span>
            <ChevronRight size={14} />
          </button>
          {onAddDwelling && <button className="drawer-add-dwelling" onClick={onAddDwelling} aria-label="Add another home at this address"><Plus size={14} /></button>}
        </div>
      )}

      {property.currentOutcome === "do_not_visit" && (
        <div className="do-not-visit-banner"><AlertOctagon size={17} /><span><strong>Don’t knock here</strong>They asked us not to come back. Only a leader can change this.</span></div>
      )}

      {openFollowUp && (
        <div className="drawer-followup-banner"><CalendarClock size={16} /><span><strong>Follow-up planned</strong>{formatDateTime(openFollowUp.dueAt, { weekday: "short", month: "short", day: "numeric" })}</span></div>
      )}

      <div className="drawer-tabs" role="tablist" tabIndex={-1} aria-label="Home sections" onKeyDown={(event) => navigateTabs(event, (index) => setTab(sections[index]))}>
        <button role="tab" id={`${tabsId}-record`} aria-controls={`${tabsId}-panel`} tabIndex={tab === "record" ? 0 : -1} aria-selected={tab === "record"} className={tab === "record" ? "active" : ""} onClick={() => setTab("record")} onFocus={() => setTab("record")}><ClipboardList size={15} /> Record visit</button>
        <button role="tab" id={`${tabsId}-people`} aria-controls={`${tabsId}-panel`} tabIndex={tab === "people" ? 0 : -1} aria-selected={tab === "people"} className={tab === "people" ? "active" : ""} onClick={() => setTab("people")} onFocus={() => setTab("people")}><Users size={15} /> People <span>{residents.length}</span></button>
        <button role="tab" id={`${tabsId}-history`} aria-controls={`${tabsId}-panel`} tabIndex={tab === "history" ? 0 : -1} aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")} onFocus={() => setTab("history")}><History size={15} /> History <span>{visits.length}</span></button>
      </div>

      {tab === "record" ? (
        <div className="drawer-record" {...panelProps}>
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
                setWorkflowNotice("No name, that’s fine. What happened?");
              }}
            />
          ) : (
            <>
          {workflowNotice && <div className="workflow-notice" role="status"><Check size={15} /><span>{workflowNotice}</span></div>}
          <fieldset className="outcome-fieldset">
            <legend>What happened?</legend>
            <div className="outcome-options">
              {recordableOutcomes.map((value) => (
                <button
                  type="button"
                  key={value}
                  className={outcome === value ? "active" : ""}
                  data-outcome={value}
                  aria-pressed={outcome === value}
                  onClick={() => {
                    if (value === "no_answer") { saveNoAnswer(); return; }
                    setOutcome(value);
                    if (value === "follow_up") setDetailsOpen(true);
                  }}
                >
                  {outcomeMeta[value].short}
                </button>
              ))}
            </div>
            <p>{outcome ? outcomeMeta[outcome].description : "Tap No answer to save it right away."}</p>
          </fieldset>

          {guideSteps.length > 0 && ["conversation", "follow_up"].includes(choice) && (
            <button className="guided-entry-card" type="button" onClick={beginGuide}>
              <span><BookOpenText size={17} /></span>
              <span><strong>Need a prompt?</strong><small>{conversationGuideContext ? `${conversationGuideContext} · ` : ""}Open {conversationGuide?.title ?? "your favorite guide"} at step one.</small></span>
              <ChevronRight size={16} />
            </button>
          )}

          {choice !== "no_answer" && choice !== "follow_up" && <button type="button" className="visit-details-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>{detailsOpen ? "Hide details" : choice === "conversation" ? "Add a person or note" : "Add a note"}<ChevronDown size={15} /></button>}

          {choice !== "no_answer" && (detailsOpen || choice === "follow_up") && <div className="visit-optional-details">
            {["conversation", "follow_up"].includes(choice) && <>
              <label className="form-field">
                <span>Person <small>Optional</small></span>
                <div className="select-wrap"><select value={linkedResidentId} onChange={(event) => {
                  if (event.target.value === addResidentOptionValue) {
                    setVisitPersonEntry(true);
                    setEditingResident("new");
                    setTab("people");
                    return;
                  }
                  setLinkedResidentId(event.target.value);
                }}><option value="">No one in particular</option><option value={addResidentOptionValue}>Add a new person…</option>{residents.map((resident) => <option value={resident.id} key={resident.id}>{resident.name || "Name not provided"}</option>)}</select><ChevronDown size={15} /></div>
              </label>
            </>}

            <label className="form-field">
              <span>{choice === "follow_up" ? "What should happen next?" : "Note"} <small>Optional</small></span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={data.church.noteCharacterLimit + 1}
                placeholder={linkedResidentId ? "Keep it short and kind." : "A short, factual note. Your team can see it."}
              />
              <em className={noteRemaining < 0 ? "over" : ""}>{noteRemaining} characters remaining</em>
            </label>

          {outcome === "follow_up" && (
            <div className="followup-form">
              <div className="form-row">
                <label className="form-field">
                  <span>When</span>
                  <input type="date" min={calendarDaysFromNow(0, data.church.timezone)} value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
                </label>
                {!linkedResidentId && <label className="form-field">
                  <span>Assign team</span>
                  <div className="select-wrap"><select value={assignedTeamId} onChange={(event) => setAssignedTeamId(event.target.value)}><option value="">Unassigned</option>{data.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select><ChevronDown size={15} /></div>
                </label>}
              </div>
              <small className="followup-link-help">{linkedResidentId ? "This follow-up goes to the person’s owner and stays private." : "The team you pick can see this follow-up."}</small>
              {followUpRestricted && <p className="inline-notice" role="status">This person asked not to be contacted. You can log the conversation, but not a follow-up.</p>}
            </div>
          )}
          </div>}

          <div className="drawer-actions">
            {property.currentOutcome !== "do_not_visit" && <button className="text-danger" onClick={markDoNotVisit}><AlertOctagon size={14} /> Do not revisit</button>}
            <button className="button primary" onClick={saveVisit} disabled={!canSave}><Save size={16} /> Save visit</button>
          </div>

          {canManage && property.visitCount === 0 && property.source !== "seed" && residents.length === 0 && (
            <button className="delete-location" onClick={() => {
              void confirm({ title: "Remove this home?", message: "It hasn’t been visited, so nothing else is lost.", confirmLabel: "Remove", destructive: true }).then((confirmed) => {
                if (confirmed) void action.run(() => onDeleteProperty(property.id), onClose);
              });
            }}><Trash2 size={14} /> Remove unvisited location</button>
          )}
            </>
          )}
        </div>
      ) : tab === "history" ? (
        <div className="history-list" {...panelProps}>
          {visits.length ? visits.map((visit) => (
            <VisitHistoryItem visit={visit} volunteerName={volunteerNames.get(visit.volunteerId) ?? "Volunteer"} key={visit.id} />
          )) : (
            <div className="empty-mini"><History size={21} /><strong>No visits yet</strong><span>Visits show up here after you save one.</span></div>
          )}
        </div>
      ) : (
        <div className="people-panel" {...panelProps}>
          {editingResident ? (
            <ResidentForm
              resident={editingResident === "new" ? undefined : editingResident}
              volunteers={data.volunteers.filter((volunteer) => volunteer.active)}
              activeVolunteerId={activeVolunteerId}
              pathwayEnabled={Boolean(data.church.pathwayEnabled)}
              autoFocusName={guidedPersonEntry || visitPersonEntry}
              onCancel={() => {
                if (guidedPersonEntry) finishGuidedPersonEntry("No name, that’s fine. What happened?");
                else if (visitPersonEntry) finishVisitPersonEntry();
                else setEditingResident(null);
              }}
              onSave={async (input) => {
                const residentId = await onUpsertResident(property.id, input, editingResident === "new" ? undefined : editingResident.id);
                if (editingResident === "new") setLinkedResidentId(residentId);
                if (guidedPersonEntry) finishGuidedPersonEntry("Saved. Now, what happened?");
                else if (visitPersonEntry) finishVisitPersonEntry("Saved and added to this visit.");
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
                      {data.church.pathwayEnabled && <small>{faithStatusLabels[resident.faithStatus]}</small>}
                      {(resident.phone || resident.email) && <p><Phone size={12} /> {resident.preferredContact === "none" ? "Contact details saved" : `Prefers ${resident.preferredContact}`}</p>}
                    </div>
                    {(canManage || resident.assignedVolunteerId === activeVolunteerId) && <button className="button quiet small" onClick={() => setEditingResident(resident)}>Edit</button>}
                    {(canManage || resident.assignedVolunteerId === activeVolunteerId) && <button className="small-icon-button danger" aria-label={`Delete ${resident.name || "person record"}`} onClick={() => {
                      void confirm({ title: "Archive this person?", message: "Their open follow-ups are cancelled. Their history stays in the church record.", confirmLabel: "Archive", destructive: true }).then((confirmed) => { if (confirmed) void action.run(() => onDeleteResident(resident.id)); });
                    }}><Trash2 size={14} /></button>}
                  </article>
                ))}
                {!residents.length && <div className="empty-mini"><Users size={21} /><strong>No one added yet</strong></div>}
              </div>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}

function GuidedConversation({ guideTitle, guideContext, steps, index: requestedIndex, onChangeIndex, onFinish, onRecordWithoutGuide }: {
  guideTitle: string;
  guideContext?: string;
  steps: NeighborWalkData["guide"];
  index: number;
  onChangeIndex: (index: number) => void;
  onFinish: () => void;
  onRecordWithoutGuide: () => void;
}) {
  const index = Math.min(requestedIndex, Math.max(0, steps.length - 1));
  const step = steps[index];
  if (!step) return null;
  const finalStep = index === steps.length - 1;

  return (
    <section className="doorstep-guide" aria-labelledby="doorstep-guide-title">
      <div className="doorstep-guide-heading">
        <div><p className="visually-hidden">{guideContext ? ` · ` : ""}{guideTitle}</p><h2 id="doorstep-guide-title">{step.title}</h2></div>
        <button className="button quiet small doorstep-without-guide" type="button" onClick={onRecordWithoutGuide}>Skip the guide</button>
      </div>
      <div className="doorstep-progress" role="group" aria-label={`Step ${index + 1} of ${steps.length}`}>
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
      <button className="skip-to-wrap" type="button" onClick={onFinish}>Wrapping up</button>
      <div className="doorstep-guide-actions">
        <button className="button quiet" type="button" disabled={index === 0} onClick={() => onChangeIndex(Math.max(0, index - 1))}>Previous</button>
        <button className="button primary" type="button" onClick={() => finalStep ? onFinish() : onChangeIndex(index + 1)}>
          {finalStep ? "Wrap up" : "Next"} <ArrowRight size={15} />
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
      <span>Only save what they’re happy to share.</span>
      <div className="name-prompt-actions">
        <button className="button primary" type="button" onClick={onAddPerson}><UserRound size={15} /> Add person details</button>
        <button className="button quiet" type="button" onClick={onSkip}>Skip for now</button>
      </div>
      <button className="name-prompt-back" type="button" onClick={onBack}>Back to the guide</button>
    </section>
  );
}

function ResidentForm({ resident, volunteers, activeVolunteerId, pathwayEnabled, autoFocusName = false, onCancel, onSave }: {
  resident?: Resident;
  volunteers: NeighborWalkData["volunteers"];
  activeVolunteerId: string;
  autoFocusName?: boolean;
  pathwayEnabled: boolean;
  onCancel: () => void;
  onSave: (input: ResidentInput) => Promise<unknown>;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const action = useAsyncAction();
  const [name, setName] = useState(resident?.name ?? "");
  const [faithStatus, setFaithStatus] = useState(resident?.faithStatus ?? "not_discussed");
  const [discipleshipStage, setDiscipleshipStage] = useState(resident?.discipleshipStage ?? "new_connection");
  const assignedVolunteerId = resident?.assignedVolunteerId ?? activeVolunteerId;
  const [status, setStatus] = useState(resident?.status ?? "active");
  const [phone, setPhone] = useState(resident?.phone ?? "");
  const [email, setEmail] = useState(resident?.email ?? "");
  const [preferredContact, setPreferredContact] = useState(resident?.preferredContact ?? "none");
  const contactMethodValid = preferredContact === "email" ? Boolean(email.trim())
    : preferredContact === "text" || preferredContact === "call" ? Boolean(phone.trim()) : true;
  const canSave = contactMethodValid && (Boolean(resident) || Boolean(name.trim()));
  const activeOwner = volunteers.find((volunteer) => volunteer.id === activeVolunteerId);

  useEffect(() => {
    if (autoFocusName) nameInputRef.current?.focus();
  }, [autoFocusName]);

  return (
    <div className="resident-form" aria-busy={action.busy}>
      <div className="form-stack">
        <label className="form-field"><span>Name</span><input ref={nameInputRef} required={!resident} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="First name, or a kind description" /></label>
        {pathwayEnabled && <label className="form-field"><span>Faith status <small>Self-described only</small></span><select value={faithStatus} onChange={(event) => setFaithStatus(event.target.value as Resident["faithStatus"])}>{faithStatusValues.map((value) => <option value={value} key={value}>{faithStatusLabels[value]}</option>)}</select></label>}
        <p>Responsible person: {volunteers.find((v) => v.id === assignedVolunteerId)?.name ?? activeOwner?.name ?? "You"}. Arrange ownership changes through a care handoff in People.</p>
        {pathwayEnabled && <label className="form-field"><span>Relationship stage</span><select value={discipleshipStage} onChange={(event) => setDiscipleshipStage(event.target.value as Resident["discipleshipStage"])}>{discipleshipStageValues.map((value) => <option value={value} key={value}>{discipleshipStageLabels[value]}</option>)}</select></label>}
      </div>
      <div className="contact-fields">
        <label className="form-field"><span>Phone <small>Optional</small></span><input inputMode="tel" autoComplete="off" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
        <label className="form-field"><span>Email <small>Optional</small></span><input type="email" inputMode="email" autoComplete="off" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="form-field"><span>Preferred contact</span><select value={preferredContact} onChange={(event) => setPreferredContact(event.target.value as Resident["preferredContact"])}><option value="none">No preference</option><option value="text">Text message</option><option value="call">Phone call</option><option value="email">Email</option></select></label>
      </div>
      <label className="form-field"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as Resident["status"])}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label>
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      {!contactMethodValid && <p className="form-warning">Add a phone number or email for that contact method.</p>}
      <div className="modal-actions"><button className="button quiet" onClick={onCancel}>Cancel</button><button className="button primary" disabled={!canSave || action.busy} onClick={() => void action.run(() => onSave({
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
      }))}><Save size={15} /> Save person</button></div>
    </div>
  );
}

function VisitHistoryItem({ visit, volunteerName }: { visit: Visit; volunteerName: string }) {
  const current = reviewedEncounter(visit);
  return (
    <article className="history-item">
      <i data-outcome={current.outcome} />
      <div>
        <div><strong>{current.voided ? "Entered in error · " : ""}{outcomeMeta[current.outcome].label}</strong><span><Clock3 size={12} /> {formatDateTime(visit.recordedAt)}</span></div>
        {visit.objectiveNote && <p>{visit.objectiveNote}</p>}
        <small>Recorded by {volunteerName}</small>
        {Boolean(visit.corrections?.length) && <details><summary>Correction history</summary><p>Original: {outcomeMeta[visit.outcome].label} · {(visit.context ?? "door").replaceAll("_", " ")}. Original links, note and date retained.</p>{visit.corrections?.map((correction) => <p key={correction.id}><time>{formatDateTime(correction.createdAt)}</time> · {correction.voided ? "Entered in error" : outcomeMeta[correction.outcome].label} · {correction.context.replaceAll("_", " ")} — {correction.reason}</p>)}<p>Tasks and contact restrictions unchanged.</p></details>}
      </div>
    </article>
  );
}
