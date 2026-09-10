\set ON_ERROR_STOP on
begin;
-- Fictional, rolled-back fixtures only. This test is run against loopback by
-- scripts/test-database.mjs; it must never become a production seed script.
insert into auth.users(id,email) values
  ('10000000-0000-4000-8000-000000000011','readiness-a@neighborwalk.test'),
  ('10000000-0000-4000-8000-000000000012','readiness-b@neighborwalk.test'),
  ('10000000-0000-4000-8000-000000000013','readiness-volunteer@neighborwalk.test');
insert into public.churches(id,name,created_by) values
  ('10000000-0000-4000-8000-000000000001','Readiness Church A','10000000-0000-4000-8000-000000000011'),
  ('10000000-0000-4000-8000-000000000002','Readiness Church B','10000000-0000-4000-8000-000000000012');
insert into public.church_memberships(church_id,user_id,role,active,display_name) values
  ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','leader',true,'Leader A'),
  ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000012','leader',true,'Leader B'),
  ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000013','volunteer',true,'Volunteer A');
insert into public.outreach_outings(church_id,id,name,starts_at,ends_at)
select '10000000-0000-4000-8000-000000000001','outing_'||lpad(i::text,4,'0'),'Fictional outing',now(),now()+interval '1 hour'
from generate_series(1,1001) i;
insert into public.outreach_outings(church_id,id,name,starts_at,ends_at)
values ('10000000-0000-4000-8000-000000000002','private-b','Other church outing',now(),now()+interval '1 hour');

select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $$ declare first_count integer; next_count integer; cursor_id text; tab text; begin
  if has_table_privilege('authenticated','public.workspace_snapshots','UPDATE') then raise exception 'Legacy snapshot replacement remains possible'; end if;
  foreach tab in array array['outreach_outings','outreach_teams','outreach_locations','outreach_encounters','outreach_tasks','outreach_task_activity','outreach_restrictions','outreach_audit','discipleship_people','discipleship_person_notes'] loop
    if has_table_privilege('authenticated','public.'||tab,'INSERT,UPDATE,DELETE') then raise exception 'Direct browser writes are still allowed on %',tab; end if;
  end loop;
  if exists(select 1 from public.outreach_outings where church_id='10000000-0000-4000-8000-000000000002') then raise exception 'Cross-church table read was allowed'; end if;
  begin
    perform public.outreach_workspace_info('10000000-0000-4000-8000-000000000002');
    raise exception 'Cross-church info read was allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.outreach_read_records('10000000-0000-4000-8000-000000000002','event');
    raise exception 'Cross-church record read was allowed';
  exception when insufficient_privilege then null; end;
  select count(*),max(id) into first_count,cursor_id from public.outreach_read_records('10000000-0000-4000-8000-000000000001','event','',999999);
  select count(*) into next_count from public.outreach_read_records('10000000-0000-4000-8000-000000000001','event',cursor_id,750);
  if first_count <> 750 or next_count <> 251 then raise exception 'Keyset pagination truncated or duplicated rows: % + %',first_count,next_count; end if;
end $$;
-- Treat an unexpected success as failure; never swallow our own assertion.
create function pg_temp.expect_denied(command jsonb, expected_state text) returns void language plpgsql as $$
declare denied boolean := false;
begin
  begin perform public.outreach_apply_command(command);
  exception when others then
    if sqlstate <> expected_state then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'Expected denial % but command succeeded',expected_state; end if;
