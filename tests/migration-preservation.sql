-- Used only by scripts/rehearse-migration.mjs against the private LOCAL restore.
do $$ begin
  if current_database() <> 'neighborwalk_rehearsal_20260909' then raise exception 'Wrong rehearsal database'; end if;
  if to_regclass('public.outreach_outings') is not null then raise exception 'Rehearsal already migrated'; end if;
end $$;
create temp table rehearsal_unchanged(kind text,id text,record jsonb);
insert into rehearsal_unchanged
select 'snapshot',church_id::text,to_jsonb(t) from public.workspace_snapshots t union all
select 'membership',church_id::text||user_id::text,to_jsonb(t) from public.church_memberships t union all
select 'guide',id::text,to_jsonb(t) from public.conversation_guides t union all
select 'guide_preference',church_id::text||user_id::text,to_jsonb(t) from public.conversation_guide_preferences t union all
select 'guide_default',church_id::text||team_id,to_jsonb(t) from public.conversation_guide_team_defaults t union all
select 'person_note',id,to_jsonb(t) from public.discipleship_person_notes t union all
select 'protected_task',id,to_jsonb(t) from public.discipleship_follow_ups t union all
select 'user',id::text,to_jsonb(t) from auth.users t union all
select 'identity',id::text,to_jsonb(t) from auth.identities t;
create temp table rehearsal_people as select id,church_id,to_jsonb(t) record from public.discipleship_people t;
create temp table rehearsal_churches as select id,to_jsonb(t) record from public.churches t;

-- MIGRATIONS HERE

do $$ declare old_record record; current_row jsonb; comparable jsonb; expected_count bigint; actual_count bigint; mapping record; begin
  for old_record in select * from rehearsal_unchanged loop
    case old_record.kind
      when 'snapshot' then select to_jsonb(t) into current_row from public.workspace_snapshots t where church_id::text=old_record.id;
      when 'membership' then select to_jsonb(t) into current_row from public.church_memberships t where church_id::text||user_id::text=old_record.id;
      when 'guide' then select to_jsonb(t) into current_row from public.conversation_guides t where id::text=old_record.id;
      when 'guide_preference' then select to_jsonb(t) into current_row from public.conversation_guide_preferences t where church_id::text||user_id::text=old_record.id;
      when 'guide_default' then select to_jsonb(t) into current_row from public.conversation_guide_team_defaults t where church_id::text||team_id=old_record.id;
      when 'person_note' then select to_jsonb(t) into current_row from public.discipleship_person_notes t where id=old_record.id;
      when 'protected_task' then select to_jsonb(t) into current_row from public.discipleship_follow_ups t where id=old_record.id;
      when 'user' then select to_jsonb(t) into current_row from auth.users t where id::text=old_record.id;
      when 'identity' then select to_jsonb(t) into current_row from auth.identities t where id::text=old_record.id;
    end case;
    select jsonb_object_agg(key,value) into comparable from jsonb_each(current_row) where old_record.record ? key;
    if comparable is distinct from old_record.record then raise exception 'Preservation failed in a baseline table'; end if;
  end loop;
  for old_record in select * from rehearsal_people loop
    select to_jsonb(t) into current_row from public.discipleship_people t where id=old_record.id and church_id=old_record.church_id;
    select jsonb_object_agg(key,value) into comparable from jsonb_each(current_row) where old_record.record ? key and key<>'property_id';
    if comparable is distinct from old_record.record-'property_id' or current_row->>'legacy_property_id' is distinct from old_record.record->>'property_id'
      or current_row->>'legacy_creator_access'<>'true' then raise exception 'Person ownership, sharing or history changed unexpectedly'; end if;
    if current_row->>'property_id' is distinct from old_record.record->>'property_id' and not exists (
      select 1 from public.outreach_migration_issues i where i.entity_type='person' and i.entity_id=old_record.id and i.church_id=old_record.church_id
    ) then raise exception 'Person location adjustment was not flagged'; end if;
  end loop;
  if exists(select 1 from rehearsal_churches c join private.outreach_migration_checkpoints p on p.church_id=c.id where p.original_church is distinct from c.record) then
    raise exception 'Original church profile was not preserved'; end if;
  for mapping in select * from (values ('events','outreach_outings'),('teams','outreach_teams'),('territories','outreach_territories'),('properties','outreach_locations'),('visits','outreach_encounters')) m(collection,table_name) loop
    select coalesce(sum(jsonb_array_length(data->mapping.collection)),0) into expected_count from public.workspace_snapshots;
    execute format('select count(*) from public.%I',mapping.table_name) into actual_count;
    if expected_count<>actual_count then raise exception 'Normalized collection count differs'; end if;
  end loop;
  select count(*) into expected_count from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'followUps') v where nullif(v->>'residentId','') is null;
  expected_count := expected_count + (select count(*) from public.discipleship_follow_ups);
  if expected_count <> (select count(*) from public.outreach_tasks) then raise exception 'Task count differs'; end if;
  if exists(select 1 from public.discipleship_follow_ups f join public.outreach_tasks t on t.id=f.id and t.church_id=f.church_id
    join public.discipleship_people p on p.id=f.person_id and p.church_id=f.church_id join public.churches c on c.id=f.church_id
    where t.person_id is distinct from f.person_id or t.owner_id is distinct from p.assigned_to or t.note is distinct from f.note
      or t.completion_note is distinct from f.completion_note or t.status is distinct from f.status
      or t.legacy_due_at is distinct from f.due_at or t.due_date is distinct from (f.due_at at time zone c.timezone)::date
      or (select count(*) from public.outreach_task_activity a where a.church_id=f.church_id and a.task_id=f.id) <> jsonb_array_length(f.history)
  ) then raise exception 'Protected task content, date, owner or history differs'; end if;
  if exists(select 1 from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'properties') v
    where (v->>'currentOutcome'='do_not_visit' or exists(select 1 from public.outreach_encounters e where e.church_id=s.church_id and e.location_id=v->>'id' and e.outcome='do_not_visit'))
    and not exists(select 1 from public.outreach_restrictions r where r.church_id=s.church_id and r.location_id=v->>'id' and r.active)
  ) then raise exception 'A historical restriction was lost'; end if;
