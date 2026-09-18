\set ON_ERROR_STOP on
begin;

-- Fictional fixtures only. The database runner is pinned to loopback and every
-- row, command receipt, correction and release below is rolled back.
insert into auth.users(id,email) values
  ('88000000-0000-4000-8000-000000000011','walk-target-leader@neighborwalk.test'),
  ('88000000-0000-4000-8000-000000000012','walk-target-a@neighborwalk.test'),
  ('88000000-0000-4000-8000-000000000013','walk-target-b@neighborwalk.test'),
  ('88000000-0000-4000-8000-000000000021','walk-target-other-leader@neighborwalk.test');
insert into auth.sessions(id,user_id,created_at,updated_at)
select id,id,now(),now() from auth.users where id::text like '88000000-%';
insert into public.churches(id,name,created_by) values
  ('88000000-0000-4000-8000-000000000001','Fictional Walk Target Church','88000000-0000-4000-8000-000000000011'),
  ('88000000-0000-4000-8000-000000000002','Fictional Other Church','88000000-0000-4000-8000-000000000021');
insert into public.church_memberships(church_id,user_id,role,active,display_name) values
  ('88000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000011','leader',true,'Target Leader'),
  ('88000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000012','volunteer',true,'Walker A'),
  ('88000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000013','volunteer',true,'Walker B'),
  ('88000000-0000-4000-8000-000000000002','88000000-0000-4000-8000-000000000021','leader',true,'Other Leader');

create function pg_temp.claims(target_user uuid,recent boolean default false) returns text language sql as $$
  select jsonb_build_object('sub',target_user,'session_id',target_user,'role','authenticated','is_anonymous',false,
    'amr',case when recent then jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now()))) else '[]'::jsonb end)::text;
$$;
create function pg_temp.command(command_id text,operations jsonb,target_church uuid default '88000000-0000-4000-8000-000000000001') returns jsonb language sql as $$
  select jsonb_build_object('id',command_id,'churchId',target_church,'schemaVersion',1,'operations',operations);
$$;
create function pg_temp.expect_denied(command jsonb,expected_state text) returns void language plpgsql as $$
declare denied boolean:=false;
begin
  begin perform public.outreach_apply_command(command);
  exception when others then if sqlstate<>expected_state then raise; end if; denied:=true; end;
  if not denied then raise exception 'Expected denial % but command succeeded',expected_state; end if;
end $$;
create function pg_temp.boundary() returns jsonb language sql immutable as $$
  select '[[-87.01,35.99],[-86.99,35.99],[-86.99,36.01],[-87.01,36.01],[-87.01,35.99]]'::jsonb;
$$;
create function pg_temp.open_boundary() returns jsonb language sql immutable as $$
  select '[[-87.01,35.99],[-86.99,35.99],[-86.99,36.01],[-87.01,36.01]]'::jsonb;
$$;
create function pg_temp.polygon(min_x double precision,min_y double precision,max_x double precision,max_y double precision) returns jsonb language sql immutable as $$
  select jsonb_build_object('type','Polygon','coordinates',jsonb_build_array(jsonb_build_array(
    jsonb_build_array(min_x,min_y),jsonb_build_array(max_x,min_y),jsonb_build_array(max_x,max_y),jsonb_build_array(min_x,max_y),jsonb_build_array(min_x,min_y))));
$$;
create function pg_temp.parent_geometry() returns jsonb language sql immutable as $$
  select jsonb_build_object('type','Polygon','coordinates',jsonb_build_array(pg_temp.boundary()));
$$;
create function pg_temp.parcel_revision() returns text language sql stable as $$
  select coalesce(to_char(max(p.imported_at),'YYYY-MM-DD"T"HH24:MI:SS.USOF'),'empty') from public.parcels p;
$$;
create function pg_temp.target_op(target_key text,event_key text,selection text,shape jsonb,parcel_keys text[],source_kind text default 'polygon_auto',street jsonb default null,expected bigint default 0)
returns jsonb language sql stable as $$
  select jsonb_build_object('entityType','target','entityId',target_key,'operation','upsert','expectedVersion',expected,'record',
    jsonb_build_object('eventId',event_key,'territoryId','target-zone','name','Fictional '||target_key,'color','#286c59','selectionKind',selection,
      'geometry',shape,'streetSelection',street,'parcels',coalesce((select jsonb_agg(jsonb_build_object(
        'countyFips','47055','gislink',parcel_key,'datasetRevision',pg_temp.parcel_revision(),'inclusionSource',source_kind)) from unnest(parcel_keys) parcel_key),'[]'::jsonb)));
$$;
create function pg_temp.assignment_op(assignment_key text,event_key text,target_key text,team_key text,volunteer_key text,next_status text,expected bigint)
returns jsonb language sql immutable as $$
  select jsonb_build_object('entityType','assignment','entityId',assignment_key,'operation','upsert','expectedVersion',expected,'record',
    jsonb_strip_nulls(jsonb_build_object('eventId',event_key,'territoryId','target-zone','targetId',target_key,
      'assignedTeamId',team_key,'assignedVolunteerId',volunteer_key,'status',next_status)));
$$;
create function pg_temp.event_op(event_key text,next_status text,expected bigint) returns jsonb language sql immutable as $$
  select jsonb_build_object('entityType','event','entityId',event_key,'operation','upsert','expectedVersion',expected,'record',jsonb_build_object(
    'name','Fictional '||event_key,'startsAt','2026-09-12T18:00:00Z','endsAt','2026-09-12T20:00:00Z','timezone','America/Chicago',
    'status',next_status,'purpose','Meet neighbors kindly','meetingPoint','Fictional lobby','leaderContact','Fictional leader'));
$$;
create function pg_temp.visit_op(visit_key text,event_key text,target_key text,property_key text,resident_key text default null) returns jsonb language sql immutable as $$
  select jsonb_build_object('entityType','visit','entityId',visit_key,'operation','upsert','expectedVersion',0,'record',
    jsonb_strip_nulls(jsonb_build_object('eventId',event_key,'territoryId','target-zone','targetId',target_key,'propertyId',property_key,
      'residentId',resident_key,'targetCountyFips','99999','targetGislink','spoofed','context','door','outcome','conversation',
      'recordedAt','2026-09-12T19:00:00Z','deviceId','fictional-target-device')));
$$;

