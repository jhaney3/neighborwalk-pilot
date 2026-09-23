-- This fragment runs inside scripts/rehearse-migration.mjs's isolated,
-- rolled-back transaction after every additive migration has been applied.
insert into auth.users(id,email) values
  ('93000000-0000-4000-8000-000000000011','push-a@neighborwalk.test'),
  ('93000000-0000-4000-8000-000000000012','push-b@neighborwalk.test');
insert into auth.sessions(id,user_id,created_at,updated_at) values
  ('93000000-0000-4000-8000-000000000111','93000000-0000-4000-8000-000000000011',now(),now()),
  ('93000000-0000-4000-8000-000000000112','93000000-0000-4000-8000-000000000012',now(),now());
insert into public.churches(id,name,created_by)
  values('93000000-0000-4000-8000-000000000001','Fictional Push Test Church','93000000-0000-4000-8000-000000000011');
insert into public.church_memberships(church_id,user_id,role,active,display_name) values
  ('93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000011','leader',true,'Push A'),
  ('93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000012','volunteer',true,'Push B');
insert into public.outreach_outings(church_id,id,name,starts_at,ends_at,status) values
  ('93000000-0000-4000-8000-000000000001','push-walk','Fictional Walk',now()+interval '1 day',now()+interval '1 day 1 hour','ready');

create function pg_temp.push_claims(target_user uuid,target_session uuid,is_anonymous boolean default false)
returns text language sql as $$
  select jsonb_build_object('sub',target_user,'session_id',target_session,'role','authenticated','is_anonymous',is_anonymous)::text;
$$;
create function pg_temp.expect_push_denied(statement text) returns void language plpgsql as $$
declare denied boolean:=false;
begin
  begin execute statement;
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Expected push API denial'; end if;
end $$;

select 'stage:push-auth-guards';
set local role anon;
select pg_temp.expect_push_denied($sql$select public.register_apns_device(
  '93000000-0000-4000-8000-000000000211','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','sandbox')$sql$);
reset role;

select set_config('request.jwt.claims',pg_temp.push_claims(
  '93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000111',true),true);
set local role authenticated;
select pg_temp.expect_push_denied($sql$select public.register_apns_device(
  '93000000-0000-4000-8000-000000000211','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','sandbox')$sql$);
reset role;

select 'stage:push-registration';
select set_config('request.jwt.claims',pg_temp.push_claims(
  '93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000111'),true);
set local role authenticated;
select public.register_apns_device(
  '93000000-0000-4000-8000-000000000211','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','sandbox');
select public.register_apns_device(
  '93000000-0000-4000-8000-000000000212','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','sandbox');
select pg_temp.expect_push_denied('select count(*) from private.apns_devices');
select pg_temp.expect_push_denied('select public.claim_apns_deliveries(1,60)');
reset role;

select set_config('request.jwt.claims',pg_temp.push_claims(
  '93000000-0000-4000-8000-000000000012','93000000-0000-4000-8000-000000000112'),true);
set local role authenticated;
select public.register_apns_device(
  '93000000-0000-4000-8000-000000000213','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','sandbox');
reset role;

select 'stage:push-events';
insert into public.outreach_outing_participants(church_id,id,outing_id,volunteer_id,user_id,status)
values('93000000-0000-4000-8000-000000000001','push-participant','push-walk','push-a',
  '93000000-0000-4000-8000-000000000011','invited');
-- An unrelated update is not a second invitation.
update public.outreach_outing_participants set version=version+1
  where church_id='93000000-0000-4000-8000-000000000001' and id='push-participant';
insert into public.outreach_tasks(church_id,id,owner_id,created_by,due_date,status,note)
values('93000000-0000-4000-8000-000000000001','push-follow-up',
  '93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000011',current_date+1,'scheduled',
  'PRIVATE TEST NOTE THAT MUST NEVER ENTER APNS');
select set_config('request.jwt.claims',pg_temp.push_claims(
  '93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000111'),true);
insert into public.outreach_tasks(church_id,id,owner_id,created_by,due_date,status)
values('93000000-0000-4000-8000-000000000001','push-self-created',
  '93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000011',current_date+1,'scheduled');
update public.outreach_tasks set owner_id='93000000-0000-4000-8000-000000000012',version=version+1
  where church_id='93000000-0000-4000-8000-000000000001' and id='push-follow-up';

