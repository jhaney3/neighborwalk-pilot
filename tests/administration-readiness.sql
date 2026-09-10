\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('20000000-0000-4000-8000-000000000011','admin-test@neighborwalk.test'),
 ('20000000-0000-4000-8000-000000000012','admin-volunteer@neighborwalk.test');
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('20000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000011',now(),now());
-- Live, fictional sessions for interactive JWT fixtures; all are rolled back.
insert into auth.sessions(id,user_id,created_at,updated_at)
 select id,id,now(),now() from auth.users where id::text like '20000000-%';
insert into public.churches(id,name,created_by,retention_days) values
 ('20000000-0000-4000-8000-000000000001','Fictional Administration Church','20000000-0000-4000-8000-000000000011',180);
insert into public.church_memberships(church_id,user_id,role,active) values
 ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000011','leader',true),
 ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000012','volunteer',true);
insert into public.outreach_locations(church_id,id,address) values('20000000-0000-4000-8000-000000000001','admin-location','100 Fictional Admin Lane');
insert into public.outreach_tasks(church_id,id,owner_id,due_date,status,created_at,completed_at) values
 ('20000000-0000-4000-8000-000000000001','old-resolved-task','20000000-0000-4000-8000-000000000011',current_date-400,'completed',now()-interval '400 days',now()-interval '399 days'),
 ('20000000-0000-4000-8000-000000000001','old-open-task','20000000-0000-4000-8000-000000000011',current_date-400,'scheduled',now()-interval '400 days',null);
insert into public.outreach_encounters(church_id,id,location_id,actor_key,outcome,occurred_at,device_id) values
 ('20000000-0000-4000-8000-000000000001','old-encounter','admin-location','old-fixture','do_not_visit',now()-interval '400 days','test-device');
insert into public.outreach_restrictions(church_id,id,location_id,channel,reason) values
 ('20000000-0000-4000-8000-000000000001','durable-restriction','admin-location','visit','Fictional do not revisit request');
insert into public.outreach_migration_issues(church_id,entity_type,entity_id,issue) values
 ('20000000-0000-4000-8000-000000000001','property','admin-location','test_review_issue');
create function pg_temp.admin_claims(method text,age integer default 0) returns text language sql as $$
 select jsonb_build_object('sub','20000000-0000-4000-8000-000000000011','role','authenticated','is_anonymous',false,
  'session_id','20000000-0000-4000-8000-000000000021','amr',jsonb_build_array(jsonb_build_object('method',method,'timestamp',extract(epoch from now())-age)))::text;
$$;
create function pg_temp.admin_request(action text,request_id text) returns jsonb language sql as $$
 select jsonb_build_object('schemaVersion',1,'id',request_id,'churchId','20000000-0000-4000-8000-000000000001','action',action,
  'expectedRevision',(select outreach_revision from public.churches where id='20000000-0000-4000-8000-000000000001'));
$$;
create function pg_temp.admin_denied(request jsonb,expected text) returns void language plpgsql as $$
declare denied boolean:=false; begin
 begin perform public.outreach_admin_action(request); exception when others then if sqlstate<>expected then raise; end if; denied:=true; end;
 if not denied then raise exception 'Administration unexpectedly succeeded'; end if;