insert into public.outreach_outings(church_id,id,name,starts_at,ends_at,timezone,status)
select '88000000-0000-4000-8000-000000000001',event_key,'Fictional '||event_key,'2026-09-12T18:00:00Z','2026-09-12T20:00:00Z','America/Chicago','draft'
from unnest(array['event-cross','event-overlap','event-field','event-owner','event-replace','event-street','event-unready','event-empty-ready','event-empty-accept','event-open-parent','event-legacy-both','event-crew']) event_key;
insert into public.outreach_outings(church_id,id,name,starts_at,ends_at,timezone,status)
values('88000000-0000-4000-8000-000000000002','event-other','Other outing','2026-09-12T18:00:00Z','2026-09-12T20:00:00Z','America/Chicago','draft');
insert into public.outreach_territories(church_id,id,name,kind,color,longitude,latitude,zoom,boundary) values
  ('88000000-0000-4000-8000-000000000001','target-zone','Fictional target zone','map','#286c59',-87,36,15,pg_temp.boundary()),
  ('88000000-0000-4000-8000-000000000001','open-target-zone','Fictional open-ring target zone','map','#286c59',-87,36,15,pg_temp.open_boundary()),
  ('88000000-0000-4000-8000-000000000002','other-zone','Other zone','map','#286c59',-87,36,15,pg_temp.boundary());
insert into public.outreach_teams(church_id,id,name,status) values
  ('88000000-0000-4000-8000-000000000001','team-field','Field team','ready'),
  ('88000000-0000-4000-8000-000000000001','team-other','Other team','ready');
insert into public.outreach_team_members(church_id,team_id,volunteer_id,user_id) values
  ('88000000-0000-4000-8000-000000000001','team-field','volunteer_88000000000040008000000000000012','88000000-0000-4000-8000-000000000012'),
  ('88000000-0000-4000-8000-000000000001','team-field','volunteer_88000000000040008000000000000013','88000000-0000-4000-8000-000000000013'),
  ('88000000-0000-4000-8000-000000000001','team-other','volunteer_88000000000040008000000000000013','88000000-0000-4000-8000-000000000013');
insert into public.outreach_assignments(church_id,id,outing_id,territory_id,team_id,assignee_id,status) values
  ('88000000-0000-4000-8000-000000000001','legacy-both-owner','event-legacy-both','target-zone','team-field','88000000-0000-4000-8000-000000000012','assigned');

insert into public.parcels(county_fips,gislink,is_residential,geometry,imported_at) values
 ('47055','PARCEL-N',true,extensions.st_geomfromtext('MULTIPOLYGON(((-87.0002 36.002,-86.9998 36.002,-86.9998 36.0024,-87.0002 36.0024,-87.0002 36.002)))',4326),now()+interval '100 years'),
 ('47055','PARCEL-S',true,extensions.st_geomfromtext('MULTIPOLYGON(((-87.0002 35.9976,-86.9998 35.9976,-86.9998 35.998,-87.0002 35.998,-87.0002 35.9976)))',4326),now()+interval '100 years'),
 ('47055','PARCEL-APT',true,extensions.st_geomfromtext('MULTIPOLYGON(((-87.0003 36.004,-86.9997 36.004,-86.9997 36.0046,-87.0003 36.0046,-87.0003 36.004)))',4326),now()+interval '100 years'),
 ('47055','PARCEL-STABLE',true,extensions.st_geomfromtext('MULTIPOLYGON(((-87.004 36.004,-87.0035 36.004,-87.0035 36.0045,-87.004 36.0045,-87.004 36.004)))',4326),now()+interval '100 years'),
 ('47055','PARCEL-REPLACE',true,extensions.st_geomfromtext('MULTIPOLYGON(((-86.997 35.995,-86.9965 35.995,-86.9965 35.9955,-86.997 35.9955,-86.997 35.995)))',4326),now()+interval '100 years'),
 ('47055','PARCEL-STREET-N',true,extensions.st_geomfromtext('MULTIPOLYGON(((-87.0001 36.00004,-86.9999 36.00004,-86.9999 36.00010,-87.0001 36.00010,-87.0001 36.00004)))',4326),now()+interval '100 years'),
 ('47055','PARCEL-STREET-DEEP',true,extensions.st_geomfromtext('MULTIPOLYGON(((-87.0003 36.00010,-86.9997 36.00010,-86.9997 36.00100,-87.0003 36.00100,-87.0003 36.00010)))',4326),now()+interval '100 years'),
 ('47055','PARCEL-STREET-S',true,extensions.st_geomfromtext('MULTIPOLYGON(((-87.0001 35.99990,-86.9999 35.99990,-86.9999 35.99996,-87.0001 35.99996,-87.0001 35.99990)))',4326),now()+interval '100 years'),
 ('47055','PARCEL-STREET-W100',true,extensions.st_geomfromtext('MULTIPOLYGON(((-87.00104 36.0049,-87.00096 36.0049,-87.00096 36.0051,-87.00104 36.0051,-87.00104 36.0049)))',4326),now()+interval '100 years'),
 ('47055','PARCEL-STREET-E100',true,extensions.st_geomfromtext('MULTIPOLYGON(((-86.99904 36.0049,-86.99896 36.0049,-86.99896 36.0051,-86.99904 36.0051,-86.99904 36.0049)))',4326),now()+interval '100 years'),
 ('47055','PARCEL-STREET-W-END',true,extensions.st_geomfromtext('MULTIPOLYGON(((-87.00054 36.00836,-87.00046 36.00836,-87.00046 36.00844,-87.00054 36.00844,-87.00054 36.00836)))',4326),now()+interval '100 years'),
 ('47055','PARCEL-EDGE',true,extensions.st_geomfromtext('MULTIPOLYGON(((-87.011 36.005,-87.0095 36.005,-87.0095 36.006,-87.011 36.006,-87.011 36.005)))',4326),now()+interval '100 years'),
 ('47055','PARCEL-NONRES',false,extensions.st_geomfromtext('MULTIPOLYGON(((-87.002 36.003,-87.0015 36.003,-87.0015 36.0035,-87.002 36.0035,-87.002 36.003)))',4326),now()+interval '100 years');

