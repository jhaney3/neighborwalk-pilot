begin;

create table public.discipleship_people (
  id text primary key check (length(id) between 1 and 160),
  church_id uuid not null references public.churches(id) on delete cascade,
  property_id text not null check (length(property_id) between 1 and 160),
  created_by uuid not null references auth.users(id) on delete restrict,
  assigned_to uuid not null references auth.users(id) on delete restrict,
  shared_user_ids uuid[] not null default '{}',
  shared_team_ids text[] not null default '{}',
  name text check (name is null or length(btrim(name)) between 1 and 120),
  faith_status text not null check (faith_status in ('not_discussed', 'christian', 'exploring', 'another_faith', 'no_faith', 'prefer_not_to_say')),
  discipleship_stage text not null check (discipleship_stage in ('new_connection', 'building_relationship', 'exploring_faith', 'following_jesus', 'growing', 'multiplying')),
  status text not null check (status in ('active', 'paused', 'archived')),
  phone text check (phone is null or length(phone) between 3 and 40),
  email text check (email is null or length(email) <= 254),
  preferred_contact text not null check (preferred_contact in ('none', 'text', 'call', 'email')),
  next_step text check (next_step is null or length(next_step) between 1 and 500),
  next_step_due_at timestamptz,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discipleship_people_id_church_key unique (id, church_id),
  constraint discipleship_people_contact_check check (
    (preferred_contact <> 'email' or email is not null)
    and (preferred_contact not in ('text', 'call') or phone is not null)
  )
);

create index discipleship_people_church_updated_idx on public.discipleship_people (church_id, updated_at desc);
create index discipleship_people_creator_church_idx on public.discipleship_people (created_by, church_id);
create index discipleship_people_assignee_church_idx on public.discipleship_people (assigned_to, church_id);
create index discipleship_people_shared_users_gin_idx on public.discipleship_people using gin (shared_user_ids);
create index discipleship_people_shared_teams_gin_idx on public.discipleship_people using gin (shared_team_ids);

create table public.discipleship_person_notes (
  id text primary key check (length(id) between 1 and 180),
  church_id uuid not null references public.churches(id) on delete cascade,
  person_id text not null,
  author_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('conversation', 'prayer', 'milestone', 'general')),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint discipleship_person_notes_person_fkey
    foreign key (person_id, church_id)
    references public.discipleship_people(id, church_id)
    on delete cascade
);

create index discipleship_person_notes_person_created_idx on public.discipleship_person_notes (person_id, created_at desc);
create index discipleship_person_notes_church_created_idx on public.discipleship_person_notes (church_id, created_at desc);
create index discipleship_person_notes_author_idx on public.discipleship_person_notes (author_id);

create or replace function private.volunteer_id_for_user(target_user_id uuid)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select 'volunteer_' || replace(target_user_id::text, '-', '');
$$;

create or replace function private.can_view_discipleship_person(target_person_id text)
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
        or (select auth.uid()) = any(person.shared_user_ids)
        or exists (
          select 1
          from public.workspace_snapshots snapshot
          cross join lateral jsonb_array_elements(
            case
              when jsonb_typeof(snapshot.data -> 'teams') = 'array' then snapshot.data -> 'teams'
              else '[]'::jsonb
            end
          ) as team(value)
          where snapshot.church_id = person.church_id
            and (team.value ->> 'id') = any(person.shared_team_ids)
            and exists (
              select 1
              from jsonb_array_elements_text(coalesce(team.value -> 'memberIds', '[]'::jsonb)) member(volunteer_id)
              where member.volunteer_id = (select private.volunteer_id_for_user((select auth.uid())))
            )
        )
      )
  );
$$;

create or replace function private.valid_discipleship_people_access(
  target_church_id uuid,
  target_assignee uuid,
  target_shared_users uuid[],
  target_shared_teams text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_church_member(target_church_id))
    and exists (
      select 1
      from public.church_memberships membership
      where membership.church_id = target_church_id
        and membership.user_id = target_assignee
        and membership.active
    )
    and not exists (
      select 1
      from unnest(coalesce(target_shared_users, '{}'::uuid[])) shared(user_id)
      where not exists (
        select 1
        from public.church_memberships membership
        where membership.church_id = target_church_id
          and membership.user_id = shared.user_id
          and membership.active
      )
    )
    and not exists (
      select 1
      from unnest(coalesce(target_shared_teams, '{}'::text[])) shared(team_id)
      where not exists (
        select 1
        from public.workspace_snapshots snapshot
        cross join lateral jsonb_array_elements(
          case
            when jsonb_typeof(snapshot.data -> 'teams') = 'array' then snapshot.data -> 'teams'
            else '[]'::jsonb
          end
        ) as team(value)
        where snapshot.church_id = target_church_id
          and team.value ->> 'id' = shared.team_id
      )
    );
$$;

create or replace function private.touch_discipleship_person()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger discipleship_people_touch_updated_at
before update on public.discipleship_people
for each row execute function private.touch_discipleship_person();

