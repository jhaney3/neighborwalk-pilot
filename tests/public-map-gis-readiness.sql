\set ON_ERROR_STOP on
begin;

-- All fixtures are fictional, future-dated so they deterministically become
-- current, and rolled back at the end of this file.
create function pg_temp.polygon(min_x double precision, min_y double precision, max_x double precision, max_y double precision)
returns jsonb language sql immutable as $$
  select jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(jsonb_build_array(
    jsonb_build_array(min_x,min_y), jsonb_build_array(max_x,min_y),
    jsonb_build_array(max_x,max_y), jsonb_build_array(min_x,max_y),
    jsonb_build_array(min_x,min_y)
  )));
$$;

do $$
begin
  if not has_function_privilege('anon', 'public.public_map_parcels_for_boundary_v1(jsonb)', 'execute')
    or not has_function_privilege('authenticated', 'public.public_map_parcels_for_boundary_v1(jsonb)', 'execute')
    or not has_function_privilege('anon', 'public.public_map_streets_for_boundary_v1(jsonb)', 'execute')
    or not has_function_privilege('authenticated', 'public.public_map_streets_for_boundary_v1(jsonb)', 'execute') then
    raise exception 'Public GIS functions are not executable by both browser roles';
  end if;
  if has_function_privilege('anon', 'public.planning_parcels_for_boundary_v1(jsonb)', 'execute')
    or has_function_privilege('anon', 'public.street_segments_for_boundary_v1(jsonb)', 'execute') then
    raise exception 'Existing authenticated planning RPC became anonymous';
  end if;
  if has_function_privilege('anon', 'private.outreach_public_map_boundary(jsonb)', 'execute')
    or has_table_privilege('anon', 'private.outreach_parcel_releases', 'select')
    or has_table_privilege('anon', 'public.parcels', 'select')
    or has_table_privilege('anon', 'public.outreach_street_segments', 'select') then
    raise exception 'Anonymous role gained an underlying helper or table grant';
  end if;
end
$$;

insert into public.parcels(
  county_fips, gislink, situs_address, property_class, land_use,
  is_residential, geometry, imported_at
) values (
  '47099', 'PUBLIC-MAP-FICTIONAL-LAWRENCE', 'DO NOT EXPOSE 1 Private Lane',
  'DO NOT EXPOSE', 'DO NOT EXPOSE', true,
  extensions.st_geomfromtext(
    'MULTIPOLYGON(((-87.336 35.244,-87.334 35.244,-87.334 35.246,-87.336 35.246,-87.336 35.244)))',
    4326
  ),
  now() + interval '100 years'
);

insert into public.outreach_street_releases(
  release, source, imported_at, complete, county_fips, expected_rows, imported_rows
) values (
  'public-map-fictional-streets', 'Overture transportation', now() + interval '100 years',
  false, array['47055','47099','47101','47181'], 1, 0
);
insert into public.outreach_street_segments(release, id, name, road_class, subclass, geometry)
values (
  'public-map-fictional-streets', 'public-map-fictional-crossing',
  'Fictional Public Road', 'residential', null,
  extensions.st_geomfromtext('MULTILINESTRING((-87.36 35.245,-87.31 35.245))', 4326)
);

set local role anon;

-- Valid but unsupported geography is a normal unavailable response. Invalid
-- or excessively broad input remains an error before any data query runs.
do $$
declare
  response jsonb;
begin
  response := public.public_map_parcels_for_boundary_v1(pg_temp.polygon(-89.66,39.78,-89.64,39.80));
  if response->>'availability' <> 'unsupported_area'
    or (response->>'complete')::boolean
    or (response->>'truncated')::boolean
    or jsonb_array_length(response->'features') <> 0 then
    raise exception 'Unsupported parcel geography did not return a safe unavailable response';
  end if;
  response := public.public_map_streets_for_boundary_v1(pg_temp.polygon(-89.66,39.78,-89.64,39.80));
  if response->>'availability' <> 'unsupported_area'
    or (response->>'complete')::boolean
    or jsonb_array_length(response->'features') <> 0 then
    raise exception 'Unsupported street geography did not return a safe unavailable response';
  end if;

  begin
    perform public.public_map_parcels_for_boundary_v1(
      '[[[-87.34,35.24],[-87.33,35.25],[-87.34,35.25],[-87.33,35.24]]]'::jsonb
    );
    raise exception 'Malformed public map boundary was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.public_map_streets_for_boundary_v1(pg_temp.polygon(-88.0,35.0,-87.0,35.7));
    raise exception 'Oversized public map boundary was accepted';
  exception when sqlstate '22023' then null;
  end;
end
$$;

-- Rows alone never publish parcels, and the newest incomplete street manifest
-- never publishes streets.
do $$
declare
  response jsonb;
begin
  response := public.public_map_parcels_for_boundary_v1(pg_temp.polygon(-87.345,35.235,-87.325,35.255));
  if response->>'availability' <> 'missing_inventory'
    or (response->>'complete')::boolean
    or jsonb_array_length(response->'features') <> 0 then
    raise exception 'Unmanifested parcel fixture appeared complete';
  end if;
  response := public.public_map_streets_for_boundary_v1(pg_temp.polygon(-87.345,35.235,-87.325,35.255));
  if response->>'availability' <> 'missing_inventory'
    or (response->>'complete')::boolean
    or jsonb_array_length(response->'features') <> 0 then
    raise exception 'Incomplete street release appeared complete';
  end if;
