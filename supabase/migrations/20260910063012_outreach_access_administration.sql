begin;
alter table public.outreach_audit add column details jsonb not null default '{}' check (pg_column_size(details)<=8192);

create function private.outreach_access_changed(church uuid,action_name text,target text,details jsonb default '{}')
returns void language plpgsql set search_path='' as $$
begin
  insert into public.outreach_audit(church_id,actor_id,command_id,action,entity_type,entity_id,details)
  values(church,auth.uid(),'access_'||extensions.gen_random_uuid()::text,action_name,'settings',target,details);
  update public.churches set outreach_revision=outreach_revision+1 where id=church;
end $$;
revoke all on function private.outreach_access_changed(uuid,text,text,jsonb) from public,anon,authenticated;

-- Retire the unreviewed operation. No access operation writes the frozen snapshot.
create or replace function private.update_church_member_impl(target_user_id uuid,member_role text,member_active boolean)
returns table(user_id uuid,role text,active boolean) language plpgsql security definer set search_path='' as $$
begin raise exception 'Refresh NeighborWalk and use the reviewed member-access form.' using errcode='22023'; end $$;

create function private.outreach_update_member(target_user_id uuid,expected_role text,expected_active boolean,member_role text,member_active boolean,reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare church uuid; previous public.church_memberships;
begin
  select m.church_id into church from public.church_memberships m where m.user_id=auth.uid() and m.active;
  perform private.outreach_require_recent_leader(church);
  perform pg_advisory_xact_lock(hashtextextended(church::text,0));
  -- Recheck after acquiring the same lock used by field commands and other leaders.
  perform private.outreach_require_recent_leader(church);
  if target_user_id=auth.uid() then raise exception 'Ask another leader to review changes to your own access.' using errcode='22023'; end if;
  if coalesce(member_role,'') not in ('leader','volunteer') or member_active is null or length(btrim(coalesce(reason,''))) not between 3 and 500 then
    raise exception 'Choose valid access and record a brief administrative reason, without neighbor details.' using errcode='22023'; end if;
  select * into previous from public.church_memberships m where m.church_id=church and m.user_id=target_user_id for update;
  if not found then raise exception 'This church member is not available.' using errcode='42501'; end if;
  if previous.role is distinct from expected_role or previous.active is distinct from expected_active then
    raise sqlstate 'PT409' using message='This member’s access changed. Refresh the roster and review it again.'; end if;
  if previous.role=member_role and previous.active=member_active then return jsonb_build_object('changed',false); end if;
  update public.church_memberships m set role=member_role,active=member_active where m.church_id=church and m.user_id=target_user_id;
  perform private.outreach_access_changed(church,'access.member_updated',target_user_id::text,
    jsonb_build_object('beforeRole',previous.role,'beforeActive',previous.active,'role',member_role,'active',member_active,'reason',btrim(reason)));
  -- Preserve people, task ownership, history and sharing. Inactive owners appear in leader exceptions;
  -- live membership gates immediately deny their requests. Offline copies cannot be remotely erased.
  return jsonb_build_object('changed',true,'role',member_role,'active',member_active);
end $$;
revoke all on function private.outreach_update_member(uuid,text,boolean,text,boolean,text) from public,anon;
grant execute on function private.outreach_update_member(uuid,text,boolean,text,boolean,text) to authenticated;
create function public.outreach_update_member(target_user_id uuid,expected_role text,expected_active boolean,member_role text,member_active boolean,reason text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.outreach_update_member(target_user_id,expected_role,expected_active,member_role,member_active,reason);
$$;
revoke all on function public.outreach_update_member(uuid,text,boolean,text,boolean,text) from public,anon;
grant execute on function public.outreach_update_member(uuid,text,boolean,text,boolean,text) to authenticated;

create or replace function private.create_church_invitation_impl(invited_email text,invitation_role text default 'volunteer',valid_for_hours integer default 168)
returns table(invitation_id uuid,invitation_token text,email text,role text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare church uuid; normalized_email text:=lower(btrim(invited_email)); token text; invitation public.church_invitations;
begin
  select m.church_id into church from public.church_memberships m where m.user_id=auth.uid() and m.active;
  perform private.outreach_require_recent_leader(church);
  perform pg_advisory_xact_lock(hashtextextended(church::text,0));
  perform private.outreach_require_recent_leader(church);
  if coalesce(normalized_email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(normalized_email)>320
    or coalesce(invitation_role,'') not in ('leader','volunteer') or valid_for_hours is null or valid_for_hours not between 1 and 720 then
    raise exception 'Enter a valid invitation email, role and expiry.' using errcode='22023'; end if;
  if exists(select 1 from public.church_memberships m where m.church_id=church and m.member_email=normalized_email) then
    raise exception 'This person already has a membership. Review their existing access instead.' using errcode='23505'; end if;
  if (select count(*) from public.church_invitations i where i.church_id=church and i.created_by=auth.uid() and i.created_at>now()-interval '1 hour')>=25
    or (select count(*) from public.church_invitations i where i.church_id=church and i.accepted_at is null and i.revoked_at is null and i.expires_at>now())>=100 then
    raise exception 'Invitation limit reached. Review pending links or wait before creating more.' using errcode='54000'; end if;
  update public.church_invitations i set revoked_at=now() where i.church_id=church and i.invited_email=normalized_email and i.accepted_at is null and i.revoked_at is null;
  token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.church_invitations(church_id,invited_email,role,token_hash,created_by,expires_at)
    values(church,normalized_email,invitation_role,encode(extensions.digest(token,'sha256'),'hex'),auth.uid(),now()+make_interval(hours=>valid_for_hours)) returning * into invitation;
  perform private.outreach_access_changed(church,'access.invitation_created',invitation.id::text,jsonb_build_object('role',invitation_role,'expiresAt',invitation.expires_at));
  return query select invitation.id,token,normalized_email,invitation_role,invitation.expires_at;
end $$;

create or replace function private.revoke_church_invitation_impl(invitation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare church uuid; changed integer;
begin
  select m.church_id into church from public.church_memberships m where m.user_id=auth.uid() and m.active;
  perform private.outreach_require_recent_leader(church);
  perform pg_advisory_xact_lock(hashtextextended(church::text,0));
  perform private.outreach_require_recent_leader(church);
  update public.church_invitations i set revoked_at=now() where i.church_id=church and i.id=invitation_id and i.accepted_at is null and i.revoked_at is null;
  get diagnostics changed=row_count;
  if changed=1 then perform private.outreach_access_changed(church,'access.invitation_revoked',invitation_id::text); end if;
  return changed=1;
end $$;

create or replace function private.accept_church_invitation_impl(invitation_token text)
returns table(church_id uuid,user_id uuid,role text,member_email text,display_name text)
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); church uuid; invitation public.church_invitations; account_email text; account_name text;
begin
  if actor is null or not private.is_real_user() or not exists(select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=actor and (s.not_after is null or s.not_after>now())) then
    raise exception 'Sign in with a verified account to accept this invitation.' using errcode='42501'; end if;
  if coalesce(invitation_token,'') !~ '^[0-9a-fA-F]{64}$' then raise exception 'This invitation link is invalid.' using errcode='22023'; end if;
  select lower(u.email),left(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),nullif(btrim(u.raw_user_meta_data->>'name'),''),split_part(u.email,'@',1)),120)
    into account_email,account_name from auth.users u where u.id=actor and u.email_confirmed_at is not null;
  if account_email is null then raise exception 'Verify your invited email address before accepting.' using errcode='42501'; end if;
  select i.church_id into church from public.church_invitations i where i.token_hash=encode(extensions.digest(lower(invitation_token),'sha256'),'hex');
  if church is null then raise exception 'This invitation has expired, was revoked, or is invalid.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(church::text,0));
  select * into invitation from public.church_invitations i where i.church_id=church and i.token_hash=encode(extensions.digest(lower(invitation_token),'sha256'),'hex') for update;
  if invitation.invited_email<>account_email then raise exception 'Sign in with the same email address that the leader invited.' using errcode='42501'; end if;
  if invitation.accepted_by=actor and invitation.accepted_at is not null then
    -- A lost success response can be retried, but never reactivates a suspended membership.
    return query select m.church_id,m.user_id,m.role,m.member_email,m.display_name from public.church_memberships m where m.church_id=church and m.user_id=actor and m.active;
    if not found then raise exception 'Ask a church leader to review your access.' using errcode='42501'; end if;
    return;
  end if;
  if invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at<=now() then
    raise exception 'This invitation has expired, was revoked, or was already used.' using errcode='22023'; end if;
  if exists(select 1 from public.church_memberships m where m.user_id=actor and (m.active or m.church_id=church)) then
    raise exception 'This account already has a workspace membership. Ask a leader to review access.' using errcode='23505'; end if;
  insert into public.church_memberships(church_id,user_id,role,active,member_email,display_name) values(church,actor,invitation.role,true,account_email,account_name);
  update public.church_invitations i set accepted_at=now(),accepted_by=actor where i.id=invitation.id;
  perform private.outreach_access_changed(church,'access.invitation_accepted',invitation.id::text,jsonb_build_object('role',invitation.role));
  return query select church,actor,invitation.role,account_email,account_name;
end $$;
commit;