end $$;
create function pg_temp.command(command_id text, operations jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id',command_id,'churchId','10000000-0000-4000-8000-000000000001','schemaVersion',1,'operations',operations);
$$;
do $$ declare command jsonb; first_result jsonb; visit jsonb; begin
  command := pg_temp.command('create-location','[{"entityType":"property","entityId":"location-a","operation":"upsert","expectedVersion":0,"record":{"address":"100 Fictional Lane","source":"manual"}}]');
  first_result := public.outreach_apply_command(command);
  if public.outreach_apply_command(command) <> first_result then raise exception 'Retry did not return the original receipt'; end if;
  if (select version from public.outreach_locations where id='location-a') <> 1 then raise exception 'Duplicate retry changed the record'; end if;
  if (select count(*) from public.outreach_audit where command_id='create-location') <> 1 then raise exception 'Duplicate audit on retry'; end if;
  perform pg_temp.expect_denied(jsonb_set(command,'{operations,0,record,address}','"Other address"'),'PT409');
  perform pg_temp.expect_denied(jsonb_set(command,'{id}','"stale-create"'),'PT409');
  perform pg_temp.expect_denied(command || '{"userId":"10000000-0000-4000-8000-000000000012"}','42501');
  perform pg_temp.expect_denied(command || '{"churchId":"10000000-0000-4000-8000-000000000002"}','42501');
  perform pg_temp.expect_denied(command - 'schemaVersion','22023');
  perform pg_temp.expect_denied(pg_temp.command('missing-operation','[{"entityType":"property","entityId":"invalid","expectedVersion":0,"record":{"address":"No operation"}}]'),'22023');
  perform pg_temp.expect_denied(pg_temp.command('atomic-failure','[
    {"entityType":"property","entityId":"must-rollback","operation":"upsert","expectedVersion":0,"record":{"address":"Rolled back"}},
    {"entityType":"property","entityId":"invalid-second","operation":"upsert","expectedVersion":0,"record":{"address":""}}
  ]'),'22023');
  if exists(select 1 from public.outreach_locations where id='must-rollback') or exists(select 1 from public.outreach_audit where command_id='atomic-failure') then
    raise exception 'Partial command persisted after failure'; end if;
  visit := jsonb_build_object('entityType','visit','entityId','restricted-visit','operation','upsert','expectedVersion',0,'record',
    jsonb_build_object('propertyId','location-a','outcome','do_not_visit','recordedAt',now(),'deviceId','fictional-device','volunteerId','spoofed-actor'));
  first_result := public.outreach_apply_command(pg_temp.command('restriction-and-task',jsonb_build_array(visit) || '[
    {"entityType":"follow_up","entityId":"restricted-task","operation":"upsert","expectedVersion":0,"record":{"propertyId":"location-a","dueAt":"2026-10-01","status":"scheduled"}}
  ]'));
  if (select actor_id from public.outreach_encounters where id='restricted-visit') <> auth.uid() then raise exception 'Client spoofed encounter actor'; end if;
  if (select status from public.outreach_tasks where id='restricted-task') <> 'cancelled' or jsonb_array_length(first_result->'warnings') <> 1 then raise exception 'Restriction did not win atomically'; end if;
  perform public.outreach_apply_command(pg_temp.command('person-without-address','[
    {"entityType":"resident","entityId":"address-optional","operation":"upsert","expectedVersion":0,"record":{"name":"Fictional Neighbor","preferredContact":"none"}}
  ]'));
  if (select property_id from public.discipleship_people where id='address-optional') is not null then raise exception 'Address-free person required fabricated location'; end if;
end $$;
do $$ declare event_record jsonb; begin
  event_record := '{"name":"Fictional reusable outing","startsAt":"2026-09-12T14:00:00Z","endsAt":"2026-09-12T16:00:00Z","timezone":"America/Chicago","status":"draft"}';
  perform public.outreach_apply_command(pg_temp.command('plan-outing',jsonb_build_array(
    jsonb_build_object('entityType','event','entityId','workflow-outing','operation','upsert','expectedVersion',0,'record',event_record),
    '{"entityType":"territory","entityId":"list-only","operation":"upsert","expectedVersion":0,"record":{"name":"Fictional address list","kind":"list","boundary":[],"color":"#286c59"}}'::jsonb,
    '{"entityType":"assignment","entityId":"assigned-area","operation":"upsert","expectedVersion":0,"record":{"eventId":"workflow-outing","territoryId":"list-only","assignedVolunteerId":"volunteer_10000000000040008000000000000013","status":"assigned"}}'::jsonb
  )));
  if not exists(select 1 from public.outreach_territories where id='list-only' and kind='list' and longitude is null and latitude is null and boundary='[]') then
    raise exception 'List fabricated map geometry'; end if;
  perform pg_temp.expect_denied(pg_temp.command('premature-ready',jsonb_build_array(jsonb_build_object(
    'entityType','event','entityId','workflow-outing','operation','upsert','expectedVersion',1,'record',event_record || '{"status":"ready"}'
  ))),'22023');
  event_record := event_record || '{"status":"ready","purpose":"Listen and follow through","meetingPoint":"Fictional welcome table","leaderContact":"Leader at welcome table"}';
  perform public.outreach_apply_command(pg_temp.command('prepared-ready',jsonb_build_array(jsonb_build_object(
    'entityType','event','entityId','workflow-outing','operation','upsert','expectedVersion',1,'record',event_record
  ))));
  perform pg_temp.expect_denied(pg_temp.command('duplicate-assignment','[
    {"entityType":"assignment","entityId":"overlap","operation":"upsert","expectedVersion":0,"record":{"eventId":"workflow-outing","territoryId":"list-only","assignedVolunteerId":"volunteer_10000000000040008000000000000011","status":"assigned"}}
  ]'),'23505');
  perform pg_temp.expect_denied(pg_temp.command('invalid-boundary','[
    {"entityType":"territory","entityId":"bad-boundary","operation":"upsert","expectedVersion":0,"record":{"name":"Invalid boundary","kind":"map","center":[0,0],"color":"#286c59","boundary":[[null,0],[1,1],[2,2]]}}
  ]'),'22023');
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000013","role":"authenticated","is_anonymous":false}',true);
do $$ begin
  perform pg_temp.expect_denied(pg_temp.command('volunteer-outing','[{"entityType":"event","entityId":"unauthorized","operation":"upsert","expectedVersion":0,"record":{}}]'),'42501');
  perform public.outreach_apply_command(pg_temp.command('accept-own-area','[
    {"entityType":"assignment","entityId":"assigned-area","operation":"upsert","expectedVersion":1,"record":{"eventId":"workflow-outing","territoryId":"list-only","assignedVolunteerId":"volunteer_10000000000040008000000000000013","status":"accepted"}}
  ]'));
  perform pg_temp.expect_denied(pg_temp.command('change-own-area-owner','[
    {"entityType":"assignment","entityId":"assigned-area","operation":"upsert","expectedVersion":2,"record":{"eventId":"workflow-outing","territoryId":"list-only","assignedVolunteerId":"volunteer_10000000000040008000000000000011","status":"accepted"}}
  ]'),'42501');
  perform pg_temp.expect_denied(pg_temp.command('volunteer-person','[{"entityType":"resident","entityId":"address-optional","operation":"delete","expectedVersion":1}]'),'42501');
  perform pg_temp.expect_denied(pg_temp.command('volunteer-note','[{"entityType":"person_note","entityId":"unauthorized-note","operation":"upsert","expectedVersion":0,"record":{"residentId":"address-optional","kind":"general","body":"Must not save"}}]'),'42501');
  if exists(select 1 from public.discipleship_people where id='address-optional') then raise exception 'Unshared person leaked to volunteer'; end if;
  perform public.outreach_apply_command(pg_temp.command('volunteer-care','[
    {"entityType":"resident","entityId":"handoff-person","operation":"upsert","expectedVersion":0,"record":{"name":"Fictional Care Handoff","preferredContact":"none"}},
    {"entityType":"follow_up","entityId":"handoff-task","operation":"upsert","expectedVersion":0,"record":{"residentId":"handoff-person","dueAt":"2026-10-02","status":"scheduled"}}
  ]'));
  perform public.outreach_apply_command(pg_temp.command('request-handoff','[
    {"entityType":"handoff","entityId":"handoff-person","operation":"upsert","expectedVersion":1,"record":{"action":"request","assignedVolunteerId":"volunteer_10000000000040008000000000000011"}}
  ]'));
  if (select assigned_to from public.discipleship_people where id='handoff-person') <> auth.uid() then raise exception 'Ownership changed before acceptance'; end if;
  perform pg_temp.expect_denied(pg_temp.command('self-accept-handoff','[
    {"entityType":"handoff","entityId":"handoff-person","operation":"upsert","expectedVersion":2,"record":{"action":"accept"}}
  ]'),'42501');
  perform pg_temp.expect_denied(pg_temp.command('volunteer-lift-restriction','[
    {"entityType":"restriction","entityId":"restriction_restricted-visit","operation":"upsert","expectedVersion":1,"record":{"active":false,"correctionReason":"Not authorized"}}
  ]'),'42501');
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated","is_anonymous":false}',true);
do $$ begin
  perform public.outreach_apply_command(pg_temp.command('accept-handoff','[
    {"entityType":"handoff","entityId":"handoff-person","operation":"upsert","expectedVersion":2,"record":{"action":"accept"}}
  ]'));
  if (select owner_id from public.outreach_tasks where id='handoff-task') <> auth.uid() then raise exception 'Open task did not transfer with care'; end if;
  if not exists(select 1 from public.outreach_task_activity where task_id='handoff-task' and action='reassigned') then raise exception 'Handoff task history missing'; end if;
  perform public.outreach_apply_command(pg_temp.command('correct-restriction','[
    {"entityType":"restriction","entityId":"restriction_restricted-visit","operation":"upsert","expectedVersion":1,"record":{"active":false,"correctionReason":"Neighbor explicitly requested another visit"}}
  ]'));
  if (select active from public.outreach_restrictions where id='restriction_restricted-visit') then raise exception 'Reviewed correction did not lift restriction'; end if;
  if (select status from public.outreach_tasks where id='restricted-task') <> 'cancelled' then raise exception 'Correction resurrected a historical task'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000013","role":"authenticated","is_anonymous":false}',true);
do $$ begin
  if exists(select 1 from public.discipleship_people where id='handoff-person') then raise exception 'Former creator retained implicit access after accepted handoff'; end if;
  if exists(select 1 from public.outreach_tasks where id='handoff-task') then raise exception 'Former owner retained implicit task access'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated","is_anonymous":false}',true);
do $$ begin
  perform public.outreach_apply_command(pg_temp.command('community-encounter','[
    {"entityType":"visit","entityId":"community-anonymous","operation":"upsert","expectedVersion":0,"record":{"context":"community_meal","outcome":"conversation","recordedAt":"2026-09-10T01:00:00Z","deviceId":"test-device"}}
  ]'));
  if not exists(select 1 from public.outreach_encounters where id='community-anonymous' and location_id is null and person_id is null and context='community_meal') then raise exception 'Anonymous community encounter required manufactured records'; end if;
  perform pg_temp.expect_denied(pg_temp.command('unnamed-new-person','[
    {"entityType":"resident","entityId":"unnamed-new","operation":"upsert","expectedVersion":0,"record":{"preferredContact":"none"}}
  ]'),'22023');
  perform pg_temp.expect_denied(pg_temp.command('locationless-door','[
    {"entityType":"visit","entityId":"missing-door","operation":"upsert","expectedVersion":0,"record":{"context":"door","outcome":"no_answer","recordedAt":"2026-09-10T01:00:00Z","deviceId":"test-device"}}
  ]'),'22023');
  perform pg_temp.expect_denied(pg_temp.command('misplaced-private-note','[
    {"entityType":"visit","entityId":"misplaced-note","operation":"upsert","expectedVersion":0,"record":{"context":"referral","residentId":"handoff-person","outcome":"conversation","objectiveNote":"Private care detail","recordedAt":"2026-09-10T01:00:00Z","deviceId":"test-device"}}
  ]'),'22023');
  perform public.outreach_apply_command(pg_temp.command('no-contact-person','[
    {"entityType":"resident","entityId":"no-contact-person","operation":"upsert","expectedVersion":0,"record":{"name":"Fictional No Contact","preferredContact":"none","contactPermission":"do_not_contact"}},
    {"entityType":"follow_up","entityId":"no-contact-task","operation":"upsert","expectedVersion":0,"record":{"residentId":"no-contact-person","dueAt":"2026-10-02","channel":"email","status":"scheduled"}}
  ]'));
  if (select status from public.outreach_tasks where id='no-contact-task')<>'cancelled' then raise exception 'All-contact restriction missed a task'; end if;
  perform public.outreach_apply_command(pg_temp.command('review-person-correction','[
    {"entityType":"restriction","entityId":"restriction_no-contact-person_1","operation":"upsert","expectedVersion":1,"record":{"active":false,"correctionReason":"Fictional neighbor explicitly corrected their request"}}
  ]'));
  if (select contact_permission from public.discipleship_people where id='no-contact-person')<>'not_recorded' then raise exception 'Corrected restriction left contradictory profile state'; end if;
  if (select status from public.outreach_tasks where id='no-contact-task')<>'cancelled' then raise exception 'Restriction correction reopened a cancelled task'; end if;
  perform public.outreach_apply_command(pg_temp.command('email-only-restriction','[
    {"entityType":"follow_up","entityId":"call-allowed-task","operation":"upsert","expectedVersion":0,"record":{"residentId":"no-contact-person","dueAt":"2026-10-02","channel":"call","status":"scheduled"}},
    {"entityType":"follow_up","entityId":"email-blocked-task","operation":"upsert","expectedVersion":0,"record":{"residentId":"no-contact-person","dueAt":"2026-10-02","channel":"email","status":"scheduled"}},
    {"entityType":"restriction","entityId":"email-only","operation":"upsert","expectedVersion":0,"record":{"residentId":"no-contact-person","channel":"email","active":true,"reason":"Fictional neighbor requested no email"}}
  ]'));
  if (select status from public.outreach_tasks where id='call-allowed-task')<>'scheduled' or (select status from public.outreach_tasks where id='email-blocked-task')<>'cancelled' then raise exception 'Channel restriction applied to the wrong tasks'; end if;
end $$;
reset role;
rollback;
select 'PASS: tenant/role denials, complete pagination, idempotent receipts, atomic rollback, authoritative actors, address-optional people and restriction precedence' as result;
