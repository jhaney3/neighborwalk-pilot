begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- A combined source remains a preserved, read-only historical record. Only the
-- reviewed leader transaction may create/flatten these tenant-local aliases.
alter table public.discipleship_people add column merged_into_id text;
alter table public.discipleship_people add column merged_at timestamptz;
alter table public.discipleship_people add constraint discipleship_merge_tenant_fk foreign key(merged_into_id,church_id) references public.discipleship_people(id,church_id);
alter table public.discipleship_people add constraint discipleship_merge_state check(merged_into_id is null or (merged_into_id<>id and merged_at is not null and status='archived'));
create index discipleship_merge_idx on public.discipleship_people(church_id,merged_into_id);
alter table public.outreach_locations add column merged_into_id text;
alter table public.outreach_locations add column merged_at timestamptz;
alter table public.outreach_locations add constraint outreach_location_merge_tenant_fk foreign key(church_id,merged_into_id) references public.outreach_locations(church_id,id);
alter table public.outreach_locations add constraint outreach_location_merge_state check(merged_into_id is null or (merged_into_id<>id and merged_at is not null));
create index outreach_location_merge_idx on public.outreach_locations(church_id,merged_into_id);
alter table public.outreach_restrictions add column origin_person_id text;
alter table public.outreach_restrictions add column origin_location_id text;
alter table public.outreach_restrictions add constraint outreach_restriction_origin_person_fk foreign key(origin_person_id,church_id) references public.discipleship_people(id,church_id);
alter table public.outreach_restrictions add constraint outreach_restriction_origin_location_fk foreign key(church_id,origin_location_id) references public.outreach_locations(church_id,id);
create index outreach_restriction_origin_person_idx on public.outreach_restrictions(origin_person_id,church_id);
create index outreach_restriction_origin_location_idx on public.outreach_restrictions(church_id,origin_location_id);
-- Two independently recorded requests must both survive combining duplicates.
-- Their IDs remain unique; each active restriction requires its own reviewed lift.
drop index public.outreach_restrictions_active_idx;
create index outreach_restrictions_active_idx on public.outreach_restrictions(church_id,coalesce(person_id,''),coalesce(location_id,''),channel) where active;

create function private.outreach_canonical_person(church uuid,person text)
returns text language sql stable security definer set search_path='' as $$
 select coalesce(p.merged_into_id,p.id) from public.discipleship_people p where p.church_id=church and p.id=person;
$$;
revoke all on function private.outreach_canonical_person(uuid,text) from public,anon,authenticated;
create or replace function private.outreach_user_can_view_person(target_church uuid,target_person text,target_user uuid)
returns boolean language sql stable set search_path='' as $$
 select private.outreach_active_member(target_church,target_user) and exists(
  select 1 from public.discipleship_people p where p.church_id=target_church
   and p.id=private.outreach_canonical_person(target_church,target_person) and p.deleted_at is null
   and (p.assigned_to=target_user or p.pending_owner_id=target_user or (p.legacy_creator_access and p.created_by=target_user)
    or target_user=any(p.shared_user_ids)
    or exists(select 1 from public.church_memberships m where m.church_id=target_church and m.user_id=target_user and m.role='leader' and m.active)
    or exists(select 1 from public.outreach_team_members m join public.outreach_teams g on g.church_id=m.church_id and g.id=m.team_id
      where m.church_id=target_church and m.user_id=target_user and m.team_id=any(p.shared_team_ids) and g.deleted_at is null)));