do $$
begin
  if (select count(*) from private.apns_outbox)<>5 then
    raise exception 'Expected two invitation, two initial assignment, and one reassignment deliveries'; end if;
  if (select count(*) from private.apns_outbox where event_kind='follow_up_assignment'
      and recipient_user_id='93000000-0000-4000-8000-000000000011' and status='failed')<>2 then
    raise exception 'Reassignment did not cancel every former-owner delivery'; end if;
  if (select count(*) from private.apns_outbox where status in ('pending','retry','leased'))<>3 then
    raise exception 'Only current invitation and assignment deliveries should remain ready'; end if;
  if exists(select 1 from private.apns_outbox where app_path='/app/followups/push-self-created') then
    raise exception 'A self-created follow-up generated a redundant assignment alert'; end if;
  if exists(select 1 from private.apns_outbox where app_path not in (
    '/app/outreach/push-walk','/app/followups/push-follow-up')) then
    raise exception 'Unsafe APNs path was queued'; end if;
  if exists(select 1 from information_schema.columns where table_schema='private' and table_name='apns_outbox'
    and column_name in ('church_id','neighbor_id','neighbor_name','address','note','source_id','source_key')) then
    raise exception 'Sensitive outreach columns were added to the APNs outbox'; end if;
  if exists(select 1 from private.apns_outbox where event_fingerprint like '%push%' or source_fingerprint like '%push%') then
    raise exception 'Source identifiers were not hashed in the APNs outbox'; end if;
end $$;

-- Cancel/delete paths invalidate queued work instead of notifying about stale ownership.
insert into public.outreach_outing_participants(church_id,id,outing_id,volunteer_id,user_id,status)
values('93000000-0000-4000-8000-000000000001','push-declined','push-walk','push-a-declined',
  '93000000-0000-4000-8000-000000000011','invited');
update public.outreach_outing_participants set status='not_going',version=version+1
  where church_id='93000000-0000-4000-8000-000000000001' and id='push-declined';
insert into public.outreach_outing_participants(church_id,id,outing_id,volunteer_id,user_id,status)
values('93000000-0000-4000-8000-000000000001','push-deleted','push-walk','push-a-deleted',
  '93000000-0000-4000-8000-000000000011','invited');
delete from public.outreach_outing_participants
  where church_id='93000000-0000-4000-8000-000000000001' and id='push-deleted';
insert into public.outreach_outings(church_id,id,name,starts_at,ends_at,status) values
  ('93000000-0000-4000-8000-000000000001','push-cancelled-walk','Cancelled Walk',now()+interval '2 days',now()+interval '2 days 1 hour','ready');
insert into public.outreach_outing_participants(church_id,id,outing_id,volunteer_id,user_id,status)
values('93000000-0000-4000-8000-000000000001','push-cancelled-walk-participant','push-cancelled-walk','push-a-cancelled-walk',
  '93000000-0000-4000-8000-000000000011','invited');
update public.outreach_outings set status='cancelled'
  where church_id='93000000-0000-4000-8000-000000000001' and id='push-cancelled-walk';
select set_config('request.jwt.claims',pg_temp.push_claims(
  '93000000-0000-4000-8000-000000000012','93000000-0000-4000-8000-000000000112'),true);
insert into public.outreach_tasks(church_id,id,owner_id,created_by,due_date,status)
values('93000000-0000-4000-8000-000000000001','push-cancelled-follow-up',
  '93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000011',current_date+1,'scheduled');
update public.outreach_tasks set status='cancelled',version=version+1
  where church_id='93000000-0000-4000-8000-000000000001' and id='push-cancelled-follow-up';
insert into public.outreach_tasks(church_id,id,owner_id,created_by,due_date,status,acceptance)
values('93000000-0000-4000-8000-000000000001','push-declined-follow-up',
  '93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000011',current_date+1,'scheduled','pending');
select set_config('request.jwt.claims',pg_temp.push_claims(
  '93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000111'),true);
update public.outreach_tasks set acceptance='declined',version=version+1
  where church_id='93000000-0000-4000-8000-000000000001' and id='push-declined-follow-up';
do $$ begin
  if exists(select 1 from private.apns_outbox where app_path in (
      '/app/outreach/push-declined','/app/outreach/push-deleted','/app/followups/push-cancelled-follow-up',
      '/app/followups/push-declined-follow-up','/app/outreach/push-cancelled-walk')
      and status in ('pending','retry','leased')) then
    raise exception 'Declined, deleted, or cancelled source remained deliverable'; end if;
end $$;

select 'stage:push-worker';
create temporary table push_leases(
  outbox_id uuid,lease_token uuid,device_token text,apns_environment text,event_kind text,
  title text,body text,app_path text,apns_id uuid,attempt integer
) on commit drop;
grant all on push_leases to service_role;
set local role service_role;
insert into push_leases select * from public.claim_apns_deliveries(25,180);
select 'stage:push-worker-leased';
do $$
begin
  if (select count(*) from push_leases)<>3 then raise exception 'Worker leased stale or missed current delivery work'; end if;
  if exists(select 1 from push_leases where
    (event_kind='walk_invitation' and (title<>'Walk invitation' or body<>'You have a new walk invitation in NeighborWalk.'))
    or (event_kind='follow_up_assignment' and (title<>'New follow-up' or body<>'A follow-up was assigned to you in NeighborWalk.'))) then
    raise exception 'Worker returned non-generic notification copy'; end if;