end
$$;

reset role;
insert into private.outreach_parcel_releases(
  release, county_fips, source, imported_at, complete,
  expected_rows, imported_rows, coverage
)
select
  'public-map-fictional-lawrence', '47099', 'NeighborWalk hosted parcel snapshot',
  now() + interval '100 years', true, count(*), count(*),
  extensions.st_multi(extensions.st_makeenvelope(-87.60,35.00,-87.10,35.55,4326))
from public.parcels
where county_fips = '47099';
update public.outreach_street_releases
set complete = true, imported_rows = 1
where release = 'public-map-fictional-streets';

set local role anon;

-- A complete Lawrence manifest enables Lawrence only. The payload exposes
-- geometry and stable GIS identity, never addresses, classifications, names,
-- ownership, membership, or outreach data.
do $$
declare
  parcel_response jsonb;
  street_response jsonb;
  feature jsonb;
  canonical extensions.geometry;
  display extensions.geometry;
begin
  parcel_response := public.public_map_parcels_for_boundary_v1(
    pg_temp.polygon(-87.345,35.235,-87.325,35.255)
  );
  if parcel_response->>'availability' <> 'available'
    or not (parcel_response->>'complete')::boolean
    or (parcel_response->>'truncated')::boolean
    or parcel_response->>'datasetRevision' <> 'public-map-fictional-lawrence'
    or not exists(
      select 1 from jsonb_array_elements(parcel_response->'features') item
      where item->>'gislink' = 'PUBLIC-MAP-FICTIONAL-LAWRENCE'
        and item->>'county_fips' = '47099'
        and item->'geometry' is not null
        and item->'representative_point' is not null
    ) then
    raise exception 'Complete per-county parcel manifest did not publish Lawrence GIS';
  end if;
  if parcel_response::text like '%DO NOT EXPOSE%'
    or exists(
      select 1
      from jsonb_array_elements(parcel_response->'features') item,
           lateral jsonb_object_keys(item) key
      where key not in ('county_fips','gislink','geometry','representative_point')
    ) then
    raise exception 'Public parcel response exposed a non-GIS field';
  end if;

  parcel_response := public.public_map_parcels_for_boundary_v1(
    pg_temp.polygon(-87.10,35.18,-87.08,35.20)
  );
  if parcel_response->>'availability' <> 'missing_inventory'
    or (parcel_response->>'complete')::boolean then
    raise exception 'Lawrence publication incorrectly enabled an uncovered county';
  end if;

  street_response := public.public_map_streets_for_boundary_v1(
    pg_temp.polygon(-87.345,35.235,-87.325,35.255)
  );
  if street_response->>'availability' <> 'available'
    or not (street_response->>'complete')::boolean
    or street_response->>'release' <> 'public-map-fictional-streets'
    or street_response->>'source' <> 'Overture transportation'
    or jsonb_array_length(street_response->'features') <> 1 then
    raise exception 'Complete street manifest did not publish bounded GIS';
  end if;
  feature := street_response#>'{features,0}';
  if feature->>'name' <> 'Fictional Public Road'
    or exists(
      select 1 from jsonb_object_keys(feature) key
      where key not in ('id','name','road_class','subclass','geometry','display_geometry')
    ) then
    raise exception 'Public street response omitted its road name or exposed a non-GIS field';
  end if;
  canonical := extensions.st_setsrid(extensions.st_geomfromgeojson((feature->'geometry')::text),4326);
  display := extensions.st_setsrid(extensions.st_geomfromgeojson((feature->'display_geometry')::text),4326);
  if extensions.st_equals(canonical, display) then
    raise exception 'Public street response replaced canonical geometry with clipped display geometry';
  end if;
end
$$;

-- A signed-in demo session may call the same static public functions without
-- membership. The existing planning function still enforces real membership.
set local role authenticated;
do $$
declare
  response jsonb;
begin
  response := public.public_map_parcels_for_boundary_v1(pg_temp.polygon(-87.345,35.235,-87.325,35.255));
  if response->>'availability' <> 'available' then
    raise exception 'Authenticated browser could not execute public parcel GIS';
  end if;
  response := public.public_map_streets_for_boundary_v1(pg_temp.polygon(-87.345,35.235,-87.325,35.255));
  if response->>'availability' <> 'available' then
    raise exception 'Authenticated browser could not execute public street GIS';
  end if;
  begin
    perform public.planning_parcels_for_boundary_v1(pg_temp.polygon(-87.345,35.235,-87.325,35.255));
    raise exception 'Existing authenticated planner guard was bypassed';
  exception when sqlstate '42501' then null;
  end;
end
$$;

reset role;
do $$
begin
  if not exists(
    select 1 from pg_proc procedure
    where procedure.oid = 'public.public_map_parcels_for_boundary_v1(jsonb)'::regprocedure
      and procedure.proconfig @> array['statement_timeout=3s']
  ) or not exists(
    select 1 from pg_proc procedure
    where procedure.oid = 'public.public_map_streets_for_boundary_v1(jsonb)'::regprocedure
      and procedure.proconfig @> array['statement_timeout=3s']
  ) then
    raise exception 'Public GIS functions are missing their statement timeout';
  end if;
end
$$;

rollback;
select 'public map GIS readiness PASS' as result;
