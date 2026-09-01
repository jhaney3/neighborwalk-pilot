begin;

create table public.discipleship_follow_ups (
  id text primary key check (length(id) between 1 and 190),
  church_id uuid not null references public.churches(id) on delete cascade,
  person_id text not null,
  property_id text not null check (length(property_id) between 1 and 160),
  source_visit_id text check (source_visit_id is null or length(source_visit_id) between 1 and 180),
  created_by uuid not null references auth.users(id) on delete restrict,
  due_at timestamptz not null,
  status text not null check (status in ('scheduled', 'completed', 'cancelled')),
  note text check (note is null or length(btrim(note)) between 1 and 2000),
  completion_note text check (completion_note is null or length(btrim(completion_note)) between 1 and 2000),
  parent_follow_up_id text check (parent_follow_up_id is null or length(parent_follow_up_id) between 1 and 190),
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint discipleship_follow_ups_person_fkey
    foreign key (person_id, church_id)
    references public.discipleship_people(id, church_id)
    on delete cascade,
  constraint discipleship_follow_ups_person_property_check check (person_id <> '' and property_id <> '')
);

create index discipleship_follow_ups_person_due_idx
  on public.discipleship_follow_ups (person_id, due_at);
create index discipleship_follow_ups_church_due_idx
  on public.discipleship_follow_ups (church_id, due_at);
create index discipleship_follow_ups_open_due_idx
  on public.discipleship_follow_ups (church_id, due_at)
  where status = 'scheduled';
create index discipleship_follow_ups_creator_idx
  on public.discipleship_follow_ups (created_by);

create or replace function private.can_manage_discipleship_person(target_person_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_real_user()) and exists (
    select 1
    from public.discipleship_people person
    where person.id = target_person_id
      and (select private.is_church_member(person.church_id))
      and (
        (select private.is_church_leader(person.church_id))
        or person.created_by = (select auth.uid())
        or person.assigned_to = (select auth.uid())
      )
  );
$$;

create or replace function private.touch_discipleship_follow_up()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger discipleship_follow_ups_touch_updated_at
before update on public.discipleship_follow_ups
for each row execute function private.touch_discipleship_follow_up();

-- Convert every legacy person-level next step into a dated, protected task.
insert into public.discipleship_follow_ups (
  id, church_id, person_id, property_id, created_by, due_at, status,
  note, history, created_at, updated_at
)
select
  'followup_next_step_' || person.id,
  person.church_id,
  person.id,
  person.property_id,
  person.created_by,
  coalesce(
    person.next_step_due_at,
    greatest(person.updated_at, now()) + make_interval(days => church.default_follow_up_days)
  ),
  'scheduled',
  person.next_step,
  jsonb_build_array(jsonb_build_object(
    'id', 'activity_migrated_' || person.id,
    'action', 'created',
    'note', person.next_step,
    'dueAt', coalesce(
      person.next_step_due_at,
      greatest(person.updated_at, now()) + make_interval(days => church.default_follow_up_days)
    ),
    'actorId', (select private.volunteer_id_for_user(person.assigned_to)),
    'createdAt', person.updated_at
  )),
  person.updated_at,
  person.updated_at
from public.discipleship_people person
join public.churches church on church.id = person.church_id
where nullif(btrim(person.next_step), '') is not null
on conflict (id) do nothing;

update public.discipleship_people
set next_step = null,
    next_step_due_at = null
where next_step is not null or next_step_due_at is not null;

alter table public.workspace_snapshots disable trigger workspace_snapshots_version_update;

