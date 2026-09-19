\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('91000000-0000-4000-8000-000000000011','outing-roster-leader@neighborwalk.test'),
  ('91000000-0000-4000-8000-000000000012','outing-roster-a@neighborwalk.test'),
  ('91000000-0000-4000-8000-000000000013','outing-roster-b@neighborwalk.test');
insert into auth.sessions(id,user_id,created_at,updated_at)
select id,id,now(),now() from auth.users where id::text like '91000000-%';
insert into public.churches(id,name,created_by) values
  ('91000000-0000-4000-8000-000000000001','Fictional Outing Roster Church','91000000-0000-4000-8000-000000000011');
insert into public.church_memberships(church_id,user_id,role,active,display_name) values
  ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000011','leader',true,'Roster Leader'),
  ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000012','volunteer',true,'Invited Walker'),
  ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000013','volunteer',true,'Other Walker');
insert into public.outreach_outings(church_id,id,name,starts_at,ends_at,timezone,status)
values('91000000-0000-4000-8000-000000000001','outing-roster','Fictional roster walk','2026-09-20T14:00:00Z','2026-09-20T16:00:00Z','America/Chicago','ready');

create function pg_temp.claims(target_user uuid) returns text language sql as $$
  select jsonb_build_object('sub',target_user,'session_id',target_user,'role','authenticated','is_anonymous',false)::text;
$$;
create function pg_temp.command(command_id text,operations jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id',command_id,'churchId','91000000-0000-4000-8000-000000000001','schemaVersion',1,'operations',operations);
$$;
create function pg_temp.participant_op(participant_key text,volunteer_key text,next_status text,expected bigint) returns jsonb language sql as $$
  select jsonb_build_object('entityType','participant','entityId',participant_key,'operation','upsert','expectedVersion',expected,'record',jsonb_build_object(
    'eventId','outing-roster','volunteerId',volunteer_key,'status',next_status));
$$;
create function pg_temp.expect_denied(command jsonb,expected_state text) returns void language plpgsql as $$
declare denied boolean:=false;
begin
  begin perform public.outreach_apply_command(command);
  exception when others then if sqlstate<>expected_state then raise; end if; denied:=true; end;
  if not denied then raise exception 'Expected denial % but command succeeded',expected_state; end if;
end $$;

select set_config('request.jwt.claims',pg_temp.claims('91000000-0000-4000-8000-000000000011'),true);
set local role authenticated;
select public.outreach_apply_command(pg_temp.command('invite-before-crews',jsonb_build_array(
  pg_temp.participant_op('participant-a','volunteer_91000000000040008000000000000012','invited',0),
  pg_temp.participant_op('participant-b','volunteer_91000000000040008000000000000013','invited',0))));
do $$ begin
  if (select count(*) from public.outreach_outing_participants where outing_id='outing-roster' and status='invited')<>2 then
    raise exception 'Advance outing roster was not saved independently'; end if;
  if exists(select 1 from public.outreach_assignments where outing_id='outing-roster') then
    raise exception 'Invitations fabricated target assignments'; end if;
  if (select count(*) from public.outreach_read_records('91000000-0000-4000-8000-000000000001','participant'))<>2 then
    raise exception 'Leader could not read the outing roster'; end if;
end $$;

reset role;
select set_config('request.jwt.claims',pg_temp.claims('91000000-0000-4000-8000-000000000012'),true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.outreach_read_records('91000000-0000-4000-8000-000000000001','participant'))<>1 then
    raise exception 'A volunteer did not receive exactly their own invitation'; end if;
  perform public.outreach_apply_command(pg_temp.command('respond-going',jsonb_build_array(
    pg_temp.participant_op('participant-a','volunteer_91000000000040008000000000000012','going',1))));
  perform pg_temp.expect_denied(pg_temp.command('respond-for-someone-else',jsonb_build_array(
    pg_temp.participant_op('participant-b','volunteer_91000000000040008000000000000013','not_going',1))),'42501');
end $$;

reset role;
select set_config('request.jwt.claims',pg_temp.claims('91000000-0000-4000-8000-000000000011'),true);
set local role authenticated;
select public.outreach_apply_command(pg_temp.command('check-in-walker',jsonb_build_array(
  pg_temp.participant_op('participant-a','volunteer_91000000000040008000000000000012','checked_in',2))));
do $$ begin
  if (select status from public.outreach_outing_participants where id='participant-a')<>'checked_in' then raise exception 'Leader check-in did not persist'; end if;
  perform pg_temp.expect_denied(pg_temp.command('remove-checked-in-walker',jsonb_build_array(
    jsonb_build_object('entityType','participant','entityId','participant-a','operation','delete','expectedVersion',3))),'22023');
  begin
    update public.outreach_outing_participants set status='not_going' where id='participant-a';
    raise exception 'Direct participant write was allowed';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
rollback;
select 'PASS: outing invitations are personal, visible before target crews, independently acknowledged, leader-managed at check-in, and command-only' as result;
