\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('60000000-0000-4000-8000-000000000011','merge-leader@neighborwalk.test'),
 ('60000000-0000-4000-8000-000000000012','merge-owner@neighborwalk.test'),
 ('60000000-0000-4000-8000-000000000013','merge-recipient@neighborwalk.test');
insert into auth.sessions(id,user_id,created_at,updated_at) values('60000000-0000-4000-8000-000000000021','60000000-0000-4000-8000-000000000011',now(),now());
-- Live, fictional sessions for interactive JWT fixtures; all are rolled back.
insert into auth.sessions(id,user_id,created_at,updated_at)
 select id,id,now(),now() from auth.users where id::text like '60000000-%';
insert into public.churches(id,name,created_by) values('60000000-0000-4000-8000-000000000001','Fictional Combination Church','60000000-0000-4000-8000-000000000011');
insert into public.church_memberships(church_id,user_id,role,active) values
 ('60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000011','leader',true),
 ('60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000012','volunteer',true),
 ('60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000013','volunteer',true);
insert into public.outreach_locations(church_id,id,address,unit) values
 ('60000000-0000-4000-8000-000000000001','merge-place-a','123 Fictional Road','A'),
 ('60000000-0000-4000-8000-000000000001','merge-place-b','123 Fictional Road','A'),
 ('60000000-0000-4000-8000-000000000001','merge-other-unit','123 Fictional Road','B');
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000012","session_id":"60000000-0000-4000-8000-000000000012","role":"authenticated","is_anonymous":false}',true);
insert into public.discipleship_people(id,church_id,property_id,created_by,assigned_to,name,phone,faith_status,discipleship_stage,status,preferred_contact) values
 ('merge-person-a','60000000-0000-4000-8000-000000000001','merge-place-a','60000000-0000-4000-8000-000000000012','60000000-0000-4000-8000-000000000012','Fictional same person','555-0101','not_discussed','new_connection','active','none'),
 ('merge-person-b','60000000-0000-4000-8000-000000000001','merge-place-a','60000000-0000-4000-8000-000000000012','60000000-0000-4000-8000-000000000012','Fictional same person','555-0102','prefer_not_to_say','building_relationship','active','none');
insert into public.discipleship_person_notes(id,church_id,person_id,author_id,kind,body) values
 ('merge-note','60000000-0000-4000-8000-000000000001','merge-person-a','60000000-0000-4000-8000-000000000012','general','Fictional historical note');
insert into public.outreach_encounters(church_id,id,person_id,location_id,actor_key,outcome,occurred_at,device_id) values
 ('60000000-0000-4000-8000-000000000001','merge-encounter','merge-person-a','merge-place-a','fictional-owner','conversation','2026-01-01T12:00:00Z','fictional-device');
insert into public.outreach_tasks(church_id,id,person_id,location_id,owner_id,due_date,status,channel) values
 ('60000000-0000-4000-8000-000000000001','merge-open-task','merge-person-a','merge-place-a','60000000-0000-4000-8000-000000000012',current_date,'scheduled','other'),
 ('60000000-0000-4000-8000-000000000001','merge-email-task','merge-person-a','merge-place-a','60000000-0000-4000-8000-000000000012',current_date,'scheduled','email'),
 ('60000000-0000-4000-8000-000000000001','merge-closed-task','merge-person-a','merge-place-a','60000000-0000-4000-8000-000000000012',current_date-10,'completed','other'),
 ('60000000-0000-4000-8000-000000000001','merge-visit-task',null,'merge-place-b','60000000-0000-4000-8000-000000000012',current_date,'scheduled','visit');
insert into public.outreach_restrictions(church_id,id,person_id,location_id,channel,reason,created_by) values
 ('60000000-0000-4000-8000-000000000001','merge-email-a','merge-person-a',null,'email','First fictional no-email request','60000000-0000-4000-8000-000000000012'),
 ('60000000-0000-4000-8000-000000000001','merge-email-b','merge-person-b',null,'email','Second fictional no-email request','60000000-0000-4000-8000-000000000012'),
 ('60000000-0000-4000-8000-000000000001','merge-visit-a',null,'merge-place-a','visit','First fictional no-visit request','60000000-0000-4000-8000-000000000012');
