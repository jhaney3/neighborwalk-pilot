begin;

drop index if exists public.churches_created_by_idx;
alter table public.churches
  add constraint churches_created_by_key unique (created_by);

create or replace function private.is_workspace_creator(target_church_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_real_user()) and exists (
    select 1
    from public.churches church
    where church.id = target_church_id
      and church.created_by = (select auth.uid())
  );
$$;

create policy churches_owner_insert
on public.churches for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.is_real_user())
  and not (select private.has_active_membership())
);

create policy memberships_workspace_creator_insert
on public.church_memberships for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and role = 'leader'
  and active
  and (select private.is_workspace_creator(church_id))
  and not (select private.has_active_membership())
);

create policy workspace_snapshots_leader_insert
on public.workspace_snapshots for insert
to authenticated
with check (
  updated_by = (select auth.uid())
  and (select private.is_church_leader(church_id))
);

grant insert (name, timezone, retention_days, default_follow_up_days, require_follow_up_consent, note_character_limit, created_by)
  on table public.churches to authenticated;
grant insert (church_id, user_id, role, active)
  on table public.church_memberships to authenticated;
grant insert (church_id, schema_version, data, updated_by)
  on table public.workspace_snapshots to authenticated;

create or replace function public.create_church_workspace(
  workspace_name text,
  initial_data jsonb,
  initial_schema_version integer
)
returns table (church_id uuid, role text, revision bigint, data jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  created_church_id uuid;
  normalized_data jsonb;
begin
  if caller_id is null or not (select private.is_real_user()) then
    raise exception 'A verified user session is required.' using errcode = '42501';
  end if;
  if length(btrim(workspace_name)) not between 1 and 120 then
    raise exception 'Church name must be between 1 and 120 characters.' using errcode = '22023';
  end if;
  if initial_schema_version < 1 or jsonb_typeof(initial_data) <> 'object' then
    raise exception 'The initial workspace data is invalid.' using errcode = '22023';
  end if;
  if pg_column_size(initial_data) > 10485760 then
    raise exception 'The initial workspace data is too large.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.church_memberships membership
    where membership.user_id = caller_id and membership.active
  ) then
    raise exception 'This account already belongs to a church workspace.' using errcode = '23505';
  end if;

  insert into public.churches (name, created_by)
  values (btrim(workspace_name), caller_id)
  returning id into created_church_id;

  insert into public.church_memberships (church_id, user_id, role)
  values (created_church_id, caller_id, 'leader');

  normalized_data := jsonb_set(initial_data, '{church,name}', to_jsonb(btrim(workspace_name)), true);

  insert into public.workspace_snapshots (church_id, schema_version, data, updated_by)
  values (created_church_id, initial_schema_version, normalized_data, caller_id);

  return query
    select created_church_id, 'leader'::text, 1::bigint, normalized_data;
end;
$$;

revoke execute on function private.is_workspace_creator(uuid) from public, anon;
grant execute on function private.is_workspace_creator(uuid) to authenticated;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

commit;
