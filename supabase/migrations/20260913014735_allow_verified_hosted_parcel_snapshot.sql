begin;

-- A verified copy from the existing NeighborWalk Supabase project is truthful
-- provenance for this local preview. It is intentionally distinct from a
-- directly inspected Tennessee Comptroller archive.
create or replace function public.public_map_parcels_for_boundary_v1(territory_boundary jsonb)
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

commit;
