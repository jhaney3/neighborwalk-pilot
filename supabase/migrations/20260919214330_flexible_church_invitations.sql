begin;
-- Additive: legacy email-bound invitations and their RPCs remain unchanged.
create table private.shared_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  church_id uuid not null references public.churches(id) on delete cascade,
  contact_kind text not null check (contact_kind in ('email','phone')),
  contact_value text not null check (length(contact_value) between 3 and 320),
  recipient_name text not null default '' check (length(recipient_name)<=120),
  role text not null check (role in ('leader','volunteer')),
  token_hash text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz
);
alter table private.shared_invitations enable row level security;
revoke all on private.shared_invitations from public,anon,authenticated;
create index shared_invitations_church on private.shared_invitations(church_id,created_at desc);

create function private.create_shared_invitation(contact_kind text,contact_value text,recipient_name text,invitation_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare church uuid; contact text; token text; invitation private.shared_invitations;
begin
  select m.church_id into church from public.church_memberships m where m.user_id=auth.uid() and m.active;
  perform private.outreach_require_recent_leader(church);
  perform pg_advisory_xact_lock(hashtextextended(church::text,0));
  perform private.outreach_require_recent_leader(church);
  contact:=case when contact_kind='email' then lower(btrim(contact_value)) else btrim(contact_value) end;
  if coalesce(contact_kind,'') not in ('email','phone') or contact is null or length(contact)>320
    or (contact_kind='email' and contact !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or (contact_kind='phone' and contact !~ '^\+[1-9][0-9]{6,14}$')
    or coalesce(invitation_role,'') not in ('volunteer','leader') or length(coalesce(recipient_name,''))>120 then
    raise exception 'Enter a valid email or international phone number and access level.' using errcode='22023'; end if;
  if (select count(*) from private.shared_invitations i where i.church_id=church and i.created_by=auth.uid() and i.created_at>now()-interval '1 hour')>=25
    or (select count(*) from private.shared_invitations i where i.church_id=church and i.accepted_at is null and i.revoked_at is null and i.expires_at>now())>=100 then
    raise exception 'Invitation limit reached. Review pending links or try later.' using errcode='54000'; end if;
  update private.shared_invitations i set revoked_at=now() where i.church_id=church and i.contact_kind=create_shared_invitation.contact_kind and i.contact_value=contact and i.accepted_at is null and i.revoked_at is null;
  token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into private.shared_invitations(church_id,contact_kind,contact_value,recipient_name,role,token_hash,created_by)
    values(church,contact_kind,contact,btrim(coalesce(recipient_name,'')),invitation_role,encode(extensions.digest(token,'sha256'),'hex'),auth.uid()) returning * into invitation;
  perform private.outreach_access_changed(church,'access.shared_invitation_created',invitation.id::text,jsonb_build_object('role',invitation_role,'expiresAt',invitation.expires_at));
  return jsonb_build_object('id',invitation.id,'token',token,'expiresAt',invitation.expires_at);
end $$;

create function private.list_shared_invitations()
returns jsonb language plpgsql security definer set search_path='' as $$
declare church uuid;
begin
  select m.church_id into church from public.church_memberships m where m.user_id=auth.uid() and m.active;
  if not coalesce(private.is_church_leader(church),false) then raise exception 'A live leader account is required.' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'contactKind',i.contact_kind,'contact',i.contact_value,'name',i.recipient_name,'role',i.role,'expiresAt',i.expires_at) order by i.created_at desc)
    from private.shared_invitations i where i.church_id=church and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()),'[]'::jsonb);
end $$;

