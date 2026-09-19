begin;

create table public.outreach_walk_targets (
  church_id uuid not null references public.churches(id),
  id text not null check(length(id) between 1 and 190),
  outing_id text not null,
  territory_id text not null,
  name text not null check(length(btrim(name)) between 1 and 120),
  color text not null check(color ~ '^#[0-9a-fA-F]{6}$'),
  selection_kind text not null check(selection_kind in ('polygon','rectangle','streets','whole_zone')),
  geometry extensions.geometry(Geometry,4326) not null,
  geometry_json jsonb not null check(jsonb_typeof(geometry_json)='object'),
  street_selection jsonb check(street_selection is null or jsonb_typeof(street_selection)='object'),
  roster_state text not null default 'draft' check(roster_state in ('draft','frozen')),
  frozen_at timestamptz,
  finished_at timestamptz,
  version bigint not null default 1 check(version > 0),
  deleted_at timestamptz,
  primary key(church_id,id),
  foreign key(church_id,outing_id) references public.outreach_outings(church_id,id),
  foreign key(church_id,territory_id) references public.outreach_territories(church_id,id),
  check(extensions.st_srid(geometry)=4326 and extensions.st_isvalid(geometry) and not extensions.st_isempty(geometry)),
  check((selection_kind='streets')=(extensions.st_geometrytype(geometry)='ST_MultiLineString')),
  check((selection_kind='streets')=(street_selection is not null)),
  check((roster_state='frozen')=(frozen_at is not null))
);
create index outreach_walk_targets_geometry_idx on public.outreach_walk_targets using gist(geometry);
create index outreach_walk_targets_outing_idx on public.outreach_walk_targets(church_id,outing_id);

create table public.outreach_street_segments (
  release text not null, id text not null, name text, road_class text, subclass text,
  geometry extensions.geometry(MultiLineString,4326) not null,
  primary key(release,id), check(extensions.st_isvalid(geometry) and not extensions.st_isempty(geometry))
);
create index outreach_street_segments_geometry_idx on public.outreach_street_segments using gist(geometry);
create table public.outreach_street_releases (
  release text primary key, source text not null, imported_at timestamptz not null default now(), complete boolean not null default false,
  county_fips text[] not null, expected_rows bigint not null check(expected_rows>=0), imported_rows bigint not null check(imported_rows>=0),
  check(not complete or (county_fips @> array['47055','47099','47101','47181']::text[] and cardinality(county_fips)=4 and expected_rows=imported_rows and imported_rows>0))
);
alter table public.outreach_street_segments enable row level security;
alter table public.outreach_street_releases enable row level security;
alter table public.outreach_street_segments force row level security;
alter table public.outreach_street_releases force row level security;
revoke all on public.outreach_street_segments,public.outreach_street_releases from anon,authenticated;

create table public.outreach_walk_target_parcels (
  church_id uuid not null,
  target_id text not null,
  county_fips text not null check(county_fips in ('47055','47099','47101','47181')),
  gislink text not null check(length(gislink) between 1 and 120),
  dataset_revision text not null check(length(dataset_revision) between 1 and 190),
  inclusion_source text not null check(inclusion_source in ('polygon_auto','street_auto','manual_add')),
  geometry_json jsonb,
  representative_longitude double precision check(representative_longitude between -180 and 180),
  representative_latitude double precision check(representative_latitude between -90 and 90),
  primary key(church_id,target_id,county_fips,gislink),
  foreign key(church_id,target_id) references public.outreach_walk_targets(church_id,id) on delete restrict,
  foreign key(county_fips,gislink) references public.parcels(county_fips,gislink),
  check((representative_longitude is null)=(representative_latitude is null))
);

alter table public.outreach_assignments add column target_id text;
alter table public.outreach_assignments add constraint outreach_assignment_target_fk foreign key(church_id,target_id) references public.outreach_walk_targets(church_id,id);
alter table public.outreach_assignments drop constraint outreach_assignments_check;
alter table public.outreach_assignments add constraint outreach_assignment_owner_compatibility check(
  (team_id is not null or assignee_id is not null)
  and (target_id is null or (team_id is null) <> (assignee_id is null))
);
alter table public.outreach_encounters add column target_id text;
alter table public.outreach_encounters add column target_county_fips text;
alter table public.outreach_encounters add column target_gislink text;
alter table public.outreach_encounters add constraint outreach_encounter_target_fk foreign key(church_id,target_id) references public.outreach_walk_targets(church_id,id);
alter table public.outreach_encounters add constraint outreach_encounter_target_parcel_fk foreign key(church_id,target_id,target_county_fips,target_gislink)
  references public.outreach_walk_target_parcels(church_id,target_id,county_fips,gislink);
alter table public.outreach_encounters add constraint outreach_encounter_target_parcel_state check(
  (target_id is null and target_county_fips is null and target_gislink is null) or
  (target_id is not null and target_county_fips is not null and target_gislink is not null));