end $$;
reset role;
select 'stage:push-worker-source-change';
-- Source changes after a lease revoke that lease; its stale worker cannot acknowledge.
update public.outreach_outing_participants set status='not_going',version=version+1
  where church_id='93000000-0000-4000-8000-000000000001' and id='push-participant';
set local role service_role;
do $$
begin
  if (select public.finish_apns_delivery(outbox_id,lease_token,'delivered','Delivered',null,apns_id)
      from push_leases where event_kind='walk_invitation' limit 1) then
    raise exception 'Source-cancelled worker lease was accepted'; end if;
end $$;
select 'stage:push-worker-stale-checked';
select public.finish_apns_delivery(outbox_id,lease_token,'invalid_token','Unregistered',null,apns_id)
  from push_leases where device_token='cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' limit 1;
reset role;
select 'stage:push-worker-finished';

do $$
begin
  if exists(select 1 from private.apns_devices where device_token=
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' and active) then
    raise exception 'APNs-rejected token remained active'; end if;
  if exists(select 1 from private.apns_outbox o join private.apns_devices d on d.id=o.device_id
    where d.device_token='cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      and o.status not in ('failed','delivered')) then
    raise exception 'Invalid-token deliveries remained claimable'; end if;
end $$;

select 'stage:push-unregister';
select set_config('request.jwt.claims',pg_temp.push_claims(
  '93000000-0000-4000-8000-000000000012','93000000-0000-4000-8000-000000000112'),true);
set local role authenticated;
-- An account cannot detach another account's installation.
do $$ begin
  if public.unregister_apns_device('93000000-0000-4000-8000-000000000211') then
    raise exception 'Cross-account device unregister succeeded'; end if;
  if not public.unregister_apns_device('93000000-0000-4000-8000-000000000213') then
    raise exception 'Own device unregister failed'; end if;
end $$;
reset role;
update private.apns_devices set disabled_at=now()-interval '31 days'
  where device_token='cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

select 'stage:push-session-revocation';
-- Re-register in the still-live B session, queue work, then expire the session.
select set_config('request.jwt.claims',pg_temp.push_claims(
  '93000000-0000-4000-8000-000000000012','93000000-0000-4000-8000-000000000112'),true);
set local role authenticated;
select public.register_apns_device(
  '93000000-0000-4000-8000-000000000214','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','sandbox');
reset role;
select 'stage:push-session-registered';
select set_config('request.jwt.claims',pg_temp.push_claims(
  '93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000111'),true);
insert into public.outreach_tasks(church_id,id,owner_id,created_by,due_date,status)
values('93000000-0000-4000-8000-000000000001','push-expired-session',
  '93000000-0000-4000-8000-000000000012','93000000-0000-4000-8000-000000000011',current_date+1,'scheduled');
update auth.sessions set not_after=now()-interval '1 second'
  where id='93000000-0000-4000-8000-000000000112';
select 'stage:push-session-expired';
set local role service_role;
do $$ begin
  if exists(select 1 from public.claim_apns_deliveries(25,180)) then
    raise exception 'Expired-session device delivery was leased'; end if;
end $$;
reset role;
select 'stage:push-session-claim-checked';
do $$ begin
  if exists(select 1 from private.apns_devices where device_token=
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' and active) then
    raise exception 'Expired-session device remained active'; end if;
  if exists(select 1 from private.apns_outbox o join private.apns_devices d on d.id=o.device_id
      where d.device_token='dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
        and o.status in ('pending','retry','leased')) then
    raise exception 'Expired-session outbox remained deliverable'; end if;
  if exists(select 1 from private.apns_devices where device_token=
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc') then
    raise exception 'Expired inactive APNs credential exceeded retention'; end if;
end $$;

select 'stage:push-membership-revocation';
insert into public.outreach_tasks(church_id,id,owner_id,created_by,due_date,status)
values('93000000-0000-4000-8000-000000000001','push-revoked-membership',
  '93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000011',current_date+1,'scheduled');
update public.church_memberships set active=false
  where church_id='93000000-0000-4000-8000-000000000001' and user_id='93000000-0000-4000-8000-000000000011';
do $$ begin
  if exists(select 1 from private.apns_outbox where app_path='/app/followups/push-revoked-membership'
      and status in ('pending','retry','leased')) then
    raise exception 'Inactive church member retained deliverable notifications'; end if;
  if exists(select 1 from private.apns_devices where user_id='93000000-0000-4000-8000-000000000011' and active) then
    raise exception 'Inactive church member retained active routing credentials'; end if;
end $$;
set local role service_role;
do $$ begin
  if exists(select 1 from public.claim_apns_deliveries(25,180)) then
    raise exception 'Worker found delivery after membership and session revocation'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',pg_temp.push_claims(
  '93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000111'),true);
set local role authenticated;
select pg_temp.expect_push_denied($sql$select public.register_apns_device(
  '93000000-0000-4000-8000-000000000215','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','sandbox')$sql$);
reset role;

select 'PASS: APNs session binding, source cancellation, tenant isolation, generic delivery, leasing and token cleanup are enforced' as push_result;
