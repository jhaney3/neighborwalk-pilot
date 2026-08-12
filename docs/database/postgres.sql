-- NeighborWalk production PostgreSQL schema
-- PostgreSQL 16+ with PostGIS. IDs exposed to clients are public_id values;
-- internal relationships use sequential bigint keys for index locality.

begin;

create extension if not exists postgis;

create schema if not exists app_private;

create or replace function app_private.current_user_id()
returns bigint
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.user_id', true), '')::bigint;
$$;

create table if not exists public.churches (
  id bigint generated always as identity primary key,
  public_id text not null unique,
  name text not null,
  timezone text not null default 'UTC',
  retention_days integer not null default 365 check (retention_days between 30 and 3650),
  default_follow_up_days integer not null default 3 check (default_follow_up_days between 1 and 90),
  require_follow_up_consent boolean not null default true,
  note_character_limit integer not null default 500 check (note_character_limit between 80 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(name) between 1 and 120),
  check (length(public_id) between 12 and 80)
);

create table if not exists public.users (
  id bigint generated always as identity primary key,
  public_id text not null unique,
  external_subject text not null unique,
  email text,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(display_name) between 1 and 120),
  check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create table if not exists public.church_memberships (
  church_id bigint not null references public.churches(id) on delete cascade,
  user_id bigint not null references public.users(id) on delete cascade,
  role text not null check (role in ('leader', 'volunteer')),
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (church_id, user_id)
);

create index if not exists church_memberships_user_id_idx on public.church_memberships (user_id, church_id) where active;

create table if not exists public.outreach_events (
  id bigint generated always as identity primary key,
  public_id text not null unique,
  church_id bigint not null references public.churches(id) on delete cascade,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'completed')),
  created_by bigint not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (length(name) between 1 and 160)
);

create index if not exists outreach_events_church_starts_idx on public.outreach_events (church_id, starts_at desc);
create index if not exists outreach_events_created_by_idx on public.outreach_events (created_by);

create table if not exists public.teams (
  id bigint generated always as identity primary key,
  public_id text not null unique,
  church_id bigint not null references public.churches(id) on delete cascade,
  event_id bigint not null references public.outreach_events(id) on delete cascade,
  name text not null,
  status text not null default 'ready' check (status in ('ready', 'active', 'finished')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(name) between 1 and 120)
);

create index if not exists teams_church_event_idx on public.teams (church_id, event_id);
create index if not exists teams_event_id_idx on public.teams (event_id);

create table if not exists public.team_members (
  team_id bigint not null references public.teams(id) on delete cascade,
  user_id bigint not null references public.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_id_idx on public.team_members (user_id, team_id);

create table if not exists public.territories (
  id bigint generated always as identity primary key,
  public_id text not null unique,
  church_id bigint not null references public.churches(id) on delete cascade,
  event_id bigint not null references public.outreach_events(id) on delete cascade,
  assigned_team_id bigint references public.teams(id) on delete set null,
  name text not null,
  color text not null default '#286c59' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  center geography(point, 4326) not null,
  boundary geometry(polygon, 4326) not null,
  default_zoom double precision not null default 15.5 check (default_zoom between 1 and 22),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(name) between 1 and 120),
  check (st_isvalid(boundary))
);

create index if not exists territories_church_event_idx on public.territories (church_id, event_id);
create index if not exists territories_event_id_idx on public.territories (event_id);
create index if not exists territories_assigned_team_id_idx on public.territories (assigned_team_id) where assigned_team_id is not null;
create index if not exists territories_boundary_gist_idx on public.territories using gist (boundary);
create index if not exists territories_center_gist_idx on public.territories using gist (center);