create temp table merge_originals(kind text,record jsonb);
insert into merge_originals select 'note',to_jsonb(n) from public.discipleship_person_notes n where n.id='merge-note';
insert into merge_originals select 'encounter',to_jsonb(e) from public.outreach_encounters e where e.id='merge-encounter';
insert into merge_originals select 'task',to_jsonb(t) from public.outreach_tasks t where t.id='merge-closed-task';
insert into merge_originals select 'person',to_jsonb(p) from public.discipleship_people p where p.id='merge-person-a';
insert into merge_originals select 'location',to_jsonb(l) from public.outreach_locations l where l.id='merge-place-a';
grant select on merge_originals to authenticated;
create function pg_temp.merge_claims(member text,leader boolean default false) returns text language sql as $$
 select jsonb_build_object('sub',member,'role','authenticated','is_anonymous',false,'session_id',case when leader then '60000000-0000-4000-8000-000000000021' else member end,
  'amr',case when leader then jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now()))) else '[]'::jsonb end)::text;
$$;
create function pg_temp.merge_request(kind text,source text,target text) returns jsonb language sql as $$
 select jsonb_build_object('schemaVersion',1,'id','preview','churchId','60000000-0000-4000-8000-000000000001','action','duplicate_preview','kind',kind,'sourceId',source,'targetId',target);
$$;
create function pg_temp.merge_denied(request jsonb,expected text) returns void language plpgsql as $$
declare denied boolean:=false; begin
 begin perform public.outreach_admin_action(request); exception when others then if sqlstate<>expected then raise; end if; denied:=true; end;
 if not denied then raise exception 'Combination unexpectedly succeeded'; end if;
end $$;
set local role authenticated;
do $$ begin perform pg_temp.merge_denied(pg_temp.merge_request('people','merge-person-a','merge-person-b'),'42501'); end $$;
select set_config('request.jwt.claims',pg_temp.merge_claims('60000000-0000-4000-8000-000000000011',true),true);
reset role;
do $$ declare plan jsonb; request jsonb; begin
 update public.discipleship_people set shared_user_ids=array['60000000-0000-4000-8000-000000000013'::uuid] where id='merge-person-a';
 plan:=public.outreach_admin_action(pg_temp.merge_request('people','merge-person-a','merge-person-b'));
 if plan->'blockers'='[]'::jsonb then raise exception 'Combination broadened private sharing without review'; end if;
 request:=pg_temp.merge_request('people','merge-person-a','merge-person-b')||jsonb_build_object('id','blocked-sharing','action','duplicate_merge','expectedRevision',plan->'revision','reviewToken',plan->>'token','reason','Fictional blocked sharing test','confirmation','COMBINE SAME PERSON');
 perform pg_temp.merge_denied(request,'22023');
 update public.discipleship_people set shared_user_ids='{}',assigned_to='60000000-0000-4000-8000-000000000013' where id='merge-person-a';
 plan:=public.outreach_admin_action(pg_temp.merge_request('people','merge-person-a','merge-person-b'));
 if plan->'blockers'='[]'::jsonb then raise exception 'Combination silently changed responsibility'; end if;
 update public.discipleship_people set assigned_to='60000000-0000-4000-8000-000000000012',pending_owner_id='60000000-0000-4000-8000-000000000013' where id='merge-person-a';
 plan:=public.outreach_admin_action(pg_temp.merge_request('people','merge-person-a','merge-person-b'));
 if plan->'blockers'='[]'::jsonb then raise exception 'Combination ignored pending handoff'; end if;
 update public.discipleship_people set pending_owner_id=null where id='merge-person-a';
 plan:=public.outreach_admin_action(pg_temp.merge_request('people','merge-person-a','merge-person-b'));
 request:=pg_temp.merge_request('people','merge-person-a','merge-person-b')||jsonb_build_object('id','stale-review','action','duplicate_merge','expectedRevision',plan->'revision','reviewToken',plan->>'token','reason','Fictional stale review test','confirmation','COMBINE SAME PERSON');
 update public.discipleship_people set phone='555-0199' where id='merge-person-a';
 perform pg_temp.merge_denied(request,'PT409');
 update public.discipleship_people set phone='555-0101' where id='merge-person-a';
 -- Restore the fixture timestamps changed by ordinary update triggers.
 update public.discipleship_people set updated_at=(select (record->>'updated_at')::timestamptz from merge_originals where kind='person') where id='merge-person-a';
