begin;

create table public.conversation_guide_team_defaults (
  church_id uuid not null references public.churches(id) on delete cascade,
  team_id text not null check (length(btrim(team_id)) between 1 and 160),
  guide_id uuid not null,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (church_id, team_id),
  constraint conversation_guide_team_defaults_guide_fkey
    foreign key (guide_id, church_id)
    references public.conversation_guides(id, church_id)
    on delete cascade
);

create index conversation_guide_team_defaults_guide_idx
  on public.conversation_guide_team_defaults (guide_id, church_id);
create index conversation_guide_team_defaults_updated_by_idx
  on public.conversation_guide_team_defaults (updated_by);

create trigger conversation_guide_team_defaults_touch_updated_at
before update on public.conversation_guide_team_defaults
for each row execute function private.touch_conversation_guide();

insert into public.conversation_guides (
  church_id,
  scope,
  title,
  description,
  steps,
  sort_order,
  created_by,
  updated_by,
  created_at,
  updated_at
)
select
  snapshot.church_id,
  'church',
  'Listen, share, invite',
  'A permission-first guide for listening well, sharing clearly, and leaving room for a next step.',
  snapshot.data -> 'guide',
  0,
  snapshot.updated_by,
  snapshot.updated_by,
  snapshot.updated_at,
  snapshot.updated_at
from public.workspace_snapshots snapshot
where jsonb_typeof(snapshot.data -> 'guide') = 'array'
  and jsonb_array_length(snapshot.data -> 'guide') between 1 and 24
  and not exists (
    select 1
    from public.conversation_guides guide
    where guide.church_id = snapshot.church_id
      and guide.scope = 'church'
  );

create function private.seed_default_conversation_guide()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.data -> 'guide') = 'array'
    and jsonb_array_length(new.data -> 'guide') between 1 and 24
  then
    insert into public.conversation_guides (
      church_id,
      scope,
      title,
      description,
      steps,
      sort_order,
      created_by,
      updated_by,
      created_at,
      updated_at
    )
    select
      new.church_id,
      'church',
      'Listen, share, invite',
      'A permission-first guide for listening well, sharing clearly, and leaving room for a next step.',
      new.data -> 'guide',
      0,
      new.updated_by,
      new.updated_by,
      new.updated_at,
      new.updated_at
    where not exists (
      select 1
      from public.conversation_guides guide
      where guide.church_id = new.church_id
        and guide.scope = 'church'
    );
  end if;
  return new;
end;
$$;

revoke all on function private.seed_default_conversation_guide() from public, anon, authenticated;

create trigger workspace_snapshot_seed_default_conversation_guide
after insert on public.workspace_snapshots
for each row execute function private.seed_default_conversation_guide();

alter table public.conversation_guide_team_defaults enable row level security;
alter table public.conversation_guide_team_defaults force row level security;

create policy conversation_guide_team_defaults_member_read
on public.conversation_guide_team_defaults for select
to authenticated
using ((select private.is_church_member(church_id)));

create policy conversation_guide_team_defaults_leader_insert
on public.conversation_guide_team_defaults for insert
to authenticated
with check (
  updated_by = (select auth.uid())
  and (select private.is_church_leader(church_id))
  and exists (
    select 1
    from public.conversation_guides guide
    where guide.id = guide_id
      and guide.church_id = conversation_guide_team_defaults.church_id
      and guide.scope = 'church'
  )
);

create policy conversation_guide_team_defaults_leader_update
on public.conversation_guide_team_defaults for update
to authenticated
using ((select private.is_church_leader(church_id)))
with check (
  (select private.is_church_leader(church_id))
  and exists (
    select 1
    from public.conversation_guides guide
    where guide.id = guide_id
      and guide.church_id = conversation_guide_team_defaults.church_id
      and guide.scope = 'church'
  )
);

create policy conversation_guide_team_defaults_leader_delete
on public.conversation_guide_team_defaults for delete
to authenticated
using ((select private.is_church_leader(church_id)));

revoke all on table public.conversation_guide_team_defaults from public, anon, authenticated;
grant select, delete on table public.conversation_guide_team_defaults to authenticated;
grant insert (church_id, team_id, guide_id, updated_by)
  on table public.conversation_guide_team_defaults to authenticated;
grant update (church_id, team_id, guide_id, updated_by)
  on table public.conversation_guide_team_defaults to authenticated;

comment on table public.conversation_guide_team_defaults is
  'Optional leader-managed church-guide defaults for teams stored in the workspace document.';

commit;
