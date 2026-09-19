\set ON_ERROR_STOP on
begin;
-- Synthetic identities and data, never a production seed. Everything rolls back.
insert into auth.users(id,email) values
 ('80000000-0000-4000-8000-000000000011','session-leader@neighborwalk.test'),
 ('80000000-0000-4000-8000-000000000012','session-other@neighborwalk.test');
insert into auth.sessions(id,user_id,not_after) values
 ('80000000-0000-4000-8000-000000000021','80000000-0000-4000-8000-000000000011',null),
 ('80000000-0000-4000-8000-000000000022','80000000-0000-4000-8000-000000000012',null),
 ('80000000-0000-4000-8000-000000000023','80000000-0000-4000-8000-000000000011',now()-interval '1 second');
insert into public.churches(id,name,created_by) values
 ('80000000-0000-4000-8000-000000000001','Fictional Session Church','80000000-0000-4000-8000-000000000011');
insert into public.church_memberships(church_id,user_id,role,active) values
 ('80000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000011','leader',true);
insert into public.outreach_locations(church_id,id,address) values
 ('80000000-0000-4000-8000-000000000001','session-location','Fictional session location');
insert into public.conversation_guides(id,church_id,scope,title,steps,created_by,updated_by) values
 ('80000000-0000-4000-8000-000000000031','80000000-0000-4000-8000-000000000001','church','Fictional session guide','[{"id":"first","title":"Listen"}]',
 '80000000-0000-4000-8000-000000000011','80000000-0000-4000-8000-000000000011');
create function pg_temp.session_claims(session_key text) returns text language sql as $$
 select jsonb_build_object('sub','80000000-0000-4000-8000-000000000011','role','authenticated','is_anonymous',false,'session_id',session_key)::text;
$$;
create function pg_temp.session_command() returns jsonb language sql as $$
 select '{"schemaVersion":1,"id":"session-command","churchId":"80000000-0000-4000-8000-000000000001","operations":[
  {"entityType":"visit","entityId":"session-encounter","operation":"upsert","expectedVersion":0,"record":{"context":"community_meal","outcome":"conversation","objectiveNote":"Fictional preserved encounter","recordedAt":"2026-09-10T10:00:00Z","deviceId":"session-fixture"}}
 ]}'::jsonb;
$$;
create function pg_temp.assert_session_denied() returns void language plpgsql as $$
declare table_name text; visible bigint;
begin
 if private.is_real_user() or private.is_church_member('80000000-0000-4000-8000-000000000001')
   or private.is_church_leader('80000000-0000-4000-8000-000000000001') or private.has_active_membership() then
   raise exception 'Invalid session passed a shared authorization guard';
 end if;
 if exists(select 1 from public.churches where id='80000000-0000-4000-8000-000000000001') then raise exception 'Former creator read church'; end if;
 foreach table_name in array array['church_memberships','outreach_locations','outreach_encounters','outreach_tasks','outreach_audit','conversation_guides','conversation_guide_preferences','discipleship_people','discipleship_person_notes'] loop
   execute format('select count(*) from public.%I where church_id=$1',table_name) into visible using '80000000-0000-4000-8000-000000000001'::uuid;
   if visible<>0 then raise exception 'Invalid session read protected table %',table_name; end if;
 end loop;
 begin perform public.outreach_workspace_info('80000000-0000-4000-8000-000000000001'); raise exception 'Revoked session read workspace'; exception when insufficient_privilege then null; end;
 begin perform public.outreach_read_records('80000000-0000-4000-8000-000000000001','property'); raise exception 'Revoked session read page'; exception when insufficient_privilege then null; end;
 begin perform public.outreach_apply_command(pg_temp.session_command()); raise exception 'Revoked session replayed receipt'; exception when insufficient_privilege then null; end;
 begin perform public.outreach_reminder_preference('80000000-0000-4000-8000-000000000001',true); raise exception 'Revoked session changed reminder preference'; exception when insufficient_privilege then null; end;
end;
$$;
set local role authenticated;
do $$ declare invalid_key text; result jsonb; begin
 perform set_config('request.jwt.claims',pg_temp.session_claims('80000000-0000-4000-8000-000000000021'),true);
 if not private.is_real_user() or not exists(select 1 from public.conversation_guides where id='80000000-0000-4000-8000-000000000031') then raise exception 'Live session cannot read permitted guide'; end if;
 result:=public.outreach_apply_command(pg_temp.session_command());
 if result<>public.outreach_apply_command(pg_temp.session_command()) then raise exception 'Live-session receipt is not idempotent'; end if;
 begin perform 1 from auth.sessions; raise exception 'Interactive role can inspect private auth sessions'; exception when insufficient_privilege then null; end;
 foreach invalid_key in array array[null,'','invalid','80000000-0000-4000-8000-000000000022','80000000-0000-4000-8000-000000000023','80000000-0000-4000-8000-000000000099'] loop
   perform set_config('request.jwt.claims',pg_temp.session_claims(invalid_key),true);
   perform pg_temp.assert_session_denied();
 end loop;
 perform set_config('request.jwt.claims',(pg_temp.session_claims('80000000-0000-4000-8000-000000000021')::jsonb||'{"is_anonymous":true}')::text,true);
 perform pg_temp.assert_session_denied();
end $$;
reset role;
delete from auth.sessions where id='80000000-0000-4000-8000-000000000021';
set local role authenticated;
do $$ begin
 perform set_config('request.jwt.claims',pg_temp.session_claims('80000000-0000-4000-8000-000000000021'),true);
 perform pg_temp.assert_session_denied();
end $$;
reset role;
-- A new sign-in restores ordinary access, but not suspended membership.
insert into auth.sessions(id,user_id) values('80000000-0000-4000-8000-000000000021','80000000-0000-4000-8000-000000000011');
update public.church_memberships set active=false where church_id='80000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 if not private.is_real_user() or private.has_active_membership() or exists(select 1 from public.churches where id='80000000-0000-4000-8000-000000000001') then raise exception 'Suspended creator retained church access'; end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.outreach_encounters where church_id='80000000-0000-4000-8000-000000000001' and objective_note='Fictional preserved encounter')<>1 then raise exception 'Revocation deleted or duplicated a record'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='is_real_user' and (not p.prosecdef or not p.proconfig @> array['search_path=""'])) then raise exception 'Session helper lacks its pinned security boundary'; end if;
 if has_function_privilege('anon','private.is_real_user()','execute') then raise exception 'Anonymous role can call session helper'; end if;
end $$;
rollback;
select 'PASS: real-session guard, missing/malformed/mismatched/expired/anonymous/revoked sessions, RLS and RPC denials, preserved records and suspended creator' as result;
