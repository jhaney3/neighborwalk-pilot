"use client";
import { teamStatusLabels } from "../lib/status-labels";
import { useAsyncAction } from "../lib/use-async-action";
import { LeaderInvitations } from "./LeaderInvitations";
import { Modal, useConfirm } from "./ui";

import { Check, Copy, Link2, PencilLine, Plus, RefreshCcw, ShieldCheck, Trash2, UserPlus, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Team, TeamUpdate } from "../lib/domain";
import type { WorkspaceMembership } from "../lib/use-neighborwalk";
import { getSupabaseBrowserClient, type NeighborWalkDatabase } from "../lib/supabase";
import { invitationLink } from "../lib/invitations";
import { isMobileApp, appServiceOrigin } from "../lib/mobile";

type Member = Pick<
  NeighborWalkDatabase["public"]["Tables"]["church_memberships"]["Row"],
  "user_id" | "role" | "active" | "joined_at" | "member_email" | "display_name"
>;

type Invitation = Pick<
  NeighborWalkDatabase["public"]["Tables"]["church_invitations"]["Row"],
  "id" | "invited_email" | "role" | "created_at" | "expires_at"
>;

function readableError(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "The member list could not be updated.";
}

function memberLabel(member: Member) {
  return member.display_name?.trim() || member.member_email?.split("@")[0] || "Church member";
}

