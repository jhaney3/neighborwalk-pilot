begin;

alter table public.discipleship_people add column pending_owner_id uuid;
alter table public.discipleship_people add column handoff_requested_at timestamptz;
alter table public.discipleship_people add constraint discipleship_pending_owner_church_fkey
  foreign key (church_id,pending_owner_id) references public.church_memberships(church_id,user_id);
create index discipleship_pending_owner_idx on public.discipleship_people(church_id,pending_owner_id);
alter table public.outreach_tasks add column channel text not null default 'visit'
  check (channel in ('visit','call','text','email','other'));

create function private.outreach_active_member(target_church uuid,target_user uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists(select 1 from public.church_memberships m where m.church_id=target_church and m.user_id=target_user and m.active);
$$;
revoke all on function private.outreach_active_member(uuid,uuid) from public,anon,authenticated;

create function private.outreach_user_can_view_person(target_church uuid,target_person text,target_user uuid)
returns boolean language sql stable set search_path = '' as $$
  select private.outreach_active_member(target_church,target_user) and exists (
    select 1 from public.discipleship_people p where p.church_id=target_church and p.id=target_person and p.deleted_at is null
      and (p.assigned_to=target_user or p.pending_owner_id=target_user or (p.legacy_creator_access and p.created_by=target_user)
        or target_user=any(p.shared_user_ids)
        or exists(select 1 from public.church_memberships m where m.church_id=target_church and m.user_id=target_user and m.role='leader' and m.active)
        or exists(select 1 from public.outreach_team_members m join public.outreach_teams g on g.church_id=m.church_id and g.id=m.team_id
          where m.church_id=target_church and m.user_id=target_user and m.team_id=any(p.shared_team_ids) and g.deleted_at is null)));
$$;
revoke all on function private.outreach_user_can_view_person(uuid,text,uuid) from public,anon,authenticated;

create or replace function private.can_view_discipleship_person(target_person_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.is_real_user() and exists (
    select 1 from public.discipleship_people p where p.id=target_person_id
    and private.outreach_user_can_view_person(p.church_id,p.id,auth.uid()));
$$;

-- Field mapping is a closed whitelist. Neither table names, actor identity,
-- tenant identity, audit history nor versions are copied from client payloads.
create function private.outreach_record_fields(kind text,r jsonb,old_row jsonb,church uuid,actor uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare owner_id uuid; shared_users uuid[]; shared_teams text[]; mapped jsonb; begin
  case kind
  when 'event' then
    if not exists(select 1 from pg_timezone_names where name=coalesce(r->>'timezone','America/Chicago')) then raise exception 'Choose a valid church timezone.' using errcode='22023'; end if;
    if nullif(r->>'guideId','') is not null and not exists(select 1 from public.conversation_guides g where g.id=(r->>'guideId')::uuid and g.church_id=church and g.scope='church') then
      raise exception 'Outings must use a guide shared with this church.' using errcode='42501'; end if;
    mapped := jsonb_build_object('name',r->>'name','starts_at',r->>'startsAt','ends_at',r->>'endsAt','timezone',coalesce(r->>'timezone','America/Chicago'),
      'purpose',coalesce(r->>'purpose',''),'meeting_point',coalesce(r->>'meetingPoint',''),'leader_contact',coalesce(r->>'leaderContact',''),
      'status',coalesce(r->>'status','draft'),'guide_id',nullif(r->>'guideId',''),'debrief',coalesce(r->>'debrief',''));
  when 'team' then
    mapped := jsonb_build_object('name',r->>'name','status',coalesce(r->>'status','ready'),'legacy_event_id',nullif(r->>'eventId',''));
  when 'territory' then
    if jsonb_typeof(r->'boundary') is distinct from 'array' then raise exception 'Invalid territory boundary.' using errcode='22023'; end if;
    if jsonb_array_length(r->'boundary') not between 3 and 2000 or exists (
      select 1 from jsonb_array_elements(r->'boundary') p where jsonb_typeof(p) <> 'array'
        or jsonb_array_length(p) <> 2 or (p->>0)::double precision not between -180 and 180 or (p->>1)::double precision not between -90 and 90
    ) then raise exception 'Invalid territory coordinates.' using errcode='22023'; end if;
    mapped := jsonb_build_object('name',r->>'name','color',r->>'color','longitude',r#>'{center,0}','latitude',r#>'{center,1}',
      'zoom',coalesce((r->>'zoom')::double precision,15),'boundary',r->'boundary','legacy_event_id',nullif(r->>'eventId',''));
  when 'assignment' then
    owner_id := private.outreach_member_id(church,r->>'assignedVolunteerId');
    if nullif(r->>'assignedVolunteerId','') is not null and not private.outreach_active_member(church,owner_id) then raise exception 'Choose an active church member.' using errcode='22023'; end if;
    mapped := jsonb_build_object('outing_id',r->>'eventId','territory_id',r->>'territoryId','team_id',nullif(r->>'assignedTeamId',''),
      'assignee_id',owner_id,'status',coalesce(r->>'status','assigned'));
  when 'property' then
    mapped := jsonb_build_object('territory_id',nullif(r->>'territoryId',''),'address',r->>'address','unit',nullif(r->>'unit',''),
      'longitude',r#>'{coordinates,0}','latitude',r#>'{coordinates,1}','building_geometry',r->'buildingGeometry','parcel_reference',r->'parcel',
      'source',coalesce(r->>'source','manual'),'updated_at',now());
    if old_row is null then mapped := mapped || jsonb_build_object('created_by',actor); end if;
  when 'visit' then
    if (r->>'recordedAt')::timestamptz > now()+interval '1 day' or (r->>'recordedAt')::timestamptz < '1970-01-01'::timestamptz then
      raise exception 'Encounter date is outside the supported range.' using errcode='22023'; end if;
    mapped := jsonb_build_object('outing_id',nullif(r->>'eventId',''),'territory_id',nullif(r->>'territoryId',''),'location_id',nullif(r->>'propertyId',''),
      'person_id',nullif(r->>'residentId',''),'actor_id',actor,'actor_key',private.volunteer_id_for_user(actor),'outcome',r->>'outcome',
      'context',coalesce(r->>'context','door'),'objective_note',nullif(r->>'objectiveNote',''),'occurred_at',r->>'recordedAt','device_id',r->>'deviceId');
  when 'resident' then
    owner_id := coalesce(private.outreach_member_id(church,r->>'assignedVolunteerId'),actor);
    if nullif(r->>'assignedVolunteerId','') is not null and private.outreach_member_id(church,r->>'assignedVolunteerId') is null then raise exception 'Choose an active person owner.' using errcode='22023'; end if;
    select coalesce(array_agg(private.outreach_member_id(church,v)),'{}') into shared_users from jsonb_array_elements_text(coalesce(r->'sharedWithVolunteerIds','[]')) v;
    select coalesce(array_agg(v),'{}') into shared_teams from jsonb_array_elements_text(coalesce(r->'sharedWithTeamIds','[]')) v;
    if array_position(shared_users,null) is not null or not private.valid_discipleship_people_access(church,owner_id,shared_users,shared_teams) then raise exception 'Person sharing must use active members and teams of this church.' using errcode='22023'; end if;
    if old_row is not null and owner_id is distinct from (old_row->>'assigned_to')::uuid then raise exception 'Use the care handoff workflow to change ownership.' using errcode='22023'; end if;
    if old_row is null and owner_id <> actor and not private.is_church_leader(church) then raise exception 'Create the person under your own care before arranging a handoff.' using errcode='42501'; end if;
    mapped := jsonb_build_object('property_id',nullif(r->>'propertyId',''),'name',nullif(btrim(r->>'name'),''),'assigned_to',owner_id,
      'shared_user_ids',shared_users,'shared_team_ids',shared_teams,'faith_status',coalesce(r->>'faithStatus','not_discussed'),
      'discipleship_stage',coalesce(r->>'discipleshipStage','new_connection'),'status',coalesce(r->>'status','active'),
      'phone',nullif(btrim(r->>'phone'),''),'email',nullif(btrim(r->>'email'),''),'preferred_contact',coalesce(r->>'preferredContact','none'),
      'contact_permission',coalesce(r->>'contactPermission',old_row->>'contact_permission','not_recorded'),'last_contact_at',nullif(r->>'lastContactAt',''));
    if old_row is null then mapped := mapped || jsonb_build_object('created_by',actor,'legacy_creator_access',false); end if;
  when 'person_note' then
    mapped := jsonb_build_object('person_id',r->>'residentId','kind',r->>'kind','body',r->>'body');
    if old_row is null then mapped := mapped || jsonb_build_object('author_id',actor); end if;
  when 'handoff' then
    if old_row is null then raise exception 'Choose an existing person for handoff.' using errcode='22023'; end if;
    if r->>'action'='request' then
      if actor is distinct from (old_row->>'assigned_to')::uuid and not private.is_church_leader(church) then raise exception 'Only the owner or a leader may request a handoff.' using errcode='42501'; end if;
      owner_id := private.outreach_member_id(church,r->>'assignedVolunteerId');
      if not private.outreach_active_member(church,owner_id) or owner_id=(old_row->>'assigned_to')::uuid then raise exception 'Choose another active church member.' using errcode='22023'; end if;
      if old_row->>'pending_owner_id' is not null then raise sqlstate 'PT409' using message='A handoff is already waiting. Cancel it before requesting another.'; end if;
      mapped := jsonb_build_object('pending_owner_id',owner_id,'handoff_requested_at',now());
    elsif r->>'action' in ('accept','decline') then
      if actor is distinct from (old_row->>'pending_owner_id')::uuid then raise exception 'Only the invited care owner may accept or decline.' using errcode='42501'; end if;
      mapped := jsonb_build_object('pending_owner_id',null,'handoff_requested_at',null);
      if r->>'action'='accept' then mapped := mapped || jsonb_build_object('assigned_to',actor,'legacy_creator_access',false); end if;
    elsif r->>'action'='cancel' then
      if actor is distinct from (old_row->>'assigned_to')::uuid and not private.is_church_leader(church) then raise exception 'Only the owner or a leader may cancel a handoff.' using errcode='42501'; end if;
      mapped := jsonb_build_object('pending_owner_id',null,'handoff_requested_at',null);
    else raise exception 'Choose a supported handoff action.' using errcode='22023'; end if;
  when 'follow_up' then
    owner_id := private.outreach_member_id(church,r->>'assignedVolunteerId');
    if nullif(r->>'assignedVolunteerId','') is not null and owner_id is null then raise exception 'Choose an active task owner.' using errcode='22023'; end if;
    if old_row is null and owner_id is null then
      if nullif(r->>'residentId','') is not null then select p.assigned_to into owner_id from public.discipleship_people p where p.church_id=church and p.id=r->>'residentId';
      else owner_id := actor; end if;
    end if;
    if owner_id is not null and not private.outreach_active_member(church,owner_id) then raise exception 'Choose an active task owner.' using errcode='22023'; end if;
    if nullif(r->>'residentId','') is not null and owner_id is not null and not private.outreach_user_can_view_person(church,r->>'residentId',owner_id) then
      raise exception 'The task owner needs explicit access to this person first.' using errcode='42501'; end if;
    if coalesce(r->>'dueAt','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Follow-ups require a calendar date, not a device-local timestamp.' using errcode='22023'; end if;
    if old_row is not null and owner_id is not distinct from (old_row->>'owner_id')::uuid
      and r->>'acceptance' is distinct from old_row->>'acceptance'
      and (actor is distinct from owner_id or coalesce(r->>'acceptance','') not in ('accepted','declined')) then
      raise exception 'Only the assigned owner can accept or decline this task.' using errcode='42501'; end if;
    mapped := jsonb_build_object('person_id',nullif(r->>'residentId',''),'location_id',nullif(r->>'propertyId',''),'encounter_id',nullif(r->>'sourceVisitId',''),
      'outing_id',nullif(r->>'eventId',''),'team_id',nullif(r->>'assignedTeamId',''),'owner_id',owner_id,'due_date',r->>'dueAt',
      'status',coalesce(r->>'status','scheduled'),'channel',coalesce(r->>'channel','visit'),'note',nullif(r->>'note',''),
      'completion_note',nullif(r->>'completionNote',''),'parent_task_id',nullif(r->>'parentFollowUpId',''),
      'acceptance',case when owner_id is distinct from (old_row->>'owner_id')::uuid and owner_id is distinct from actor then 'pending' else coalesce(r->>'acceptance','accepted') end,
      'completed_at',case when r->>'status'='completed' then coalesce((old_row->>'completed_at')::timestamptz,now()) else null end);
    if old_row is null then mapped := mapped || jsonb_build_object('created_by',actor); end if;
  when 'restriction' then
    if old_row is null then
      mapped := jsonb_build_object('person_id',nullif(r->>'residentId',''),'location_id',nullif(r->>'propertyId',''),'channel',coalesce(r->>'channel','all'),
        'active',true,'reason',r->>'reason','created_by',actor);
    else
      if not private.is_church_leader(church) or coalesce((r->>'active')::boolean,true) or length(btrim(coalesce(r->>'correctionReason',''))) < 3 then
        raise exception 'Only a leader may lift a restriction, with a recorded reason.' using errcode='42501'; end if;
      mapped := jsonb_build_object('active',false,'corrected_by',actor,'corrected_at',now(),'correction_reason',r->>'correctionReason');
    end if;
  else raise exception 'Unknown record type.' using errcode='22023';
  end case;
  return mapped;
end $$;
revoke all on function private.outreach_record_fields(text,jsonb,jsonb,uuid,uuid) from public,anon,authenticated;

create function private.outreach_apply_operation(church uuid,actor uuid,command_id text,op jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare kind text:=op->>'entityType'; record_id text:=op->>'entityId'; operation text:=op->>'operation'; r jsonb:=coalesce(op->'record','{}');
  tab text; old_row jsonb; mapped jsonb; cols text; assignments text; current_version bigint; expected bigint; leader boolean:=private.is_church_leader(church);
  member_key text; activity_action text; task public.outreach_tasks; parent_id text;
begin
  if length(coalesce(record_id,'')) not between 1 and 240 or coalesce(operation,'') not in ('upsert','delete') then raise exception 'Invalid change request.' using errcode='22023'; end if;
  if r ? 'churchId' and r->>'churchId' is distinct from church::text then raise exception 'Cross-church payload rejected.' using errcode='42501'; end if;
  expected := (op->>'expectedVersion')::bigint;
  if expected is null or expected < 0 then raise exception 'An expected record version is required.' using errcode='22023'; end if;
  if kind='settings' then
    if operation <> 'upsert' then raise exception 'Church settings cannot be deleted.' using errcode='22023'; end if;
    if not leader or record_id <> church::text then raise exception 'Only a church leader can change settings.' using errcode='42501'; end if;
    select outreach_version into current_version from public.churches where id=church for update;
    if expected <> current_version then raise sqlstate 'PT409' using message='Church settings changed on another device. Review before retrying.'; end if;
    if not exists(select 1 from pg_timezone_names where name=r->>'timezone') then raise exception 'Choose a valid timezone.' using errcode='22023'; end if;
    update public.churches set name=r->>'name',timezone=r->>'timezone',retention_days=(r->>'retentionDays')::integer,
      default_follow_up_days=(r->>'defaultFollowUpDays')::integer,note_character_limit=(r->>'noteCharacterLimit')::integer,
      pathway_enabled=coalesce((r->>'pathwayEnabled')::boolean,false),outreach_version=outreach_version+1 where id=church;
  else
    tab := case kind when 'event' then 'outreach_outings' when 'team' then 'outreach_teams' when 'territory' then 'outreach_territories'
      when 'assignment' then 'outreach_assignments' when 'property' then 'outreach_locations' when 'visit' then 'outreach_encounters'
      when 'resident' then 'discipleship_people' when 'handoff' then 'discipleship_people' when 'person_note' then 'discipleship_person_notes' when 'follow_up' then 'outreach_tasks'
      when 'restriction' then 'outreach_restrictions' else null end;
    if tab is null then raise exception 'Unknown record type.' using errcode='22023'; end if;
    execute format('select to_jsonb(t) from public.%I t where church_id=$1 and id=$2 for update',tab) into old_row using church,record_id;
    current_version := coalesce((old_row->>'version')::bigint,0);
    if old_row->>'deleted_at' is not null then raise sqlstate 'PT409' using message='This record was archived. A stale device cannot restore it.'; end if;
    if current_version <> expected then raise sqlstate 'PT409' using message='This record changed on another device. Review the queued change before retrying.'; end if;
    if kind in ('event','team','territory') and not leader then raise exception 'Only a church leader can manage outreach preparation.' using errcode='42501'; end if;
    if kind='assignment' and not leader then
      if old_row is null or operation='delete' or not (coalesce((old_row->>'assignee_id')::uuid=actor,false) or exists(select 1 from public.outreach_team_members m where m.church_id=church and m.team_id=old_row->>'team_id' and m.user_id=actor)) then
        raise exception 'You may acknowledge only your own assignments.' using errcode='42501'; end if;
      if coalesce(r->>'status','') not in ('accepted','completed','declined') or r->>'eventId' is distinct from old_row->>'outing_id'
        or r->>'territoryId' is distinct from old_row->>'territory_id' or nullif(r->>'assignedTeamId','') is distinct from old_row->>'team_id'
        or private.outreach_member_id(church,r->>'assignedVolunteerId') is distinct from (old_row->>'assignee_id')::uuid then
        raise exception 'Only assignment acknowledgement is allowed.' using errcode='42501'; end if;
    end if;
    if kind='property' and old_row is not null and not leader and (old_row->>'created_by')::uuid is distinct from actor then
      raise exception 'Ask a leader to correct an existing shared location.' using errcode='42501'; end if;
    if kind='visit' and (old_row is not null or operation='delete') then raise exception 'Encounters are append-only. Use an audited correction workflow.' using errcode='42501'; end if;
    if kind='resident' and old_row is not null and not private.can_manage_discipleship_person(record_id) then raise exception 'Only the owner or a leader can manage this person.' using errcode='42501'; end if;
    if kind='handoff' and (operation <> 'upsert' or old_row is null or not private.can_view_discipleship_person(record_id)) then raise exception 'This person is not available for handoff.' using errcode='42501'; end if;
    if kind='person_note' then
      parent_id := coalesce(old_row->>'person_id',r->>'residentId');
      if not private.can_view_discipleship_person(parent_id) or (old_row is not null and not leader and (old_row->>'author_id')::uuid <> actor) then
        raise exception 'This note is not available for this action.' using errcode='42501'; end if;
      if old_row is not null and r ? 'residentId' and r->>'residentId' <> parent_id then raise exception 'Notes cannot be moved to another person.' using errcode='42501'; end if;
    end if;
    if kind='follow_up' then
      if old_row is not null and (not private.can_view_outreach_task(church,record_id) or (not leader and (old_row->>'owner_id')::uuid is distinct from actor)) then
        raise exception 'Only the responsible person or a leader can change this task.' using errcode='42501'; end if;
      if old_row is not null and (old_row->>'status') <> 'scheduled' and operation<>'delete' then raise exception 'Resolved tasks are history. Create a next step instead.' using errcode='22023'; end if;
    end if;
    if nullif(r->>'residentId','') is not null and kind in ('visit','follow_up','restriction') and not private.can_view_discipleship_person(r->>'residentId') then raise exception 'Person access is required.' using errcode='42501'; end if;
    if operation='delete' then
      if old_row is null or kind in ('visit','restriction') then raise exception 'This record cannot be deleted.' using errcode='42501'; end if;
      if kind='property' and (exists(select 1 from public.outreach_encounters where church_id=church and location_id=record_id)
        or exists(select 1 from public.discipleship_people where church_id=church and property_id=record_id)
        or exists(select 1 from public.outreach_tasks where church_id=church and location_id=record_id)
        or exists(select 1 from public.outreach_restrictions where church_id=church and location_id=record_id)) then
        raise exception 'A location with history or restrictions must be preserved.' using errcode='22023'; end if;
      execute format('update public.%I set deleted_at=now(),version=version+1 where church_id=$1 and id=$2',tab) using church,record_id;
    else
      mapped := private.outreach_record_fields(kind,r,old_row,church,actor)
        || jsonb_build_object('church_id',church,'id',record_id,'version',current_version+1);
      select string_agg(quote_ident(key),',' order by key),string_agg(format('%I=incoming.%I',key,key),',' order by key)
        into cols,assignments from jsonb_object_keys(mapped) key;
      if old_row is null then
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1)',tab,cols,cols,tab) using mapped;
      else
        execute format('update public.%I target set %s from jsonb_populate_record(null::public.%I,$1) incoming where target.church_id=$2 and target.id=$3',tab,assignments,tab) using mapped,church,record_id;
      end if;
    end if;

    if kind='team' then
      delete from public.outreach_team_members where church_id=church and team_id=record_id;
      if operation='upsert' then
        for member_key in select distinct v from jsonb_array_elements_text(coalesce(r->'memberIds','[]')) v loop
          if private.outreach_member_id(church,member_key) is null and not exists(select 1 from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'volunteers') v where s.church_id=church and v->>'id'=member_key) then
            raise exception 'Group members must belong to this church.' using errcode='22023'; end if;
          insert into public.outreach_team_members(church_id,team_id,volunteer_id,user_id) values(church,record_id,member_key,private.outreach_member_id(church,member_key));
        end loop;
      else
        update public.outreach_assignments set deleted_at=now(),status='cancelled',version=version+1 where church_id=church and team_id=record_id and deleted_at is null;
        update public.outreach_tasks set team_id=null,version=version+1 where church_id=church and team_id=record_id and deleted_at is null;
      end if;
    end if;
    if kind='territory' and operation='delete' then
      if nullif(op->>'destinationTerritoryId','') is not null then
        if not exists(select 1 from public.outreach_territories where church_id=church and id=op->>'destinationTerritoryId' and deleted_at is null) then raise exception 'Choose an available destination territory.' using errcode='22023'; end if;
        update public.outreach_locations set territory_id=op->>'destinationTerritoryId',version=version+1 where church_id=church and territory_id=record_id and deleted_at is null;
      end if;
      update public.outreach_assignments set deleted_at=now(),status='cancelled',version=version+1 where church_id=church and territory_id=record_id and deleted_at is null;
      -- Historical encounters retain the original territory; no history is rewritten.
    end if;
    if kind='resident' and operation='upsert' and old_row->>'property_id' is distinct from mapped->>'property_id' then
      update public.outreach_tasks set location_id=nullif(mapped->>'property_id',''),version=version+1
      where church_id=church and person_id=record_id and status='scheduled' and deleted_at is null;
    end if;
    if kind='resident' and operation='delete' then
      update public.discipleship_person_notes set deleted_at=now(),version=version+1 where church_id=church and person_id=record_id and deleted_at is null;
      update public.outreach_tasks set deleted_at=now(),status=case when status='scheduled' then 'cancelled' else status end,version=version+1 where church_id=church and person_id=record_id and deleted_at is null;
    end if;
    if kind='handoff' and r->>'action'='accept' then
      for task in select * from public.outreach_tasks where church_id=church and person_id=record_id and status='scheduled' and deleted_at is null
        and (owner_id=(old_row->>'assigned_to')::uuid or owner_id is null)
      loop
        update public.outreach_tasks set owner_id=actor,acceptance='accepted',version=version+1 where church_id=church and id=task.id;
        insert into public.outreach_task_activity(church_id,task_id,id,action,actor_id,actor_key,note)
        values(church,task.id,command_id||'_handoff_'||task.id,'reassigned',actor,private.volunteer_id_for_user(actor),'Care handoff accepted; responsibility transferred.');
      end loop;
    end if;
    if kind='visit' and r->>'outcome'='do_not_visit' and nullif(r->>'propertyId','') is not null then
      insert into public.outreach_restrictions(church_id,id,location_id,channel,reason,created_by)
      values(church,'restriction_'||record_id,r->>'propertyId','visit','Neighbor requested no future visits.',actor) on conflict do nothing;
    end if;
    if kind='resident' and r->>'contactPermission'='do_not_contact' then
      insert into public.outreach_restrictions(church_id,id,person_id,channel,reason,created_by)
      values(church,'restriction_'||record_id||'_'||(current_version+1),record_id,'all','Neighbor requested no further contact.',actor) on conflict do nothing;
    end if;
    if kind='follow_up' and operation='upsert' then
      activity_action := case when old_row is null then 'created' when r->>'status' is distinct from old_row->>'status' then r->>'status'
        when mapped->>'owner_id' is distinct from old_row->>'owner_id' then 'reassigned' when mapped->>'due_date' is distinct from old_row->>'due_date' then 'rescheduled'
        when mapped->>'acceptance' is distinct from old_row->>'acceptance' then mapped->>'acceptance' else 'note' end;
      insert into public.outreach_task_activity(church_id,task_id,id,action,actor_id,actor_key,note,due_date)
      values(church,record_id,command_id||'_'||record_id,activity_action,actor,private.volunteer_id_for_user(actor),
        left(coalesce(r->>'completionNote',r#>>'{history,-1,note}',r->>'note'),2000),(r->>'dueAt')::date);
    end if;
  end if;
  insert into public.outreach_audit(church_id,actor_id,command_id,action,entity_type,entity_id)
  values(church,actor,command_id,case when kind='handoff' then 'handoff.'||(r->>'action') else kind||'.'||operation end,kind,record_id);
  return jsonb_build_object('entityType',kind,'entityId',record_id,'version',current_version+1);
end $$;
revoke all on function private.outreach_apply_operation(uuid,uuid,text,jsonb) from public,anon,authenticated;

-- The only privileged command boundary. Its definer privilege is intentional:
-- browser table writes are revoked, identity and every operation are checked,
-- and records, receipts and audit entries commit in this one transaction.
create function private.outreach_apply_command(command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare church uuid:=(command->>'churchId')::uuid; actor uuid:=auth.uid(); command_key text:=command->>'id';
  hash text; receipt private.outreach_receipts; op jsonb; result jsonb:='[]'; blocked public.outreach_tasks; warnings jsonb:='[]';
begin
  if actor is null or not private.is_church_member(church) then raise exception 'Active church membership is required.' using errcode='42501'; end if;
  if command->>'schemaVersion' is distinct from '1' or length(coalesce(command_key,'')) not between 1 and 190
    or jsonb_typeof(command->'operations') is distinct from 'array' then raise exception 'Unsupported command.' using errcode='22023'; end if;
  if jsonb_array_length(command->'operations') not between 1 and 100
    or pg_column_size(command)>1048576 then raise exception 'Unsupported or oversized command.' using errcode='22023'; end if;
  if command ? 'userId' and command->>'userId' is distinct from actor::text then raise exception 'Command account does not match the authenticated user.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(church::text,0));
  hash := encode(extensions.digest(command::text,'sha256'),'hex');
  select * into receipt from private.outreach_receipts where church_id=church and actor_id=actor and command_id=command_key;
  if found then
    if receipt.payload_hash<>hash then raise sqlstate 'PT409' using message='This command ID was already used for different work.'; end if;
    return receipt.result;
  end if;
  for op in select v from jsonb_array_elements(command->'operations') v loop
    result := result || jsonb_build_array(private.outreach_apply_operation(church,actor,command_key,op));
  end loop;
  -- A restriction wins over stale/offline task requests. Preserve the historical
  -- encounter, cancel prohibited next steps and return an explicit warning.
  for blocked in select t.* from public.outreach_tasks t where t.church_id=church and t.status='scheduled' and t.deleted_at is null
    and exists(select 1 from public.outreach_restrictions x where x.church_id=church and x.active
      and ((x.person_id=t.person_id and x.channel in ('all',t.channel)) or (x.location_id=t.location_id and t.channel='visit' and x.channel in ('all','visit'))))
  loop
    update public.outreach_tasks set status='cancelled',version=version+1 where church_id=church and id=blocked.id;
    insert into public.outreach_task_activity(church_id,task_id,id,action,actor_id,actor_key,note)
    values(church,blocked.id,command_key||'_restriction_'||blocked.id,'cancelled',actor,private.volunteer_id_for_user(actor),'Cancelled because a contact or visit restriction applies.');
    insert into public.outreach_audit(church_id,actor_id,command_id,action,entity_type,entity_id)
    values(church,actor,command_key,'task.restriction_cancelled','follow_up',blocked.id);
    warnings := jsonb_build_array('A restricted next step was cancelled. Historical encounters were preserved.');
  end loop;
  update public.churches set outreach_revision=outreach_revision+1 where id=church;
  result := jsonb_build_object('id',command_key,'applied',result,'warnings',warnings);
  insert into private.outreach_receipts(church_id,actor_id,command_id,payload_hash,result) values(church,actor,command_key,hash,result);
  return result;
end $$;
revoke all on function private.outreach_apply_command(jsonb) from public,anon;
grant execute on function private.outreach_apply_command(jsonb) to authenticated;

create function public.outreach_apply_command(command jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select private.outreach_apply_command(command); $$;
revoke all on function public.outreach_apply_command(jsonb) from public,anon;
grant execute on function public.outreach_apply_command(jsonb) to authenticated;

commit;