drop index public.outreach_assignment_active_area_idx;
create unique index outreach_assignment_active_target_idx on public.outreach_assignments(church_id,outing_id,target_id)
  where deleted_at is null and target_id is not null and status in ('assigned','accepted');
create unique index outreach_assignment_active_whole_area_idx on public.outreach_assignments(church_id,outing_id,territory_id)
  where deleted_at is null and target_id is null and status in ('assigned','accepted');
create index outreach_assignment_target_idx on public.outreach_assignments(church_id,target_id) where target_id is not null;
create index outreach_encounters_target_parcel_idx on public.outreach_encounters(church_id,target_id,target_county_fips,target_gislink) where target_id is not null;

alter table public.outreach_walk_targets enable row level security;
alter table public.outreach_walk_target_parcels enable row level security;
alter table public.outreach_walk_targets force row level security;
alter table public.outreach_walk_target_parcels force row level security;
create policy member_read on public.outreach_walk_targets for select to authenticated
  using(deleted_at is null and (select private.is_church_member(church_id)));
create policy member_read on public.outreach_walk_target_parcels for select to authenticated
  using((select private.is_church_member(church_id)));
revoke insert,update,delete on public.outreach_walk_targets,public.outreach_walk_target_parcels from authenticated,anon;
grant select on public.outreach_walk_targets,public.outreach_walk_target_parcels to authenticated;

