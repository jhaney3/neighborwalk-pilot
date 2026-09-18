begin;

-- Parcel publication is intentionally separate from the parcel rows. A row
-- count or a browser/test fixture is not evidence that an entire county was
-- imported. The admin-only importer publishes one county only after that
-- county's complete archive and coverage boundary have been validated.
create table private.outreach_parcel_releases (
  release text not null,
  county_fips text not null check(county_fips in ('47055','47099','47101','47181')),
  source text not null,
  imported_at timestamptz not null default now(),
  complete boolean not null default false,
  expected_rows bigint not null check(expected_rows >= 0),
  imported_rows bigint not null check(imported_rows >= 0),
  coverage extensions.geometry(MultiPolygon, 4326) not null,
  primary key(release, county_fips),
  check(extensions.st_isvalid(coverage) and not extensions.st_isempty(coverage)),
  check(
    not complete or (
      expected_rows = imported_rows
      and imported_rows > 0
    )
  )
);
comment on table private.outreach_parcel_releases is
  'Admin-only publication record for complete Tennessee Comptroller parcel archive imports. Never infer completeness from public.parcels row presence.';
revoke all on table private.outreach_parcel_releases from public, anon, authenticated;

create function private.outreach_public_map_boundary(territory_boundary jsonb)
returns extensions.geometry
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  shape extensions.geometry;
begin
  if territory_boundary is null
    or jsonb_typeof(territory_boundary) not in ('object','array')
    or pg_column_size(territory_boundary) > 100000 then
    raise exception 'A bounded territory polygon is required.' using errcode = '22023';
  end if;

  shape := private.outreach_boundary_polygon(territory_boundary);
  if extensions.st_area(shape::extensions.geography) > 100000000 then
    raise exception 'The requested map area is too large.' using errcode = '22023';
  end if;

  -- This envelope is a deliberately broad guard around only Giles, Lawrence,
  -- Lewis and Wayne counties. Returning NULL lets public callers distinguish
  -- unsupported geography from malformed or dangerously broad input.
  if not extensions.st_coveredby(
    shape,
    extensions.st_makeenvelope(-88.10, 34.90, -86.75, 35.80, 4326)
  ) then
    return null;
  end if;

  return shape;
end
$$;
revoke all on function private.outreach_public_map_boundary(jsonb) from public, anon, authenticated;

