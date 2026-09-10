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
select jsonb_build_object('result','PASS','unchanged_records',(select count(*) from rehearsal_unchanged),
  'people_preserved',(select count(*) from rehearsal_people),'locations',(select count(*) from public.outreach_locations),
  'encounters',(select count(*) from public.outreach_encounters),'tasks',(select count(*) from public.outreach_tasks),
  'restrictions',(select count(*) from public.outreach_restrictions),'review_issues',(select count(*) from public.outreach_migration_issues));