insert into public.outreach_locations(church_id,id,territory_id,address,unit,parcel_reference,source,created_by) values
 ('88000000-0000-4000-8000-000000000001','location-apt-1','target-zone','100 Fictional Apartments','1A','{"countyFips":"47055","gislink":"PARCEL-APT"}','map','88000000-0000-4000-8000-000000000012'),
 ('88000000-0000-4000-8000-000000000001','location-apt-2','target-zone','100 Fictional Apartments','2B','{"countyFips":"47055","gislink":"PARCEL-APT"}','map','88000000-0000-4000-8000-000000000012'),
 ('88000000-0000-4000-8000-000000000001','location-private','target-zone','101 Fictional Lane',null,'{"countyFips":"47055","gislink":"PARCEL-N"}','map','88000000-0000-4000-8000-000000000012'),
 ('88000000-0000-4000-8000-000000000001','location-south','target-zone','102 Fictional Lane',null,'{"countyFips":"47055","gislink":"PARCEL-S"}','map','88000000-0000-4000-8000-000000000013'),
 ('88000000-0000-4000-8000-000000000001','location-replace','target-zone','103 Fictional Lane',null,'{"countyFips":"47055","gislink":"PARCEL-REPLACE"}','map','88000000-0000-4000-8000-000000000012'),
 ('88000000-0000-4000-8000-000000000001','location-legacy','target-zone','104 Fictional Lane',null,'{"countyFips":"47055","gislink":"PARCEL-STABLE"}','map','88000000-0000-4000-8000-000000000011');
insert into public.discipleship_people(id,church_id,property_id,created_by,assigned_to,name,faith_status,discipleship_stage,status,preferred_contact) values
 ('private-target-person','88000000-0000-4000-8000-000000000001','location-private','88000000-0000-4000-8000-000000000012','88000000-0000-4000-8000-000000000012','Fictional Private Neighbor','not_discussed','new_connection','active','none');
insert into public.outreach_encounters(church_id,id,territory_id,location_id,actor_id,actor_key,outcome,context,occurred_at,device_id) values
 ('88000000-0000-4000-8000-000000000001','legacy-outingless','target-zone','location-legacy','88000000-0000-4000-8000-000000000011','volunteer_88000000000040008000000000000011','conversation','door','2026-09-01T12:00:00Z','legacy-device');

insert into public.outreach_street_releases(release,source,imported_at,complete,county_fips,expected_rows,imported_rows) values
 ('walk-old','Overture transportation',now()+interval '90 years',true,array['47055','47099','47101','47181'],1,1),
 ('walk-current','Overture transportation',now()+interval '91 years',true,array['47055','47099','47101','47181'],3,3),
 ('walk-partial','Overture transportation',now()+interval '92 years',false,array['47055'],2,1);
insert into public.outreach_street_segments(release,id,name,road_class,subclass,geometry) values
 ('walk-old','crossing','Fictional Crossing','residential',null,extensions.st_geomfromtext('MULTILINESTRING((-87.02 36,-86.98 36))',4326)),
 ('walk-current','crossing','Fictional Crossing','residential',null,extensions.st_geomfromtext('MULTILINESTRING((-87.02 36,-86.98 36))',4326)),
 ('walk-current','outside','Fictional Outside','residential',null,extensions.st_geomfromtext('MULTILINESTRING((-87.02 36.02,-86.98 36.02))',4326)),
 ('walk-current','vertical','Fictional Vertical','residential',null,extensions.st_geomfromtext('MULTILINESTRING((-87 35.995,-87 36.008))',4326)),
 ('walk-partial','crossing','Fictional Crossing','residential',null,extensions.st_geomfromtext('MULTILINESTRING((-87.02 36,-86.98 36))',4326));

do $$ begin
  begin update public.outreach_street_releases set complete=true where release='walk-partial'; raise exception 'Partial manifest was marked complete';
  exception when check_violation then null; end;
  if not exists(select 1 from pg_constraint where conrelid='public.outreach_assignments'::regclass and conname='outreach_assignment_owner_compatibility') then raise exception 'Target-aware owner compatibility constraint missing'; end if;
  if not has_table_privilege('authenticated','public.outreach_walk_targets','select') or has_table_privilege('authenticated','public.outreach_walk_targets','insert,update,delete') then raise exception 'Target table grants are incorrect'; end if;
  if has_table_privilege('authenticated','public.outreach_street_segments','select') then raise exception 'Raw street cache became browser-readable'; end if;
end $$;

select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000011'),true);
set local role authenticated;

-- Cross-tenant writes and zero-owner assignments are denied. Targeted work
-- requires exactly one owner, while historical targetless rows retain the old
-- at-least-one rule and may be acknowledged without rewriting either owner.
do $$ begin
  perform pg_temp.expect_denied(pg_temp.command('cross-church-command',jsonb_build_array(pg_temp.event_op('event-other','ready',1)),'88000000-0000-4000-8000-000000000002'),'42501');
  perform pg_temp.expect_denied(pg_temp.command('cross-church-payload',jsonb_build_array(jsonb_set(pg_temp.target_op('cross-payload','event-cross','polygon',pg_temp.parent_geometry(),array['PARCEL-N']),'{record,churchId}','"88000000-0000-4000-8000-000000000002"'))),'42501');
  perform pg_temp.expect_denied(pg_temp.command('no-owner',jsonb_build_array(pg_temp.assignment_op('no-owner','event-cross',null,null,null,'assigned',0))),'22023');
  perform public.outreach_apply_command(pg_temp.command('owner-guard-target',jsonb_build_array(
    pg_temp.target_op('owner-guard-target','event-cross','polygon',pg_temp.parent_geometry(),array['PARCEL-N']))));
  perform pg_temp.expect_denied(pg_temp.command('targeted-two-owners',jsonb_build_array(
    pg_temp.assignment_op('targeted-two-owners','event-cross','owner-guard-target','team-field','volunteer_88000000000040008000000000000012','assigned',0))),'22023');
end $$;

-- A leader can create an outing-specific multi-person crew and assign it to a
-- prepared target in the same command. This is the event-day check-in path.
do $$ begin
  perform public.outreach_apply_command(pg_temp.command('event-day-crew',jsonb_build_array(
    jsonb_build_object('entityType','team','entityId','team-event-day','operation','upsert','expectedVersion',0,'record',
      jsonb_build_object('name','Fictional target crew','status','ready','eventId','event-crew','memberIds',jsonb_build_array(
        'volunteer_88000000000040008000000000000012','volunteer_88000000000040008000000000000013'))),
    pg_temp.target_op('event-day-target','event-crew','polygon',pg_temp.parent_geometry(),array['PARCEL-N']),
    pg_temp.assignment_op('event-day-assignment','event-crew','event-day-target','team-event-day',null,'assigned',0))));
  if not exists(select 1 from public.outreach_teams where id='team-event-day' and legacy_event_id='event-crew')
    or (select count(*) from public.outreach_team_members where team_id='team-event-day')<>2
    or not exists(select 1 from public.outreach_assignments where id='event-day-assignment' and target_id='event-day-target' and team_id='team-event-day' and status='assigned') then
    raise exception 'Event-day crew and assignment were not saved together'; end if;