create function private.revoke_shared_invitation(invitation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare church uuid; changed integer;
begin
  select m.church_id into church from public.church_memberships m where m.user_id=auth.uid() and m.active;
  perform private.outreach_require_recent_leader(church);
  perform pg_advisory_xact_lock(hashtextextended(church::text,0));
  perform private.outreach_require_recent_leader(church);
  update private.shared_invitations i set revoked_at=now() where i.church_id=church and i.id=invitation_id and i.accepted_at is null and i.revoked_at is null;
  get diagnostics changed=row_count;
  if changed=1 then perform private.outreach_access_changed(church,'access.shared_invitation_revoked',invitation_id::text); end if;
  return changed=1;
end $$;

create function private.shared_invitation(invitation_token text,accept_invitation boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); church uuid; invitation private.shared_invitations; account_email text; account_name text; church_name text;
begin
  if not coalesce(private.is_real_user(),false) then raise exception 'Sign in to open your invitation.' using errcode='42501'; end if;
  if coalesce(invitation_token,'') !~ '^[0-9a-fA-F]{64}$' then raise exception 'This invitation link is invalid.' using errcode='22023'; end if;
  select lower(u.email),left(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),nullif(btrim(u.raw_user_meta_data->>'name'),''),nullif(split_part(u.email,'@',1),''),'Church member'),120)
    into account_email,account_name from auth.users u where u.id=actor and u.deleted_at is null
    and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null);
  if not found then raise exception 'Verify your email or phone number before joining.' using errcode='42501'; end if;
  select i.church_id into church from private.shared_invitations i where i.token_hash=encode(extensions.digest(lower(invitation_token),'sha256'),'hex');
  if church is null then raise exception 'This invitation is invalid or unavailable.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(church::text,0));
  if not coalesce(private.is_real_user(),false) then raise exception 'Sign in again to join.' using errcode='42501'; end if;
  select * into invitation from private.shared_invitations i where i.church_id=church and i.token_hash=encode(extensions.digest(lower(invitation_token),'sha256'),'hex') for update;
  select c.name into church_name from public.churches c where c.id=church;
  if invitation.accepted_by=actor and invitation.accepted_at is not null then
    if not exists(select 1 from public.church_memberships m where m.church_id=church and m.user_id=actor and m.active) then
      raise exception 'Ask a leader to review your access.' using errcode='42501'; end if;
    return jsonb_build_object('joined',true,'churchName',church_name);
  end if;
  if invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at<=now() then
    raise exception 'This invitation expired, was revoked, or has already been used. Ask your leader for a new link.' using errcode='22023'; end if;
  if not coalesce(accept_invitation,false) then return jsonb_build_object('joined',false,'churchName',church_name,'role',invitation.role,'expiresAt',invitation.expires_at); end if;
  -- The link is the capability. Contact labels are never proof of account ownership.
  -- Preserve suspended memberships; never overwrite an existing account's role.
  if exists(select 1 from public.church_memberships m where m.user_id=actor and (m.active or m.church_id=church)) then
    raise exception 'This account already has a workspace membership. Ask a leader to review access.' using errcode='23505'; end if;
  insert into public.church_memberships(church_id,user_id,role,active,member_email,display_name)
    values(church,actor,invitation.role,true,account_email,account_name);
  update private.shared_invitations i set accepted_at=now(),accepted_by=actor where i.id=invitation.id;
  perform private.outreach_access_changed(church,'access.shared_invitation_accepted',invitation.id::text,jsonb_build_object('role',invitation.role));
  return jsonb_build_object('joined',true,'churchName',church_name);
end $$;

create function public.create_shared_invitation(contact_kind text,contact_value text,recipient_name text default '',invitation_role text default 'volunteer')
returns jsonb language sql security invoker set search_path='' as $$ select private.create_shared_invitation(contact_kind,contact_value,recipient_name,invitation_role); $$;
create function public.list_shared_invitations() returns jsonb language sql security invoker set search_path='' as $$ select private.list_shared_invitations(); $$;
create function public.revoke_shared_invitation(invitation_id uuid) returns boolean language sql security invoker set search_path='' as $$ select private.revoke_shared_invitation(invitation_id); $$;
create function public.shared_invitation(invitation_token text,accept_invitation boolean default false) returns jsonb language sql security invoker set search_path='' as $$ select private.shared_invitation(invitation_token,accept_invitation); $$;
revoke all on function private.create_shared_invitation(text,text,text,text),private.list_shared_invitations(),private.revoke_shared_invitation(uuid),private.shared_invitation(text,boolean),public.create_shared_invitation(text,text,text,text),public.list_shared_invitations(),public.revoke_shared_invitation(uuid),public.shared_invitation(text,boolean) from public,anon;
grant execute on function private.create_shared_invitation(text,text,text,text),private.list_shared_invitations(),private.revoke_shared_invitation(uuid),private.shared_invitation(text,boolean),public.create_shared_invitation(text,text,text,text),public.list_shared_invitations(),public.revoke_shared_invitation(uuid),public.shared_invitation(text,boolean) to authenticated;
commit;