create function private.outreach_boundary_polygon(boundary jsonb)
returns extensions.geometry language plpgsql stable set search_path='' as $$
declare ring jsonb; shape extensions.geometry;
begin
  if jsonb_typeof(boundary)='array' then ring:=boundary;
  elsif jsonb_typeof(boundary)='object' and boundary->>'type'='Polygon'
    and jsonb_typeof(boundary#>'{coordinates,0}')='array' then ring:=boundary#>'{coordinates,0}';
  else raise exception 'A polygon boundary is required.' using errcode='22023'; end if;
  if jsonb_array_length(ring)<3 or exists(
    select 1 from jsonb_array_elements(ring) p(value)
    where jsonb_typeof(p.value)<>'array' or jsonb_array_length(p.value)<2
      or jsonb_typeof(p.value->0)<>'number' or jsonb_typeof(p.value->1)<>'number'
  ) or (select count(distinct p.value) from jsonb_array_elements(ring) p(value))<3 then
    raise exception 'A polygon boundary needs at least three distinct coordinate points.' using errcode='22023';
  end if;
  if ring->0 is distinct from ring->(jsonb_array_length(ring)-1) then ring:=ring||jsonb_build_array(ring->0); end if;
  begin
    shape:=extensions.st_setsrid(extensions.st_geomfromgeojson(jsonb_build_object('type','Polygon','coordinates',jsonb_build_array(ring))::text),4326);
  exception when others then raise exception 'Territory geometry could not be parsed.' using errcode='22023'; end;
  if extensions.st_geometrytype(shape)<>'ST_Polygon' or extensions.st_isempty(shape) or not extensions.st_isvalid(shape) then
    raise exception 'Territory boundary must be a valid polygon without crossing edges.' using errcode='22023';
  end if;
  return shape;
end $$;
revoke all on function private.outreach_boundary_polygon(jsonb) from public,anon,authenticated;

alter function private.outreach_apply_operation(uuid,uuid,text,jsonb) rename to outreach_apply_operation_before_walk_targets;
create function private.outreach_apply_operation(church uuid,actor uuid,command_id text,op jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare kind text:=op->>'entityType'; record_id text:=op->>'entityId'; operation text:=op->>'operation'; r jsonb:=coalesce(op->'record','{}');
  old_target public.outreach_walk_targets; target public.outreach_walk_targets; old_assignment public.outreach_assignments;
  shape extensions.geometry; submitted_shape extensions.geometry; parent_shape extensions.geometry; target_scope extensions.geometry; selected_lines extensions.geometry;
  authoritative_parcel public.parcels; parcel jsonb; location_parcel jsonb; current_version bigint; result jsonb;
  outing_status text; current_street_release text; effective_target_id text; incoming_assignee uuid;
begin
  if length(coalesce(record_id,'')) not between 1 and 240 or coalesce(operation,'') not in ('upsert','delete') then raise exception 'Invalid change request.' using errcode='22023'; end if;
  if r ? 'churchId' and r->>'churchId' is distinct from church::text then raise exception 'Cross-church payload rejected.' using errcode='42501'; end if;
  if kind='target' then
    if not private.is_church_leader(church) then raise exception 'Only a church leader can plan nightly targets.' using errcode='42501'; end if;
    select * into old_target from public.outreach_walk_targets where church_id=church and id=record_id for update;
    current_version:=coalesce(old_target.version,0);
    if current_version<>(op->>'expectedVersion')::bigint then raise sqlstate 'PT409' using message='This nightly target changed on another device. Review before retrying.'; end if;
    if old_target.roster_state='frozen' then raise sqlstate 'PT409' using message='This nightly target is frozen history. Create a replacement target.'; end if;
    if operation='delete' then
      if old_target.id is null then raise exception 'This nightly target is unavailable.' using errcode='22023'; end if;
      if exists(select 1 from public.outreach_assignments a where a.church_id=church and a.target_id=record_id and a.deleted_at is null)
        or exists(select 1 from public.outreach_encounters e where e.church_id=church and e.target_id=record_id) then raise exception 'A target with assignments or encounters must remain as history.' using errcode='22023'; end if;
      update public.outreach_walk_targets set deleted_at=now(),version=version+1 where church_id=church and id=record_id;
    else
      select o.status into outing_status from public.outreach_outings o where o.church_id=church and o.id=r->>'eventId' and o.deleted_at is null;
      if outing_status is null or (old_target.id is null and outing_status not in ('draft','scheduled','ready','active'))
        or (old_target.id is not null and outing_status not in ('draft','scheduled')) then
        raise exception 'Targets may be planned only for an open outing; ready or active outings require a new frozen replacement.' using errcode='22023';
      end if;
      if old_target.id is not null and (old_target.outing_id is distinct from r->>'eventId' or old_target.territory_id is distinct from r->>'territoryId') then
        raise exception 'A nightly target cannot move to another outing or parent zone.' using errcode='22023';
      end if;
      if not exists(select 1 from public.outreach_territories t where t.church_id=church and t.id=r->>'territoryId' and t.kind='map' and t.deleted_at is null) then raise exception 'Choose an available mapped parent zone.' using errcode='22023'; end if;
      if pg_column_size(r)>900000 or jsonb_array_length(coalesce(r->'parcels','[]'))>10000 then raise exception 'Nightly target is too large.' using errcode='22023'; end if;
      begin submitted_shape:=extensions.st_setsrid(extensions.st_geomfromgeojson((r->'geometry')::text),4326); exception when others then raise exception 'Target geometry could not be parsed.' using errcode='22023'; end;
      if extensions.st_isempty(submitted_shape) or not extensions.st_isvalid(submitted_shape) then raise exception 'Target geometry must be valid and non-empty.' using errcode='22023'; end if;
      if (r->>'selectionKind'='streets' and extensions.st_geometrytype(submitted_shape)<>'ST_MultiLineString') or (r->>'selectionKind'<>'streets' and extensions.st_geometrytype(submitted_shape)<>'ST_Polygon') then raise exception 'Target geometry does not match its selection method.' using errcode='22023'; end if;
      select private.outreach_boundary_polygon(t.boundary) into parent_shape
        from public.outreach_territories t where t.church_id=church and t.id=r->>'territoryId';
      if r->>'selectionKind'='streets' then
        if r#>>'{streetSelection,source}' is distinct from 'Overture transportation'
          or r#>>'{streetSelection,side}' not in ('both','left','right')
          or coalesce(r#>>'{streetSelection,corridorMeters}','') !~ '^\d+$'
          or (r#>>'{streetSelection,corridorMeters}')::integer not between 5 and 100
          or jsonb_typeof(r#>'{streetSelection,segmentIds}') is distinct from 'array'
          or jsonb_array_length(r#>'{streetSelection,segmentIds}') not between 1 and 5000 then
          raise exception 'Choose supported canonical street sections, side and corridor.' using errcode='22023';
        end if;
        select sr.release into current_street_release from public.outreach_street_releases sr
          where sr.source='Overture transportation' order by sr.imported_at desc,sr.release desc limit 1;
        if current_street_release is distinct from r#>>'{streetSelection,sourceRevision}'
          or not exists(select 1 from public.outreach_street_releases sr where sr.release=current_street_release and sr.complete) then
          raise sqlstate 'PT409' using message='The selected street release is incomplete or stale.';
        end if;
        if jsonb_array_length(r#>'{streetSelection,segmentIds}')<>(select count(distinct s.id) from public.outreach_street_segments s
          where s.release=current_street_release and s.id in (select jsonb_array_elements_text(r#>'{streetSelection,segmentIds}'))
            and extensions.st_intersects(s.geometry,parent_shape)) then raise exception 'A selected street segment is unavailable in this parent zone.' using errcode='22023'; end if;
        select extensions.st_multi(extensions.st_unaryunion(extensions.st_collect(s.geometry))) into selected_lines from public.outreach_street_segments s where s.release=r#>>'{streetSelection,sourceRevision}' and s.id in (select jsonb_array_elements_text(r#>'{streetSelection,segmentIds}'));
        if selected_lines is null or extensions.st_isempty(selected_lines)
          or not extensions.st_coveredby(submitted_shape,extensions.st_buffer(selected_lines::extensions.geography,1)::extensions.geometry)
          or not extensions.st_coveredby(selected_lines,extensions.st_buffer(submitted_shape::extensions.geography,1)::extensions.geometry) then
          raise exception 'Selected street geometry does not match the imported release.' using errcode='22023';
        end if;
        shape:=selected_lines;
      else
        shape:=submitted_shape;
      end if;
      if r->>'selectionKind'='streets' then
        select extensions.st_transform(extensions.st_unaryunion(extensions.st_collect(
          extensions.st_buffer(extensions.st_transform(parts.geom,32616),(r#>>'{streetSelection,corridorMeters}')::double precision,
            case r#>>'{streetSelection,side}' when 'left' then 'side=left endcap=flat'
              when 'right' then 'side=right endcap=flat' else 'endcap=round' end))),4326)
        into target_scope
        from public.outreach_street_segments s
        cross join lateral extensions.st_dump(s.geometry) parts
        where s.release=current_street_release and s.id in (select jsonb_array_elements_text(r#>'{streetSelection,segmentIds}'));
      else
        target_scope:=shape;
      end if;
      if r->>'selectionKind'='streets' then target_scope:=extensions.st_intersection(target_scope,parent_shape); end if;
      if extensions.st_isempty(target_scope) then raise exception 'The selected target does not intersect its parent zone.' using errcode='22023'; end if;
      if r->>'selectionKind'='whole_zone' and not extensions.st_equals(shape,parent_shape) then
        raise exception 'A whole-zone target must use the complete parent boundary.' using errcode='22023';
      end if;
      if r->>'selectionKind'<>'streets' and not extensions.st_coveredby(target_scope,parent_shape) then
        raise exception 'Nightly targets must stay inside their parent zone.' using errcode='22023'; end if;
      insert into public.outreach_walk_targets(church_id,id,outing_id,territory_id,name,color,selection_kind,geometry,geometry_json,street_selection,roster_state,frozen_at,version)
      values(church,record_id,r->>'eventId',r->>'territoryId',r->>'name',r->>'color',r->>'selectionKind',shape,
        case when r->>'selectionKind'='streets' then extensions.st_asgeojson(shape,6)::jsonb else r->'geometry' end,nullif(r->'streetSelection','null'::jsonb),
        case when outing_status in ('ready','active') then 'frozen' else 'draft' end,
        case when outing_status in ('ready','active') then now() else null end,current_version+1)
      on conflict(church_id,id) do update set name=excluded.name,color=excluded.color,selection_kind=excluded.selection_kind,geometry=excluded.geometry,
        geometry_json=excluded.geometry_json,street_selection=excluded.street_selection,version=excluded.version;
      delete from public.outreach_walk_target_parcels where church_id=church and target_id=record_id;
      for parcel in select value from jsonb_array_elements(coalesce(r->'parcels','[]')) loop
        if parcel->>'datasetRevision' is distinct from (select coalesce(to_char(max(p.imported_at),'YYYY-MM-DD"T"HH24:MI:SS.USOF'),'empty') from public.parcels p) then raise sqlstate 'PT409' using message='Parcel data changed while this target was being reviewed. Refresh and review the highlighted parcels again.'; end if;
        select * into authoritative_parcel from public.parcels p where p.county_fips=parcel->>'countyFips' and p.gislink=parcel->>'gislink' and p.is_residential;
        if authoritative_parcel.id is null then raise exception 'Target rosters may contain only known residential parcels.' using errcode='22023'; end if;
        if not extensions.st_covers(parent_shape,extensions.st_pointonsurface(authoritative_parcel.geometry))
          or parcel->>'inclusionSource'<>'manual_add' and not extensions.st_covers(target_scope,extensions.st_pointonsurface(authoritative_parcel.geometry)) then raise exception 'Roster parcels must be residential and inside the reviewed map scope.' using errcode='22023'; end if;
        if exists(select 1 from public.outreach_walk_target_parcels tp join public.outreach_walk_targets wt on wt.church_id=tp.church_id and wt.id=tp.target_id
          join public.outreach_assignments a on a.church_id=wt.church_id and a.target_id=wt.id and a.deleted_at is null and a.status in ('assigned','accepted')
          where tp.church_id=church and wt.outing_id=r->>'eventId' and wt.id<>record_id and wt.deleted_at is null and tp.county_fips=parcel->>'countyFips' and tp.gislink=parcel->>'gislink') then
          raise exception 'A residential parcel may belong to only one active nightly target.' using errcode='23505'; end if;
        insert into public.outreach_walk_target_parcels(church_id,target_id,county_fips,gislink,dataset_revision,inclusion_source,geometry_json,representative_longitude,representative_latitude)
        values(church,record_id,parcel->>'countyFips',parcel->>'gislink',parcel->>'datasetRevision',parcel->>'inclusionSource',extensions.st_asgeojson(authoritative_parcel.geometry,6)::jsonb,
          extensions.st_x(extensions.st_pointonsurface(authoritative_parcel.geometry)),extensions.st_y(extensions.st_pointonsurface(authoritative_parcel.geometry)));
      end loop;
    end if;
    insert into public.outreach_audit(church_id,actor_id,command_id,action,entity_type,entity_id) values(church,actor,command_id,'target.'||operation,'target',record_id);
    return jsonb_build_object('entityType','target','entityId',record_id,'version',current_version+1);
  end if;

  if kind='assignment' and operation='upsert' then
    select * into old_assignment from public.outreach_assignments where church_id=church and id=record_id;
    effective_target_id:=case when r ? 'targetId' then nullif(r->>'targetId','') else old_assignment.target_id end;
    incoming_assignee:=private.outreach_member_id(church,r->>'assignedVolunteerId');
    if (nullif(r->>'assignedTeamId','') is null and nullif(r->>'assignedVolunteerId','') is null)
      or (effective_target_id is not null and nullif(r->>'assignedTeamId','') is not null and nullif(r->>'assignedVolunteerId','') is not null) then
      raise exception 'Choose exactly one team or person for this target.' using errcode='22023';
    end if;
    if effective_target_id is not null and old_assignment.id is not null and old_assignment.status='accepted'
      and (effective_target_id is distinct from old_assignment.target_id
        or nullif(r->>'assignedTeamId','') is distinct from old_assignment.team_id or incoming_assignee is distinct from old_assignment.assignee_id)
      and r->>'status' is distinct from 'assigned' then
      raise exception 'Changing accepted ownership requires a new assigned state and fresh acceptance.' using errcode='22023';
    end if;
    if effective_target_id is not null and r->>'status'='accepted' and old_assignment.status is distinct from 'accepted' then
      if old_assignment.id is null
        or effective_target_id is distinct from old_assignment.target_id
        or nullif(r->>'assignedTeamId','') is distinct from old_assignment.team_id
        or incoming_assignee is distinct from old_assignment.assignee_id
        or not (incoming_assignee=actor or exists(select 1 from public.outreach_team_members tm
          where tm.church_id=church and tm.team_id=nullif(r->>'assignedTeamId','') and tm.user_id=actor)) then
        raise exception 'Only the unchanged assigned owner may accept this target.' using errcode='42501';
      end if;
    end if;
  elsif kind='visit' and operation='upsert' then
    effective_target_id:=nullif(r->>'targetId','');
  end if;

  if ((kind='assignment' or kind='visit') and operation='upsert') and effective_target_id is not null then
    select * into target from public.outreach_walk_targets where church_id=church and id=effective_target_id and deleted_at is null for share;
    if target.id is null or target.outing_id is distinct from r->>'eventId' or target.territory_id is distinct from r->>'territoryId' then raise exception 'Target, outing and parent zone must match.' using errcode='22023'; end if;
    if kind='assignment' and coalesce(r->>'status','assigned') in ('assigned','accepted') and target.finished_at is not null then
      raise exception 'A finished target is history. Create a replacement target.' using errcode='22023';
    end if;
    if kind='visit' and not exists(select 1 from public.outreach_assignments a where a.church_id=church and a.target_id=target.id and a.status='accepted' and a.deleted_at is null
      and (a.assignee_id=actor or exists(select 1 from public.outreach_team_members tm where tm.church_id=church and tm.team_id=a.team_id and tm.user_id=actor))) then raise exception 'Accept your target assignment before recording visits.' using errcode='42501'; end if;
    if kind='visit' then
      select l.parcel_reference into location_parcel from public.outreach_locations l where l.church_id=church and l.id=r->>'propertyId' and l.deleted_at is null;
      if location_parcel is null or not exists(select 1 from public.outreach_walk_target_parcels tp where tp.church_id=church and tp.target_id=target.id
        and tp.county_fips=location_parcel->>'countyFips' and tp.gislink=location_parcel->>'gislink') then raise exception 'This location is outside the frozen target parcel roster.' using errcode='22023'; end if;
    end if;
  end if;
  result:=private.outreach_apply_operation_before_walk_targets(church,actor,command_id,op);
  if kind='assignment' and operation='upsert' then
    update public.outreach_assignments set target_id=effective_target_id where church_id=church and id=record_id;
    if r->>'status'='accepted' and effective_target_id is not null then update public.outreach_walk_targets set roster_state='frozen',frozen_at=coalesce(frozen_at,now()) where church_id=church and id=effective_target_id; end if;
    if r->>'status'='completed' and effective_target_id is not null then update public.outreach_walk_targets set finished_at=coalesce(finished_at,now()) where church_id=church and id=effective_target_id; end if;
  elsif kind='visit' and operation='upsert' then update public.outreach_encounters set target_id=nullif(r->>'targetId',''),
    target_county_fips=location_parcel->>'countyFips',target_gislink=location_parcel->>'gislink' where church_id=church and id=record_id;
  elsif kind='event' and operation='upsert' and r->>'status'='ready' then
    update public.outreach_walk_targets set roster_state='frozen',frozen_at=coalesce(frozen_at,now()) where church_id=church and outing_id=record_id and deleted_at is null;
  end if;
  return result;
end $$;
revoke all on function private.outreach_apply_operation(uuid,uuid,text,jsonb) from public,anon,authenticated;

create function private.outreach_validate_walk_target_state(target_church uuid)
returns void language plpgsql set search_path='' as $$
begin
  if exists(
    select 1 from public.outreach_assignments a
    join public.outreach_walk_targets t on t.church_id=a.church_id and t.id=a.target_id
    where a.church_id=target_church and a.deleted_at is null and a.status in ('assigned','accepted')
      and (a.outing_id is distinct from t.outing_id or a.territory_id is distinct from t.territory_id or t.deleted_at is not null or t.finished_at is not null)
  ) then raise exception 'Active target assignments must match an unfinished target, outing and parent zone.' using errcode='22023'; end if;

  if exists(
    select 1 from public.outreach_assignments a
    join public.outreach_assignments b on b.church_id=a.church_id and b.outing_id=a.outing_id and b.territory_id=a.territory_id and b.id>a.id
      and b.deleted_at is null and b.status in ('assigned','accepted')
    left join public.outreach_walk_targets ta on ta.church_id=a.church_id and ta.id=a.target_id
    left join public.outreach_walk_targets tb on tb.church_id=b.church_id and tb.id=b.target_id
    where a.church_id=target_church and a.deleted_at is null and a.status in ('assigned','accepted')
      and (a.target_id is null or b.target_id is null or ta.selection_kind='whole_zone' or tb.selection_kind='whole_zone')
  ) then raise exception 'Whole-zone and nightly-target assignments cannot overlap.' using errcode='23505'; end if;

  if exists(
    select 1 from public.outreach_assignments a
    join public.outreach_assignments b on b.church_id=a.church_id and b.outing_id=a.outing_id and b.id>a.id
      and b.deleted_at is null and b.status in ('assigned','accepted') and b.target_id is not null
    join public.outreach_walk_target_parcels ap on ap.church_id=a.church_id and ap.target_id=a.target_id
    join public.outreach_walk_target_parcels bp on bp.church_id=b.church_id and bp.target_id=b.target_id
      and bp.county_fips=ap.county_fips and bp.gislink=ap.gislink
    where a.church_id=target_church and a.deleted_at is null and a.status in ('assigned','accepted') and a.target_id is not null
  ) then raise exception 'A residential parcel may belong to only one active nightly target.' using errcode='23505'; end if;

  if exists(
    select 1 from public.outreach_walk_targets t
    join public.outreach_outings o on o.church_id=t.church_id and o.id=t.outing_id
    where t.church_id=target_church and t.deleted_at is null and t.finished_at is null and o.deleted_at is null and o.status in ('ready','active')
      and not exists(select 1 from public.outreach_assignments a where a.church_id=t.church_id and a.target_id=t.id
        and a.deleted_at is null and a.status in ('assigned','accepted'))
      and not exists(select 1 from public.outreach_assignments a where a.church_id=t.church_id and a.target_id=t.id
        and a.deleted_at is null and a.status in ('completed','cancelled','declined'))
  ) then raise exception 'Every new target in a ready or active outing needs exactly one owner.' using errcode='22023'; end if;

  if exists(
    select 1 from public.outreach_walk_targets t
    join public.outreach_outings o on o.church_id=t.church_id and o.id=t.outing_id
    where t.church_id=target_church and t.deleted_at is null and t.finished_at is null and o.deleted_at is null
      and not exists(select 1 from public.outreach_walk_target_parcels tp
        where tp.church_id=t.church_id and tp.target_id=t.id)
      and (
        exists(select 1 from public.outreach_assignments a where a.church_id=t.church_id and a.target_id=t.id
          and a.deleted_at is null and a.status='accepted')
        or (o.status in ('ready','active') and exists(select 1 from public.outreach_assignments a
          where a.church_id=t.church_id and a.target_id=t.id and a.deleted_at is null and a.status in ('assigned','accepted')))
      )
  ) then raise exception 'A target needs at least one residential parcel before readiness or acceptance.' using errcode='22023'; end if;
end $$;
revoke all on function private.outreach_validate_walk_target_state(uuid) from public,anon,authenticated;

alter function private.outreach_apply_command(jsonb) rename to outreach_apply_command_before_walk_target_readiness;
create function private.outreach_apply_command(command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; target_church uuid:=(command->>'churchId')::uuid;
begin
  result:=private.outreach_apply_command_before_walk_target_readiness(command);
  perform private.outreach_validate_walk_target_state(target_church);
  return result;
end $$;
revoke all on function private.outreach_apply_command_before_walk_target_readiness(jsonb) from public,anon,authenticated;
revoke all on function private.outreach_apply_command(jsonb) from public,anon;
grant execute on function private.outreach_apply_command(jsonb) to authenticated;

create or replace function public.outreach_read_records(target_church uuid,entity_kind text,after_id text default '',page_size integer default 500)
returns table(id text,version bigint,record jsonb)
language plpgsql stable security invoker set search_path = '' as $$
declare tab text; key_expression text := 'r.id::text'; version_expression text := 'r.version'; live_filter text := ' and r.deleted_at is null';
begin
  if auth.uid() is null or not private.is_church_member(target_church) then raise exception 'Active church membership is required.' using errcode='42501'; end if;
  if entity_kind='target_progress' then
    return query select jsonb_build_array(p.target_id,p.county_fips,p.gislink)::text,1::bigint,
      jsonb_build_object('church_id',target_church,'target_id',p.target_id,'county_fips',p.county_fips,'gislink',p.gislink)
      from public.outreach_target_progress(target_church) p
      where jsonb_build_array(p.target_id,p.county_fips,p.gislink)::text>coalesce(after_id,'') order by 1 limit least(greatest(coalesce(page_size,500),1),750);
    return;
  end if;
  if entity_kind='parent_progress' then
    return query select jsonb_build_array(p.territory_id,p.outing_id,p.county_fips,p.gislink)::text,1::bigint,
      jsonb_build_object('church_id',target_church,'territory_id',p.territory_id,'outing_id',p.outing_id,'county_fips',p.county_fips,'gislink',p.gislink)
      from public.outreach_parent_progress(target_church) p
      where jsonb_build_array(p.territory_id,p.outing_id,p.county_fips,p.gislink)::text>coalesce(after_id,'') order by 1 limit least(greatest(coalesce(page_size,500),1),750);
    return;
  end if;
  tab := case entity_kind when 'event' then 'outreach_outings' when 'team' then 'outreach_teams' when 'team_member' then 'outreach_team_members'
    when 'territory' then 'outreach_territories' when 'target' then 'outreach_walk_targets' when 'target_parcel' then 'outreach_walk_target_parcels'
    when 'assignment' then 'outreach_assignments' when 'property' then 'outreach_locations' when 'visit' then 'outreach_encounters'
    when 'follow_up' then 'outreach_tasks' when 'task_activity' then 'outreach_task_activity' when 'resident' then 'discipleship_people'
    when 'person_note' then 'discipleship_person_notes' when 'restriction' then 'outreach_restrictions' when 'audit' then 'outreach_audit'
    when 'migration_issue' then 'outreach_migration_issues' else null end;
  if tab is null then raise exception 'Unknown record type.' using errcode='22023'; end if;
  if entity_kind='team_member' then key_expression:='jsonb_build_array(r.team_id,r.volunteer_id)::text';version_expression:='1::bigint';live_filter:='';
  elsif entity_kind='target_parcel' then key_expression:='jsonb_build_array(r.target_id,r.county_fips,r.gislink)::text';version_expression:='1::bigint';live_filter:='';
  elsif entity_kind='task_activity' then key_expression:='jsonb_build_array(r.task_id,r.id)::text';version_expression:='1::bigint';live_filter:='';
  elsif entity_kind='audit' then key_expression:='lpad(r.sequence::text,20,''0'')';version_expression:='1::bigint';live_filter:='';
  elsif entity_kind='migration_issue' then key_expression:='jsonb_build_array(r.entity_type,r.entity_id,r.issue)::text';version_expression:='1::bigint';live_filter:=' and r.resolved_at is null';
  elsif entity_kind='restriction' then live_filter:=''; end if;
  return query execute format('select %s,%s,to_jsonb(r) from public.%I r where r.church_id=$1 and %s > $2 %s order by %s limit $3',key_expression,version_expression,tab,key_expression,live_filter,key_expression)
    using target_church,coalesce(after_id,''),least(greatest(coalesce(page_size,500),1),750);
end $$;

create function public.outreach_target_progress(target_church uuid)
returns table(target_id text,county_fips text,gislink text)
language sql stable security definer set search_path='' as $$
  select distinct e.target_id,e.target_county_fips,e.target_gislink
  from public.outreach_encounters e
  where e.church_id=target_church and e.deleted_at is null and e.target_id is not null
    and not coalesce((e.corrections->-1->>'voided')::boolean,false)
    and auth.uid() is not null and private.is_real_user() and private.is_church_member(target_church)
    and (private.is_church_leader(target_church) or exists(
      select 1 from public.outreach_assignments a where a.church_id=target_church and a.target_id=e.target_id and a.deleted_at is null
        and (a.assignee_id=auth.uid() or exists(select 1 from public.outreach_team_members tm where tm.church_id=target_church and tm.team_id=a.team_id and tm.user_id=auth.uid()))));
$$;
revoke all on function public.outreach_target_progress(uuid) from public,anon;
grant execute on function public.outreach_target_progress(uuid) to authenticated;

create function public.outreach_parent_progress(target_church uuid)
returns table(territory_id text,outing_id text,county_fips text,gislink text)
language sql stable security definer set search_path='' as $$
  select distinct e.territory_id,e.outing_id,
    coalesce(e.target_county_fips,l.parcel_reference->>'countyFips'),coalesce(e.target_gislink,l.parcel_reference->>'gislink')
  from public.outreach_encounters e
  left join public.outreach_locations l on l.church_id=e.church_id and l.id=e.location_id
  where e.church_id=target_church and e.deleted_at is null and e.territory_id is not null
    and (e.target_id is not null or exists(select 1 from public.parcels p
      where p.county_fips=l.parcel_reference->>'countyFips' and p.gislink=l.parcel_reference->>'gislink' and p.is_residential))
    and not coalesce((e.corrections->-1->>'voided')::boolean,false)
    and auth.uid() is not null and private.is_real_user() and private.is_church_leader(target_church);
$$;
revoke all on function public.outreach_parent_progress(uuid) from public,anon;
grant execute on function public.outreach_parent_progress(uuid) to authenticated;

create function public.street_segments_for_boundary_v1(territory_boundary jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare shape extensions.geometry; manifest public.outreach_street_releases; feature_count integer; features jsonb;
begin
  if auth.uid() is null or not private.is_real_user() or not exists(select 1 from public.church_memberships m where m.user_id=auth.uid() and m.active) then raise exception 'Active church membership is required.' using errcode='42501'; end if;
  if territory_boundary is null or jsonb_typeof(territory_boundary) not in ('object','array') or pg_column_size(territory_boundary)>100000 then raise exception 'A bounded territory polygon is required.' using errcode='22023'; end if;
  shape:=private.outreach_boundary_polygon(territory_boundary);
  if extensions.st_area(shape::extensions.geography)>100000000 then raise exception 'A valid bounded territory polygon is required.' using errcode='22023'; end if;
  select sr.* into manifest from public.outreach_street_releases sr where sr.source='Overture transportation' order by sr.imported_at desc,sr.release desc limit 1;
  if manifest.release is null or not manifest.complete then
    return jsonb_build_object('release',coalesce(manifest.release,''),'source','Overture transportation','complete',false,'truncated',false,'features','[]'::jsonb);
  end if;
  with candidates as (select s.* from public.outreach_street_segments s where s.release=manifest.release and s.geometry operator(extensions.&&) shape
      and not extensions.st_isempty(extensions.st_collectionextract(extensions.st_intersection(s.geometry,shape),2)) order by s.id limit 5001),
  counted as (select count(*) count from candidates), limited as (select * from candidates limit 5000)
  select c.count,jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'road_class',l.road_class,'subclass',l.subclass,
      'geometry',extensions.st_asgeojson(l.geometry,6)::jsonb,
      'display_geometry',extensions.st_asgeojson(extensions.st_multi(extensions.st_collectionextract(extensions.st_intersection(l.geometry,shape),2)),6)::jsonb) order by l.id) filter(where l.id is not null)
    into feature_count,features from counted c left join limited l on true group by c.count;
  return jsonb_build_object('release',manifest.release,'source',manifest.source,'complete',feature_count<=5000,'truncated',feature_count>5000,'features',coalesce(features,'[]'::jsonb));
end $$;
revoke all on function public.street_segments_for_boundary_v1(jsonb) from public,anon;
grant execute on function public.street_segments_for_boundary_v1(jsonb) to authenticated;

create function public.planning_parcels_for_boundary_v1(territory_boundary jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare shape extensions.geometry; feature_count integer; features jsonb; dataset_revision text;
begin
  if auth.uid() is null or not private.is_real_user() or not exists(select 1 from public.church_memberships m where m.user_id=auth.uid() and m.active) then raise exception 'Active church membership is required.' using errcode='42501'; end if;
  if territory_boundary is null or jsonb_typeof(territory_boundary) not in ('object','array') or pg_column_size(territory_boundary)>100000 then raise exception 'A bounded territory polygon is required.' using errcode='22023'; end if;
  shape:=private.outreach_boundary_polygon(territory_boundary);
  if extensions.st_area(shape::extensions.geography)>100000000 then raise exception 'A valid bounded territory polygon is required.' using errcode='22023'; end if;
  select coalesce(to_char(max(p.imported_at),'YYYY-MM-DD"T"HH24:MI:SS.USOF'),'empty') into dataset_revision from public.parcels p;
  with candidates as (
    select p.*,extensions.st_pointonsurface(p.geometry) representative_point from public.parcels p
    where p.is_residential and p.geometry operator(extensions.&&) shape and extensions.st_covers(shape,extensions.st_pointonsurface(p.geometry))
    order by p.county_fips,p.gislink limit 5001
  ), counted as (select count(*) count from candidates), limited as (select * from candidates limit 5000)
  select c.count,jsonb_agg(jsonb_build_object('county_fips',l.county_fips,'gislink',l.gislink,
      'geometry',extensions.st_asgeojson(l.geometry,6)::jsonb,'representative_point',extensions.st_asgeojson(l.representative_point,6)::jsonb)
      order by l.county_fips,l.gislink) filter(where l.gislink is not null)
    into feature_count,features from counted c left join limited l on true group by c.count;
  return jsonb_build_object('datasetRevision',dataset_revision,'complete',feature_count<=5000,'truncated',feature_count>5000,'features',coalesce(features,'[]'::jsonb));
end $$;
revoke all on function public.planning_parcels_for_boundary_v1(jsonb) from public,anon;
grant execute on function public.planning_parcels_for_boundary_v1(jsonb) to authenticated;

commit;
