"use client";

import { Check, Copy, Link2, PencilLine, Plus, RefreshCcw, ShieldCheck, Trash2, UserPlus, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Team, TeamUpdate } from "../lib/domain";
import type { WorkspaceMembership } from "../lib/use-neighborwalk";
import { getSupabaseBrowserClient, type NeighborWalkDatabase } from "../lib/supabase";

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

export function MembersPanel({ membership, teams, onAddTeam, onUpdateTeam, onDeleteTeam }: {
  membership: WorkspaceMembership;
  teams: Team[];
  onAddTeam: (update: TeamUpdate) => string;
  onUpdateTeam: (teamId: string, update: TeamUpdate) => void;
  onDeleteTeam: (teamId: string) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"leader" | "volunteer">("volunteer");
  const [createdLink, setCreatedLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editingTeam, setEditingTeam] = useState<Team | "new" | null>(null);

  const load = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const [memberResult, invitationResult] = await Promise.all([
      client
        .from("church_memberships")
        .select("user_id, role, active, joined_at, member_email, display_name")
        .eq("church_id", membership.churchId)
        .order("joined_at", { ascending: true }),
      client
        .from("church_invitations")
        .select("id, invited_email, role, created_at, expires_at")
        .eq("church_id", membership.churchId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false }),
    ]);
    if (memberResult.error) throw memberResult.error;
    if (invitationResult.error) throw invitationResult.error;
    setMembers(memberResult.data ?? []);
    setInvitations(invitationResult.data ?? []);
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
      const link = new URL(window.location.origin);
      link.searchParams.set("invite", invitation.invitation_token);
      setCreatedLink(link.toString());
      setEmail("");
      setMessage(`Invitation ready for ${invitation.email}. It expires in 7 days.`);
      await load();
    } catch (invitationError) {
      setError(readableError(invitationError));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(createdLink);
      setMessage("Invitation link copied. Send it only to the intended person.");
    } catch {
      setError("Copy was blocked by the browser. Select and copy the link manually.");
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
    } catch (revokeError) {
      setError(readableError(revokeError));
    } finally {
      setBusy(false);
    }
  };

  const updateMember = async (member: Member, patch: Pick<Member, "role" | "active">) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      const { error: updateError } = await client.rpc("update_church_member", {
        target_user_id: member.user_id,
        member_role: patch.role,
        member_active: patch.active,
      });
      if (updateError) throw updateError;
      setMessage(`${memberLabel(member)} updated.`);
      await load();
    } catch (updateError) {
      setError(readableError(updateError));
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

      <div className="member-management-grid">
        <div className="member-invite-card">
          <div className="member-card-heading"><span><UserPlus size={18} /></span><div><strong>Invite a member</strong><small>The link works once and only for this email.</small></div></div>
          <label className="form-field"><span>Email address</span><input type="email" autoComplete="off" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="member@example.com" /></label>
          <label className="form-field"><span>Access level</span><select value={role} onChange={(event) => setRole(event.target.value as "leader" | "volunteer")}><option value="volunteer">Volunteer — field tools only</option><option value="leader">Leader — members, territories, and settings</option></select></label>
          <button className="button primary" disabled={busy || !email.trim()} onClick={() => void createInvitation()}><Link2 size={15} /> Create invitation link</button>
          {createdLink && <div className="created-invitation"><div><Check size={16} /><span><strong>Link ready</strong>Copy it now; the secret token is not shown again after this page refreshes.</span></div><div className="invite-link-row"><input readOnly value={createdLink} onFocus={(event) => event.currentTarget.select()} aria-label="Invitation link" /><button className="button quiet" onClick={() => void copyLink()}><Copy size={14} /> Copy</button></div></div>}
          {message && <p className="member-message" role="status"><Check size={14} />{message}</p>}
          {error && <p className="member-message error" role="alert"><X size={14} />{error}</p>}
        </div>

        <div className="member-roster-card">
          <div className="member-card-heading"><span><Users size={18} /></span><div><strong>Church roster</strong><small>Roles come from the signed-in account, not this device.</small></div></div>
          <div className="member-list">
            {members.map((member) => {
              const isCurrentUser = member.user_id === membership.userId;
              return <div className={`member-row${member.active ? "" : " inactive"}`} key={member.user_id}>
                <span className={`member-avatar ${member.role}`}>{memberLabel(member).charAt(0).toUpperCase()}</span>
                <p><strong>{memberLabel(member)}{isCurrentUser ? " (you)" : ""}</strong><small>{member.member_email ?? "No email available"}</small></p>
                {isCurrentUser ? <span className="role-badge leader"><ShieldCheck size={12} /> Leader</span> : <div className="member-controls"><select disabled={busy} value={member.role} aria-label={`Role for ${memberLabel(member)}`} onChange={(event) => void updateMember(member, { role: event.target.value as Member["role"], active: member.active })}><option value="volunteer">Volunteer</option><option value="leader">Leader</option></select><button className="button quiet" disabled={busy} onClick={() => void updateMember(member, { role: member.role, active: !member.active })}>{member.active ? "Suspend" : "Reactivate"}</button></div>}
              </div>;
            })}
            {!members.length && <div className="member-empty"><RefreshCcw size={16} /> Loading members…</div>}
          </div>
        </div>
      </div>

      {invitations.length > 0 && <div className="pending-invitations"><div className="member-card-heading"><span><Link2 size={17} /></span><div><strong>Pending invitations</strong><small>Unused links expire automatically after 7 days.</small></div></div><div>{invitations.map((invitation) => <div className="pending-invitation-row" key={invitation.id}><p><strong>{invitation.invited_email}</strong><small>{invitation.role} · expires {new Date(invitation.expires_at).toLocaleDateString()}</small></p><button className="button quiet" disabled={busy} onClick={() => void revokeInvitation(invitation.id)}>Revoke</button></div>)}</div></div>}

      <div className="group-management">
        <div className="section-heading"><div><p className="eyebrow">Field organization</p><h2>Outreach groups</h2></div><button className="button quiet small" onClick={() => setEditingTeam("new")}><Plus size={14} /> New group</button></div>
        <p className="section-description">Place active members into reusable groups, then assign a group to a territory or follow-up.</p>
        <div className="group-list">
          {teams.map((team) => <article className="group-card" key={team.id}>
            <span className={`team-initial ${team.status}`}>{team.name.charAt(0).toUpperCase()}</span>
            <div><strong>{team.name}</strong><small>{team.memberIds.length} member{team.memberIds.length === 1 ? "" : "s"} · {team.status}</small></div>
            <button className="small-icon-button" onClick={() => setEditingTeam(team)} aria-label={`Edit ${team.name}`}><PencilLine size={14} /></button>
          </article>)}
          {!teams.length && <div className="member-empty"><Users size={16} /> No groups yet. Create one when your team is ready.</div>}
        </div>
      </div>

      {editingTeam && <TeamEditor
        team={editingTeam === "new" ? undefined : editingTeam}
        members={members.filter((member) => member.active)}
        onClose={() => setEditingTeam(null)}
        onSave={(update) => {
          if (editingTeam === "new") onAddTeam(update);
          else onUpdateTeam(editingTeam.id, update);
          setEditingTeam(null);
        }}
        onDelete={editingTeam === "new" ? undefined : () => {
          if (window.confirm(`Delete ${editingTeam.name}? Territory and follow-up assignments will become unassigned.`)) {
            onDeleteTeam(editingTeam.id);
            setEditingTeam(null);
          }
        }}
      />}
    </section>
  );
}