$$;
create or replace function private.can_manage_discipleship_person(target_person_id text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.is_real_user() and exists(
  select 1 from public.discipleship_people p where p.id=target_person_id and p.deleted_at is null and p.merged_into_id is null
   and private.is_church_member(p.church_id) and (private.is_church_leader(p.church_id) or p.assigned_to=auth.uid()));
$$;

create function private.outreach_duplicate_plan(church uuid,kind text,source_id text,target_id text)
returns jsonb language plpgsql stable set search_path='' as $$
declare source jsonb; target jsonb; effects jsonb; payload jsonb; blockers jsonb:='[]'; source_users uuid[]; target_users uuid[];
begin
 if coalesce(kind,'') not in ('people','locations') or source_id is null or target_id is null or source_id=target_id then
  raise exception 'Choose two different available records of the same kind.' using errcode='22023'; end if;
 if kind='people' then
  select to_jsonb(p) into source from public.discipleship_people p where p.church_id=church and p.id=source_id and p.deleted_at is null and p.merged_into_id is null;
  select to_jsonb(p) into target from public.discipleship_people p where p.church_id=church and p.id=target_id and p.deleted_at is null and p.merged_into_id is null;
 else
  select to_jsonb(p) into source from public.outreach_locations p where p.church_id=church and p.id=source_id and p.deleted_at is null and p.merged_into_id is null;
  select to_jsonb(p) into target from public.outreach_locations p where p.church_id=church and p.id=target_id and p.deleted_at is null and p.merged_into_id is null;
 end if;
 if source is null or target is null then raise exception 'One of these records is no longer available. Refresh the review.' using errcode='22023'; end if;
 if kind='people' then
  if source->>'assigned_to' is distinct from target->>'assigned_to' then blockers:=blockers||'"Use an accepted care handoff to reconcile the owners first."'; end if;
  if not private.outreach_active_member(church,(target->>'assigned_to')::uuid) then blockers:=blockers||'"An active member must accept responsibility before combining these profiles."'; end if;
  if source->>'pending_owner_id' is not null or target->>'pending_owner_id' is not null then blockers:=blockers||'"Resolve pending care handoffs before combining profiles."'; end if;
  if source->>'property_id' is distinct from target->>'property_id' then blockers:=blockers||'"Review and reconcile the current locations with a reasoned person move first."'; end if;
  select array_agg(distinct u order by u) into source_users from (
    select (source->>'assigned_to')::uuid as u union all select v::uuid from jsonb_array_elements_text(source->'shared_user_ids') v
    union all select (source->>'created_by')::uuid where (source->>'legacy_creator_access')::boolean) users;
  select array_agg(distinct u order by u) into target_users from (
    select (target->>'assigned_to')::uuid as u union all select v::uuid from jsonb_array_elements_text(target->'shared_user_ids') v
    union all select (target->>'created_by')::uuid where (target->>'legacy_creator_access')::boolean) users;
  if source_users is distinct from target_users or not ((source->'shared_team_ids') @> (target->'shared_team_ids') and (target->'shared_team_ids') @> (source->'shared_team_ids')) then
    blockers:=blockers||'"Reconcile explicit sharing and historical creator access first. Combining must not grant anyone new private history implicitly."'; end if;
  if not (coalesce(nullif(lower(regexp_replace(btrim(source->>'name'),'\s+',' ','g')),'')=nullif(lower(regexp_replace(btrim(target->>'name'),'\s+',' ','g')),''),false)
    or coalesce(nullif(lower(btrim(source->>'email')),'')=nullif(lower(btrim(target->>'email')),''),false)
    or coalesce(nullif(regexp_replace(source->>'phone','\D','','g'),'')=nullif(regexp_replace(target->>'phone','\D','','g'),''),false)) then
    blockers:=blockers||'"No name or contact detail matches. Confirm and correct the identity details first; do not combine different people."'; end if;
 else
  if lower(regexp_replace(btrim(source->>'address'),'\s+',' ','g')) is distinct from lower(regexp_replace(btrim(target->>'address'),'\s+',' ','g'))
    or lower(btrim(coalesce(source->>'unit',''))) is distinct from lower(btrim(coalesce(target->>'unit',''))) then
    blockers:=blockers||'"The address or unit differs. Correct and confirm the location details first; never combine different apartment units."'; end if;
  if exists(select 1 from public.outreach_tasks t join public.discipleship_people p on p.church_id=t.church_id and p.id=t.person_id
    where t.church_id=church and t.location_id=source_id and t.status='scheduled' and t.deleted_at is null and p.property_id is distinct from source_id) then
    blockers:=blockers||'"An open task has a mismatched person/location link. Resolve that task before combining locations."'; end if;
 end if;
 select jsonb_build_object(
   'people',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'version',p.version) order by p.id) from public.discipleship_people p
     where p.church_id=church and p.deleted_at is null and (case when kind='people' then p.merged_into_id=source_id else p.property_id=source_id and p.merged_into_id is null end)),'[]'::jsonb),
   'locationAliases',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'version',l.version) order by l.id) from public.outreach_locations l
     where kind='locations' and l.church_id=church and l.merged_into_id=source_id and l.deleted_at is null),'[]'::jsonb),
   'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'version',t.version) order by t.id) from public.outreach_tasks t
     where t.church_id=church and t.status='scheduled' and t.deleted_at is null and (case when kind='people' then t.person_id=source_id
       else t.location_id=source_id or exists(select 1 from public.discipleship_people p where p.church_id=church and p.id=t.person_id and p.property_id=source_id and p.merged_into_id is null and p.deleted_at is null) end)),'[]'::jsonb),
   'restrictions',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'version',r.version) order by r.id) from public.outreach_restrictions r
     where r.church_id=church and r.active and (case when kind='people' then r.person_id=source_id else r.location_id=source_id end)),'[]'::jsonb),
   'tasksToCancel',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'version',t.version) order by t.id) from public.outreach_tasks t
     where t.church_id=church and t.status='scheduled' and t.deleted_at is null and (case when kind='people' then t.person_id in(source_id,target_id)
       else t.location_id in(source_id,target_id) or exists(select 1 from public.discipleship_people p where p.church_id=church and p.id=t.person_id and p.property_id=source_id and p.merged_into_id is null and p.deleted_at is null) end)
     and ((kind='people' and (source->>'contact_permission'='do_not_contact' or target->>'contact_permission'='do_not_contact'))
      or exists(select 1 from public.outreach_restrictions r where r.church_id=church and r.active and (
       (r.channel in ('all',t.channel) and (case when kind='people' then r.person_id in(source_id,target_id) else r.person_id=t.person_id end))
       or (t.channel='visit' and r.channel in ('all','visit') and (case when kind='locations' then r.location_id in(source_id,target_id) else r.location_id=t.location_id end)))))) ,'[]'::jsonb)
 ) into effects;
 if pg_column_size(effects)>524288 then blockers:=blockers||'"This combination exceeds the supervised pilot limit. Use an operator-reviewed migration instead."'; end if;
 payload:=jsonb_build_object('kind',kind,'source',source,'target',target,'effects',effects,'blockers',blockers);
 return payload||jsonb_build_object('token',encode(extensions.digest(payload::text,'sha256'),'hex'));