update public.workspace_snapshots snapshot
set
  data = (snapshot.data - 'followUps' - 'audit' - 'sync' - 'schemaVersion') || jsonb_build_object(
    'schemaVersion', 10,
    'followUps', coalesce((
      select jsonb_agg(item.value order by item.ordinality)
      from jsonb_array_elements(
        case when jsonb_typeof(snapshot.data -> 'followUps') = 'array' then snapshot.data -> 'followUps' else '[]'::jsonb end
      ) with ordinality item(value, ordinality)
      where nullif(item.value ->> 'residentId', '') is null
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(entry.value order by entry.ordinality)
      from jsonb_array_elements(
        case when jsonb_typeof(snapshot.data -> 'audit') = 'array' then snapshot.data -> 'audit' else '[]'::jsonb end
      ) with ordinality entry(value, ordinality)
      where entry.value ->> 'entityType' <> 'person_follow_up'
    ), '[]'::jsonb),
    'sync', jsonb_set(
      coalesce(snapshot.data -> 'sync', '{}'::jsonb),
      '{pending}',
      coalesce((
        select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(
          case when jsonb_typeof(snapshot.data #> '{sync,pending}') = 'array' then snapshot.data #> '{sync,pending}' else '[]'::jsonb end
        ) with ordinality item(value, ordinality)
        where item.value ->> 'entityType' <> 'person_follow_up'
      ), '[]'::jsonb),
      true
    )
  ),
  schema_version = 10,
  revision = revision + 1,
  updated_at = now()
where snapshot.schema_version < 10
   or exists (
     select 1
     from jsonb_array_elements(
       case when jsonb_typeof(snapshot.data -> 'followUps') = 'array' then snapshot.data -> 'followUps' else '[]'::jsonb end
     ) item(value)
     where nullif(item.value ->> 'residentId', '') is not null
   );

alter table public.workspace_snapshots enable trigger workspace_snapshots_version_update;

create or replace function private.guard_private_people_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_array_length(case when jsonb_typeof(new.data -> 'residents') = 'array' then new.data -> 'residents' else '[]'::jsonb end) > 0
    or jsonb_array_length(case when jsonb_typeof(new.data -> 'personNotes') = 'array' then new.data -> 'personNotes' else '[]'::jsonb end) > 0
    or exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(new.data -> 'followUps') = 'array' then new.data -> 'followUps' else '[]'::jsonb end
      ) item(value)
      where nullif(item.value ->> 'residentId', '') is not null
    )
  then
    raise exception 'People, person notes, and person follow-ups must use the protected discipleship records.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function private.guard_workspace_schema_floor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.schema_version >= 10 and new.schema_version < 10 then
    raise exception 'This workspace requires a newer NeighborWalk app version';
  end if;
  return new;
end;
$$;

alter table public.discipleship_follow_ups enable row level security;
alter table public.discipleship_follow_ups force row level security;

create policy discipleship_follow_ups_visible
on public.discipleship_follow_ups for select
to authenticated
using ((select private.can_view_discipleship_person(person_id)));

create policy discipleship_follow_ups_manager_insert
on public.discipleship_follow_ups for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.can_manage_discipleship_person(person_id))
  and exists (
    select 1
    from public.discipleship_people person
    where person.id = discipleship_follow_ups.person_id
      and person.church_id = discipleship_follow_ups.church_id
      and person.property_id = discipleship_follow_ups.property_id
  )
);

create policy discipleship_follow_ups_manager_update
on public.discipleship_follow_ups for update
to authenticated
using ((select private.can_manage_discipleship_person(person_id)))
with check (
  (select private.can_manage_discipleship_person(person_id))
  and exists (
    select 1
    from public.discipleship_people person
    where person.id = discipleship_follow_ups.person_id
      and person.church_id = discipleship_follow_ups.church_id
      and person.property_id = discipleship_follow_ups.property_id
  )
);

create policy discipleship_follow_ups_manager_delete
on public.discipleship_follow_ups for delete
to authenticated
using ((select private.can_manage_discipleship_person(person_id)));

-- New records always begin with the signed-in creator as their owner. Leaders
-- retain an exception for restoring backups that preserve another owner.
drop policy if exists discipleship_people_creator_insert on public.discipleship_people;
create policy discipleship_people_creator_insert
on public.discipleship_people for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (
    assigned_to = (select auth.uid())
    or (select private.is_church_leader(church_id))
  )
  and (select private.valid_discipleship_people_access(church_id, assigned_to, shared_user_ids, shared_team_ids))
);

revoke all on table public.discipleship_follow_ups from public, anon, authenticated;
grant select, delete on table public.discipleship_follow_ups to authenticated;
grant insert (
  id, church_id, person_id, property_id, source_visit_id, created_by, due_at,
  status, note, completion_note, parent_follow_up_id, history, created_at,
  completed_at, updated_at
) on table public.discipleship_follow_ups to authenticated;
grant update (
  property_id, source_visit_id, due_at, status, note, completion_note,
  parent_follow_up_id, history, completed_at, updated_at
) on table public.discipleship_follow_ups to authenticated;

revoke all on function private.can_manage_discipleship_person(text) from public, anon, authenticated;
revoke all on function private.touch_discipleship_follow_up() from public, anon, authenticated;
revoke all on function private.guard_private_people_snapshot() from public, anon, authenticated;
revoke all on function private.guard_workspace_schema_floor() from public, anon, authenticated;
grant execute on function private.can_manage_discipleship_person(text) to authenticated;

comment on table public.discipleship_follow_ups is
  'Dated person-care tasks protected by the same visibility rules as their discipleship person record.';

commit;
