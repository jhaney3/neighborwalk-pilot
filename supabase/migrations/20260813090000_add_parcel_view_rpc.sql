create or replace function public.parcels_in_view_v2(
  min_lat double precision,
  min_long double precision,
  max_lat double precision,
  max_long double precision,
  result_limit integer default 2500
)
returns table (
  id bigint,
  county_fips text,
  gislink text,
  situs_address text,
  property_class text,
  land_use text,
  is_residential boolean,
  geometry jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    parcel.id,
    parcel.county_fips,
    parcel.gislink,
    parcel.situs_address,
    parcel.property_class,
    parcel.land_use,
    parcel.is_residential,
    extensions.st_asgeojson(parcel.geometry, 6)::jsonb
  from public.parcels as parcel
  where min_lat between -90 and 90
    and max_lat between -90 and 90
    and min_long between -180 and 180
    and max_long between -180 and 180
    and min_lat < max_lat
    and min_long < max_long
    and extensions.st_intersects(
      parcel.geometry,
      extensions.st_makeenvelope(min_long, min_lat, max_long, max_lat, 4326)
    )
  order by parcel.is_residential desc nulls last, parcel.id
  limit least(greatest(result_limit, 1), 5000);
$$;

revoke execute on function public.parcels_in_view_v2(double precision, double precision, double precision, double precision, integer) from public, anon;
grant execute on function public.parcels_in_view_v2(double precision, double precision, double precision, double precision, integer) to authenticated;

comment on function public.parcels_in_view_v2(double precision, double precision, double precision, double precision, integer)
  is 'Returns privacy-safe parcel geometry and situs metadata for the visible map bounds to active church members.';