export function MembersPanel({ membership, teams, showTeams = true, onAddTeam, onUpdateTeam, onDeleteTeam, onAuthenticate, onAccessChanged }: {
  membership: WorkspaceMembership;
  teams: Team[];
  showTeams?: boolean;
  onAddTeam: (update: TeamUpdate) => Promise<unknown>;
  onUpdateTeam: (teamId: string, update: TeamUpdate) => Promise<unknown>;
  onDeleteTeam: (teamId: string) => Promise<unknown>;
  onAuthenticate: (password: string) => Promise<void>;
  onAccessChanged: () => Promise<boolean>;
}) {
  const confirm = useConfirm();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"leader" | "volunteer">("volunteer");
  const [createdLink, setCreatedLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editingTeam, setEditingTeam] = useState<Team | "new" | null>(null);
  const [password, setPassword] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [reviewing, setReviewing] = useState<{ member: Member; patch: Pick<Member, "role" | "active"> } | null>(null);

  const load = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Connect to load church members.");
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await client.rpc("outreach_workspace_info", { target_church: membership.churchId });
      if (before.error) throw before.error;
      const roster: Member[] = [];
      const invites: Invitation[] = [];
      let cursor = "";
      for (;;) {
        let query = client.from("church_memberships").select("user_id, role, active, joined_at, member_email, display_name").eq("church_id", membership.churchId).order("user_id").limit(500);
        if (cursor) query = query.gt("user_id", cursor);
        const page = await query;
        if (page.error) throw page.error;
        roster.push(...page.data);
        if (page.data.length < 500) break;
        const next = page.data[page.data.length - 1]!.user_id;
        if (next <= cursor) throw new Error("Couldn’t load everyone. Refresh to try again.");
        cursor = next;
      }
      cursor = "";
      for (;;) {
        let query = client.from("church_invitations").select("id, invited_email, role, created_at, expires_at").eq("church_id", membership.churchId).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("id").limit(500);
        if (cursor) query = query.gt("id", cursor);
        const page = await query;
        if (page.error) throw page.error;
        invites.push(...page.data);
        if (page.data.length < 500) break;
        const next = page.data[page.data.length - 1]!.id;
        if (next <= cursor) throw new Error("Couldn’t load all invitations. Refresh to try again.");
        cursor = next;
      }
      const after = await client.rpc("outreach_workspace_info", { target_church: membership.churchId });
      if (after.error) throw after.error;
      const start = before.data as { revision?: number; role?: string };
      const end = after.data as { revision?: number; role?: string };
      if (start.revision === end.revision && end.role === "leader") {
        setMembers(roster.sort((a, b) => a.joined_at.localeCompare(b.joined_at)));
        setInvitations(invites.sort((a, b) => b.created_at.localeCompare(a.created_at)));
        setLoaded(true);
        return;
      }
    }
    throw new Error("Access changed while loading. Refresh again.");
  }, [membership.churchId]);

  useEffect(() => {
    void Promise.resolve().then(load).catch((loadError) => setError(readableError(loadError)));
  }, [load]);

  const activeCount = members.filter((member) => member.active).length;

  const createInvitation = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError("Enter the email address this invitation is for.");
      return;
    }
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data, error: invitationError } = await client.rpc("create_church_invitation", {
        invited_email: normalizedEmail,
        invitation_role: role,
        valid_for_hours: 168,
      });
      if (invitationError) throw invitationError;
      const invitation = data?.[0];
      if (!invitation) throw new Error("The invitation link was not created.");
      setCreatedLink(invitationLink(isMobileApp ? appServiceOrigin : window.location.origin, invitation.invitation_token));
      setEmail("");
      setMessage(`Invitation ready for ${invitation.email}. It expires in 7 days.`);
      await load();
      await onAccessChanged();
    } catch (invitationError) {
      setError(readableError(invitationError));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(createdLink);
      setMessage("Link copied.");
    } catch {
      setError("Couldn’t copy. Select the link and copy it.");
    }
  };

  const revokeInvitation = async (invitationId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      const { data, error: revokeError } = await client.rpc("revoke_church_invitation", { invitation_id: invitationId });
      if (revokeError) throw revokeError;
      if (!data) throw new Error("That invitation is no longer pending.");
      setCreatedLink("");
      setMessage("Invitation revoked.");
      await load();
      await onAccessChanged();
    } catch (revokeError) {
      setError(readableError(revokeError));
    } finally {
      setBusy(false);
    }
  };

  const updateMember = async (member: Member, patch: Pick<Member, "role" | "active">, reason: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Connect to review account access.");
    setBusy(true);
    setError("");
    try {
      const { error: updateError } = await client.rpc("outreach_update_member", {
        target_user_id: member.user_id,
        expected_role: member.role,
        expected_active: member.active,
        member_role: patch.role,
        member_active: patch.active,
        reason,
      });
      if (updateError) throw updateError;
      setMessage(`${memberLabel(member)} updated.`);
      setReviewing(null);
      await load();
      if (!await onAccessChanged()) setMessage("Access updated.");
    } catch (updateError) {
      setError(readableError(updateError));
      throw updateError;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="leader-section member-management">
      <div className="section-heading">
        <div><p className="eyebrow">Workspace access</p><h2>Members</h2></div>
        <span>{activeCount} active</span>
      </div>

      <div className="today-card"><h3>Confirm sensitive access changes</h3><p>Inviting people and changing roles needs a recent sign-in.</p>
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(""); void onAuthenticate(password).then(() => { setPassword(""); setMessage("Sign-in confirmed."); }).catch((failure) => setError(readableError(failure))).finally(() => setBusy(false)); }}><label className="form-field"><span>Current password</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="button quiet" disabled={busy}>Confirm my sign-in</button></form>
        <p>Signed in with Apple, Google or an email link? Sign out and back in instead.</p>
        <button className="button quiet" disabled={busy} onClick={() => { setBusy(true); void load().catch((failure) => setError(readableError(failure))).finally(() => setBusy(false)); }}>Refresh roster</button>
      </div>

      <div className="member-management-grid">
        {isMobileApp ? <LeaderInvitations onChanged={onAccessChanged} /> : <div className="member-invite-card">
          <div className="member-card-heading"><span><UserPlus size={18} /></span><div><strong>Invite a member</strong><small>The link works once and only for this email.</small></div></div>
          <label className="form-field"><span>Email address</span><input type="email" autoComplete="off" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="member@example.com" /></label>
          <label className="form-field"><span>Access level</span><select value={role} onChange={(event) => setRole(event.target.value as "leader" | "volunteer")}><option value="volunteer">Volunteer — field tools only</option><option value="leader">Leader — people, neighborhoods and settings</option></select></label>
          <button className="button primary" disabled={busy || !email.trim()} onClick={() => void createInvitation()}><Link2 size={15} /> Create invitation link</button>
          {createdLink && <div className="created-invitation"><div><Check size={16} /><span><strong>Link ready</strong>Copy it now. It won’t be shown again.</span></div><div className="invite-link-row"><input readOnly value={createdLink} onFocus={(event) => event.currentTarget.select()} aria-label="Invitation link" /><button className="button quiet" onClick={() => void copyLink()}><Copy size={14} /> Copy</button></div></div>}
          {message && <p className="member-message" role="status"><Check size={14} />{message}</p>}
          {error && <p className="member-message error" role="alert"><X size={14} />{error}</p>}
        </div>}

        <div className="member-roster-card">
          <div className="member-card-heading"><span><Users size={18} /></span><div><strong>Church roster</strong><small>Roles belong to each person’s account.</small></div></div>
          <div className="member-list">
            {members.map((member) => {
              const isCurrentUser = member.user_id === membership.userId;
              return <div className={`member-row${member.active ? "" : " inactive"}`} key={member.user_id}>
                <span className={`member-avatar ${member.role}`}>{memberLabel(member).charAt(0).toUpperCase()}</span>
                <p><strong>{memberLabel(member)}{isCurrentUser ? " (you)" : ""}</strong><small>{member.member_email ?? "No email available"}</small></p>
                {isCurrentUser ? <span className="role-badge leader"><ShieldCheck size={12} /> Leader</span> : <div className="member-controls"><select disabled={busy} value={member.role} aria-label={`Role for ${memberLabel(member)}`} onChange={(event) => setReviewing({ member, patch: { role: event.target.value as Member["role"], active: member.active } })}><option value="volunteer">Volunteer</option><option value="leader">Leader</option></select><button className="button quiet" disabled={busy} onClick={() => setReviewing({ member, patch: { role: member.role, active: !member.active } })}>{member.active ? "Suspend" : "Reactivate"}</button></div>}
              </div>;
            })}
            {!members.length && <div className="member-empty"><RefreshCcw size={16} /> {loaded ? "No one here yet." : error ? "Couldn’t load people. Check your connection and refresh." : "Loading members…"}</div>}
          </div>
        </div>
      </div>

      {invitations.length > 0 && <div className="pending-invitations"><div className="member-card-heading"><span><Link2 size={17} /></span><div><strong>Pending invitations</strong><small>Unused links expire after 7 days.</small></div></div><div>{invitations.map((invitation) => <div className="pending-invitation-row" key={invitation.id}><p><strong>{invitation.invited_email}</strong><small>{invitation.role} · expires {new Date(invitation.expires_at).toLocaleDateString()}</small></p><button className="button quiet" disabled={busy} onClick={() => void revokeInvitation(invitation.id)}>Revoke</button></div>)}</div></div>}

      {showTeams && <div className="group-management">
        <div className="section-heading"><div><p className="eyebrow">Field organization</p><h2>Teams</h2></div><button className="button quiet small" onClick={() => setEditingTeam("new")}><Plus size={14} /> New group</button></div>
        <p className="section-description">Saved teams are a starting point. At each walk you can mix people however you like.</p>
        <div className="group-list">
          {teams.map((team) => <article className="group-card" key={team.id}>
            <span className={`team-initial ${team.status}`}>{team.name.charAt(0).toUpperCase()}</span>
            <div><strong>{team.name}</strong><small>{team.memberIds.length} {team.memberIds.length === 1 ? "person" : "people"} · {teamStatusLabels[team.status]}</small></div>
            <button className="small-icon-button" onClick={() => setEditingTeam(team)} aria-label={`Edit ${team.name}`}><PencilLine size={14} /></button>
          </article>)}
          {!teams.length && <div className="member-empty"><Users size={16} /> No groups yet. Create one when your team is ready.</div>}
        </div>
      </div>}

      {editingTeam && <TeamEditor
        team={editingTeam === "new" ? undefined : editingTeam}
        members={members.filter((member) => member.active)}
        onClose={() => setEditingTeam(null)}
        onSave={async (update) => {
          if (editingTeam === "new") await onAddTeam(update);
          else await onUpdateTeam(editingTeam.id, update);
          setEditingTeam(null);
        }}
        onDelete={editingTeam === "new" ? undefined : async () => {
          if (await confirm({ title: `Archive ${editingTeam.name}?`, message: "Its walk assignments are cancelled. People keep their follow-ups and history.", confirmLabel: "Archive team", destructive: true })) {
            await onDeleteTeam(editingTeam.id);
            setEditingTeam(null);
          }
        }}
      />}
      {reviewing && <MemberAccessReview key={reviewing.member.user_id + reviewing.patch.role + reviewing.patch.active} review={reviewing} onClose={() => setReviewing(null)} onSave={(reason) => updateMember(reviewing.member, reviewing.patch, reason)} />}
    </section>
  );
}