function TeamEditor({ team, members, onClose, onSave, onDelete }: {
  team?: Team;
  members: Member[];
  onClose: () => void;
  onSave: (update: TeamUpdate) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(team?.name ?? "");
  const [status, setStatus] = useState<Team["status"]>(team?.status ?? "ready");
  const [memberIds, setMemberIds] = useState<string[]>(team?.memberIds ?? []);
  const volunteerId = (userId: string) => `volunteer_${userId.replaceAll("-", "")}`;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="team-editor-title">
      <div className="modal-heading"><div><h2 id="team-editor-title">{team ? "Edit outreach group" : "Create outreach group"}</h2><p>Groups organize your church members without changing their account access.</p></div><button className="close-button" onClick={onClose} aria-label="Close dialog">×</button></div>
      <div className="form-stack">
        <label className="form-field"><span>Group name</span><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: Team Barnabas" /></label>
        <label className="form-field"><span>Field status</span><select value={status} onChange={(event) => setStatus(event.target.value as Team["status"])}><option value="ready">Ready</option><option value="active">Active</option><option value="finished">Finished</option></select></label>
        <fieldset className="group-member-picker"><legend>Members</legend>{members.map((member) => {
          const id = volunteerId(member.user_id);
          return <label key={member.user_id} aria-label={`Include ${memberLabel(member)} in this group`}><input type="checkbox" checked={memberIds.includes(id)} onChange={(event) => setMemberIds((current) => event.target.checked ? [...new Set([...current, id])] : current.filter((item) => item !== id))} /><span><strong>{memberLabel(member)}</strong><small>{member.member_email ?? member.role}</small></span></label>;
        })}{!members.length && <p>No active members are available yet.</p>}</fieldset>
      </div>
      <div className="modal-actions split">{onDelete ? <button className="button danger" onClick={onDelete}><Trash2 size={14} /> Delete group</button> : <span />}<div><button className="button quiet" onClick={onClose}>Cancel</button><button className="button primary" disabled={name.trim().length < 2} onClick={() => onSave({ name, memberIds, status })}><Check size={14} /> Save group</button></div></div>
    </section>
  </div>;
}