create function public.public_map_parcels_for_boundary_v1(territory_boundary jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  shape extensions.geometry;
  manifest private.outreach_parcel_releases;
  loaded_rows bigint;
  loaded_counties integer;
  feature_count integer;
  features jsonb;
begin
  shape := private.outreach_public_map_boundary(territory_boundary);

  if shape is null then
    return jsonb_build_object(
      'datasetRevision', '',
      'complete', false,
      'truncated', false,
      'availability', 'unsupported_area',
      'features', '[]'::jsonb
    );
  end if;

  select release.* into manifest
  from private.outreach_parcel_releases release
  where release.source in (
      'Tennessee Comptroller parcel archives',
      'NeighborWalk hosted parcel snapshot'
    )
    and release.complete
    and extensions.st_covers(release.coverage, shape)
  order by release.imported_at desc, release.release desc
  limit 1;

  if manifest.release is null or not manifest.complete then
    return jsonb_build_object(
      'datasetRevision', coalesce(manifest.release, ''),
      'complete', false,
      'truncated', false,
      'availability', 'missing_inventory',
      'features', '[]'::jsonb
    );
  end if;

  select count(*), count(distinct parcel.county_fips)
    into loaded_rows, loaded_counties
  from public.parcels parcel
  where parcel.county_fips = manifest.county_fips;

  if loaded_rows <> manifest.imported_rows or loaded_counties <> 1 then
    return jsonb_build_object(
      'datasetRevision', manifest.release,
      'complete', false,
      'truncated', false,
      'availability', 'missing_inventory',
      'features', '[]'::jsonb
    );
  end if;

  with candidates as (
    select
      parcel.county_fips,
      parcel.gislink,
      parcel.geometry,
      extensions.st_pointonsurface(parcel.geometry) as representative_point
    from public.parcels parcel
    where parcel.county_fips = manifest.county_fips
      and parcel.is_residential
      and parcel.geometry operator(extensions.&&) shape
      and extensions.st_covers(shape, extensions.st_pointonsurface(parcel.geometry))
    order by parcel.county_fips, parcel.gislink
    limit 5001
  ), counted as (
    select count(*)::integer as count from candidates
  ), limited as (
    select * from candidates limit 5000
  )
  select
    counted.count,
    jsonb_agg(
      jsonb_build_object(
        'county_fips', limited.county_fips,
        'gislink', limited.gislink,
        'geometry', extensions.st_asgeojson(limited.geometry, 6)::jsonb,
        'representative_point', extensions.st_asgeojson(limited.representative_point, 6)::jsonb
      ) order by limited.county_fips, limited.gislink
    ) filter(where limited.gislink is not null)
    into feature_count, features
  from counted
  left join limited on true
  group by counted.count;

  return jsonb_build_object(
    'datasetRevision', manifest.release,
    'complete', feature_count <= 5000,
    'truncated', feature_count > 5000,
    'availability', case when feature_count > 5000 then 'truncated' else 'available' end,
    'features', coalesce(features, '[]'::jsonb)
  );
end
$$;
revoke all on function public.public_map_parcels_for_boundary_v1(jsonb) from public, anon, authenticated;
grant execute on function public.public_map_parcels_for_boundary_v1(jsonb) to anon, authenticated;

create function public.public_map_streets_for_boundary_v1(territory_boundary jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  shape extensions.geometry;
  manifest public.outreach_street_releases;
  feature_count integer;
  features jsonb;
begin
  shape := private.outreach_public_map_boundary(territory_boundary);

  if shape is null then
    return jsonb_build_object(
      'release', '',
      'source', 'Overture transportation',
      'complete', false,
      'truncated', false,
      'availability', 'unsupported_area',
      'features', '[]'::jsonb
    );
  end if;

  select release.* into manifest
  from public.outreach_street_releases release
  where release.source = 'Overture transportation'
  order by release.imported_at desc, release.release desc
  limit 1;

  if manifest.release is null or not manifest.complete
    or manifest.county_fips <> array['47055','47099','47101','47181']::text[]
    or manifest.expected_rows <> manifest.imported_rows
    or manifest.imported_rows <= 0 then
    return jsonb_build_object(
      'release', coalesce(manifest.release, ''),
      'source', 'Overture transportation',
      'complete', false,
      'truncated', false,
      'availability', 'missing_inventory',
      'features', '[]'::jsonb
    );
  end if;

  with candidates as (
    select segment.*
    from public.outreach_street_segments segment
    where segment.release = manifest.release
      and segment.geometry operator(extensions.&&) shape
      and not extensions.st_isempty(
        extensions.st_collectionextract(extensions.st_intersection(segment.geometry, shape), 2)
      )
    order by segment.id
    limit 5001
  ), counted as (
    select count(*)::integer as count from candidates
  ), limited as (
    select * from candidates limit 5000
  )
  select
    counted.count,
    jsonb_agg(
      jsonb_build_object(
        'id', limited.id,
        'name', limited.name,
        'road_class', limited.road_class,
        'subclass', limited.subclass,
        'geometry', extensions.st_asgeojson(limited.geometry, 6)::jsonb,
        'display_geometry', extensions.st_asgeojson(
          extensions.st_multi(
            extensions.st_collectionextract(extensions.st_intersection(limited.geometry, shape), 2)
          ),
          6
        )::jsonb
      ) order by limited.id
    ) filter(where limited.id is not null)
    into feature_count, features
  from counted
  left join limited on true
  group by counted.count;

  return jsonb_build_object(
    'release', manifest.release,
    'source', manifest.source,
    'complete', feature_count <= 5000,
    'truncated', feature_count > 5000,
    'availability', case when feature_count > 5000 then 'truncated' else 'available' end,
    'features', coalesce(features, '[]'::jsonb)
  );
end
$$;
revoke all on function public.public_map_streets_for_boundary_v1(jsonb) from public, anon, authenticated;
grant execute on function public.public_map_streets_for_boundary_v1(jsonb) to anon, authenticated;

-- Keep the authenticated planner contract and authorization unchanged. An
-- empty local dataset is now explicitly unavailable rather than falsely
-- complete; a future manifest conversion can be done without changing the
-- existing authenticated client.
create or replace function public.planning_parcels_for_boundary_v1(territory_boundary jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  shape extensions.geometry;
  feature_count integer;
  features jsonb;
  dataset_revision text;
begin
  if auth.uid() is null or not private.is_real_user()
    or not exists(
      select 1 from public.church_memberships membership
      where membership.user_id = auth.uid() and membership.active
    ) then
    raise exception 'Active church membership is required.' using errcode = '42501';
  end if;
  if territory_boundary is null
    or jsonb_typeof(territory_boundary) not in ('object','array')
    or pg_column_size(territory_boundary) > 100000 then
    raise exception 'A bounded territory polygon is required.' using errcode = '22023';
  end if;
  shape := private.outreach_boundary_polygon(territory_boundary);
  if extensions.st_area(shape::extensions.geography) > 100000000 then
    raise exception 'A valid bounded territory polygon is required.' using errcode = '22023';
  end if;
  select coalesce(
    to_char(max(parcel.imported_at), 'YYYY-MM-DD"T"HH24:MI:SS.USOF'),
    'empty'
  ) into dataset_revision
  from public.parcels parcel;

  with candidates as (
    select parcel.*, extensions.st_pointonsurface(parcel.geometry) as representative_point
    from public.parcels parcel
    where parcel.is_residential
      and parcel.geometry operator(extensions.&&) shape
      and extensions.st_covers(shape, extensions.st_pointonsurface(parcel.geometry))
    order by parcel.county_fips, parcel.gislink
    limit 5001
  ), counted as (
    select count(*)::integer as count from candidates
  ), limited as (
    select * from candidates limit 5000
  )
  select
    counted.count,
    jsonb_agg(
      jsonb_build_object(
        'county_fips', limited.county_fips,
        'gislink', limited.gislink,
        'geometry', extensions.st_asgeojson(limited.geometry, 6)::jsonb,
        'representative_point', extensions.st_asgeojson(limited.representative_point, 6)::jsonb
      ) order by limited.county_fips, limited.gislink
    ) filter(where limited.gislink is not null)
    into feature_count, features
  from counted
  left join limited on true
  group by counted.count;

  return jsonb_build_object(
    'datasetRevision', dataset_revision,
    'complete', feature_count between 1 and 5000,
    'truncated', feature_count > 5000,
    'availability', case
      when feature_count > 5000 then 'truncated'
      when feature_count = 0 then 'missing_inventory'
      else 'available'
    end,
    'features', coalesce(features, '[]'::jsonb)
  );
end
$$;
revoke all on function public.planning_parcels_for_boundary_v1(jsonb) from public, anon;
grant execute on function public.planning_parcels_for_boundary_v1(jsonb) to authenticated;

commit;