end $$;
select set_config('request.jwt.claims',pg_temp.admin_claims('password'),true);
set local role authenticated;
do $$ declare request jsonb; result jsonb; plan jsonb; begin
  request:=pg_temp.admin_request('record_export','export-one')||'{"kind":"people"}';
  result:=public.outreach_admin_action(request);
  if result<>public.outreach_admin_action(request) then raise exception 'Admin receipt retry changed'; end if;
  if (select count(*) from public.outreach_audit where command_id='admin_export-one')<>1 then raise exception 'Export audit missing or duplicated'; end if;
  perform pg_temp.admin_denied(request||'{"kind":"tasks"}','PT409');
  perform set_config('request.jwt.claims',pg_temp.admin_claims('password',1800),true);
  perform pg_temp.admin_denied(pg_temp.admin_request('record_export','stale-auth')||'{"kind":"people"}','42501');
  perform set_config('request.jwt.claims',pg_temp.admin_claims('token_refresh'),true);
  perform pg_temp.admin_denied(pg_temp.admin_request('record_export','only-refreshed')||'{"kind":"people"}','42501');
  perform set_config('request.jwt.claims',pg_temp.admin_claims('password'),true);
  perform pg_temp.admin_denied(pg_temp.admin_request('record_export','other-church')||'{"kind":"people","churchId":"20000000-0000-4000-8000-000000000099"}','42501');
  request:=pg_temp.admin_request('import','import-one')||'{"operations":[{"entityType":"resident","entityId":"csv-person","operation":"upsert","expectedVersion":0,"record":{"name":"Fictional CSV Person","preferredContact":"none","contactPermission":"requested"}}]}';
  result:=public.outreach_admin_action(request);
  if result<>public.outreach_admin_action(request) then raise exception 'Import retry not idempotent'; end if;
  if (select assigned_to from public.discipleship_people where id='csv-person')<>auth.uid() then raise exception 'Imported person lacks responsible owner'; end if;
  perform pg_temp.admin_denied(pg_temp.admin_request('import','import-duplicate')||'{"operations":[{"entityType":"resident","entityId":"duplicate-csv-person","operation":"upsert","expectedVersion":0,"record":{"name":"  fictional CSV person  ","preferredContact":"none"}}]}','PT409');
  perform pg_temp.admin_denied(pg_temp.admin_request('import','atomic-csv-failure')||'{"operations":[{"entityType":"property","entityId":"csv-must-rollback","operation":"upsert","expectedVersion":0,"record":{"address":"Unique Fictional Rollback Lane"}},{"entityType":"property","entityId":"csv-duplicate-location","operation":"upsert","expectedVersion":0,"record":{"address":"100 Fictional Admin Lane"}}]}','PT409');
  if exists(select 1 from public.outreach_locations where id='csv-must-rollback') then raise exception 'Partial CSV import survived rollback'; end if;
  plan:=public.outreach_admin_action(pg_temp.admin_request('retention_preview','preview-one'));
  if plan->>'taskCount'<>'1' or plan->>'encounterCount'<>'1' then raise exception 'Retention eligibility included wrong records'; end if;
  perform pg_temp.admin_denied(pg_temp.admin_request('retention_archive','bad-preview')||jsonb_build_object('reviewToken','wrong','confirmation','ARCHIVE REVIEWED'),'PT409');
  result:=public.outreach_admin_action(pg_temp.admin_request('retention_archive','archive-reviewed')||jsonb_build_object('reviewToken',plan->>'token','confirmation','ARCHIVE REVIEWED'));
  if exists(select 1 from public.outreach_tasks where id='old-resolved-task') or exists(select 1 from public.outreach_encounters where id='old-encounter') then raise exception 'Reviewed records remain active'; end if;
  if not exists(select 1 from public.outreach_tasks where id='old-open-task') or not exists(select 1 from public.outreach_restrictions where id='durable-restriction' and active) then raise exception 'Archival lost open responsibility or suppression'; end if;
  perform public.outreach_admin_action(pg_temp.admin_request('review_migration_issue','review-issue')||'{"entityType":"property","entityId":"admin-location","issue":"test_review_issue","reason":"Fictional record links checked"}');
  if not exists(select 1 from public.outreach_migration_issues where entity_id='admin-location' and resolved_by=auth.uid() and resolution_note='Fictional record links checked' and resolved_at is not null) then raise exception 'Review reason or actor was not preserved'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000012","session_id":"20000000-0000-4000-8000-000000000012","role":"authenticated","is_anonymous":false}',true);
do $$ begin
 perform pg_temp.admin_denied(pg_temp.admin_request('record_export','volunteer-export')||'{"kind":"people"}','42501');
end $$;
reset role;
delete from auth.sessions where id='20000000-0000-4000-8000-000000000021';
select set_config('request.jwt.claims',pg_temp.admin_claims('password'),true);
set local role authenticated;
do $$ begin
 perform pg_temp.admin_denied(pg_temp.admin_request('record_export','revoked-session')||'{"kind":"people"}','42501');
end $$;
reset role;
rollback;
select 'PASS: recent-auth and live-session gates, audited/idempotent exports, atomic duplicate-safe imports, exact retention review, durable restrictions and review reasons' as result;
