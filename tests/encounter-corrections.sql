\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('70000000-0000-4000-8000-000000000011','correction-leader@neighborwalk.test'),
 ('70000000-0000-4000-8000-000000000012','correction-volunteer@neighborwalk.test');
insert into auth.sessions(id,user_id,created_at,updated_at) values('70000000-0000-4000-8000-000000000021','70000000-0000-4000-8000-000000000011',now(),now());
-- Live, fictional sessions for interactive JWT fixtures; all are rolled back.
insert into auth.sessions(id,user_id,created_at,updated_at)
 select id,id,now(),now() from auth.users where id::text like '70000000-%';
insert into public.churches(id,name,created_by) values('70000000-0000-4000-8000-000000000001','Fictional Correction Church','70000000-0000-4000-8000-000000000011');
insert into public.church_memberships(church_id,user_id,role,active) values
 ('70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000011','leader',true),
 ('70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000012','volunteer',true);
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-000000000011","session_id":"70000000-0000-4000-8000-000000000011","role":"authenticated","is_anonymous":false}',true);
insert into public.outreach_locations(church_id,id,address) values('70000000-0000-4000-8000-000000000001','correction-place','123 Fictional Correction Road');
insert into public.discipleship_people(id,church_id,property_id,name,faith_status,discipleship_stage,status,preferred_contact) values
 ('correction-person','70000000-0000-4000-8000-000000000001','correction-place','Fictional Private Correction Person','not_discussed','new_connection','active','none');
insert into public.outreach_encounters(church_id,id,person_id,location_id,actor_key,outcome,context,objective_note,occurred_at,device_id) values
 ('70000000-0000-4000-8000-000000000001','correction-encounter','correction-person','correction-place','fictional-original','conversation','door',null,'2026-01-01T12:00:00Z','fictional-original-device'),
 ('70000000-0000-4000-8000-000000000001','correction-anonymous',null,null,'fictional-original','conversation','community_meal','Fictional shared original','2026-01-01T12:00:00Z','fictional-original-device'),
 ('70000000-0000-4000-8000-000000000001','correction-restricted',null,'correction-place','fictional-original','do_not_visit','door',null,'2026-01-01T12:00:00Z','fictional-original-device');
insert into public.outreach_tasks(church_id,id,encounter_id,person_id,location_id,owner_id,due_date,status,channel) values
 ('70000000-0000-4000-8000-000000000001','correction-task','correction-encounter','correction-person','correction-place','70000000-0000-4000-8000-000000000011',current_date,'scheduled','other');
insert into public.outreach_restrictions(church_id,id,location_id,channel,reason) values
 ('70000000-0000-4000-8000-000000000001','correction-restriction','correction-place','visit','Fictional no-visit request');