end $$;
-- Check every persisted ordinary field against its explicit normalized mapping,
-- not just collection sizes. Errors name a mapping category, never private rows.
create temp table reconciliation_checks(kind text primary key, checked bigint);
do $$ declare snapshot record; collection text; item jsonb; expected jsonb; actual jsonb; tab text;
  linked text; linked2 text; linked3 text; linked4 text; history_item jsonb; task_row record; total bigint; begin
  for snapshot in select church_id,data from public.workspace_snapshots loop
    if exists(select 1 from public.churches c where c.id=snapshot.church_id and (
      c.name is distinct from snapshot.data#>>'{church,name}' or c.timezone is distinct from snapshot.data#>>'{church,timezone}'
      or c.retention_days is distinct from (snapshot.data#>>'{church,retentionDays}')::integer
      or c.default_follow_up_days is distinct from (snapshot.data#>>'{church,defaultFollowUpDays}')::integer
      or c.note_character_limit is distinct from (snapshot.data#>>'{church,noteCharacterLimit}')::integer
      or c.pathway_enabled is distinct from false)) then raise exception 'Church settings mapping differs' using errcode='NW001'; end if;
    foreach collection in array array['events','teams','territories','properties','visits','followUps'] loop
      total:=0;
      for item in select value from jsonb_array_elements(snapshot.data->collection) loop
        if collection='followUps' and nullif(item->>'residentId','') is not null then continue; end if;
        expected:=jsonb_build_object('church_id',snapshot.church_id,'id',item->>'id','deleted_at',null,'version',1);
        case collection
        when 'events' then
          tab:='outreach_outings';
          expected:=expected||jsonb_build_object('name',item->>'name','starts_at',(item->>'startsAt')::timestamptz,
            'ends_at',(item->>'endsAt')::timestamptz,'status',item->>'status','timezone',snapshot.data#>>'{church,timezone}');
        when 'teams' then
          tab:='outreach_teams';
          expected:=expected||jsonb_build_object('name',item->>'name','status',item->>'status','legacy_event_id',item->>'eventId');
          if (select coalesce(jsonb_agg(v order by v),'[]') from (select distinct value v from jsonb_array_elements_text(item->'memberIds')) members)
            is distinct from (select coalesce(jsonb_agg(volunteer_id order by volunteer_id),'[]') from public.outreach_team_members m
              where m.church_id=snapshot.church_id and m.team_id=item->>'id') then raise exception 'Group membership mapping differs' using errcode='NW002'; end if;
          if exists(select 1 from public.outreach_team_members m where m.church_id=snapshot.church_id and m.team_id=item->>'id'
            and m.user_id is distinct from private.outreach_member_id(snapshot.church_id,m.volunteer_id)) then raise exception 'Group actor mapping differs' using errcode='NW002'; end if;
        when 'territories' then
          tab:='outreach_territories';
          expected:=expected||jsonb_build_object('name',item->>'name','color',item->>'color','longitude',(item#>>'{center,0}')::double precision,
            'latitude',(item#>>'{center,1}')::double precision,'zoom',(item->>'zoom')::double precision,'boundary',item->'boundary','legacy_event_id',item->>'eventId','kind','map');
          if nullif(item->>'assignedTeamId','') is not null and exists(select 1 from public.outreach_teams g where g.church_id=snapshot.church_id and g.id=item->>'assignedTeamId')
            and exists(select 1 from public.outreach_outings o where o.church_id=snapshot.church_id and o.id=item->>'eventId')
            and not exists(select 1 from public.outreach_assignments a where a.church_id=snapshot.church_id and a.territory_id=item->>'id'
              and a.team_id=item->>'assignedTeamId' and a.outing_id=item->>'eventId') then raise exception 'Outing assignment mapping differs' using errcode='NW003'; end if;
        when 'properties' then
          tab:='outreach_locations';
          select id into linked from public.outreach_territories t where t.church_id=snapshot.church_id and t.id=item->>'territoryId';
          expected:=expected||jsonb_build_object('territory_id',linked,'legacy_territory_id',item->>'territoryId','address',item->>'address','unit',nullif(item->>'unit',''),
            'longitude',(item#>>'{coordinates,0}')::double precision,'latitude',(item#>>'{coordinates,1}')::double precision,
            'building_geometry',nullif(item->'buildingGeometry','null'),'parcel_reference',nullif(item->'parcel','null'),'source',item->>'source',
            'created_at',(item->>'createdAt')::timestamptz,'updated_at',(item->>'updatedAt')::timestamptz);
        when 'visits' then
          tab:='outreach_encounters';
          select id into linked from public.outreach_outings t where t.church_id=snapshot.church_id and t.id=item->>'eventId';
          select id into linked2 from public.outreach_territories t where t.church_id=snapshot.church_id and t.id=item->>'territoryId';
          select id into linked3 from public.outreach_locations t where t.church_id=snapshot.church_id and t.id=item->>'propertyId';
          expected:=expected||jsonb_build_object('outing_id',linked,'territory_id',linked2,'location_id',linked3,
            'legacy_links',jsonb_build_object('eventId',item->>'eventId','territoryId',item->>'territoryId','propertyId',item->>'propertyId'),
            'actor_id',private.outreach_member_id(snapshot.church_id,item->>'volunteerId'),'actor_key',item->>'volunteerId','outcome',item->>'outcome',
            'objective_note',nullif(item->>'objectiveNote',''),'occurred_at',(item->>'recordedAt')::timestamptz,'device_id',item->>'deviceId','context','door');
        when 'followUps' then
          tab:='outreach_tasks';
          select id into linked from public.outreach_locations t where t.church_id=snapshot.church_id and t.id=item->>'propertyId';
          select id,outing_id into linked2,linked3 from public.outreach_encounters t where t.church_id=snapshot.church_id and t.id=item->>'sourceVisitId';
          select id into linked4 from public.outreach_teams t where t.church_id=snapshot.church_id and t.id=item->>'assignedTeamId';
          expected:=expected||jsonb_build_object('location_id',linked,'encounter_id',linked2,'outing_id',linked3,'team_id',linked4,'owner_id',null,
            'created_by',private.outreach_member_id(snapshot.church_id,item#>>'{history,0,actorId}'),
            'due_date',((item->>'dueAt')::timestamptz at time zone (snapshot.data#>>'{church,timezone}'))::date,
            'legacy_due_at',(item->>'dueAt')::timestamptz,'status',item->>'status','note',nullif(item->>'note',''),
            'completion_note',nullif(item->>'completionNote',''),'parent_task_id',item->>'parentFollowUpId',
            'created_at',(item->>'createdAt')::timestamptz,'completed_at',(item->>'completedAt')::timestamptz,
            'legacy_links',jsonb_build_object('propertyId',item->>'propertyId','sourceVisitId',item->>'sourceVisitId','assignedTeamId',item->>'assignedTeamId'));
        end case;
        execute format('select to_jsonb(t) from public.%I t where church_id=$1 and id=$2',tab) into actual using snapshot.church_id,item->>'id';
        if actual is null or not actual @> expected then raise exception 'Ordinary field mapping differs' using errcode='NW004'; end if;
        total:=total+1;
      end loop;
      insert into reconciliation_checks values(collection,total) on conflict(kind) do update set checked=reconciliation_checks.checked+excluded.checked;
    end loop;
  end loop;
  total:=0;
  for task_row in
    select s.church_id,v->>'id' id,coalesce(v->'history','[]') history,s.data#>>'{church,timezone}' timezone
      from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'followUps') v where nullif(v->>'residentId','') is null
    union all select f.church_id,f.id,f.history,c.timezone from public.discipleship_follow_ups f join public.churches c on c.id=f.church_id
  loop
    if jsonb_array_length(task_row.history) <> (select count(*) from public.outreach_task_activity a where a.church_id=task_row.church_id and a.task_id=task_row.id)
      then raise exception 'Historical task activity count differs' using errcode='NW005'; end if;
    for history_item in select value from jsonb_array_elements(task_row.history) loop
      expected:=jsonb_build_object('church_id',task_row.church_id,'task_id',task_row.id,'id',history_item->>'id','action',history_item->>'action',
        'actor_id',private.outreach_member_id(task_row.church_id,history_item->>'actorId'),'actor_key',history_item->>'actorId',
        'note',nullif(history_item->>'note',''),'due_date',((history_item->>'dueAt')::timestamptz at time zone task_row.timezone)::date,
        'occurred_at',(history_item->>'createdAt')::timestamptz);
      select to_jsonb(a) into actual from public.outreach_task_activity a where a.church_id=task_row.church_id and a.task_id=task_row.id and a.id=history_item->>'id';
      if actual is null or not actual @> expected then raise exception 'Historical task activity field differs' using errcode='NW005'; end if;
      total:=total+1;
    end loop;
  end loop;
  insert into reconciliation_checks values('task_activity',total);
  total:=0;
  for task_row in select f.*,p.assigned_to,c.timezone from public.discipleship_follow_ups f
    join public.discipleship_people p on p.church_id=f.church_id and p.id=f.person_id
    join public.churches c on c.id=f.church_id loop
    select id into linked from public.outreach_locations t where t.church_id=task_row.church_id and t.id=task_row.property_id;
    select id,outing_id into linked2,linked3 from public.outreach_encounters t where t.church_id=task_row.church_id and t.id=task_row.source_visit_id;
    expected:=jsonb_build_object('church_id',task_row.church_id,'id',task_row.id,'person_id',task_row.person_id,'location_id',linked,
      'encounter_id',linked2,'outing_id',linked3,'owner_id',task_row.assigned_to,'created_by',task_row.created_by,
      'due_date',(task_row.due_at at time zone task_row.timezone)::date,'legacy_due_at',task_row.due_at,
      'status',task_row.status,'note',task_row.note,'completion_note',task_row.completion_note,'parent_task_id',task_row.parent_follow_up_id,
      'created_at',task_row.created_at,'completed_at',task_row.completed_at,'deleted_at',null,'version',1,
      'legacy_links',jsonb_build_object('propertyId',task_row.property_id,'sourceVisitId',task_row.source_visit_id));
    select to_jsonb(t) into actual from public.outreach_tasks t where t.church_id=task_row.church_id and t.id=task_row.id;
    if actual is null or not actual @> expected then raise exception 'Protected task field mapping differs' using errcode='NW006'; end if;
    total:=total+1;
  end loop;
  insert into reconciliation_checks values('protected_tasks',total);
end $$;
-- The staged FKs initially preserve inconsistencies for review. This rehearsal
-- proves whether this backup can validate them, without changing the original.
alter table public.outreach_tasks validate constraint outreach_tasks_parent_tenant_fk;
alter table public.conversation_guide_team_defaults validate constraint conversation_guide_team_normalized_fk;
select jsonb_build_object('result','PASS','unchanged_records',(select count(*) from rehearsal_unchanged),
  'field_reconciliation',(select jsonb_object_agg(kind,checked) from reconciliation_checks),
  'staged_relationship_constraints_validated',2,
  'review_categories',(select jsonb_object_agg(entity_type,total) from (select entity_type,count(*) total from public.outreach_migration_issues group by entity_type) issues),
  'people_preserved',(select count(*) from rehearsal_people),'locations',(select count(*) from public.outreach_locations),
  'encounters',(select count(*) from public.outreach_encounters),'tasks',(select count(*) from public.outreach_tasks),
  'restrictions',(select count(*) from public.outreach_restrictions),'review_issues',(select count(*) from public.outreach_migration_issues));
