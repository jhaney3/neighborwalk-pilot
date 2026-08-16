begin;

alter table public.church_memberships
  add column member_email text,
  add column display_name text;

update public.church_memberships membership
set
  member_email = lower(auth_user.email),
  display_name = coalesce(
    nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
    split_part(lower(auth_user.email), '@', 1)
  )
from auth.users auth_user
where auth_user.id = membership.user_id;

alter table public.church_memberships
  add constraint church_memberships_member_email_check
    check (member_email is null or (member_email = lower(btrim(member_email)) and length(member_email) between 3 and 320)),
  add constraint church_memberships_display_name_check
    check (display_name is null or length(btrim(display_name)) between 1 and 120);

drop index if exists public.church_memberships_active_user_idx;
create unique index church_memberships_active_user_idx
  on public.church_memberships (user_id)
  where active;

create table public.church_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  church_id uuid not null references public.churches(id) on delete cascade,
  invited_email text not null,
  role text not null check (role in ('leader', 'volunteer')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  check (invited_email = lower(btrim(invited_email)) and length(invited_email) between 3 and 320),
  check (expires_at > created_at),
  check ((accepted_by is null) = (accepted_at is null))
);

create index church_invitations_church_created_idx
  on public.church_invitations (church_id, created_at desc);
create index church_invitations_pending_email_idx
  on public.church_invitations (church_id, invited_email)
  where accepted_at is null and revoked_at is null;

alter table public.church_invitations enable row level security;

create policy church_invitations_leader_read
on public.church_invitations for select
to authenticated
using ((select private.is_church_leader(church_id)));

revoke all on table public.church_invitations from anon, authenticated;
grant select on table public.church_invitations to authenticated;

create or replace function private.guard_workspace_snapshot_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed_keys text[] := array['properties', 'visits', 'followUps', 'audit', 'preferences', 'sync', 'updatedAt'];
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
    and not (select private.is_church_leader(old.church_id))
    and (
      (new.data - allowed_keys) is distinct from (old.data - allowed_keys)
      or new.schema_version is distinct from old.schema_version
    )
  then
    raise exception 'Only a church leader can change territories, teams, members, events, the guide, or church settings.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger workspace_snapshots_role_guard
before update on public.workspace_snapshots
for each row execute function private.guard_workspace_snapshot_role();

create or replace function public.create_church_invitation(
  invited_email text,
  invitation_role text default 'volunteer',
  valid_for_hours integer default 168
)
returns table (
  invitation_id uuid,
  invitation_token text,
  email text,
  role text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_church_id uuid;
  normalized_email text := lower(btrim(invited_email));
  raw_token text;
  created_invitation_id uuid;
  invitation_expires_at timestamptz;
begin
  if caller_id is null or not (select private.is_real_user()) then
    raise exception 'A verified user session is required.' using errcode = '42501';
  end if;

  select membership.church_id
  into target_church_id
  from public.church_memberships membership
  where membership.user_id = caller_id
    and membership.role = 'leader'
    and membership.active
  limit 1;

  if target_church_id is null then
    raise exception 'Only an active church leader can invite members.' using errcode = '42501';
  end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(normalized_email) > 320
  then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if invitation_role not in ('leader', 'volunteer') then
    raise exception 'Invitation role must be leader or volunteer.' using errcode = '22023';
  end if;
  if valid_for_hours not between 1 and 720 then
    raise exception 'Invitation lifetime must be between 1 and 720 hours.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.church_memberships membership
    where membership.church_id = target_church_id
      and membership.member_email = normalized_email
      and membership.active
  ) then
    raise exception 'That email already belongs to an active member.' using errcode = '23505';
  end if;

  update public.church_invitations invitation
  set revoked_at = now()
  where invitation.church_id = target_church_id
    and invitation.invited_email = normalized_email
    and invitation.accepted_at is null
    and invitation.revoked_at is null;

  raw_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  invitation_expires_at := now() + make_interval(hours => valid_for_hours);

  insert into public.church_invitations (
    church_id,
    invited_email,
    role,
    token_hash,
    created_by,
    expires_at
  ) values (
    target_church_id,
    normalized_email,
    invitation_role,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'), 'hex'),
    caller_id,
    invitation_expires_at
  )
  returning id into created_invitation_id;

  return query select created_invitation_id, raw_token, normalized_email, invitation_role, invitation_expires_at;
end;
$$;