end $$;
revoke all on function private.outreach_duplicate_plan(uuid,text,text,text) from public,anon,authenticated;

alter function private.outreach_admin_action(jsonb) rename to outreach_admin_action_before_merges;
create function private.outreach_admin_action(request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare church uuid:=(request->>'churchId')::uuid; actor uuid:=auth.uid(); action text:=request->>'action'; key text:=request->>'id';
 kind text:=request->>'kind'; source_id text:=request->>'sourceId'; target_id text:=request->>'targetId'; reason text:=btrim(request->>'reason');
 revision bigint; fingerprint text; previous private.outreach_receipts; plan jsonb; result jsonb; task public.outreach_tasks; person public.discipleship_people;
 moved integer:=0; cancelled integer:=0; people_moved integer:=0;
begin
 if coalesce(action,'') not in ('duplicate_preview','duplicate_merge') then return private.outreach_admin_action_before_merges(request); end if;
 perform private.outreach_require_recent_leader(church);
 if request->>'schemaVersion' is distinct from '1' or length(coalesce(key,'')) not between 1 and 180 or pg_column_size(request)>1048576 then
  raise exception 'Unsupported reviewed combination request.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(church::text,0));
 perform private.outreach_require_recent_leader(church);
 fingerprint:=encode(extensions.digest(request::text,'sha256'),'hex');
 select * into previous from private.outreach_receipts where church_id=church and actor_id=actor and command_id='admin_'||key;
 if found then
  if previous.payload_hash<>fingerprint then raise sqlstate 'PT409' using message='This administration ID was already used for different work.'; end if;
  return previous.result;
 end if;
 select outreach_revision into revision from public.churches where id=church;
 plan:=private.outreach_duplicate_plan(church,kind,source_id,target_id);
 if action='duplicate_preview' then return plan||jsonb_build_object('revision',revision); end if;
 if (request->>'expectedRevision')::bigint is distinct from revision or request->>'reviewToken' is distinct from plan->>'token' then
  raise sqlstate 'PT409' using message='The records changed. Refresh and review the exact combination again.'; end if;
 if plan->'blockers'<>'[]'::jsonb then raise exception 'Resolve every review blocker before combining these records.' using errcode='22023'; end if;
 if coalesce(length(reason),0) not between 3 and 500 or request->>'confirmation' is distinct from (case when kind='people' then 'COMBINE SAME PERSON' else 'COMBINE SAME LOCATION' end) then
  raise exception 'Confirm the same identity/location and record why this combination is correct.' using errcode='22023'; end if;

 if kind='people' then
  -- Current responsibilities follow the selected profile. Historical notes,
  -- encounters and resolved tasks keep their original person IDs and dates.
  update public.outreach_tasks set person_id=target_id,version=version+1,
   legacy_links=legacy_links||jsonb_build_object('combinedFromPersonIds',coalesce(legacy_links->'combinedFromPersonIds','[]'::jsonb)||to_jsonb(source_id))
   where church_id=church and id in(select v->>'id' from jsonb_array_elements(plan#>'{effects,tasks}') v);
  update public.outreach_restrictions set person_id=target_id,origin_person_id=coalesce(origin_person_id,source_id),version=version+1
   where church_id=church and id in(select v->>'id' from jsonb_array_elements(plan#>'{effects,restrictions}') v);
  if (plan#>>'{source,contact_permission}'='do_not_contact' or plan#>>'{target,contact_permission}'='do_not_contact')
    and not exists(select 1 from public.outreach_restrictions r where r.church_id=church and r.person_id=target_id and r.active and r.channel='all') then
   insert into public.outreach_restrictions(church_id,id,person_id,origin_person_id,channel,reason,created_by)
    values(church,'combined_restriction_'||key,target_id,source_id,'all','Do-not-contact preference preserved during reviewed duplicate combination.',actor);
  end if;
  update public.discipleship_people set merged_into_id=target_id,version=version+1 where church_id=church and merged_into_id=source_id;
  update public.discipleship_people set merged_into_id=target_id,merged_at=now(),status='archived',version=version+1 where church_id=church and id=source_id;
  update public.discipleship_people set version=version+1,
   contact_permission=case when exists(select 1 from public.outreach_restrictions r where r.church_id=church and r.person_id=target_id and r.active and r.channel='all')
      or plan#>>'{source,contact_permission}'='do_not_contact' then 'do_not_contact' else contact_permission end
   where church_id=church and id=target_id;
 else
  -- Location aliases retain the original address/geometry for old encounters.
  -- All current people and their open tasks move together, exactly as reviewed.
  for person in select * from public.discipleship_people where church_id=church and id in(select v->>'id' from jsonb_array_elements(plan#>'{effects,people}') v) loop
   update public.discipleship_people set property_id=target_id,version=version+1 where church_id=church and id=person.id;
   insert into public.outreach_audit(church_id,actor_id,command_id,action,entity_type,entity_id,details)
   values(church,actor,'admin_'||key,'resident.location_changed','resident',person.id,
    jsonb_build_object('reason','Duplicate location combined: '||reason,'previousLocationId',source_id,'locationId',target_id,'previousVersion',person.version,'version',person.version+1));
   people_moved:=people_moved+1;
  end loop;
  update public.outreach_tasks set location_id=target_id,version=version+1,
   legacy_links=legacy_links||jsonb_build_object('combinedFromLocationIds',coalesce(legacy_links->'combinedFromLocationIds','[]'::jsonb)||to_jsonb(source_id))
   where church_id=church and id in(select v->>'id' from jsonb_array_elements(plan#>'{effects,tasks}') v);
  update public.outreach_restrictions set location_id=target_id,origin_location_id=coalesce(origin_location_id,source_id),version=version+1
   where church_id=church and id in(select v->>'id' from jsonb_array_elements(plan#>'{effects,restrictions}') v);
  update public.outreach_locations set merged_into_id=target_id,version=version+1 where church_id=church and merged_into_id=source_id;
  update public.outreach_locations set merged_into_id=target_id,merged_at=now(),version=version+1 where church_id=church and id=source_id;
  update public.outreach_locations set version=version+1 where church_id=church and id=target_id;
 end if;
 for task in select * from public.outreach_tasks where church_id=church and id in(select v->>'id' from jsonb_array_elements(plan#>'{effects,tasks}') v) loop
  insert into public.outreach_task_activity(church_id,task_id,id,action,actor_id,actor_key,note)
   values(church,task.id,'admin_'||key||'_merge_'||task.id,'note',actor,private.volunteer_id_for_user(actor),'Duplicate '||(case when kind='people' then 'person' else 'location' end)||' combined after leader review: '||reason);
  moved:=moved+1;
 end loop;
 for task in select * from public.outreach_tasks where church_id=church and id in(select v->>'id' from jsonb_array_elements(plan#>'{effects,tasksToCancel}') v) loop
  update public.outreach_tasks set status='cancelled',version=version+1 where church_id=church and id=task.id;
  insert into public.outreach_task_activity(church_id,task_id,id,action,actor_id,actor_key,note)
   values(church,task.id,'admin_'||key||'_restriction_'||task.id,'cancelled',actor,private.volunteer_id_for_user(actor),'Cancelled because a preserved contact or visit restriction applies after the reviewed combination.');
  cancelled:=cancelled+1;
 end loop;
 insert into public.outreach_audit(church_id,actor_id,command_id,action,entity_type,entity_id,details)
 values(church,actor,'admin_'||key,(case when kind='people' then 'resident' else 'property' end)||'.duplicates_combined',
  case when kind='people' then 'resident' else 'property' end,target_id,
  jsonb_build_object('reason',reason,'sourceId',source_id,'targetId',target_id,'sourcePreviousVersion',plan#>'{source,version}','targetPreviousVersion',plan#>'{target,version}',
   'sourcePreviousStatus',plan#>'{source,status}','sourcePreviousUpdatedAt',plan#>'{source,updated_at}','targetPreviousContactPermission',plan#>'{target,contact_permission}',
   'peopleMoved',people_moved,'tasksMoved',moved,'tasksCancelled',cancelled,'restrictionsPreserved',jsonb_array_length(plan#>'{effects,restrictions}')));
 update public.churches set outreach_revision=outreach_revision+1 where id=church;
 result:=jsonb_build_object('combined',true,'kind',kind,'sourceId',source_id,'targetId',target_id,'peopleMoved',people_moved,'tasksMoved',moved,'tasksCancelled',cancelled,'reviewToken',plan->>'token');
 insert into private.outreach_receipts(church_id,actor_id,command_id,payload_hash,result) values(church,actor,'admin_'||key,fingerprint,result);
 return result;
end $$;
revoke all on function private.outreach_admin_action(jsonb) from public,anon;
grant execute on function private.outreach_admin_action(jsonb) to authenticated;

alter function private.outreach_apply_operation(uuid,uuid,text,jsonb) rename to outreach_apply_operation_before_merges;
-- The prior body qualified a parameter with its original function name.
-- Keep the audited-move behavior, using a uniquely named local value so future
-- wrapper names cannot break the audit update at execution time.
create or replace function private.outreach_apply_operation_before_merges(church uuid,actor uuid,command_id text,op jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare previous public.discipleship_people; moving boolean:=false; result jsonb; task public.outreach_tasks;
 moved integer:=0; reason text:=btrim(op->>'reason'); move_command_id text:=command_id;
begin
 if op->>'entityType'='resident' and op->>'operation'='upsert' then
  select * into previous from public.discipleship_people where church_id=church and id=op->>'entityId';
  moving:=previous.id is not null and previous.property_id is distinct from nullif(op#>>'{record,propertyId}','');
  if moving and (coalesce(length(reason),0) not between 3 and 500) then
   raise exception 'Review the open next steps and record a brief reason for this location change.' using errcode='22023'; end if;
 end if;
 result:=private.outreach_apply_operation_contact_corrections(church,actor,command_id,op);
 if moving then
  for task in select * from public.outreach_tasks where church_id=church and person_id=previous.id and status='scheduled' and deleted_at is null loop
   insert into public.outreach_task_activity(church_id,task_id,id,action,actor_id,actor_key,note)
    values(church,task.id,command_id||'_person_move_'||task.id,'note',actor,private.volunteer_id_for_user(actor),'Location updated with the person after review: '||reason);
   moved:=moved+1;
  end loop;
  update public.outreach_audit set action='resident.location_changed',details=jsonb_build_object('reason',reason,
   'previousLocationId',previous.property_id,'locationId',nullif(op#>>'{record,propertyId}',''),'previousVersion',previous.version,'version',result->'version','openTasksMoved',moved)
   where church_id=church and outreach_audit.command_id=move_command_id and entity_type='resident' and entity_id=previous.id and action='resident.upsert';
 end if;
 return result;
end $$;
create function private.outreach_apply_operation(church uuid,actor uuid,command_id text,op jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare kind text:=op->>'entityType'; r jsonb:=op->'record'; linked_person text; linked_location text;
begin
 -- Resolve private access before exposing a profile's combination state.
 if kind in ('resident','handoff') and ((op->>'expectedVersion')::bigint>0
  or exists(select 1 from public.discipleship_people p where p.church_id=church and p.id=op->>'entityId'))
  and not private.can_view_discipleship_person(op->>'entityId') then
  raise exception 'This person is not available to your account.' using errcode='42501'; end if;
 if kind in ('resident','handoff') and exists(select 1 from public.discipleship_people p where p.church_id=church and p.id=op->>'entityId' and p.merged_into_id is not null) then
  raise sqlstate 'PT409' using message='This profile was combined after review. Open the current profile; the original record is preserved.'; end if;
 if kind='property' and exists(select 1 from public.outreach_locations l where l.church_id=church and l.id=op->>'entityId' and l.merged_into_id is not null) then
  raise sqlstate 'PT409' using message='This location was combined after review. Use its current location; the original history is preserved.'; end if;
 if kind='property' and op->>'operation'='delete' and exists(select 1 from public.outreach_locations l where l.church_id=church and l.merged_into_id=op->>'entityId') then
  raise exception 'A location with combined history must be preserved.' using errcode='22023'; end if;
 -- New work must use the current identity, not a stale alias. Existing notes
 -- and resolved task history remain permission-filtered and retain their links.
 if op->>'operation'='upsert' and (op->>'expectedVersion')::bigint=0 then
  linked_person:=case when kind in ('visit','follow_up','person_note','restriction') then nullif(r->>'residentId','') end;
  linked_location:=case when kind='resident' then nullif(r->>'propertyId','') when kind in ('visit','follow_up','restriction') then nullif(r->>'propertyId','') end;
  if linked_person is not null and not private.can_view_discipleship_person(linked_person) then
   raise exception 'This person is not available to your account.' using errcode='42501'; end if;
  if linked_person is not null and exists(select 1 from public.discipleship_people p where p.church_id=church and p.id=linked_person and p.merged_into_id is not null)
    or linked_location is not null and exists(select 1 from public.outreach_locations l where l.church_id=church and l.id=linked_location and l.merged_into_id is not null) then
   raise sqlstate 'PT409' using message='This person or location was combined. Review the current record before saving new work.'; end if;
 end if;
 if kind='resident' and op->>'operation'='upsert' and exists(select 1 from public.outreach_locations l where l.church_id=church and l.id=r->>'propertyId' and l.merged_into_id is not null) then
  raise sqlstate 'PT409' using message='Choose the current location, not a preserved combined record.'; end if;
 return private.outreach_apply_operation_before_merges(church,actor,command_id,op);
end $$;
revoke all on function private.outreach_apply_operation(uuid,uuid,text,jsonb) from public,anon,authenticated;

-- Retain all existing lifecycle guards, changing only the same-person test for
-- a new step following a completed task whose original profile was combined.
create or replace function private.outreach_record_fields(kind text,r jsonb,old_row jsonb,church uuid,actor uuid)
returns jsonb language plpgsql set search_path='' as $$
declare mapped jsonb; field text; linked public.outreach_tasks; note_limit integer;
begin
 mapped:=private.outreach_record_fields_encounter_guards(kind,r,old_row,church,actor);
 if kind<>'follow_up' then return mapped; end if;
 if old_row is null and mapped->>'status'<>'scheduled' then raise exception 'New next steps must start open. Record completion through the task workflow.' using errcode='22023'; end if;
 if old_row is not null then
  foreach field in array array['person_id','location_id','encounter_id','outing_id','parent_task_id'] loop
   if mapped->field is distinct from old_row->field then raise exception 'A task cannot be relinked to different history. Cancel it with a reason and create the corrected next step.' using errcode='22023'; end if;
  end loop;
  if mapped->>'status'='completed' or mapped->>'due_date' is distinct from old_row->>'due_date' then
   if mapped->>'acceptance'<>'accepted' or mapped->>'owner_id' is null then raise exception 'The responsible person must accept the task before completion or rescheduling.' using errcode='22023'; end if;
  end if;
  if mapped->>'status'='cancelled' then
   select note_character_limit into note_limit from public.churches where id=church;
   if coalesce(r#>>'{history,-1,action}','')<>'cancelled' or length(btrim(coalesce(r#>>'{history,-1,note}',''))) not between 1 and note_limit then
    raise exception 'Include a current cancellation reason in the final task activity.' using errcode='22023'; end if;
  end if;
 end if;
 if old_row is null and mapped->>'person_id' is not null and not exists(select 1 from public.discipleship_people p where p.church_id=church and p.id=mapped->>'person_id' and p.property_id is not distinct from mapped->>'location_id' and p.deleted_at is null and p.merged_into_id is null) then
  raise exception 'Link this next step to the person’s current location, or no location if they have none.' using errcode='22023'; end if;
 if old_row is null and mapped->>'parent_task_id' is not null then
  select * into linked from public.outreach_tasks where church_id=church and id=mapped->>'parent_task_id' and deleted_at is null;
  if not found or not private.can_view_outreach_task(church,linked.id) or linked.status<>'completed'
   or private.outreach_canonical_person(church,linked.person_id) is distinct from private.outreach_canonical_person(church,mapped->>'person_id') then
   raise exception 'A subsequent step must follow an accessible completed task for the same person.' using errcode='22023'; end if;
 end if;
 return mapped;
end $$;
commit;