end $$;
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000012'),true);
select public.outreach_apply_command(pg_temp.command('legacy-both-owner-ack',jsonb_build_array(
  pg_temp.assignment_op('legacy-both-owner','event-legacy-both',null,'team-field','volunteer_88000000000040008000000000000012','accepted',1))));
do $$ begin
  if not exists(select 1 from public.outreach_assignments where id='legacy-both-owner' and target_id is null
    and team_id='team-field' and assignee_id='88000000-0000-4000-8000-000000000012' and status='accepted' and version=2) then
    raise exception 'Legacy both-owner acknowledgement rewrote ownership or failed'; end if;
end $$;
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000011'),true);

-- Newly persisted parent zones use open coordinate rings. Both whole-zone and
-- smaller polygon targets normalize that parent in memory without rewriting it.
do $$ begin
  perform public.outreach_apply_command(pg_temp.command('open-parent-targets',jsonb_build_array(
    jsonb_set(pg_temp.target_op('open-parent-whole','event-open-parent','whole_zone',pg_temp.parent_geometry(),array['PARCEL-N']),'{record,territoryId}','"open-target-zone"'),
    jsonb_set(pg_temp.target_op('open-parent-polygon','event-open-parent','polygon',pg_temp.polygon(-87.005,35.995,-86.995,36.005),array['PARCEL-N']),'{record,territoryId}','"open-target-zone"'))));
  if jsonb_array_length((select boundary from public.outreach_territories where id='open-target-zone'))<>4
    or (select count(*) from public.outreach_walk_targets where id in ('open-parent-whole','open-parent-polygon'))<>2 then
    raise exception 'Open parent boundary was rewritten or rejected'; end if;
end $$;

-- An incomplete newest manifest returns no authoritative data. Once the
-- complete import becomes newest, the bounded RPC returns full canonical
-- geometry plus a separately clipped display geometry.
do $$ declare response jsonb; begin
  response:=public.street_segments_for_boundary_v1(pg_temp.open_boundary());
  if response->>'release'<>'walk-partial' then raise exception 'Open bare-array RPC boundary was rejected'; end if;
  begin perform public.street_segments_for_boundary_v1('[[-87,36],[-87,36],[-86.99,36]]'::jsonb); raise exception 'Too-few-distinct boundary was accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.planning_parcels_for_boundary_v1('[[-87.01,35.99],[-86.99,36.01],[-87.01,36.01],[-86.99,35.99]]'::jsonb); raise exception 'Self-crossing boundary was accepted';
  exception when sqlstate '22023' then null; end;
  response:=public.street_segments_for_boundary_v1(pg_temp.parent_geometry());
  if response->>'release'<>'walk-partial' or (response->>'complete')::boolean or jsonb_array_length(response->'features')<>0 then raise exception 'Partial street manifest appeared authoritative'; end if;
  perform pg_temp.expect_denied(pg_temp.command('partial-street-target',jsonb_build_array(pg_temp.target_op('partial-street','event-street','streets',
    extensions.st_asgeojson(extensions.st_geomfromtext('MULTILINESTRING((-87.02 36,-86.98 36))',4326))::jsonb,array['PARCEL-STREET-N'],'street_auto',
    '{"source":"Overture transportation","sourceRevision":"walk-partial","side":"left","corridorMeters":20,"segmentIds":["crossing"]}'))),'PT409');
  begin perform public.street_segments_for_boundary_v1(pg_temp.polygon(-88,35,-86,37)); raise exception 'Oversized street boundary was accepted';
  exception when others then if sqlstate<>'22023' then raise; end if; end;
  begin perform public.planning_parcels_for_boundary_v1(pg_temp.polygon(-88,35,-86,37)); raise exception 'Oversized parcel boundary was accepted';
  exception when others then if sqlstate<>'22023' then raise; end if; end;
