begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Ordinary ministry records have their own rows, tenant-consistent keys and
-- versions. Existing snapshots and protected-person records are preserved.
create table public.outreach_outings (
  church_id uuid not null references public.churches(id),
  id text not null check (length(id) between 1 and 190),
  name text not null check (length(btrim(name)) between 1 and 160),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/Chicago',
  purpose text not null default '' check (length(purpose) <= 1000),
  meeting_point text not null default '' check (length(meeting_point) <= 300),
  leader_contact text not null default '' check (length(leader_contact) <= 254),
  status text not null default 'draft' check (status in ('draft','scheduled','ready','active','completed','cancelled','archived')),
  guide_id uuid,
  debrief text not null default '' check (length(debrief) <= 2000),
  version bigint not null default 1 check (version > 0),
  deleted_at timestamptz,
  primary key (church_id,id),
  check (ends_at >= starts_at),
  foreign key (guide_id,church_id) references public.conversation_guides(id,church_id)
);
create index outreach_outings_schedule_idx on public.outreach_outings(church_id,starts_at) where deleted_at is null;
create index outreach_outings_guide_idx on public.outreach_outings(guide_id);

create table public.outreach_teams (
  church_id uuid not null references public.churches(id),
  id text not null check (length(id) between 1 and 190),
  name text not null check (length(btrim(name)) between 1 and 120),
  status text not null default 'ready' check (status in ('ready','active','finished')),
  legacy_event_id text,
  version bigint not null default 1 check (version > 0),
  deleted_at timestamptz,
  primary key (church_id,id)
);

create table public.outreach_team_members (
  church_id uuid not null,
  team_id text not null,
  volunteer_id text not null,
  user_id uuid,
  primary key (church_id,team_id,volunteer_id),
  foreign key (church_id,team_id) references public.outreach_teams(church_id,id),
  foreign key (church_id,user_id) references public.church_memberships(church_id,user_id)
);
create index outreach_team_members_user_idx on public.outreach_team_members(church_id,user_id);

create table public.outreach_territories (
  church_id uuid not null references public.churches(id),
  id text not null check (length(id) between 1 and 190),
  name text not null check (length(btrim(name)) between 1 and 120),
  color text not null default '#286c59' check (color ~ '^#[0-9a-fA-F]{6}$'),
  longitude double precision not null check (longitude between -180 and 180),
  latitude double precision not null check (latitude between -90 and 90),
  zoom double precision not null default 15 check (zoom between 1 and 22),
  boundary jsonb not null default '[]' check (jsonb_typeof(boundary)='array'),
  legacy_event_id text,
  version bigint not null default 1 check (version > 0),
  deleted_at timestamptz,
  primary key (church_id,id)
);

create table public.outreach_assignments (
  church_id uuid not null,
  id text not null check (length(id) between 1 and 240),
  outing_id text not null,
  territory_id text not null,
  team_id text,
  assignee_id uuid,
  status text not null default 'assigned' check (status in ('assigned','accepted','completed','declined','cancelled')),
  version bigint not null default 1 check (version > 0),
  deleted_at timestamptz,
  primary key (church_id,id),
  foreign key (church_id,outing_id) references public.outreach_outings(church_id,id),
  foreign key (church_id,territory_id) references public.outreach_territories(church_id,id),
  foreign key (church_id,team_id) references public.outreach_teams(church_id,id),
  foreign key (church_id,assignee_id) references public.church_memberships(church_id,user_id),
  check (team_id is not null or assignee_id is not null)
);
create unique index outreach_assignment_active_area_idx on public.outreach_assignments(church_id,outing_id,territory_id)
  where deleted_at is null and status not in ('declined','cancelled');
create index outreach_assignments_territory_idx on public.outreach_assignments(church_id,territory_id);
create index outreach_assignments_team_idx on public.outreach_assignments(church_id,team_id);
create index outreach_assignments_assignee_idx on public.outreach_assignments(church_id,assignee_id);

