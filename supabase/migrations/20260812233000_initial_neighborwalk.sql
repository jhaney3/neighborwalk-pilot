begin;

create extension if not exists postgis with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.churches (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Chicago',
  retention_days integer not null default 365 check (retention_days between 30 and 3650),
  default_follow_up_days integer not null default 3 check (default_follow_up_days between 1 and 90),
  require_follow_up_consent boolean not null default true,
  note_character_limit integer not null default 500 check (note_character_limit between 80 and 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(name)) between 1 and 120)
);

create index churches_created_by_idx on public.churches (created_by);

create table public.church_memberships (
  church_id uuid not null references public.churches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('leader', 'volunteer')),
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (church_id, user_id)
);

create index church_memberships_active_user_idx
  on public.church_memberships (user_id, church_id)
  where active;

create table public.workspace_snapshots (
  church_id uuid primary key references public.churches(id) on delete cascade,
  schema_version integer not null check (schema_version > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create index workspace_snapshots_updated_by_idx on public.workspace_snapshots (updated_by);

create table public.parcels (
  id bigint generated always as identity primary key,
  county_fips text not null,
  gislink text not null,
  situs_address text,
  property_class text,
  land_use text,
  is_residential boolean,
  geometry extensions.geometry(multipolygon, 4326) not null,
  source_updated_on date,
  imported_at timestamptz not null default now(),
  unique (county_fips, gislink),
  check (county_fips ~ '^[0-9]{5}$'),
  check (length(gislink) between 1 and 120),
  check (situs_address is null or length(situs_address) <= 300),
  check (extensions.st_isvalid(geometry))
);

create index parcels_county_fips_idx on public.parcels (county_fips);
create index parcels_geometry_gist_idx on public.parcels using gist (geometry);

create or replace function private.is_real_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
$$;

create or replace function private.is_church_member(target_church_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_real_user()) and exists (
    select 1
    from public.church_memberships membership
    where membership.church_id = target_church_id
      and membership.user_id = (select auth.uid())
      and membership.active
  );
$$;

create or replace function private.is_church_leader(target_church_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_real_user()) and exists (
    select 1
    from public.church_memberships membership
    where membership.church_id = target_church_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'leader'
      and membership.active
  );
$$;

create or replace function private.has_active_membership()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_real_user()) and exists (
    select 1
    from public.church_memberships membership
    where membership.user_id = (select auth.uid())
      and membership.active
  );
$$;

create or replace function private.touch_church()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger churches_touch_updated_at
before update on public.churches
for each row execute function private.touch_church();

create or replace function private.version_workspace_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.revision = old.revision + 1;
  new.updated_by = (select auth.uid());
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspace_snapshots_version_update
before update on public.workspace_snapshots
for each row execute function private.version_workspace_snapshot();

create or replace function public.create_church_workspace(
  workspace_name text,
  initial_data jsonb,
  initial_schema_version integer
)
returns table (church_id uuid, role text, revision bigint, data jsonb)
language plpgsql
security definer
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

create or replace function public.parcels_in_view(
  min_lat double precision,
  min_long double precision,
  max_lat double precision,
  max_long double precision,
  target_county_fips text default '47099',
  result_limit integer default 2500
)
returns table (
  id bigint,
  gislink text,
  situs_address text,
  property_class text,
  land_use text,
  is_residential boolean,
  geometry jsonb
)
language sql
stable
set search_path = ''
as $$
  select
    parcel.id,
    parcel.gislink,
    parcel.situs_address,
    parcel.property_class,
    parcel.land_use,
    parcel.is_residential,
    extensions.st_asgeojson(parcel.geometry)::jsonb
  from public.parcels parcel
  where parcel.county_fips = target_county_fips
    and parcel.geometry operator(extensions.&&)
      extensions.st_makeenvelope(min_long, min_lat, max_long, max_lat, 4326)
  order by parcel.id
  limit least(greatest(coalesce(result_limit, 2500), 1), 5000);
$$;

alter table public.churches enable row level security;
alter table public.church_memberships enable row level security;
alter table public.workspace_snapshots enable row level security;
alter table public.parcels enable row level security;

create policy churches_member_read
on public.churches for select
to authenticated
using ((select private.is_church_member(id)));

create policy churches_leader_update
on public.churches for update
to authenticated
using ((select private.is_church_leader(id)))
with check ((select private.is_church_leader(id)));

create policy memberships_self_or_leader_read
on public.church_memberships for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_church_leader(church_id))
);

create policy workspace_snapshots_member_read
on public.workspace_snapshots for select
to authenticated
using ((select private.is_church_member(church_id)));

create policy workspace_snapshots_member_update
on public.workspace_snapshots for update
to authenticated
using ((select private.is_church_member(church_id)))
with check (
  (select private.is_church_member(church_id))
  and updated_by = (select auth.uid())
);

create policy parcels_member_read
on public.parcels for select
to authenticated
using ((select private.has_active_membership()));

revoke all on table public.churches from anon, authenticated;
revoke all on table public.church_memberships from anon, authenticated;
revoke all on table public.workspace_snapshots from anon, authenticated;
revoke all on table public.parcels from anon, authenticated;

grant select on table public.churches to authenticated;
grant update (name, timezone, retention_days, default_follow_up_days, require_follow_up_consent, note_character_limit)
  on table public.churches to authenticated;
grant select on table public.church_memberships to authenticated;
grant select on table public.workspace_snapshots to authenticated;
grant update (schema_version, data) on table public.workspace_snapshots to authenticated;
grant select on table public.parcels to authenticated;

revoke execute on function private.is_real_user() from public, anon;
revoke execute on function private.is_church_member(uuid) from public, anon;
revoke execute on function private.is_church_leader(uuid) from public, anon;
revoke execute on function private.has_active_membership() from public, anon;
grant execute on function private.is_real_user() to authenticated;
grant execute on function private.is_church_member(uuid) to authenticated;
grant execute on function private.is_church_leader(uuid) to authenticated;
grant execute on function private.has_active_membership() to authenticated;

revoke execute on function public.create_church_workspace(text, jsonb, integer) from public, anon;
grant execute on function public.create_church_workspace(text, jsonb, integer) to authenticated;
revoke execute on function public.parcels_in_view(double precision, double precision, double precision, double precision, text, integer) from public, anon;
grant execute on function public.parcels_in_view(double precision, double precision, double precision, double precision, text, integer) to authenticated;

comment on table public.workspace_snapshots is
  'Offline-first NeighborWalk workspace document. Access is restricted to active church members by RLS.';
comment on table public.parcels is
  'Public-assessment parcel boundaries imported without owner names or assessed values.';

commit;