-- Preserve existing records while moving them out of the church-wide snapshot.
insert into public.discipleship_people (
  id, church_id, property_id, created_by, assigned_to, name, faith_status,
  discipleship_stage, status, phone, email, preferred_contact, next_step,
  next_step_due_at, last_contact_at, created_at, updated_at
)
select
  person.value ->> 'id',
  snapshot.church_id,
  person.value ->> 'propertyId',
  coalesce(creator.user_id, assignee.user_id, snapshot.updated_by),
  coalesce(assignee.user_id, creator.user_id, snapshot.updated_by),
  nullif(btrim(person.value ->> 'name'), ''),
  case when person.value ->> 'faithStatus' in ('not_discussed', 'christian', 'exploring', 'another_faith', 'no_faith', 'prefer_not_to_say') then person.value ->> 'faithStatus' else 'not_discussed' end,
  case when person.value ->> 'discipleshipStage' in ('new_connection', 'building_relationship', 'exploring_faith', 'following_jesus', 'growing', 'multiplying') then person.value ->> 'discipleshipStage' else 'new_connection' end,
  case when person.value ->> 'status' in ('active', 'paused', 'archived') then person.value ->> 'status' else 'active' end,
  nullif(person.value ->> 'phone', ''),
  nullif(person.value ->> 'email', ''),
  case when person.value ->> 'preferredContact' in ('none', 'text', 'call', 'email') then person.value ->> 'preferredContact' else 'none' end,
  nullif(btrim(person.value ->> 'nextStep'), ''),
  nullif(person.value ->> 'nextStepDueAt', '')::timestamptz,
  nullif(person.value ->> 'lastContactAt', '')::timestamptz,
  coalesce(nullif(person.value ->> 'createdAt', '')::timestamptz, snapshot.updated_at),
  coalesce(nullif(person.value ->> 'updatedAt', '')::timestamptz, snapshot.updated_at)
from public.workspace_snapshots snapshot
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(snapshot.data -> 'residents') = 'array' then snapshot.data -> 'residents' else '[]'::jsonb end
) person(value)
left join lateral (
  select membership.user_id
  from public.church_memberships membership
  where membership.church_id = snapshot.church_id
    and membership.active
    and (select private.volunteer_id_for_user(membership.user_id)) = person.value ->> 'createdByVolunteerId'
  limit 1
) creator on true
left join lateral (
  select membership.user_id
  from public.church_memberships membership
  where membership.church_id = snapshot.church_id
    and membership.active
    and (select private.volunteer_id_for_user(membership.user_id)) = person.value ->> 'assignedVolunteerId'
  limit 1
) assignee on true
where nullif(person.value ->> 'id', '') is not null
  and nullif(person.value ->> 'propertyId', '') is not null
on conflict (id) do nothing;

insert into public.discipleship_person_notes (id, church_id, person_id, author_id, kind, body, created_at)
select
  note.value ->> 'id',
  snapshot.church_id,
  note.value ->> 'residentId',
  coalesce(author.user_id, person.created_by),
  case when note.value ->> 'kind' in ('conversation', 'prayer', 'milestone', 'general') then note.value ->> 'kind' else 'general' end,
  btrim(note.value ->> 'body'),
  coalesce(nullif(note.value ->> 'createdAt', '')::timestamptz, person.created_at)
from public.workspace_snapshots snapshot
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(snapshot.data -> 'personNotes') = 'array' then snapshot.data -> 'personNotes' else '[]'::jsonb end
) note(value)
join public.discipleship_people person
  on person.id = note.value ->> 'residentId'
 and person.church_id = snapshot.church_id
left join lateral (
  select membership.user_id
  from public.church_memberships membership
  where membership.church_id = snapshot.church_id
    and membership.active
    and (select private.volunteer_id_for_user(membership.user_id)) = note.value ->> 'authorId'
  limit 1
) author on true
where nullif(note.value ->> 'id', '') is not null
  and nullif(btrim(note.value ->> 'body'), '') is not null
on conflict (id) do nothing;

alter table public.workspace_snapshots disable trigger workspace_snapshots_version_update;