end $$;
set local role authenticated;
do $$ declare plan jsonb; request jsonb; result jsonb; begin
 plan:=public.outreach_admin_action(pg_temp.merge_request('locations','merge-place-a','merge-other-unit'));
 if plan->'blockers'='[]'::jsonb then raise exception 'Different apartment units could be combined'; end if;
 perform pg_temp.merge_denied(pg_temp.merge_request('people','merge-person-a','missing-private-profile'),'22023');
 plan:=public.outreach_admin_action(pg_temp.merge_request('people','merge-person-a','merge-person-b'));
 if plan->'blockers'<>'[]'::jsonb or jsonb_array_length(plan#>'{effects,tasks}')<>2 or jsonb_array_length(plan#>'{effects,tasksToCancel}')<>1 then raise exception 'Person combination preview omitted effects'; end if;
 request:=pg_temp.merge_request('people','merge-person-a','merge-person-b')||jsonb_build_object('id','combine-people','action','duplicate_merge','expectedRevision',plan->'revision','reviewToken',plan->>'token','reason','Confirmed this is the same fictional person.','confirmation','COMBINE SAME PERSON');
 perform pg_temp.merge_denied(request||'{"reviewToken":"tampered"}','PT409');
 perform pg_temp.merge_denied(request||'{"reason":""}','22023');
 result:=public.outreach_admin_action(request);
 if public.outreach_admin_action(request)<>result then raise exception 'Retry did not return same merge receipt'; end if;
 if not exists(select 1 from public.discipleship_people where id='merge-person-a' and merged_into_id='merge-person-b' and status='archived')
  or not exists(select 1 from public.outreach_tasks where id='merge-open-task' and person_id='merge-person-b' and status='scheduled' and version=2)
  or not exists(select 1 from public.outreach_tasks where id='merge-email-task' and person_id='merge-person-b' and status='cancelled' and version=3)
  or (select count(*) from public.outreach_restrictions where person_id='merge-person-b' and active and channel='email')<>2
  or (select count(*) from public.outreach_task_activity where task_id='merge-open-task')<>1 then raise exception 'Merge lost ownership, independent restrictions or exactly-once history'; end if;
 if (select record from merge_originals where kind='note')<>(select to_jsonb(n) from public.discipleship_person_notes n where n.id='merge-note')
  or (select record from merge_originals where kind='encounter')<>(select to_jsonb(e) from public.outreach_encounters e where e.id='merge-encounter')
  or (select record from merge_originals where kind='task')<>(select to_jsonb(t) from public.outreach_tasks t where t.id='merge-closed-task') then raise exception 'Person merge rewrote historical records'; end if;
 if (select record-array['version','status','updated_at','merged_into_id','merged_at'] from merge_originals where kind='person')
  <>(select to_jsonb(p)-array['version','status','updated_at','merged_into_id','merged_at'] from public.discipleship_people p where p.id='merge-person-a') then raise exception 'Original profile details were lost'; end if;
end $$;
-- A later accepted handoff changes access to the entire combined history.
select set_config('request.jwt.claims',pg_temp.merge_claims('60000000-0000-4000-8000-000000000012'),true);
do $$ begin
 if not exists(select 1 from public.discipleship_person_notes where id='merge-note') then raise exception 'Original owner lost permitted combined history'; end if;
 perform public.outreach_apply_command('{"id":"merge-handoff-request","schemaVersion":1,"churchId":"60000000-0000-4000-8000-000000000001","operations":[{"entityType":"handoff","entityId":"merge-person-b","operation":"upsert","expectedVersion":2,"record":{"action":"request","assignedVolunteerId":"volunteer_60000000000040008000000000000013"}}]}');
end $$;
select set_config('request.jwt.claims',pg_temp.merge_claims('60000000-0000-4000-8000-000000000013'),true);
do $$ begin
 perform public.outreach_apply_command('{"id":"merge-handoff-accept","schemaVersion":1,"churchId":"60000000-0000-4000-8000-000000000001","operations":[{"entityType":"handoff","entityId":"merge-person-b","operation":"upsert","expectedVersion":3,"record":{"action":"accept"}}]}');
 if not exists(select 1 from public.discipleship_person_notes where id='merge-note') then raise exception 'Accepted owner cannot view preserved source history'; end if;
 perform public.outreach_apply_command('{"id":"merge-subsequent-task","schemaVersion":1,"churchId":"60000000-0000-4000-8000-000000000001","operations":[{"entityType":"follow_up","entityId":"merge-next-task","operation":"upsert","expectedVersion":0,"record":{"residentId":"merge-person-b","propertyId":"merge-place-a","parentFollowUpId":"merge-closed-task","dueAt":"2026-10-01","status":"scheduled","channel":"other","assignedVolunteerId":"volunteer_60000000000040008000000000000013"}}]}');
 begin
  perform public.outreach_apply_command('{"id":"stale-alias-note","schemaVersion":1,"churchId":"60000000-0000-4000-8000-000000000001","operations":[{"entityType":"person_note","entityId":"wrong-alias-note","operation":"upsert","expectedVersion":0,"record":{"residentId":"merge-person-a","kind":"general","body":"Fictional stale entry"}}]}');
  raise exception 'New work was written to a combined alias';
 exception when sqlstate 'PT409' then null; end;
end $$;
select set_config('request.jwt.claims',pg_temp.merge_claims('60000000-0000-4000-8000-000000000012'),true);
do $$ begin
 if exists(select 1 from public.discipleship_person_notes where id='merge-note') or exists(select 1 from public.discipleship_people where id in('merge-person-a','merge-person-b')) then raise exception 'Previous owner retained private combined history after handoff'; end if;
 begin
  perform public.outreach_apply_command('{"id":"private-alias-probe","schemaVersion":1,"churchId":"60000000-0000-4000-8000-000000000001","operations":[{"entityType":"person_note","entityId":"unavailable-alias-note","operation":"upsert","expectedVersion":0,"record":{"residentId":"merge-person-a","kind":"general","body":"Fictional unavailable profile"}}]}');
  raise exception 'An unavailable alias accepted private work';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims',pg_temp.merge_claims('60000000-0000-4000-8000-000000000011',true),true);
-- Simulate a legacy independently recorded request immediately before review.
-- Ordinary commands correctly cancel restricted tasks already at that location.
reset role;
insert into public.outreach_restrictions(church_id,id,location_id,channel,reason,created_by) values
 ('60000000-0000-4000-8000-000000000001','merge-visit-b','merge-place-b','visit','Second fictional no-visit request','60000000-0000-4000-8000-000000000012');
set local role authenticated;
do $$ declare plan jsonb; request jsonb; result jsonb; begin
 plan:=public.outreach_admin_action(pg_temp.merge_request('locations','merge-place-a','merge-place-b'));
 if plan->'blockers'<>'[]'::jsonb or jsonb_array_length(plan#>'{effects,people}')<>1 or jsonb_array_length(plan#>'{effects,tasks}')<>2
  or jsonb_array_length(plan#>'{effects,tasksToCancel}')<>1 then raise exception 'Location preview omitted current people, tasks or visit restriction'; end if;
 request:=pg_temp.merge_request('locations','merge-place-a','merge-place-b')||jsonb_build_object('id','combine-locations','action','duplicate_merge','expectedRevision',plan->'revision','reviewToken',plan->>'token','reason','Confirmed the same fictional dwelling and unit.','confirmation','COMBINE SAME LOCATION');
 result:=public.outreach_admin_action(request);
 if public.outreach_admin_action(request)<>result then raise exception 'Location merge receipt changed'; end if;
 if not exists(select 1 from public.outreach_locations where id='merge-place-a' and merged_into_id='merge-place-b')
  or not exists(select 1 from public.discipleship_people where id='merge-person-b' and property_id='merge-place-b')
  or not exists(select 1 from public.outreach_tasks where id='merge-open-task' and location_id='merge-place-b' and owner_id='60000000-0000-4000-8000-000000000013' and status='scheduled')
  or not exists(select 1 from public.outreach_tasks where id='merge-visit-task' and status='cancelled')
  or (select count(*) from public.outreach_restrictions where location_id='merge-place-b' and active and channel='visit')<>2 then raise exception 'Location combination lost current links or suppression'; end if;
 if (select record from merge_originals where kind='encounter')<>(select to_jsonb(e) from public.outreach_encounters e where e.id='merge-encounter')
  or (select record from merge_originals where kind='task')<>(select to_jsonb(t) from public.outreach_tasks t where t.id='merge-closed-task') then raise exception 'Location merge rewrote original history'; end if;
 if (select record-array['version','merged_into_id','merged_at'] from merge_originals where kind='location')
  <>(select to_jsonb(l)-array['version','merged_into_id','merged_at'] from public.outreach_locations l where l.id='merge-place-a') then raise exception 'Original location details were lost'; end if;
end $$;
-- Independently recorded requests remain independently liftable after a merge.
do $$ begin
 perform public.outreach_apply_command('{"id":"lift-one-combined-restriction","schemaVersion":1,"churchId":"60000000-0000-4000-8000-000000000001","operations":[{"entityType":"restriction","entityId":"merge-visit-a","operation":"upsert","expectedVersion":2,"record":{"active":false,"correctionReason":"First fictional request corrected after independent review."}}]}');
 if (select count(*) from public.outreach_restrictions where location_id='merge-place-b' and active and channel='visit')<>1
  or not exists(select 1 from public.outreach_tasks where id='merge-visit-task' and status='cancelled') then raise exception 'Lifting one combined request removed another or reopened a task'; end if;
 perform pg_temp.merge_denied(pg_temp.merge_request('people','merge-person-b','merge-person-a'),'22023');
 perform pg_temp.merge_denied(pg_temp.merge_request('locations','merge-place-b','merge-place-a'),'22023');
end $$;
-- A later combination flattens old aliases without a cycle, and a legacy
-- blanket no-contact flag remains authoritative even without a restriction row.
reset role;
select set_config('request.jwt.claims',pg_temp.merge_claims('60000000-0000-4000-8000-000000000013'),true);
insert into public.discipleship_people(id,church_id,property_id,created_by,assigned_to,name,faith_status,discipleship_stage,status,preferred_contact,contact_permission) values
 ('merge-person-c','60000000-0000-4000-8000-000000000001','merge-place-b','60000000-0000-4000-8000-000000000013','60000000-0000-4000-8000-000000000013','Fictional same person','not_discussed','new_connection','active','none','do_not_contact');
select set_config('request.jwt.claims',pg_temp.merge_claims('60000000-0000-4000-8000-000000000011',true),true);
set local role authenticated;
do $$ declare plan jsonb; request jsonb; begin
 plan:=public.outreach_admin_action(pg_temp.merge_request('people','merge-person-b','merge-person-c'));
 if plan->'blockers'<>'[]'::jsonb or jsonb_array_length(plan#>'{effects,people}')<>1 or jsonb_array_length(plan#>'{effects,tasksToCancel}')<>2 then raise exception 'Chained review omitted aliases or blanket restriction effects'; end if;
 request:=pg_temp.merge_request('people','merge-person-b','merge-person-c')||jsonb_build_object('id','combine-again','action','duplicate_merge','expectedRevision',plan->'revision','reviewToken',plan->>'token','reason','Confirmed an additional fictional duplicate.','confirmation','COMBINE SAME PERSON');
 perform public.outreach_admin_action(request);
 if (select count(*) from public.discipleship_people where id in ('merge-person-a','merge-person-b') and merged_into_id='merge-person-c')<>2
  or not exists(select 1 from public.outreach_restrictions where person_id='merge-person-c' and active and channel='all')
  or exists(select 1 from public.outreach_tasks where person_id='merge-person-c' and status='scheduled')
  or not exists(select 1 from public.discipleship_person_notes where id='merge-note' and person_id='merge-person-a') then raise exception 'Chained merge lost original history or legacy restriction'; end if;
end $$;
rollback;
\echo 'Reviewed duplicate combination passed (all fictional changes rolled back).'
