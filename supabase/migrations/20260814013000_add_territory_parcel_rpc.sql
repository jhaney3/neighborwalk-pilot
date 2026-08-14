create index if not exists parcels_imported_at_idx
  on public.parcels (imported_at desc);

create or replace function public.parcels_for_territory_v1(
  territory_geometry jsonb,
  buffer_meters double precision default 35,
  result_limit integer default 12000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  territory_shape extensions.geometry;
  search_shape extensions.geometry;
  bounded_limit integer := least(greatest(result_limit, 1), 12000);
  bounded_buffer double precision := least(greatest(buffer_meters, 0), 250);
  matching_count bigint;
  dataset_revision text;
  parcel_features jsonb;
begin
  if territory_geometry is null
    or jsonb_typeof(territory_geometry) <> 'object'
    or length(territory_geometry::text) > 100000 then
    raise exception 'A valid territory GeoJSON geometry is required.' using errcode = '22023';
  end if;

  begin
    territory_shape := extensions.st_setsrid(
      extensions.st_geomfromgeojson(territory_geometry::text),
      4326
    );
  exception when others then
    raise exception 'The territory GeoJSON geometry could not be parsed.' using errcode = '22023';
  end;

  if extensions.st_geometrytype(territory_shape) not in ('ST_Polygon', 'ST_MultiPolygon') then
    raise exception 'Territory geometry must be a Polygon or MultiPolygon.' using errcode = '22023';
  end if;

  territory_shape := extensions.st_multi(
    extensions.st_collectionextract(
      extensions.st_makevalid(territory_shape),
      3
    )
  );

  if extensions.st_isempty(territory_shape) then
    raise exception 'Territory geometry must contain an area.' using errcode = '22023';
  end if;

  search_shape := extensions.st_buffer(
    territory_shape::extensions.geography,
    bounded_buffer
  )::extensions.geometry;

  select count(*)
  into matching_count
  from public.parcels as parcel
  where parcel.geometry operator(extensions.&&) search_shape
    and extensions.st_intersects(parcel.geometry, search_shape);

  select coalesce(to_char(max(parcel.imported_at), 'YYYY-MM-DD"T"HH24:MI:SS.USOF'), 'empty')
  into dataset_revision
  from public.parcels as parcel;

  select coalesce(jsonb_agg(parcel_feature.feature), '[]'::jsonb)
  into parcel_features
  from (
    select jsonb_build_object(
      'type', 'Feature',
      'id', parcel.id,
      'properties', jsonb_build_object(
        'id', parcel.id,
        'countyFips', parcel.county_fips,
        'gislink', parcel.gislink,
        'situsAddress', parcel.situs_address,
        'propertyClass', parcel.property_class,
        'landUse', parcel.land_use,
        'isResidential', coalesce(parcel.is_residential, false)
      ),
      'geometry', extensions.st_asgeojson(parcel.geometry, 6)::jsonb
    ) as feature
    from public.parcels as parcel
    where parcel.geometry operator(extensions.&&) search_shape
      and extensions.st_intersects(parcel.geometry, search_shape)
    order by parcel.is_residential desc nulls last, parcel.id
    limit bounded_limit
  ) as parcel_feature;

  return jsonb_build_object(
    'datasetRevision', dataset_revision,
    'totalCount', matching_count,
    'truncated', matching_count > bounded_limit,
    'features', parcel_features
  );
end;
$$;

revoke execute on function public.parcels_for_territory_v1(jsonb, double precision, integer) from public, anon;
grant execute on function public.parcels_for_territory_v1(jsonb, double precision, integer) to authenticated;

comment on function public.parcels_for_territory_v1(jsonb, double precision, integer)
  is 'Returns privacy-safe parcels intersecting an active territory plus a small boundary buffer, cache revision, total count, and truncation flag.';