update public.workspace_snapshots snapshot
set
  data = (snapshot.data - 'residents' - 'personNotes' - 'audit' - 'sync' - 'schemaVersion') || jsonb_build_object(
    'schemaVersion', 9,
    'residents', '[]'::jsonb,
    'personNotes', '[]'::jsonb,
    'audit', coalesce((
      select jsonb_agg(entry.value order by entry.ordinality)
      from jsonb_array_elements(case when jsonb_typeof(snapshot.data -> 'audit') = 'array' then snapshot.data -> 'audit' else '[]'::jsonb end)
        with ordinality entry(value, ordinality)
      where entry.value ->> 'entityType' not in ('resident', 'person_note')
    ), '[]'::jsonb),
    'sync', jsonb_set(
      coalesce(snapshot.data -> 'sync', '{}'::jsonb),
      '{pending}',
      coalesce((
        select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(case when jsonb_typeof(snapshot.data #> '{sync,pending}') = 'array' then snapshot.data #> '{sync,pending}' else '[]'::jsonb end)
          with ordinality item(value, ordinality)
        where item.value ->> 'entityType' not in ('resident', 'person_note')
      ), '[]'::jsonb),
      true
    )
  ),
  schema_version = 9,
  revision = revision + 1,
  updated_at = now()
where snapshot.schema_version < 9
   or jsonb_array_length(case when jsonb_typeof(snapshot.data -> 'residents') = 'array' then snapshot.data -> 'residents' else '[]'::jsonb end) > 0
   or jsonb_array_length(case when jsonb_typeof(snapshot.data -> 'personNotes') = 'array' then snapshot.data -> 'personNotes' else '[]'::jsonb end) > 0;

alter table public.workspace_snapshots enable trigger workspace_snapshots_version_update;

create or replace function private.guard_private_people_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_array_length(case when jsonb_typeof(new.data -> 'residents') = 'array' then new.data -> 'residents' else '[]'::jsonb end) > 0
    or jsonb_array_length(case when jsonb_typeof(new.data -> 'personNotes') = 'array' then new.data -> 'personNotes' else '[]'::jsonb end) > 0
  then
    raise exception 'People and person notes must use the protected discipleship records.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger workspace_snapshots_private_people_guard
before insert or update of data on public.workspace_snapshots
for each row execute function private.guard_private_people_snapshot();

create or replace function private.guard_workspace_schema_floor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.schema_version >= 9 and new.schema_version < 9 then
    raise exception 'This workspace requires a newer NeighborWalk app version';
  end if;
  return new;
end;
$$;

alter table public.discipleship_people enable row level security;
alter table public.discipleship_people force row level security;
alter table public.discipleship_person_notes enable row level security;
alter table public.discipleship_person_notes force row level security;

create policy discipleship_people_visible
on public.discipleship_people for select
to authenticated
using ((select private.can_view_discipleship_person(id)));

create policy discipleship_people_creator_insert
on public.discipleship_people for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.valid_discipleship_people_access(church_id, assigned_to, shared_user_ids, shared_team_ids))
);

create policy discipleship_people_owner_update
on public.discipleship_people for update
to authenticated
using (
  (select private.is_church_leader(church_id))
  or created_by = (select auth.uid())
  or assigned_to = (select auth.uid())
)
with check (
  (select private.valid_discipleship_people_access(church_id, assigned_to, shared_user_ids, shared_team_ids))
);

create policy discipleship_people_creator_delete
on public.discipleship_people for delete
to authenticated
using (
  (select private.is_church_leader(church_id))
  or created_by = (select auth.uid())
);

create policy discipleship_person_notes_visible
on public.discipleship_person_notes for select
to authenticated
using (
  exists (
    select 1
    from public.discipleship_people person
    where person.id = discipleship_person_notes.person_id
      and person.church_id = discipleship_person_notes.church_id
      and (select private.can_view_discipleship_person(person.id))
  )
);

create policy discipleship_person_notes_visible_insert
on public.discipleship_person_notes for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1
    from public.discipleship_people person
    where person.id = discipleship_person_notes.person_id
      and person.church_id = discipleship_person_notes.church_id
      and (select private.can_view_discipleship_person(person.id))
  )
);

create policy discipleship_person_notes_author_delete
on public.discipleship_person_notes for delete
to authenticated
using (
  author_id = (select auth.uid())
  or (select private.is_church_leader(church_id))
);

revoke all on table public.discipleship_people from public, anon, authenticated;
revoke all on table public.discipleship_person_notes from public, anon, authenticated;

grant select, delete on table public.discipleship_people to authenticated;
grant insert (
  id, church_id, property_id, created_by, assigned_to, shared_user_ids,
  shared_team_ids, name, faith_status, discipleship_stage, status, phone,
  email, preferred_contact, next_step, next_step_due_at, last_contact_at,
  created_at, updated_at
) on table public.discipleship_people to authenticated;
grant update (
  property_id, assigned_to, shared_user_ids, shared_team_ids, name,
  faith_status, discipleship_stage, status, phone, email, preferred_contact,
  next_step, next_step_due_at, last_contact_at, updated_at
) on table public.discipleship_people to authenticated;

grant select, insert, delete on table public.discipleship_person_notes to authenticated;

revoke all on function private.volunteer_id_for_user(uuid) from public, anon, authenticated;
revoke all on function private.can_view_discipleship_person(text) from public, anon, authenticated;
revoke all on function private.valid_discipleship_people_access(uuid, uuid, uuid[], text[]) from public, anon, authenticated;
revoke all on function private.touch_discipleship_person() from public, anon, authenticated;
revoke all on function private.guard_private_people_snapshot() from public, anon, authenticated;
revoke all on function private.guard_workspace_schema_floor() from public, anon, authenticated;
grant execute on function private.volunteer_id_for_user(uuid) to authenticated;
grant execute on function private.can_view_discipleship_person(text) to authenticated;
grant execute on function private.valid_discipleship_people_access(uuid, uuid, uuid[], text[]) to authenticated;

comment on table public.discipleship_people is
  'Private-by-default discipleship records. Creators, assignees, explicit users or teams, and church leaders are authorized through RLS.';
comment on table public.discipleship_person_notes is
  'One chronological note stream per protected discipleship person record.';

commit;