create table public.outreach_locations (
  church_id uuid not null references public.churches(id),
  id text not null check (length(id) between 1 and 190),
  territory_id text,
  legacy_territory_id text,
  address text not null check (length(btrim(address)) between 1 and 240),
  unit text check (length(unit) <= 60),
  longitude double precision check (longitude between -180 and 180),
  latitude double precision check (latitude between -90 and 90),
  building_geometry jsonb check (building_geometry is null or jsonb_typeof(building_geometry)='array'),
  parcel_reference jsonb check (parcel_reference is null or jsonb_typeof(parcel_reference)='object'),
  source text not null default 'map' check (source in ('seed','map','import','manual')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  deleted_at timestamptz,
  primary key (church_id,id),
  foreign key (church_id,territory_id) references public.outreach_territories(church_id,id),
  foreign key (church_id,created_by) references public.church_memberships(church_id,user_id),
  check ((longitude is null) = (latitude is null))
);
create index outreach_locations_territory_idx on public.outreach_locations(church_id,territory_id);
create index outreach_locations_creator_idx on public.outreach_locations(church_id,created_by);
create index outreach_locations_address_idx on public.outreach_locations(church_id,lower(address),lower(coalesce(unit,'')));

-- A person can be met at a meal, through a referral, or without sharing an
-- address. The optional relationship is validated against the same tenant.
alter table public.discipleship_people alter column property_id drop not null;
alter table public.discipleship_people add column version bigint not null default 1 check (version > 0);
alter table public.discipleship_people add column deleted_at timestamptz;
alter table public.discipleship_people add column contact_permission text not null default 'not_recorded'
  check (contact_permission in ('not_recorded','requested','do_not_contact'));
alter table public.discipleship_person_notes add column version bigint not null default 1 check (version > 0);
alter table public.discipleship_person_notes add column deleted_at timestamptz;

create table public.outreach_encounters (
  church_id uuid not null references public.churches(id),
  id text not null check (length(id) between 1 and 190),
  outing_id text,
  territory_id text,
  location_id text,
  person_id text,
  legacy_links jsonb not null default '{}' check (jsonb_typeof(legacy_links)='object'),
  actor_id uuid,
  actor_key text not null,
  outcome text not null check (outcome in ('no_answer','conversation','follow_up','declined','do_not_visit','inaccessible')),
  context text not null default 'door' check (context in ('door','community_meal','service','referral','other')),
  objective_note text check (length(objective_note) <= 2000),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  device_id text not null,
  version bigint not null default 1 check (version > 0),
  deleted_at timestamptz,
  primary key (church_id,id),
  foreign key (church_id,outing_id) references public.outreach_outings(church_id,id),
  foreign key (church_id,territory_id) references public.outreach_territories(church_id,id),
  foreign key (church_id,location_id) references public.outreach_locations(church_id,id),
  foreign key (person_id,church_id) references public.discipleship_people(id,church_id),
  foreign key (church_id,actor_id) references public.church_memberships(church_id,user_id)
);
create index outreach_encounters_location_idx on public.outreach_encounters(church_id,location_id,occurred_at desc);
create index outreach_encounters_outing_idx on public.outreach_encounters(church_id,outing_id,occurred_at desc);
create index outreach_encounters_territory_idx on public.outreach_encounters(church_id,territory_id);
create index outreach_encounters_person_idx on public.outreach_encounters(person_id,church_id);
create index outreach_encounters_actor_idx on public.outreach_encounters(church_id,actor_id);

create table public.outreach_tasks (
  church_id uuid not null references public.churches(id),
  id text not null check (length(id) between 1 and 240),
  person_id text,
  location_id text,
  encounter_id text,
  outing_id text,
  team_id text,
  owner_id uuid,
  created_by uuid,
  due_date date not null,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  acceptance text not null default 'accepted' check (acceptance in ('pending','accepted','declined')),
  note text check (length(note) <= 2000),
  completion_note text check (length(completion_note) <= 2000),
  parent_task_id text,
  legacy_links jsonb not null default '{}' check (jsonb_typeof(legacy_links)='object'),
  legacy_due_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  deleted_at timestamptz,
  primary key (church_id,id),
  foreign key (person_id,church_id) references public.discipleship_people(id,church_id),
  foreign key (church_id,location_id) references public.outreach_locations(church_id,id),
  foreign key (church_id,encounter_id) references public.outreach_encounters(church_id,id),
  foreign key (church_id,outing_id) references public.outreach_outings(church_id,id),
  foreign key (church_id,team_id) references public.outreach_teams(church_id,id),
  foreign key (church_id,owner_id) references public.church_memberships(church_id,user_id),
  foreign key (church_id,created_by) references public.church_memberships(church_id,user_id)
);
create index outreach_tasks_person_idx on public.outreach_tasks(person_id,church_id);
create index outreach_tasks_location_idx on public.outreach_tasks(church_id,location_id);
create index outreach_tasks_encounter_idx on public.outreach_tasks(church_id,encounter_id);
create index outreach_tasks_outing_idx on public.outreach_tasks(church_id,outing_id);
create index outreach_tasks_team_idx on public.outreach_tasks(church_id,team_id);
create index outreach_tasks_owner_due_idx on public.outreach_tasks(church_id,owner_id,due_date) where deleted_at is null;
create index outreach_tasks_creator_idx on public.outreach_tasks(church_id,created_by);

create table public.outreach_task_activity (
  church_id uuid not null,
  task_id text not null,
  id text not null,
  action text not null check (action in ('created','rescheduled','note','completed','cancelled','reassigned','accepted','declined')),
  actor_id uuid,
  actor_key text not null,
  note text check (length(note) <= 2000),
  due_date date,
  occurred_at timestamptz not null default now(),
  primary key (church_id,task_id,id),
  foreign key (church_id,task_id) references public.outreach_tasks(church_id,id),
  foreign key (church_id,actor_id) references public.church_memberships(church_id,user_id)
);
create index outreach_task_activity_actor_idx on public.outreach_task_activity(church_id,actor_id);

create table public.outreach_restrictions (
  church_id uuid not null references public.churches(id),
  id text not null,
  person_id text,
  location_id text,
  channel text not null check (channel in ('all','visit','call','text','email')),
  active boolean not null default true,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  corrected_by uuid,
  corrected_at timestamptz,
  correction_reason text check (length(btrim(correction_reason)) between 1 and 500),
  version bigint not null default 1 check (version > 0),
  primary key (church_id,id),
  check ((person_id is null) <> (location_id is null)),
  check (active or (corrected_by is not null and corrected_at is not null and correction_reason is not null)),
  foreign key (person_id,church_id) references public.discipleship_people(id,church_id),
  foreign key (church_id,location_id) references public.outreach_locations(church_id,id),
  foreign key (church_id,created_by) references public.church_memberships(church_id,user_id),
  foreign key (church_id,corrected_by) references public.church_memberships(church_id,user_id)
);
create unique index outreach_restrictions_active_idx on public.outreach_restrictions(church_id,coalesce(person_id,''),coalesce(location_id,''),channel) where active;
create index outreach_restrictions_person_idx on public.outreach_restrictions(person_id,church_id);
create index outreach_restrictions_location_idx on public.outreach_restrictions(church_id,location_id);
create index outreach_restrictions_creator_idx on public.outreach_restrictions(church_id,created_by);
create index outreach_restrictions_corrector_idx on public.outreach_restrictions(church_id,corrected_by);

create table public.outreach_audit (
  sequence bigint generated always as identity primary key,
  church_id uuid not null references public.churches(id),
  actor_id uuid not null,
  command_id text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  occurred_at timestamptz not null default now(),
  foreign key (church_id,actor_id) references public.church_memberships(church_id,user_id)
);
create index outreach_audit_church_sequence_idx on public.outreach_audit(church_id,sequence);
create index outreach_audit_actor_idx on public.outreach_audit(church_id,actor_id);

create table private.outreach_receipts (
  church_id uuid not null,
  actor_id uuid not null,
  command_id text not null check (length(command_id) between 1 and 190),
  payload_hash text not null,
  result jsonb not null,
  received_at timestamptz not null default now(),
  primary key (church_id,actor_id,command_id),
  foreign key (church_id,actor_id) references public.church_memberships(church_id,user_id)
);
alter table private.outreach_receipts enable row level security;
revoke all on private.outreach_receipts from public,anon,authenticated;

create table public.outreach_migration_issues (
  church_id uuid not null references public.churches(id),
  entity_type text not null,
  entity_id text not null,
  issue text not null,
  resolved_at timestamptz,
  primary key (church_id,entity_type,entity_id,issue)
);

-- No new table receives implicit browser write privileges. Commands will be
-- the only write interface, with server-derived identity and explicit checks.
do $$ declare tab text; begin
  foreach tab in array array['outreach_outings','outreach_teams','outreach_team_members','outreach_territories','outreach_assignments','outreach_locations','outreach_encounters','outreach_tasks','outreach_task_activity','outreach_restrictions','outreach_audit','outreach_migration_issues'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public,anon,authenticated',tab);
    execute format('grant select on public.%I to authenticated',tab);
  end loop;
end $$;

-- RLS policies, preservation backfill and command helpers follow in the next
-- migrations. Deploy the full sequence, never this incomplete foundation alone.

commit;