function TeamEditor({ team, members, onClose, onSave, onDelete }: {
  team?: Team;
  members: Member[];
  onClose: () => void;
  onSave: (update: TeamUpdate) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
}) {
  const [name, setName] = useState(team?.name ?? "");
  const action = useAsyncAction();
  const [status, setStatus] = useState<Team["status"]>(team?.status ?? "ready");
  const [memberIds, setMemberIds] = useState<string[]>(team?.memberIds ?? []);
  const volunteerId = (userId: string) => `volunteer_${userId.replaceAll("-", "")}`;
  return <Modal title={team ? "Edit team" : "New team"} description="Teams don’t change anyone’s access." onClose={action.busy ? () => undefined : onClose}>
      <div className="form-stack">
        <label className="form-field"><span>Group name</span><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: Team Barnabas" /></label>
        <label className="form-field"><span>Field status</span><select value={status} onChange={(event) => setStatus(event.target.value as Team["status"])}><option value="ready">Ready</option><option value="active">Active</option><option value="finished">Finished</option></select></label>
        <fieldset className="group-member-picker"><legend>Members</legend>{members.map((member) => {
          const id = volunteerId(member.user_id);
          return <label key={member.user_id} aria-label={`Include ${memberLabel(member)} on this team`}><input type="checkbox" checked={memberIds.includes(id)} onChange={(event) => setMemberIds((current) => event.target.checked ? [...new Set([...current, id])] : current.filter((item) => item !== id))} /><span><strong>{memberLabel(member)}</strong><small>{member.member_email ?? member.role}</small></span></label>;
        })}{!members.length && <p>No active members are available yet.</p>}</fieldset>
      </div>
      <div className="modal-actions split">{onDelete ? <button className="button danger" disabled={action.busy} onClick={() => void action.run(onDelete)}><Trash2 size={14} /> Archive group</button> : <span />}<div><button className="button quiet" disabled={action.busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={name.trim().length < 2 || action.busy} onClick={() => void action.run(() => onSave({ name, memberIds, status }))}><Check size={14} /> Save group</button></div></div>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
  </Modal>;
}

function MemberAccessReview({ review, onClose, onSave }: { review: { member: Member; patch: Pick<Member, "role" | "active"> }; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const action = useAsyncAction();
  return <Modal title="Review member access" onClose={action.busy ? () => undefined : onClose}>
    <form className="form-stack" aria-busy={action.busy} onSubmit={(event) => { event.preventDefault(); void action.run(() => onSave(reason)); }}>
      <p><strong>{memberLabel(review.member)}</strong>: {review.member.active ? "Active" : "Suspended"} {review.member.role} → {review.patch.active ? "Active" : "Suspended"} {review.patch.role}.</p>
      <p>{!review.patch.active ? "Their access stops right away. A leader should review their people and follow-ups." : review.patch.role === "leader" ? "Leaders can see every person and manage access." : "Volunteers see their walks and the people shared with them."}</p>
      <label className="form-field"><span>Reason (no neighbor details)</span><textarea required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {action.error && <p role="alert" className="inline-error">{action.error} Refresh the roster before retrying if access changed elsewhere.</p>}
      <div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={action.busy || reason.trim().length < 3}>Confirm reviewed change</button></div>
    </form>
  </Modal>;
}