create or replace function public.accept_church_invitation(invitation_token text)
returns table (
  church_id uuid,
  user_id uuid,
  role text,
  member_email text,
  display_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_email text;
  caller_name text;
  target_church_id uuid;
  target_role text;
  target_invitation_id uuid;
  volunteer_id text;
  domain_church_id text;
  volunteer_record jsonb;
begin
  if caller_id is null or not (select private.is_real_user()) then
    raise exception 'A verified user session is required.' using errcode = '42501';
  end if;
  if invitation_token is null or invitation_token !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'This invitation link is invalid.' using errcode = '22023';
  end if;

  select
    lower(auth_user.email),
    coalesce(
      nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
      split_part(lower(auth_user.email), '@', 1)
    )
  into caller_email, caller_name
  from auth.users auth_user
  where auth_user.id = caller_id;

  if caller_email is null then
    raise exception 'Your signed-in account does not have an email address.' using errcode = '42501';
  end if;

  select invitation.id, invitation.church_id, invitation.role
  into target_invitation_id, target_church_id, target_role
  from public.church_invitations invitation
  where invitation.token_hash = pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(lower(invitation_token), 'UTF8'), 'sha256'),
      'hex'
    )
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at > now()
  for update;

  if target_invitation_id is null then
    raise exception 'This invitation has expired, was revoked, or was already used.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.church_invitations invitation
    where invitation.id = target_invitation_id
      and invitation.invited_email = caller_email
  ) then
    raise exception 'Sign in with the same email address that the leader invited.' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.church_memberships membership
    where membership.user_id = caller_id
      and membership.active
  ) then
    raise exception 'This account already belongs to a church workspace.' using errcode = '23505';
  end if;

  insert into public.church_memberships (
    church_id,
    user_id,
    role,
    active,
    member_email,
    display_name
  ) values (
    target_church_id,
    caller_id,
    target_role,
    true,
    caller_email,
    caller_name
  );

  volunteer_id := 'volunteer_' || replace(caller_id::text, '-', '');
  select coalesce(snapshot.data -> 'church' ->> 'id', target_church_id::text)
  into domain_church_id
  from public.workspace_snapshots snapshot
  where snapshot.church_id = target_church_id;

  volunteer_record := jsonb_build_object(
    'id', volunteer_id,
    'churchId', domain_church_id,
    'name', caller_name,
    'email', caller_email,
    'role', target_role,
    'active', true
  );

  update public.workspace_snapshots snapshot
  set data = jsonb_set(
    snapshot.data,
    '{volunteers}',
    coalesce((
      select jsonb_agg(item.value order by item.ordinality)
      from jsonb_array_elements(coalesce(snapshot.data -> 'volunteers', '[]'::jsonb))
        with ordinality as item(value, ordinality)
      where item.value ->> 'id' <> volunteer_id
    ), '[]'::jsonb) || jsonb_build_array(volunteer_record),
    true
  )
  where snapshot.church_id = target_church_id;

  update public.church_invitations invitation
  set accepted_by = caller_id, accepted_at = now()
  where invitation.id = target_invitation_id;

  return query select target_church_id, caller_id, target_role, caller_email, caller_name;
end;
$$;

create or replace function public.revoke_church_invitation(invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  affected integer;
begin
  update public.church_invitations invitation
  set revoked_at = now()
  where invitation.id = invitation_id
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and exists (
      select 1
      from public.church_memberships membership
      where membership.church_id = invitation.church_id
        and membership.user_id = caller_id
        and membership.role = 'leader'
        and membership.active
    );
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.update_church_member(
  target_user_id uuid,
  member_role text,
  member_active boolean
)
returns table (
  user_id uuid,
  role text,
  active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_church_id uuid;
  volunteer_id text;
  affected integer;
begin
  if caller_id is null or not (select private.is_real_user()) then
    raise exception 'A verified user session is required.' using errcode = '42501';
  end if;
  if member_role not in ('leader', 'volunteer') then
    raise exception 'Member role must be leader or volunteer.' using errcode = '22023';
  end if;
  if target_user_id = caller_id then
    raise exception 'Leaders cannot change their own access.' using errcode = '22023';
  end if;

  select membership.church_id
  into target_church_id
  from public.church_memberships membership
  where membership.user_id = caller_id
    and membership.role = 'leader'
    and membership.active
  limit 1;

  if target_church_id is null then
    raise exception 'Only an active church leader can manage members.' using errcode = '42501';
  end if;

  update public.church_memberships membership
  set role = member_role, active = member_active
  where membership.church_id = target_church_id
    and membership.user_id = target_user_id;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'The selected member was not found.' using errcode = 'P0002';
  end if;

  volunteer_id := 'volunteer_' || replace(target_user_id::text, '-', '');
  update public.workspace_snapshots snapshot
  set data = jsonb_set(
    snapshot.data,
    '{volunteers}',
    coalesce((
      select jsonb_agg(
        case
          when item.value ->> 'id' = volunteer_id
            then item.value || jsonb_build_object('role', member_role, 'active', member_active)
          else item.value
        end
        order by item.ordinality
      )
      from jsonb_array_elements(coalesce(snapshot.data -> 'volunteers', '[]'::jsonb))
        with ordinality as item(value, ordinality)
    ), '[]'::jsonb),
    true
  )
  where snapshot.church_id = target_church_id;

  return query select target_user_id, member_role, member_active;
end;
$$;

revoke execute on function private.guard_workspace_snapshot_role() from public, anon, authenticated;

revoke execute on function public.create_church_invitation(text, text, integer) from public, anon;
grant execute on function public.create_church_invitation(text, text, integer) to authenticated;
revoke execute on function public.accept_church_invitation(text) from public, anon;
grant execute on function public.accept_church_invitation(text) to authenticated;
revoke execute on function public.revoke_church_invitation(uuid) from public, anon;
grant execute on function public.revoke_church_invitation(uuid) to authenticated;
revoke execute on function public.update_church_member(uuid, text, boolean) from public, anon;
grant execute on function public.update_church_member(uuid, text, boolean) to authenticated;

revoke execute on function public.create_church_workspace(text, jsonb, integer) from authenticated;
revoke insert on table public.churches from authenticated;
revoke insert on table public.church_memberships from authenticated;
revoke insert on table public.workspace_snapshots from authenticated;
drop policy if exists churches_owner_insert on public.churches;
drop policy if exists memberships_workspace_creator_insert on public.church_memberships;
drop policy if exists workspace_snapshots_leader_insert on public.workspace_snapshots;

comment on table public.church_invitations is
  'Hashed, expiring, single-use invitations created by church leaders.';
comment on function public.accept_church_invitation(text) is
  'Accepts a one-time church invitation only when the signed-in account email matches the invited email.';

commit;
