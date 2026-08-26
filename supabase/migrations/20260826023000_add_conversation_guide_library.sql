begin;

create table public.conversation_guides (
  id uuid primary key default extensions.gen_random_uuid(),
  church_id uuid not null references public.churches(id) on delete cascade,
  scope text not null check (scope in ('church', 'personal')),
  owner_user_id uuid references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 500),
  steps jsonb not null check (
    jsonb_typeof(steps) = 'array'
    and jsonb_array_length(steps) between 1 and 24
  ),
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_guides_scope_owner_check check (
    (scope = 'church' and owner_user_id is null)
    or (scope = 'personal' and owner_user_id is not null)
  ),
  constraint conversation_guides_id_church_key unique (id, church_id)
);

create index conversation_guides_church_scope_order_idx
  on public.conversation_guides (church_id, scope, sort_order, created_at);
create index conversation_guides_owner_church_idx
  on public.conversation_guides (owner_user_id, church_id)
  where owner_user_id is not null;
create index conversation_guides_created_by_idx on public.conversation_guides (created_by);
create index conversation_guides_updated_by_idx on public.conversation_guides (updated_by);

create table public.conversation_guide_preferences (
  church_id uuid not null references public.churches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  favorite_guide_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (church_id, user_id),
  constraint conversation_guide_preferences_guide_fkey
    foreign key (favorite_guide_id, church_id)
    references public.conversation_guides(id, church_id)
    on delete cascade
);

create index conversation_guide_preferences_user_church_idx
  on public.conversation_guide_preferences (user_id, church_id);
create index conversation_guide_preferences_favorite_idx
  on public.conversation_guide_preferences (favorite_guide_id, church_id);

create or replace function private.touch_conversation_guide()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by = (select auth.uid());
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.touch_conversation_guide() from public, anon, authenticated;

create trigger conversation_guides_touch_updated_at
before update on public.conversation_guides
for each row execute function private.touch_conversation_guide();

create trigger conversation_guide_preferences_touch_updated_at
before update on public.conversation_guide_preferences
for each row execute function private.touch_church();

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
  and jsonb_array_length(snapshot.data -> 'guide') between 1 and 24;

alter table public.conversation_guides enable row level security;
alter table public.conversation_guides force row level security;
alter table public.conversation_guide_preferences enable row level security;
alter table public.conversation_guide_preferences force row level security;

create policy conversation_guides_visible_to_member
on public.conversation_guides for select
to authenticated
using (
  (select private.is_church_member(church_id))
  and (
    scope = 'church'
    or owner_user_id = (select auth.uid())
  )
);

create policy conversation_guides_member_insert
on public.conversation_guides for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and (
    (
      scope = 'church'
      and owner_user_id is null
      and (select private.is_church_leader(church_id))
    )
    or (
      scope = 'personal'
      and owner_user_id = (select auth.uid())
      and (select private.is_church_member(church_id))
    )
  )
);

create policy conversation_guides_member_update
on public.conversation_guides for update
to authenticated
using (
  (
    scope = 'church'
    and (select private.is_church_leader(church_id))
  )
  or (
    scope = 'personal'
    and owner_user_id = (select auth.uid())
    and (select private.is_church_member(church_id))
  )
)
with check (
  (
    scope = 'church'
    and owner_user_id is null
    and (select private.is_church_leader(church_id))
  )
  or (
    scope = 'personal'
    and owner_user_id = (select auth.uid())
    and (select private.is_church_member(church_id))
  )
);

create policy conversation_guides_member_delete
on public.conversation_guides for delete
to authenticated
using (
  (
    scope = 'church'
    and (select private.is_church_leader(church_id))
  )
  or (
    scope = 'personal'
    and owner_user_id = (select auth.uid())
    and (select private.is_church_member(church_id))
  )
);

create policy conversation_guide_preferences_owner_read
on public.conversation_guide_preferences for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_church_member(church_id))
);

create policy conversation_guide_preferences_owner_insert
on public.conversation_guide_preferences for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.is_church_member(church_id))
  and exists (
    select 1
    from public.conversation_guides guide
    where guide.id = favorite_guide_id
      and guide.church_id = conversation_guide_preferences.church_id
      and (
        guide.scope = 'church'
        or guide.owner_user_id = (select auth.uid())
      )
  )
);

create policy conversation_guide_preferences_owner_update
on public.conversation_guide_preferences for update
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_church_member(church_id))
)
with check (
  user_id = (select auth.uid())
  and (select private.is_church_member(church_id))
  and exists (
    select 1
    from public.conversation_guides guide
    where guide.id = favorite_guide_id
      and guide.church_id = conversation_guide_preferences.church_id
      and (
        guide.scope = 'church'
        or guide.owner_user_id = (select auth.uid())
      )
  )
);

create policy conversation_guide_preferences_owner_delete
on public.conversation_guide_preferences for delete
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_church_member(church_id))
);

revoke all on table public.conversation_guides from public, anon, authenticated;
revoke all on table public.conversation_guide_preferences from public, anon, authenticated;

grant select, delete on table public.conversation_guides to authenticated;
grant insert (
  church_id,
  scope,
  owner_user_id,
  title,
  description,
  steps,
  sort_order,
  created_by,
  updated_by
) on table public.conversation_guides to authenticated;
grant update (title, description, steps, sort_order)
  on table public.conversation_guides to authenticated;

grant select, insert, delete on table public.conversation_guide_preferences to authenticated;
grant update (church_id, user_id, favorite_guide_id)
  on table public.conversation_guide_preferences to authenticated;

comment on table public.conversation_guides is
  'Church-wide guides are leader-managed; personal guides are visible only to their owner.';
comment on table public.conversation_guide_preferences is
  'Each member''s preferred guide for the current church workspace.';

commit;