create temp table correction_originals(kind text,record jsonb);
insert into correction_originals select 'encounter',to_jsonb(e)-'version'-'corrections' from public.outreach_encounters e where church_id='70000000-0000-4000-8000-000000000001';
insert into correction_originals select 'task',to_jsonb(t) from public.outreach_tasks t where id='correction-task';
insert into correction_originals select 'restriction',to_jsonb(r) from public.outreach_restrictions r where id='correction-restriction';
grant select on correction_originals to authenticated;
create function pg_temp.correction_claims(age integer default 0) returns text language sql as $$
 select jsonb_build_object('sub','70000000-0000-4000-8000-000000000011','role','authenticated','is_anonymous',false,
  'session_id','70000000-0000-4000-8000-000000000021','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())-age)))::text;
$$;
create function pg_temp.correction_request(record_id text,request_id text) returns jsonb language sql as $$
 select jsonb_build_object('schemaVersion',1,'id',request_id,'churchId','70000000-0000-4000-8000-000000000001','action','encounter_correct',
  'encounterId',record_id,'expectedRevision',(select outreach_revision from public.churches where id='70000000-0000-4000-8000-000000000001'),
  'expectedVersion',(select version from public.outreach_encounters where id=record_id),'outcome','follow_up','context','service','voided',false,
  'reason','Fictional factual correction','confirmation','KEEP ORIGINAL AND RESPONSIBILITIES');
$$;
create function pg_temp.correction_denied(request jsonb,expected text) returns void language plpgsql as $$
declare denied boolean:=false; begin
 begin perform public.outreach_admin_action(request); exception when others then if sqlstate<>expected then raise; end if; denied:=true; end;
 if not denied then raise exception 'Correction unexpectedly succeeded'; end if;
end $$;
select set_config('request.jwt.claims',pg_temp.correction_claims(),true);
set local role authenticated;
do $$ declare request jsonb; result jsonb; begin
 request:=pg_temp.correction_request('correction-encounter','correct-once');
 perform pg_temp.correction_denied(request||'{"expectedVersion":999}','PT409');
 perform pg_temp.correction_denied(request||'{"expectedRevision":999}','PT409');
 perform pg_temp.correction_denied(request||'{"confirmation":""}','22023');
 perform pg_temp.correction_denied(request||'{"reason":" "}','22023');
 perform pg_temp.correction_denied(request||'{"voided":"true"}','22023');
 perform pg_temp.correction_denied(request||'{"personId":"someone-else"}','22023');
 perform pg_temp.correction_denied(request||'{"outcome":"unvisited"}','22023');
 perform pg_temp.correction_denied(request||'{"outcome":"do_not_visit"}','22023');
 perform pg_temp.correction_denied(request||'{"outcome":"conversation","context":"door"}','22023');
 perform pg_temp.correction_denied(request||'{"churchId":"70000000-0000-4000-8000-000000000099"}','42501');
 perform set_config('request.jwt.claims',pg_temp.correction_claims(1800),true);
 perform pg_temp.correction_denied(request,'42501');
 perform set_config('request.jwt.claims',pg_temp.correction_claims(),true);
 result:=public.outreach_admin_action(request);
 if result<>public.outreach_admin_action(request) then raise exception 'Correction receipt changed on retry'; end if;
 if (select jsonb_array_length(corrections) from public.outreach_encounters where id='correction-encounter')<>1 then raise exception 'Retry duplicated correction'; end if;
 perform pg_temp.correction_denied(request||'{"reason":"Changed immutable payload"}','PT409');
 if not exists(select 1 from public.outreach_encounters where id='correction-encounter' and corrections#>>'{0,actorId}'=private.volunteer_id_for_user(auth.uid()) and corrections#>>'{0,createdAt}' is not null and version=2) then raise exception 'Correction attribution/version missing'; end if;
 perform public.outreach_admin_action(pg_temp.correction_request('correction-encounter','void-reviewed')||'{"voided":true}');
 perform public.outreach_admin_action(pg_temp.correction_request('correction-encounter','restore-reviewed'));
 if (select jsonb_array_length(corrections) from public.outreach_encounters where id='correction-encounter')<>3 then raise exception 'Correction chain was replaced'; end if;
 perform pg_temp.correction_denied(pg_temp.correction_request('correction-anonymous','anonymous-door')||'{"context":"door"}','22023');
 perform pg_temp.correction_denied(pg_temp.correction_request('correction-anonymous','anonymous-no-answer')||'{"outcome":"no_answer"}','22023');
 perform public.outreach_admin_action(pg_temp.correction_request('correction-anonymous','anonymous-correction'));
 perform public.outreach_admin_action(pg_temp.correction_request('correction-restricted','restricted-correction')||'{"outcome":"conversation","context":"door"}');
 if (select count(*) from public.outreach_audit where church_id='70000000-0000-4000-8000-000000000001' and action='visit.corrected')<>5 then raise exception 'Correction audit missing or duplicated'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-000000000012","session_id":"70000000-0000-4000-8000-000000000012","role":"authenticated","is_anonymous":false}',true);
do $$ begin
 perform pg_temp.correction_denied(pg_temp.correction_request('correction-anonymous','volunteer-correct'),'42501');
 if exists(select 1 from public.outreach_encounters where id='correction-encounter') then raise exception 'Private correction leaked'; end if;
 if not exists(select 1 from public.outreach_encounters where id='correction-anonymous' and jsonb_array_length(corrections)=1) then raise exception 'Permitted anonymous correction unavailable'; end if;
 begin update public.outreach_encounters set corrections='[]' where id='correction-anonymous'; raise exception 'Direct correction overwrite allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if exists(select 1 from correction_originals o where o.kind='encounter' and not exists(select 1 from public.outreach_encounters e where to_jsonb(e)-'version'-'corrections'=o.record)) then raise exception 'Original encounter changed'; end if;
 if not exists(select 1 from public.outreach_tasks t,correction_originals o where o.kind='task' and to_jsonb(t)=o.record) then raise exception 'Task changed during correction'; end if;
 if not exists(select 1 from public.outreach_restrictions r,correction_originals o where o.kind='restriction' and to_jsonb(r)=o.record) then raise exception 'Restriction changed during correction'; end if;
end $$;
delete from auth.sessions where id='70000000-0000-4000-8000-000000000021';
select set_config('request.jwt.claims',pg_temp.correction_claims(),true);
set local role authenticated;
do $$ begin perform pg_temp.correction_denied(pg_temp.correction_request('correction-anonymous','revoked-correct'),'42501'); end $$;
reset role;
rollback;
select 'PASS: reasoned corrections, immutable originals and links, chain/retry, stale/role/tenant/session denials, private history, unchanged tasks and restrictions' as result;