end $$;
reset role;
update public.outreach_street_releases set imported_at=now()+interval '93 years' where release='walk-current';
set local role authenticated;
do $$ declare response jsonb; parcel_response jsonb; full_shape extensions.geometry; display_shape extensions.geometry; begin
  response:=public.street_segments_for_boundary_v1(pg_temp.parent_geometry());
  if response->>'release'<>'walk-current' or response->>'source'<>'Overture transportation' or not (response->>'complete')::boolean or (response->>'truncated')::boolean then raise exception 'Complete street manifest metadata is wrong'; end if;
  select extensions.st_setsrid(extensions.st_geomfromgeojson((response#>'{features,0,geometry}')::text),4326),
    extensions.st_setsrid(extensions.st_geomfromgeojson((response#>'{features,0,display_geometry}')::text),4326) into full_shape,display_shape;
  if not extensions.st_equals(full_shape,extensions.st_geomfromtext('MULTILINESTRING((-87.02 36,-86.98 36))',4326))
    or not extensions.st_coveredby(display_shape,extensions.st_setsrid(extensions.st_geomfromgeojson(pg_temp.parent_geometry()::text),4326))
    or extensions.st_equals(full_shape,display_shape) then raise exception 'Street RPC did not separate canonical and display geometry'; end if;
  parcel_response:=public.planning_parcels_for_boundary_v1(pg_temp.parent_geometry());
  if not (parcel_response->>'complete')::boolean or parcel_response->>'datasetRevision'<>pg_temp.parcel_revision()
    or exists(select 1 from jsonb_array_elements(parcel_response->'features') f where f->>'gislink' in ('PARCEL-EDGE','PARCEL-NONRES'))
    or not exists(select 1 from jsonb_array_elements(parcel_response->'features') f where f->>'gislink'='PARCEL-APT' and f->'representative_point' is not null) then
    raise exception 'Planning parcel RPC did not use authoritative residential point-on-surface membership';
  end if;
end $$;

-- Street targets require the current release, full canonical imported geometry,
-- an intersecting parent section, and the correct PostGIS side of that directed
-- geometry (positive offset is left/north for this west-to-east fixture).
do $$ declare canonical jsonb:=extensions.st_asgeojson(extensions.st_geomfromtext('MULTILINESTRING((-87.02 36,-86.98 36))',4326))::jsonb;
  clipped jsonb:=extensions.st_asgeojson(extensions.st_geomfromtext('MULTILINESTRING((-87.01 36,-86.99 36))',4326))::jsonb;
  left_selection jsonb:='{"source":"Overture transportation","sourceRevision":"walk-current","side":"left","corridorMeters":20,"segmentIds":["crossing"]}';
  right_selection jsonb:='{"source":"Overture transportation","sourceRevision":"walk-current","side":"right","corridorMeters":20,"segmentIds":["crossing"]}';
  vertical jsonb:=extensions.st_asgeojson(extensions.st_geomfromtext('MULTILINESTRING((-87 35.995,-87 36.008))',4326))::jsonb;
  vertical_left jsonb:='{"source":"Overture transportation","sourceRevision":"walk-current","side":"left","corridorMeters":100,"segmentIds":["vertical"]}';
  vertical_both jsonb:='{"source":"Overture transportation","sourceRevision":"walk-current","side":"both","corridorMeters":100,"segmentIds":["vertical"]}'; begin
  perform pg_temp.expect_denied(pg_temp.command('stale-street',jsonb_build_array(pg_temp.target_op('stale-street','event-street','streets',canonical,array['PARCEL-STREET-N'],'street_auto',
    '{"source":"Overture transportation","sourceRevision":"walk-old","side":"left","corridorMeters":20,"segmentIds":["crossing"]}'))),'PT409');
  perform pg_temp.expect_denied(pg_temp.command('clipped-is-not-canonical',jsonb_build_array(pg_temp.target_op('clipped-street','event-street','streets',clipped,array['PARCEL-STREET-N'],'street_auto',left_selection))),'22023');
  perform pg_temp.expect_denied(pg_temp.command('outside-parent-street',jsonb_build_array(pg_temp.target_op('outside-street','event-street','streets',
    extensions.st_asgeojson(extensions.st_geomfromtext('MULTILINESTRING((-87.02 36.02,-86.98 36.02))',4326))::jsonb,array[]::text[],'street_auto',
    '{"source":"Overture transportation","sourceRevision":"walk-current","side":"left","corridorMeters":20,"segmentIds":["outside"]}'))),'22023');
  perform pg_temp.expect_denied(pg_temp.command('left-wrong-side',jsonb_build_array(pg_temp.target_op('left-wrong','event-street','streets',canonical,array['PARCEL-STREET-S'],'street_auto',left_selection))),'22023');
  perform pg_temp.expect_denied(pg_temp.command('vertical-left-wrong-side',jsonb_build_array(pg_temp.target_op('vertical-left-wrong','event-street','streets',vertical,array['PARCEL-STREET-E100'],'street_auto',vertical_left))),'22023');
  perform pg_temp.expect_denied(pg_temp.command('vertical-left-flat-end',jsonb_build_array(pg_temp.target_op('vertical-left-flat-end','event-street','streets',vertical,array['PARCEL-STREET-W-END'],'street_auto',vertical_left))),'22023');
  perform public.outreach_apply_command(pg_temp.command('canonical-street-targets',jsonb_build_array(
    pg_temp.target_op('street-left','event-street','streets',canonical,array['PARCEL-STREET-N'],'street_auto',left_selection),
    pg_temp.target_op('street-deep','event-street','streets',canonical,array['PARCEL-STREET-DEEP'],'street_auto',left_selection),
    pg_temp.target_op('street-right','event-street','streets',canonical,array['PARCEL-STREET-S'],'street_auto',right_selection),
    pg_temp.target_op('street-vertical-left','event-street','streets',vertical,array['PARCEL-STREET-W100'],'street_auto',vertical_left),
    pg_temp.target_op('street-vertical-both','event-street','streets',vertical,array['PARCEL-STREET-W-END'],'street_auto',vertical_both))));
  if not exists(select 1 from public.outreach_walk_targets t where t.id='street-left'
    and extensions.st_equals(t.geometry,extensions.st_geomfromtext('MULTILINESTRING((-87.02 36,-86.98 36))',4326))
    and extensions.st_equals(extensions.st_setsrid(extensions.st_geomfromgeojson(t.geometry_json::text),4326),t.geometry)) then
    raise exception 'Canonical street geometry was not persisted'; end if;
  if not exists(select 1 from public.outreach_walk_target_parcels where target_id='street-deep' and gislink='PARCEL-STREET-DEEP') then
    raise exception 'Street-adjacent parcel geometry was not accepted when its representative point fell outside the corridor'; end if;
end $$;

-- Accepted ownership cannot be silently changed. A leader may explicitly put
-- the assignment back into assigned state; the new owner still cannot visit
-- until personally accepting it.
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000011'),true);
do $$ begin
  perform public.outreach_apply_command(pg_temp.command('owner-target-and-assignment',jsonb_build_array(
    pg_temp.target_op('owner-target','event-owner','polygon',pg_temp.parent_geometry(),array['PARCEL-S']),
    pg_temp.target_op('owner-other-target','event-owner','polygon',pg_temp.parent_geometry(),array['PARCEL-N']),
    pg_temp.assignment_op('owner-assignment','event-owner','owner-target',null,'volunteer_88000000000040008000000000000012','assigned',0))));
  perform pg_temp.expect_denied(pg_temp.command('leader-fakes-acceptance',jsonb_build_array(pg_temp.assignment_op('owner-assignment','event-owner','owner-target',null,'volunteer_88000000000040008000000000000012','accepted',1))),'42501');
end $$;
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000012'),true);
select public.outreach_apply_command(pg_temp.command('owner-accepts',jsonb_build_array(pg_temp.assignment_op('owner-assignment','event-owner','owner-target',null,'volunteer_88000000000040008000000000000012','accepted',1))));
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000011'),true);
do $$ begin
  perform pg_temp.expect_denied(pg_temp.command('silent-accepted-target-change',jsonb_build_array(pg_temp.assignment_op('owner-assignment','event-owner','owner-other-target',null,'volunteer_88000000000040008000000000000012','accepted',2))),'22023');
  perform pg_temp.expect_denied(pg_temp.command('silent-owner-change',jsonb_build_array(pg_temp.assignment_op('owner-assignment','event-owner','owner-target',null,'volunteer_88000000000040008000000000000013','accepted',2))),'22023');
  perform public.outreach_apply_command(pg_temp.command('explicit-owner-change',jsonb_build_array(pg_temp.assignment_op('owner-assignment','event-owner','owner-target',null,'volunteer_88000000000040008000000000000013','assigned',2))));
end $$;
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000013'),true);
do $$ begin
  perform pg_temp.expect_denied(pg_temp.command('new-owner-too-early',jsonb_build_array(pg_temp.visit_op('owner-visit-too-early','event-owner','owner-target','location-south'))),'42501');
  perform public.outreach_apply_command(pg_temp.command('new-owner-accepts',jsonb_build_array(pg_temp.assignment_op('owner-assignment','event-owner','owner-target',null,'volunteer_88000000000040008000000000000013','accepted',3))));
end $$;

-- Empty target drafts may be saved, but the transaction-final validator rejects
-- both readiness with an assigned owner and acceptance while the outing is still
-- a draft. Each failed command rolls back its earlier lifecycle mutations.
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000011'),true);
do $$ begin
  perform public.outreach_apply_command(pg_temp.command('empty-target-drafts',jsonb_build_array(
    pg_temp.target_op('empty-ready-target','event-empty-ready','polygon',pg_temp.parent_geometry(),array[]::text[]),
    pg_temp.assignment_op('empty-ready-assignment','event-empty-ready','empty-ready-target',null,'volunteer_88000000000040008000000000000012','assigned',0),
    pg_temp.target_op('empty-accept-target','event-empty-accept','polygon',pg_temp.parent_geometry(),array[]::text[]),
    pg_temp.assignment_op('empty-accept-assignment','event-empty-accept','empty-accept-target',null,'volunteer_88000000000040008000000000000012','assigned',0))));
  perform pg_temp.expect_denied(pg_temp.command('empty-target-ready',jsonb_build_array(pg_temp.event_op('event-empty-ready','ready',1))),'22023');
  if (select status from public.outreach_outings where id='event-empty-ready')<>'draft'
    or (select roster_state from public.outreach_walk_targets where id='empty-ready-target')<>'draft' then
    raise exception 'Empty-target readiness rejection did not roll back'; end if;
end $$;
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000012'),true);
do $$ begin
  perform pg_temp.expect_denied(pg_temp.command('empty-target-accept',jsonb_build_array(
    pg_temp.assignment_op('empty-accept-assignment','event-empty-accept','empty-accept-target',null,'volunteer_88000000000040008000000000000012','accepted',1))),'22023');
  if (select status from public.outreach_assignments where id='empty-accept-assignment')<>'assigned'
    or (select roster_state from public.outreach_walk_targets where id='empty-accept-target')<>'draft' then
    raise exception 'Empty-target acceptance rejection did not roll back'; end if;
end $$;

-- Ready/active replacement is one ordered durable command: cancellation first,
-- then the new frozen target, then a newly assigned owner. A later failure rolls
-- back the cancellation; successful replacements retain all frozen history and
-- require fresh acceptance.
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000011'),true);
do $$ begin
  perform public.outreach_apply_command(pg_temp.command('replacement-plan',jsonb_build_array(
    pg_temp.target_op('replace-old','event-replace','polygon',pg_temp.parent_geometry(),array['PARCEL-REPLACE']),
    pg_temp.target_op('replace-stable','event-replace','polygon',pg_temp.parent_geometry(),array['PARCEL-STABLE']),
    pg_temp.assignment_op('replace-old-assignment','event-replace','replace-old',null,'volunteer_88000000000040008000000000000012','assigned',0),
    pg_temp.assignment_op('replace-stable-assignment','event-replace','replace-stable',null,'volunteer_88000000000040008000000000000012','assigned',0))));
end $$;
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000012'),true);
select public.outreach_apply_command(pg_temp.command('accept-replacement-plan',jsonb_build_array(
  pg_temp.assignment_op('replace-old-assignment','event-replace','replace-old',null,'volunteer_88000000000040008000000000000012','accepted',1),
  pg_temp.assignment_op('replace-stable-assignment','event-replace','replace-stable',null,'volunteer_88000000000040008000000000000012','accepted',1))));
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000011'),true);
select public.outreach_apply_command(pg_temp.command('replacement-ready',jsonb_build_array(pg_temp.event_op('event-replace','ready',1))));
do $$ begin
  perform pg_temp.expect_denied(pg_temp.command('edit-frozen-target',jsonb_build_array(pg_temp.target_op('replace-old','event-replace','polygon',pg_temp.parent_geometry(),array['PARCEL-REPLACE'],'polygon_auto',null,1))),'PT409');
  perform pg_temp.expect_denied(pg_temp.command('replacement-rollback',jsonb_build_array(
    pg_temp.assignment_op('replace-old-assignment','event-replace','replace-old',null,'volunteer_88000000000040008000000000000012','cancelled',2),
    pg_temp.target_op('replace-failed','event-replace','polygon',pg_temp.parent_geometry(),array['PARCEL-REPLACE']),
    pg_temp.assignment_op('replace-failed-assignment','event-replace','replace-failed','team-field','volunteer_88000000000040008000000000000013','assigned',0))),'22023');
  if (select status from public.outreach_assignments where id='replace-old-assignment')<>'accepted' or exists(select 1 from public.outreach_walk_targets where id='replace-failed') then raise exception 'Failed replacement did not roll back cancellation and target'; end if;
  perform public.outreach_apply_command(pg_temp.command('replacement-on-ready',jsonb_build_array(
    pg_temp.assignment_op('replace-old-assignment','event-replace','replace-old',null,'volunteer_88000000000040008000000000000012','cancelled',2),
    pg_temp.target_op('replace-ready','event-replace','polygon',pg_temp.parent_geometry(),array['PARCEL-REPLACE']),
    pg_temp.assignment_op('replace-ready-assignment','event-replace','replace-ready',null,'volunteer_88000000000040008000000000000013','assigned',0))));
  if not exists(select 1 from public.outreach_walk_targets where id='replace-old' and roster_state='frozen' and finished_at is null)
    or not exists(select 1 from public.outreach_walk_targets where id='replace-ready' and roster_state='frozen' and frozen_at is not null)
    or (select status from public.outreach_assignments where id='replace-ready-assignment')<>'assigned'
    or not exists(select 1 from public.outreach_walk_targets where id='replace-stable' and roster_state='frozen' and finished_at is null) then
    raise exception 'Ready replacement did not preserve frozen history or fresh assignment'; end if;
end $$;
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000013'),true);
do $$ begin
  perform pg_temp.expect_denied(pg_temp.command('replacement-visit-before-accept',jsonb_build_array(pg_temp.visit_op('replace-too-early','event-replace','replace-ready','location-replace'))),'42501');
  perform public.outreach_apply_command(pg_temp.command('accept-ready-replacement',jsonb_build_array(pg_temp.assignment_op('replace-ready-assignment','event-replace','replace-ready',null,'volunteer_88000000000040008000000000000013','accepted',1))));
end $$;

select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000011'),true);
-- Whole-zone labels are geometrically real. A whole-zone target assignment
-- conflicts with every smaller target in the same parent, including when both
-- targets were drafted unassigned first.
do $$ begin
  perform pg_temp.expect_denied(pg_temp.command('fake-whole-zone',jsonb_build_array(pg_temp.target_op('fake-whole','event-cross','whole_zone',
    pg_temp.polygon(-87.005,35.995,-86.995,36.005),array['PARCEL-N']))),'22023');
  perform public.outreach_apply_command(pg_temp.command('draft-cross-targets',jsonb_build_array(
    pg_temp.target_op('whole-target','event-cross','whole_zone',pg_temp.parent_geometry(),array['PARCEL-N']),
    pg_temp.target_op('small-target','event-cross','polygon',pg_temp.parent_geometry(),array['PARCEL-S']))));
  perform public.outreach_apply_command(pg_temp.command('assign-whole',jsonb_build_array(pg_temp.assignment_op('assign-whole','event-cross','whole-target','team-field',null,'assigned',0))));
  perform pg_temp.expect_denied(pg_temp.command('assign-under-whole',jsonb_build_array(pg_temp.assignment_op('assign-small','event-cross','small-target','team-other',null,'assigned',0))),'23505');
  if exists(select 1 from public.outreach_assignments where id='assign-small') then raise exception 'Conflicting subtarget assignment partially persisted'; end if;
  perform public.outreach_apply_command(pg_temp.command('cancel-whole',jsonb_build_array(pg_temp.assignment_op('assign-whole','event-cross','whole-target','team-field',null,'cancelled',1))));
  perform public.outreach_apply_command(pg_temp.command('assign-small-after-cancel',jsonb_build_array(pg_temp.assignment_op('assign-small','event-cross','small-target','team-other',null,'assigned',0))));
end $$;

-- Two overlapping draft rosters are allowed for visual planning, but activating
-- the second assignment is rejected atomically. Target/event/zone links are
-- also checked independently of foreign-key existence.
do $$ begin
  perform public.outreach_apply_command(pg_temp.command('draft-overlap-targets',jsonb_build_array(
    pg_temp.target_op('overlap-a','event-overlap','polygon',pg_temp.parent_geometry(),array['PARCEL-N']),
    pg_temp.target_op('overlap-b','event-overlap','polygon',pg_temp.parent_geometry(),array['PARCEL-N']))));
  perform public.outreach_apply_command(pg_temp.command('assign-overlap-a',jsonb_build_array(pg_temp.assignment_op('overlap-assignment-a','event-overlap','overlap-a',null,'volunteer_88000000000040008000000000000012','assigned',0))));
  perform pg_temp.expect_denied(pg_temp.command('assign-overlap-b',jsonb_build_array(pg_temp.assignment_op('overlap-assignment-b','event-overlap','overlap-b',null,'volunteer_88000000000040008000000000000013','assigned',0))),'23505');
  perform pg_temp.expect_denied(pg_temp.command('wrong-target-event',jsonb_build_array(pg_temp.assignment_op('wrong-event-assignment','event-cross','overlap-a',null,'volunteer_88000000000040008000000000000012','assigned',0))),'22023');
end $$;

-- Assigned work cannot record visits. Acceptance must come from the unchanged
-- assigned owner; authoritative location parcel identity wins over spoofed
-- target parcel fields in the visit payload.
do $$ begin
  perform public.outreach_apply_command(pg_temp.command('field-target-and-assignment',jsonb_build_array(
    pg_temp.target_op('field-target','event-field','polygon',pg_temp.parent_geometry(),array['PARCEL-APT','PARCEL-N']),
    pg_temp.assignment_op('field-assignment','event-field','field-target','team-field',null,'assigned',0))));
end $$;
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000012'),true);
do $$ begin
  perform pg_temp.expect_denied(pg_temp.command('visit-before-acceptance',jsonb_build_array(pg_temp.visit_op('visit-too-early','event-field','field-target','location-apt-1'))),'42501');
  perform public.outreach_apply_command(pg_temp.command('accept-field-assignment',jsonb_build_array(pg_temp.assignment_op('field-assignment','event-field','field-target','team-field',null,'accepted',1))));
  perform public.outreach_apply_command(pg_temp.command('field-visits',jsonb_build_array(
    pg_temp.visit_op('visit-apt-1','event-field','field-target','location-apt-1'),
    pg_temp.visit_op('visit-apt-2','event-field','field-target','location-apt-2'),
    pg_temp.visit_op('visit-apt-repeat','event-field','field-target','location-apt-1'),
    pg_temp.visit_op('visit-private','event-field','field-target','location-private','private-target-person'))));
  if exists(select 1 from public.outreach_encounters e where e.id like 'visit-%' and e.target_id='field-target'
    and (e.target_county_fips<>'47055' or e.target_gislink not in ('PARCEL-APT','PARCEL-N'))) then raise exception 'Client spoofed target parcel snapshot'; end if;
  if (select count(*) from public.outreach_target_progress('88000000-0000-4000-8000-000000000001') where target_id='field-target')<>2 then raise exception 'Apartment/repeat encounters were not distinct parcel coverage'; end if;
end $$;

-- A teammate can consume parcel-level progress without gaining the private
-- person-linked encounter row that contributed to it.
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000013'),true);
do $$ begin
  if exists(select 1 from public.outreach_encounters where id='visit-private') then raise exception 'Private person-linked encounter leaked to teammate'; end if;
  if not exists(select 1 from public.outreach_target_progress('88000000-0000-4000-8000-000000000001') where target_id='field-target' and gislink='PARCEL-N') then raise exception 'Privacy-safe aggregate omitted permitted target progress'; end if;
end $$;

-- A reviewed void removes only that encounter's parcel from progress; original
-- target/event/location/person links remain immutable.
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000011',true),true);
do $$ declare request jsonb; begin
  request:=jsonb_build_object('schemaVersion',1,'id','void-target-progress','churchId','88000000-0000-4000-8000-000000000001','action','encounter_correct',
    'encounterId','visit-private','expectedRevision',(select outreach_revision from public.churches where id='88000000-0000-4000-8000-000000000001'),
    'expectedVersion',1,'outcome','conversation','context','door','voided',true,'reason','Fictional duplicate encounter',
    'confirmation','KEEP ORIGINAL AND RESPONSIBILITIES');
  perform public.outreach_admin_action(request);
  if exists(select 1 from public.outreach_target_progress('88000000-0000-4000-8000-000000000001') where target_id='field-target' and gislink='PARCEL-N') then raise exception 'Voided encounter still counted as progress'; end if;
  if (select count(*) from public.outreach_target_progress('88000000-0000-4000-8000-000000000001') where target_id='field-target')<>1 then raise exception 'Voiding one parcel changed apartment distinct coverage'; end if;
  if not exists(select 1 from public.outreach_encounters where id='visit-private' and target_id='field-target' and outing_id='event-field' and territory_id='target-zone'
    and location_id='location-private' and person_id='private-target-person' and target_gislink='PARCEL-N') then raise exception 'Correction rewrote immutable target/event links'; end if;
end $$;

select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000011'),true);
select public.outreach_apply_command(pg_temp.command('replacement-active',jsonb_build_array(pg_temp.event_op('event-replace','active',2))));
select public.outreach_apply_command(pg_temp.command('replacement-on-active',jsonb_build_array(
  pg_temp.assignment_op('replace-ready-assignment','event-replace','replace-ready',null,'volunteer_88000000000040008000000000000013','cancelled',2),
  pg_temp.target_op('replace-active','event-replace','polygon',pg_temp.parent_geometry(),array['PARCEL-REPLACE']),
  pg_temp.assignment_op('replace-active-assignment','event-replace','replace-active',null,'volunteer_88000000000040008000000000000012','assigned',0))));
do $$ begin
  if not exists(select 1 from public.outreach_walk_targets where id='replace-ready' and roster_state='frozen' and finished_at is null)
    then raise exception 'Cancelled Ready replacement history was mislabeled as finished'; end if;
end $$;
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000012'),true);
select public.outreach_apply_command(pg_temp.command('accept-active-replacement',jsonb_build_array(pg_temp.assignment_op('replace-active-assignment','event-replace','replace-active',null,'volunteer_88000000000040008000000000000012','accepted',1))));

-- Terminal assignment history stays intact, while a reviewed target may be
-- shared before its day-of crew is known.
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000011'),true);
do $$ begin
  perform public.outreach_apply_command(pg_temp.command('unready-targets',jsonb_build_array(
    pg_temp.target_op('declined-history-target','event-unready','polygon',pg_temp.parent_geometry(),array['PARCEL-S']),
    pg_temp.assignment_op('declined-history-assignment','event-unready','declined-history-target',null,'volunteer_88000000000040008000000000000012','assigned',0),
    pg_temp.target_op('unready-target','event-unready','polygon',pg_temp.parent_geometry(),array['PARCEL-N']))));
end $$;
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000012'),true);
select public.outreach_apply_command(pg_temp.command('decline-history',jsonb_build_array(
  pg_temp.assignment_op('declined-history-assignment','event-unready','declined-history-target',null,'volunteer_88000000000040008000000000000012','declined',1))));
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000011'),true);
do $$ begin
  perform public.outreach_apply_command(pg_temp.command('ready-before-checkin',jsonb_build_array(pg_temp.event_op('event-unready','ready',1))));
  if (select status from public.outreach_outings where id='event-unready')<>'ready'
    or (select roster_state from public.outreach_walk_targets where id='unready-target')<>'frozen'
    or exists(select 1 from public.outreach_assignments where target_id='unready-target')
    or (select status from public.outreach_assignments where id='declined-history-assignment')<>'declined' then
    raise exception 'Advance sharing created ownership or damaged target history'; end if;
end $$;

-- Availability is a reversible response while the walk remains open. The
-- unchanged owner can rejoin after declining, then change the response again;
-- the same assignment and frozen target history are retained.
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000012'),true);
select public.outreach_apply_command(pg_temp.command('rejoin-declined-assignment',jsonb_build_array(
  pg_temp.assignment_op('declined-history-assignment','event-unready','declined-history-target',null,'volunteer_88000000000040008000000000000012','accepted',2))));
do $$ begin
  if (select status from public.outreach_assignments where id='declined-history-assignment')<>'accepted' then
    raise exception 'Declined assignment response could not be changed'; end if;
end $$;
select public.outreach_apply_command(pg_temp.command('change-rejoined-response',jsonb_build_array(
  pg_temp.assignment_op('declined-history-assignment','event-unready','declined-history-target',null,'volunteer_88000000000040008000000000000012','declined',3))));

-- Leader cumulative coverage retains residential legacy encounters with no
-- outing. The public paged projection preserves a JSON-null outing cursor.
select set_config('request.jwt.claims',pg_temp.claims('88000000-0000-4000-8000-000000000011'),true);
do $$ begin
  if not exists(select 1 from public.outreach_parent_progress('88000000-0000-4000-8000-000000000001')
    where territory_id='target-zone' and outing_id is null and gislink='PARCEL-STABLE') then raise exception 'Outing-less legacy coverage disappeared'; end if;
  if not exists(select 1 from public.outreach_read_records('88000000-0000-4000-8000-000000000001','parent_progress')
    where record->>'territory_id'='target-zone' and record->>'outing_id' is null and record->>'gislink'='PARCEL-STABLE' and id like '%null%') then
    raise exception 'Nullable parent-progress cursor was not stable'; end if;
  begin perform public.outreach_read_records('88000000-0000-4000-8000-000000000002','target'); raise exception 'Cross-church target read was allowed';
  exception when others then if sqlstate<>'42501' then raise; end if; end;
end $$;

reset role;
rollback;
select 'PASS: authenticated target commands, legacy targetless both-owner acknowledgement, targeted exact ownership/fresh acceptance, open-ring parent normalization, nonempty readiness/acceptance rosters, whole-zone and parcel exclusivity, frozen ready/active replacement rollback, target-linked privacy-safe distinct/voided coverage, outing-less parent coverage, authoritative parcel points, and complete bounded canonical street releases' as result;
