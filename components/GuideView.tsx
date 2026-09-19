"use client";

import { AlertTriangle, ArrowRight, BookOpenText, Check, ChevronDown, ChevronRight, ChevronUp, Church, Copy, Edit3, LockKeyhole, MessageCircle, Plus, Save, Star, Trash2, UserRound, Users } from "lucide-react";
import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { createId, type ConversationGuide, type ConversationGuideInput, type GuideStep, type NeighborWalkData } from "../lib/domain";
import { makeBlankGuideStep, parseScriptureReferenceInput, validGuideInput } from "../lib/conversation-guides";
import { ScriptureReader } from "./ScriptureReader";
import { navigateTabs } from "../lib/tab-navigation";
import { Modal, ViewHeading, EmptyState } from "./ui";

const guideCompactQuery = "(max-width: 820px)";
const subscribeGuideLayout = (onChange: () => void) => {
  const query = window.matchMedia(guideCompactQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const compactGuideLayout = () => window.matchMedia(guideCompactQuery).matches;
const serverGuideLayout = () => false;

export function GuideView({
  guides,
  favoriteGuideId,
  effectiveGuideId,
  routeGuideId,
  onSelectGuide,
  activeTeamId,
  activeTeamName,
  teams,
  teamGuideDefaults,
  canManage,
  allowBuiltInManagement,
  libraryError,
  recovery,
  changesDisabled = false,
  pendingRequest = false,
  onSave,
  onDelete,
  onSetFavorite,
  onSetTeamDefault,
}: {
  guides: ConversationGuide[];
  favoriteGuideId?: string;
  effectiveGuideId?: string;
  routeGuideId?: string;
  onSelectGuide?: (id: string) => void;
  activeTeamId?: string;
  activeTeamName?: string;
  teams: NeighborWalkData["teams"];
  teamGuideDefaults: Record<string, string>;
  canManage: boolean;
  allowBuiltInManagement: boolean;
  libraryError?: string | null;
  recovery?: ReactNode;
  changesDisabled?: boolean;
  pendingRequest?: boolean;
  onSave: (input: ConversationGuideInput) => Promise<ConversationGuide>;
  onDelete: (guideId: string, expectedVersion?: number) => Promise<void>;
  onSetFavorite: (guideId?: string) => Promise<void>;
  onSetTeamDefault: (teamId: string, guideId?: string) => Promise<void>;
}) {
  const [selectedGuideId, setSelectedGuideId] = useState(effectiveGuideId ?? favoriteGuideId ?? guides[0]?.id ?? "");
  const [index, setIndex] = useState(0);
  const tabsId = useId();
  const compactLayout = useSyncExternalStore(subscribeGuideLayout, compactGuideLayout, serverGuideLayout);
  const tabsOrientation = compactLayout ? "horizontal" : "vertical";
  const [editor, setEditor] = useState<{ guide?: ConversationGuide; scope: ConversationGuide["scope"]; copy?: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [savingTeamId, setSavingTeamId] = useState<string>();
  const selectedGuide = guides.find((guide) => guide.id === (routeGuideId ?? selectedGuideId))
    ?? guides.find((guide) => guide.id === favoriteGuideId)
    ?? guides[0];
  const steps = selectedGuide?.steps ?? [];
  const activeStepIndex = Math.min(index, Math.max(0, steps.length - 1));
  const step = steps[activeStepIndex];
  const canUseBuiltInActions = (guide: ConversationGuide) => guide.id !== "legacy_church_guide" || allowBuiltInManagement;
  const canEditSelected = Boolean(selectedGuide && canUseBuiltInActions(selectedGuide) && (selectedGuide.scope === "personal" || canManage));
  const churchGuides = guides.filter((guide) => guide.scope === "church" && canUseBuiltInActions(guide));

  const chooseGuide = (guideId: string) => {
    onSelectGuide?.(guideId);
    setSelectedGuideId(guideId);
    setIndex(0);
    setMessage("");
    setMessageError(false);
  };

  const makeFavorite = async (guideId?: string) => {
    try {
      await onSetFavorite(guideId);
      if (guideId) setSelectedGuideId(guideId);
      setIndex(0);
      setMessage(guideId ? "Favorite guide saved. Outing and assigned-group guides still take priority." : "Personal favorite cleared. Outing, assigned-group and church guide choices still apply.");
      setMessageError(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The favorite guide could not be saved.");
      setMessageError(true);
    }
  };

  const setTeamDefault = async (teamId: string, guideId?: string) => {
    setSavingTeamId(teamId);
    setMessage("");
    setMessageError(false);
    try {
      await onSetTeamDefault(teamId, guideId);
      if (teamId === activeTeamId) {
        setSelectedGuideId(guideId ?? favoriteGuideId ?? churchGuides[0]?.id ?? guides[0]?.id ?? "");
        setIndex(0);
      }
      const team = teams.find((item) => item.id === teamId);
      setMessage(guideId ? `${team?.name ?? "Group"} will open with this church guide.` : `${team?.name ?? "Group"} will use each volunteer’s favorite guide.`);
      setMessageError(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The group default could not be saved.");
      setMessageError(true);
    } finally {
      setSavingTeamId(undefined);
    }
  };

  return (
    <div className="content-view guide-view">
      <ViewHeading
        eyebrow="A steadying hand in the moment"
        title="Conversation guides"
        description="Choose a church method or shape a private guide around your own testimony and scripture."
        aside={<div className="guide-create-actions"><button className="button quiet" disabled={changesDisabled} onClick={() => setEditor({ scope: "personal" })}><UserRound size={15} /> New personal guide</button>{canManage && <button className="button primary" disabled={changesDisabled} onClick={() => setEditor({ scope: "church" })}><Plus size={15} /> New church guide</button>}</div>}
      />
      {recovery}
      {routeGuideId && !guides.some((guide) => guide.id === routeGuideId) && <p className="inline-notice" role="status">The requested guide is not available in your active library. It may be archived or outside your access. You can choose another available guide below.</p>}

      <section className="guide-library" aria-labelledby="guide-library-title">
        <div className="guide-library-heading"><div><p className="eyebrow">Guide shelf</p><h2 id="guide-library-title">Pick the method that fits this conversation.</h2></div><span>{guides.filter((guide) => guide.scope === "church").length} church · {guides.filter((guide) => guide.scope === "personal").length} personal</span></div>
        {guides.length ? <div className="guide-library-list">
          {guides.map((guide) => {
            const favorite = guide.id === favoriteGuideId;
            const selected = guide.id === selectedGuide?.id;
            return <article className={`guide-library-item${selected ? " selected" : ""}`} key={guide.id}>
              <button className="guide-library-choice" onClick={() => chooseGuide(guide.id)} aria-pressed={selected}>
                <span className={`guide-scope-mark ${guide.scope}`}>{guide.scope === "church" ? <Church size={15} /> : <LockKeyhole size={15} />}</span>
                <span><small>{guide.scope === "church" ? "Church guide" : "Only me"}</small><strong>{guide.title}</strong><em>{guide.description || `${guide.steps.length} conversation steps`}</em></span>
              </button>
              {canUseBuiltInActions(guide) && <button className={`guide-favorite-button${favorite ? " active" : ""}`} disabled={changesDisabled} onClick={() => void makeFavorite(guide.id)} aria-label={favorite ? `${guide.title} is your favorite guide` : `Make ${guide.title} your favorite guide`} aria-pressed={favorite}><Star size={16} fill={favorite ? "currentColor" : "none"} /></button>}
            </article>;
          })}
        </div> : <div className="guide-library-empty"><BookOpenText size={22} /><div><strong>No conversation guides yet</strong><span>Create a private guide for yourself, or ask a leader to publish a church guide.</span></div></div>}
      </section>

      {canManage && <section className="guide-group-defaults" aria-labelledby="guide-group-defaults-title">
        <div className="guide-library-heading"><div><p className="eyebrow">Leader controls</p><h2 id="guide-group-defaults-title">Group defaults</h2></div><span>Optional</span></div>
        <div className="guide-group-warning"><AlertTriangle size={17} /><span><strong>A group default overrides personal favorites.</strong> Members of that group will open the selected church guide at the doorstep, even if they chose another favorite. Choose “Use each volunteer’s favorite” to remove the override.</span></div>
        {teams.length ? <div className="guide-group-default-list">
          {teams.map((team) => <label className="guide-group-default-row" key={team.id}>
            <span><strong>{team.name}</strong><small>{team.memberIds.length} {team.memberIds.length === 1 ? "volunteer" : "volunteers"} · {team.status}</small></span>
            <select value={teamGuideDefaults[team.id] ?? ""} disabled={changesDisabled || savingTeamId === team.id || (churchGuides.length === 0 && !teamGuideDefaults[team.id])} onChange={(event) => void setTeamDefault(team.id, event.target.value || undefined)} aria-label={`Default conversation guide for ${team.name}`}>
              <option value="">Use each volunteer’s favorite</option>
              {churchGuides.map((guide) => <option value={guide.id} key={guide.id}>{guide.title}</option>)}
            </select>
          </label>)}
        </div> : <div className="guide-library-empty"><Users size={22} /><div><strong>No groups yet</strong><span>Create a group in Leader view before assigning a default guide.</span></div></div>}
      </section>}

      {activeTeamName && effectiveGuideId && teamGuideDefaults[activeTeamId ?? ""] === effectiveGuideId && <div className="guide-library-message group-default" role="status"><Users size={15} /><span><strong>{activeTeamName} default:</strong> {guides.find((guide) => guide.id === effectiveGuideId)?.title}. This takes priority over your personal favorite while you work with this group.</span></div>}

      {(message || libraryError) && <div className={`guide-library-message${libraryError || messageError ? " error" : ""}`} role={libraryError || messageError ? "alert" : "status"}>{libraryError || messageError ? <AlertTriangle size={15} /> : <Check size={15} />}<span>{libraryError || message}</span></div>}

      {selectedGuide && step ? <>
        <section className="guide-active-heading">
          <div><span className={`guide-scope-label ${selectedGuide.scope}`}>{selectedGuide.scope === "church" ? <Church size={13} /> : <LockKeyhole size={13} />}{selectedGuide.scope === "church" ? "Church guide" : "Private guide"}</span><h2>{selectedGuide.title}</h2><p>{selectedGuide.description || `${steps.length} conversation steps`}</p></div>
          <div className="guide-active-actions">
            {canUseBuiltInActions(selectedGuide) && selectedGuide.id !== favoriteGuideId && <button className="button quiet" disabled={changesDisabled} onClick={() => void makeFavorite(selectedGuide.id)}><Star size={15} /> Set as favorite</button>}
            {canUseBuiltInActions(selectedGuide) && selectedGuide.id === favoriteGuideId && <button className="button quiet" disabled={changesDisabled} onClick={() => void makeFavorite()}>Clear personal favorite</button>}
            {selectedGuide.scope === "church" && <button className="button quiet" disabled={changesDisabled} onClick={() => setEditor({ guide: selectedGuide, scope: "personal", copy: true })}><Copy size={15} /> Make a private copy</button>}
            {canEditSelected && <button className="button quiet" disabled={changesDisabled} onClick={() => setEditor({ guide: selectedGuide, scope: selectedGuide.scope })}><Edit3 size={15} /> Edit guide</button>}
          </div>
        </section>
        <div className="guide-layout">
          <div className="guide-step-list" role="tablist" tabIndex={-1} aria-orientation={tabsOrientation} aria-label={`${selectedGuide.title} steps`} onKeyDown={(event) => navigateTabs(event, setIndex, tabsOrientation)}>
            {steps.map((item, itemIndex) => (
              <button key={item.id} id={`${tabsId}-${itemIndex}`} aria-label={`Step ${itemIndex + 1}: ${item.title}`} aria-controls={`${tabsId}-panel`} tabIndex={itemIndex === activeStepIndex ? 0 : -1} className={itemIndex === activeStepIndex ? "active" : ""} onClick={() => setIndex(itemIndex)} onFocus={() => setIndex(itemIndex)} role="tab" aria-selected={itemIndex === activeStepIndex}>
                <span>{itemIndex + 1}</span><div><small>{item.eyebrow}</small><strong>{item.title}</strong></div><ChevronRight size={16} />
              </button>
            ))}
          </div>
          <article className="guide-card" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${activeStepIndex}`} tabIndex={0}>
            <div className="guide-progress"><span style={{ width: `${((activeStepIndex + 1) / steps.length) * 100}%` }} /></div>
            <p className="eyebrow">Step {activeStepIndex + 1} of {steps.length} · {step.eyebrow}</p>
            <h2>{step.title}</h2>
            {step.sampleWords && <blockquote><MessageCircle size={20} /><p>“{step.sampleWords}”</p></blockquote>}
            <ScriptureReader references={step.scriptureReferences} />
            <div className="guide-actions"><button className="button inverted" disabled={activeStepIndex === 0} onClick={() => setIndex(Math.max(0, activeStepIndex - 1))}>Previous</button><button className="button amber" disabled={activeStepIndex === steps.length - 1} onClick={() => setIndex(Math.min(steps.length - 1, activeStepIndex + 1))}>Next step <ArrowRight size={15} /></button></div>
          </article>
        </div>
      </> : <EmptyState icon={<BookOpenText size={25} />} title="Build your first guide" copy="Personal guides stay private. Church guides are published by leaders for everyone." />}

      {editor && <GuideComposer
        guide={editor.guide}
        scope={editor.scope}
        copy={editor.copy}
        pendingRequest={pendingRequest}
        demo={allowBuiltInManagement}
        onClose={() => setEditor(null)}
        onSave={async (input) => {
          const saved = await onSave(input);
          onSelectGuide?.(saved.id);
          setSelectedGuideId(saved.id);
          setIndex(0);
          setEditor(null);
          setMessage(saved.scope === "church" ? "Church guide published." : "Private guide saved.");
          setMessageError(false);
        }}
        onDelete={editor.guide && !editor.copy ? async () => {
          await onDelete(editor.guide!.id, editor.guide!.version);
          onSelectGuide?.(guides.find((guide) => guide.id !== editor.guide!.id)?.id ?? "");
          setEditor(null);
          setIndex(0);
          setMessage(allowBuiltInManagement ? "Sample guide removed." : "Guide archived; historical links retained.");
          setMessageError(false);
        } : undefined}
      />}
    </div>
  );
}

function GuideComposer({ guide, scope, copy = false, pendingRequest = false, demo = false, onClose, onSave, onDelete }: {
  guide?: ConversationGuide;
  scope: ConversationGuide["scope"];
  copy?: boolean;
  pendingRequest?: boolean;
  demo?: boolean;
  onClose: () => void;
  onSave: (input: ConversationGuideInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ConversationGuideInput>(() => ({
    id: copy ? undefined : guide?.id,
    expectedVersion: copy ? undefined : guide?.version,
    scope,
    title: copy ? `${guide?.title ?? "Guide"} — my version` : guide?.title ?? "",
    description: guide?.description ?? "",
    steps: guide?.steps.map((step) => ({ ...step, id: copy ? createId("guide_step") : step.id })) ?? [makeBlankGuideStep(1)],
  }));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const valid = validGuideInput(draft);
  const saveLabel = guide && !copy
    ? scope === "church" ? "Publish changes" : "Save changes"
    : scope === "church" ? "Publish guide" : copy ? "Save private copy" : "Save private guide";

  const updateStep = (index: number, patch: Partial<GuideStep>) => {
    setDraft((current) => ({ ...current, steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) }));
  };
  const moveStep = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps: steps.map((step, stepIndex) => ({ ...step, order: stepIndex + 1 })) };
    });
  };
  const removeStep = (index: number) => {
    setDraft((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index).map((step, stepIndex) => ({ ...step, order: stepIndex + 1 })) }));
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The guide could not be saved.");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!onDelete) return;
    setDeleting(true);
    setError("");
    try {
      await onDelete();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The guide could not be deleted.");
      setDeleting(false);
    }
  };

  return <Modal
    wide
    title={copy ? "Make a private copy" : guide ? "Edit conversation guide" : scope === "church" ? "Create a church guide" : "Create a personal guide"}
    description={scope === "church" ? "Everyone in the church can use this guide. Only leaders can change it." : "Only you can see and use this guide."}
    onClose={saving || deleting ? () => undefined : onClose}
  >
    <fieldset className="guide-form-controls" disabled={saving || deleting || pendingRequest}><legend className="sr-only">Guide contents</legend>
    <div className={`guide-composer-privacy ${scope}`}>
      {scope === "church" ? <Church size={17} /> : <LockKeyhole size={17} />}
      <span><strong>{scope === "church" ? "Church-wide" : "Only me"}</strong>{scope === "church" ? "Published to every volunteer in this church workspace." : "Private to your signed-in account, including across your devices."}</span>
    </div>
    <div className="form-stack guide-composer-meta">
      <label className="form-field"><span>Guide name</span><input maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={scope === "church" ? "Romans Road" : "My testimony and key scriptures"} /></label>
      <label className="form-field"><span>Short description <small>Optional</small></span><textarea maxLength={500} rows={2} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="When this guide is most helpful" /></label>
    </div>
    <div className="guide-composer-heading"><div><p className="eyebrow">Conversation path</p><strong>{draft.steps.length} {draft.steps.length === 1 ? "step" : "steps"}</strong></div><span>Each step needs words, scripture, or both.</span></div>
    <div className="guide-composer-steps">
      {draft.steps.map((step, stepIndex) => <section className="guide-composer-step" key={step.id}>
        <header><span>{stepIndex + 1}</span><strong>{step.title || "Untitled step"}</strong><div><button type="button" disabled={stepIndex === 0} onClick={() => moveStep(stepIndex, -1)} aria-label={`Move step ${stepIndex + 1} up`}><ChevronUp size={15} /></button><button type="button" disabled={stepIndex === draft.steps.length - 1} onClick={() => moveStep(stepIndex, 1)} aria-label={`Move step ${stepIndex + 1} down`}><ChevronDown size={15} /></button><button type="button" disabled={draft.steps.length === 1} onClick={() => removeStep(stepIndex)} aria-label={`Delete step ${stepIndex + 1}`}><Trash2 size={15} /></button></div></header>
        <div className="guide-composer-step-fields">
          <label className="form-field"><span>Stage label</span><input maxLength={80} value={step.eyebrow} onChange={(event) => updateStep(stepIndex, { eyebrow: event.target.value })} placeholder="Share clearly" /></label>
          <label className="form-field"><span>Step title</span><input maxLength={120} value={step.title} onChange={(event) => updateStep(stepIndex, { title: event.target.value })} placeholder="Explain the good news" /></label>
          <label className="form-field full"><span>Coaching before speaking <small>Optional</small></span><textarea maxLength={800} rows={3} value={step.coaching} onChange={(event) => updateStep(stepIndex, { coaching: event.target.value })} placeholder="A practical cue for listening respectfully." /></label>
          <label className="form-field full"><span>Words or testimony notes <small>Optional when scripture is added</small></span><textarea maxLength={1600} rows={4} value={step.sampleWords} onChange={(event) => updateStep(stepIndex, { sampleWords: event.target.value })} placeholder="Write the words you want available at the door. This can be a prompt, your testimony, or a transition." /></label>
          <label className="form-field full"><span>Scripture references <small>Separate with commas</small></span><input maxLength={1200} value={step.scriptureReferences.join(", ")} onChange={(event) => updateStep(stepIndex, { scriptureReferences: parseScriptureReferenceInput(event.target.value) })} placeholder="Romans 3:23, Romans 6:23" /></label>
          <label className="form-field full"><span>Closing reminder <small>Optional</small></span><textarea maxLength={800} rows={3} value={step.reminder} onChange={(event) => updateStep(stepIndex, { reminder: event.target.value })} placeholder="Respect their answer and agree an owned next step only if requested." /></label>
        </div>
      </section>)}
    </div>
    <button className="guide-add-step" type="button" disabled={draft.steps.length >= 24} onClick={() => setDraft((current) => ({ ...current, steps: [...current.steps, makeBlankGuideStep(current.steps.length + 1)] }))}><Plus size={15} /> Add another step</button>
    </fieldset>
    {error && <div className="guide-library-message error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
    {pendingRequest && !saving && !deleting && <p role="status">This submission is preserved exactly. Close this editor and use guide recovery to retry it or preserve it as reviewed before making another change.</p>}
    {confirmDelete && <div className="guide-delete-confirm"><AlertTriangle size={16} /><span><strong>{demo ? "Remove" : "Archive"} “{guide?.title}”?</strong>{demo ? "This removes the guide from this sample device." : "The guide will leave the active library, but its record and historical links remain. Change current outing and group choices first. This is not permanent erasure."}</span></div>}
    <div className="modal-actions split">
      {onDelete ? <button className="button danger" disabled={saving || deleting || pendingRequest} onClick={() => confirmDelete ? void remove() : setConfirmDelete(true)}>{demo ? "Remove sample guide" : confirmDelete ? "Archive guide" : "Archive"}</button> : <span />}
      <div><button className="button quiet" disabled={saving || deleting} onClick={onClose}>Cancel</button><button className="button primary" disabled={!valid || saving || deleting || pendingRequest} onClick={() => void save()}><Save size={15} /> {saving ? "Saving…" : saveLabel}</button></div>
    </div>
  </Modal>;
}