create table if not exists public.properties (
  id bigint generated always as identity primary key,
  public_id text not null unique,
  church_id bigint not null references public.churches(id) on delete cascade,
  territory_id bigint not null references public.territories(id) on delete cascade,
  address text not null,
  unit text,
  location geography(point, 4326) not null,
  building_geometry geometry(polygon, 4326),
  current_outcome text not null default 'unvisited' check (current_outcome in ('unvisited', 'no_answer', 'conversation', 'follow_up', 'declined', 'do_not_visit', 'inaccessible')),
  last_visited_at timestamptz,
  visit_count integer not null default 0 check (visit_count >= 0),
  source text not null default 'map' check (source in ('map', 'import', 'seed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (length(address) between 1 and 240),
  check (unit is null or length(unit) <= 60),
  check (building_geometry is null or st_isvalid(building_geometry))
);

create index if not exists properties_territory_outcome_idx on public.properties (territory_id, current_outcome) where deleted_at is null;
create index if not exists properties_church_updated_idx on public.properties (church_id, updated_at desc) where deleted_at is null;
create index if not exists properties_location_gist_idx on public.properties using gist (location) where deleted_at is null;
create index if not exists properties_building_geometry_gist_idx on public.properties using gist (building_geometry) where building_geometry is not null and deleted_at is null;

create table if not exists public.visits (
  id bigint generated always as identity primary key,
  public_id text not null unique,
  church_id bigint not null references public.churches(id) on delete cascade,
  event_id bigint not null references public.outreach_events(id) on delete restrict,
  territory_id bigint not null references public.territories(id) on delete restrict,
  property_id bigint not null references public.properties(id) on delete restrict,
  volunteer_id bigint not null references public.users(id) on delete restrict,
  outcome text not null check (outcome in ('no_answer', 'conversation', 'follow_up', 'declined', 'do_not_visit', 'inaccessible')),
  objective_note text,
  follow_up_consent boolean not null default false,
  device_id text not null,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (objective_note is null or length(objective_note) <= 2000),
  check (outcome <> 'follow_up' or follow_up_consent),
  check (length(device_id) between 8 and 120)
);

create index if not exists visits_property_recorded_idx on public.visits (property_id, recorded_at desc) where deleted_at is null;
create index if not exists visits_territory_recorded_idx on public.visits (territory_id, recorded_at desc) where deleted_at is null;
create index if not exists visits_church_received_id_idx on public.visits (church_id, received_at, id) where deleted_at is null;
create index if not exists visits_event_id_idx on public.visits (event_id);
create index if not exists visits_volunteer_id_idx on public.visits (volunteer_id);

create table if not exists public.follow_ups (
  id bigint generated always as identity primary key,
  public_id text not null unique,
  church_id bigint not null references public.churches(id) on delete cascade,
  property_id bigint not null references public.properties(id) on delete restrict,
  source_visit_id bigint not null unique references public.visits(id) on delete restrict,
  assigned_team_id bigint references public.teams(id) on delete set null,
  due_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  note text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (note is null or length(note) <= 2000),
  check ((status = 'completed') = (completed_at is not null))
);

create index if not exists follow_ups_church_due_scheduled_idx on public.follow_ups (church_id, due_at, id) where status = 'scheduled';
create index if not exists follow_ups_property_id_idx on public.follow_ups (property_id);
create index if not exists follow_ups_assigned_team_due_idx on public.follow_ups (assigned_team_id, due_at) where status = 'scheduled' and assigned_team_id is not null;

create table if not exists public.guide_steps (
  id bigint generated always as identity primary key,
  public_id text not null unique,
  church_id bigint not null references public.churches(id) on delete cascade,
  step_order integer not null check (step_order > 0),
  eyebrow text not null,
  title text not null,
  coaching text not null,
  sample_words text not null,
  reminder text not null,
  scripture_references text[] not null default '{}',
  published boolean not null default false,
  updated_by bigint not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (church_id, step_order),
  check (length(eyebrow) between 1 and 80),
  check (length(title) between 1 and 120),
  check (length(coaching) between 1 and 800),
  check (length(sample_words) between 1 and 1600),
  check (length(reminder) between 1 and 800)
);

create index if not exists guide_steps_church_published_order_idx on public.guide_steps (church_id, published, step_order);
create index if not exists guide_steps_updated_by_idx on public.guide_steps (updated_by);

create table if not exists public.audit_entries (
  id bigint generated always as identity primary key,
  public_id text not null unique,
  church_id bigint not null references public.churches(id) on delete cascade,
  actor_id bigint not null references public.users(id) on delete restrict,
  action text not null,
  entity_type text not null check (entity_type in ('property', 'visit', 'follow_up', 'territory', 'settings', 'guide', 'data')),
  entity_public_id text not null,
  summary text not null,
  created_at timestamptz not null default now(),
  check (length(summary) between 1 and 500)
);

create index if not exists audit_entries_church_created_id_idx on public.audit_entries (church_id, created_at desc, id desc);
create index if not exists audit_entries_actor_id_idx on public.audit_entries (actor_id);

create table if not exists public.sync_mutations (
  id bigint generated always as identity primary key,
  church_id bigint not null references public.churches(id) on delete cascade,
  mutation_id text not null,
  device_id text not null,
  actor_id bigint not null references public.users(id) on delete restrict,
  entity_type text not null,
  entity_public_id text not null,
  operation text not null check (operation in ('upsert', 'delete')),
  received_at timestamptz not null default now(),
  unique (church_id, mutation_id)
);

create index if not exists sync_mutations_church_received_id_idx on public.sync_mutations (church_id, received_at, id);
create index if not exists sync_mutations_actor_id_idx on public.sync_mutations (actor_id);

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['churches', 'users', 'outreach_events', 'teams', 'territories', 'properties', 'follow_ups', 'guide_steps']
  loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', table_name, table_name);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function app_private.set_updated_at()', table_name, table_name);
  end loop;
end $$;

-- Row-level security. The API must set app.user_id with SET LOCAL inside each
-- short transaction after verifying the request's authenticated identity.
create or replace function app_private.is_member(target_church_id bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.church_memberships membership
    where membership.church_id = target_church_id
      and membership.user_id = (select app_private.current_user_id())
      and membership.active
  );
$$;

create or replace function app_private.is_leader(target_church_id bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.church_memberships membership
    where membership.church_id = target_church_id
      and membership.user_id = (select app_private.current_user_id())
      and membership.role = 'leader'
      and membership.active
  );
$$;

alter table public.users enable row level security;
alter table public.churches enable row level security;
alter table public.church_memberships enable row level security;
alter table public.outreach_events enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.territories enable row level security;
alter table public.properties enable row level security;
alter table public.visits enable row level security;
alter table public.follow_ups enable row level security;
alter table public.guide_steps enable row level security;
alter table public.audit_entries enable row level security;
alter table public.sync_mutations enable row level security;

alter table public.users force row level security;
alter table public.churches force row level security;
alter table public.church_memberships force row level security;
alter table public.outreach_events force row level security;
alter table public.teams force row level security;
alter table public.team_members force row level security;
alter table public.territories force row level security;
alter table public.properties force row level security;
alter table public.visits force row level security;
alter table public.follow_ups force row level security;
alter table public.guide_steps force row level security;
alter table public.audit_entries force row level security;
alter table public.sync_mutations force row level security;

-- These drops make the policy section safe to revise and rerun in development.
drop policy if exists church_memberships_self on public.church_memberships;
drop policy if exists churches_member_read on public.churches;
drop policy if exists outreach_events_member_all on public.outreach_events;
drop policy if exists teams_member_all on public.teams;
drop policy if exists territories_member_all on public.territories;
drop policy if exists properties_member_all on public.properties;
drop policy if exists visits_member_all on public.visits;
drop policy if exists follow_ups_member_all on public.follow_ups;
drop policy if exists guide_steps_member_all on public.guide_steps;
drop policy if exists team_members_member_all on public.team_members;
drop policy if exists audit_entries_member_read on public.audit_entries;
drop policy if exists audit_entries_member_insert on public.audit_entries;
drop policy if exists sync_mutations_member_all on public.sync_mutations;
drop policy if exists users_self_read on public.users;
drop policy if exists users_self_update on public.users;
drop policy if exists churches_leader_update on public.churches;
drop policy if exists outreach_events_member_read on public.outreach_events;
drop policy if exists outreach_events_leader_insert on public.outreach_events;
drop policy if exists outreach_events_leader_update on public.outreach_events;
drop policy if exists outreach_events_leader_delete on public.outreach_events;
drop policy if exists teams_member_read on public.teams;
drop policy if exists teams_leader_write on public.teams;
drop policy if exists territories_member_read on public.territories;
drop policy if exists territories_leader_write on public.territories;
drop policy if exists visits_member_read on public.visits;
drop policy if exists visits_self_insert on public.visits;
drop policy if exists follow_ups_member_read on public.follow_ups;
drop policy if exists follow_ups_member_write on public.follow_ups;
drop policy if exists guide_steps_member_read on public.guide_steps;
drop policy if exists guide_steps_leader_write on public.guide_steps;
drop policy if exists team_members_member_read on public.team_members;
drop policy if exists team_members_leader_write on public.team_members;

create policy users_self_read on public.users for select
  using (id = (select app_private.current_user_id()));
create policy users_self_update on public.users for update
  using (id = (select app_private.current_user_id()))
  with check (id = (select app_private.current_user_id()));

create policy church_memberships_self on public.church_memberships for select
  using (user_id = (select app_private.current_user_id()) and active);
create policy churches_member_read on public.churches for select
  using ((select app_private.is_member(id)));
create policy churches_leader_update on public.churches for update
  using ((select app_private.is_leader(id)))
  with check ((select app_private.is_leader(id)));

create policy outreach_events_member_read on public.outreach_events for select
  using ((select app_private.is_member(church_id)));
create policy outreach_events_leader_insert on public.outreach_events for insert
  with check ((select app_private.is_leader(church_id)) and created_by = (select app_private.current_user_id()));
create policy outreach_events_leader_update on public.outreach_events for update
  using ((select app_private.is_leader(church_id)))
  with check ((select app_private.is_leader(church_id)));
create policy outreach_events_leader_delete on public.outreach_events for delete
  using ((select app_private.is_leader(church_id)));

create policy teams_member_read on public.teams for select
  using ((select app_private.is_member(church_id)));
create policy teams_leader_write on public.teams for all
  using ((select app_private.is_leader(church_id)))
  with check ((select app_private.is_leader(church_id)));

create policy territories_member_read on public.territories for select
  using ((select app_private.is_member(church_id)));
create policy territories_leader_write on public.territories for all
  using ((select app_private.is_leader(church_id)))
  with check ((select app_private.is_leader(church_id)));

create policy properties_member_all on public.properties for all
  using ((select app_private.is_member(church_id)))
  with check ((select app_private.is_member(church_id)));

-- Visit history is append-only for application roles. Corrections and erasure
-- use a narrowly scoped privileged maintenance job and retain an audit entry.
create policy visits_member_read on public.visits for select
  using ((select app_private.is_member(church_id)));
create policy visits_self_insert on public.visits for insert
  with check ((select app_private.is_member(church_id)) and volunteer_id = (select app_private.current_user_id()));

create policy follow_ups_member_read on public.follow_ups for select
  using ((select app_private.is_member(church_id)));
create policy follow_ups_member_write on public.follow_ups for all
  using ((select app_private.is_member(church_id)))
  with check ((select app_private.is_member(church_id)));

create policy guide_steps_member_read on public.guide_steps for select
  using ((select app_private.is_member(church_id)) and published);
create policy guide_steps_leader_write on public.guide_steps for all
  using ((select app_private.is_leader(church_id)))
  with check ((select app_private.is_leader(church_id)));

-- team_members reaches church_id through teams. Only leaders may change rosters.
create policy team_members_member_read on public.team_members for select
  using (exists (
    select 1 from public.teams team
    where team.id = team_members.team_id
      and (select app_private.is_member(team.church_id))
  ));
create policy team_members_leader_write on public.team_members for all
  using (exists (
    select 1 from public.teams team
    where team.id = team_members.team_id
      and (select app_private.is_leader(team.church_id))
  ))
  with check (exists (
    select 1 from public.teams team
    where team.id = team_members.team_id
      and (select app_private.is_leader(team.church_id))
  ));

create policy audit_entries_member_read on public.audit_entries for select
  using ((select app_private.is_member(church_id)));
create policy audit_entries_member_insert on public.audit_entries for insert
  with check (actor_id = (select app_private.current_user_id()) and (select app_private.is_member(church_id)));
create policy sync_mutations_member_all on public.sync_mutations for all
  using (actor_id = (select app_private.current_user_id()))
  with check (actor_id = (select app_private.current_user_id()) and (select app_private.is_member(church_id)));

commit;
