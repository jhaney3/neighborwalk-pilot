\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('50000000-0000-4000-8000-000000000011','reminder-leader@neighborwalk.test',now()),
 ('50000000-0000-4000-8000-000000000012','reminder-volunteer@neighborwalk.test',now()),
 ('50000000-0000-4000-8000-000000000013','reminder-unverified@neighborwalk.test',null);
insert into public.churches(id,name,created_by,timezone) values
 ('50000000-0000-4000-8000-000000000001','Fictional Reminder Church','50000000-0000-4000-8000-000000000011',
   (select name from pg_timezone_names where name like 'Etc/GMT%' and extract(hour from now() at time zone name)=12 limit 1)),
 ('50000000-0000-4000-8000-000000000002','Other Fictional Reminder Church','50000000-0000-4000-8000-000000000013','UTC');
insert into public.church_memberships(church_id,user_id,role,active) values
 ('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000011','leader',true),
 ('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000012','volunteer',true),
 ('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000013','volunteer',true);
insert into public.outreach_tasks(church_id,id,owner_id,due_date,note) values
 ('50000000-0000-4000-8000-000000000001','reminder-task','50000000-0000-4000-8000-000000000012','2020-01-01','PRIVATE FICTIONAL CARE NOTE MUST NOT ENTER EMAIL');
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000012","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $$ declare result jsonb; begin
 result:=public.outreach_reminder_preference('50000000-0000-4000-8000-000000000001');
 if (result->>'enabled')::boolean then raise exception 'Member was enrolled without consent'; end if;
 perform public.outreach_reminder_preference('50000000-0000-4000-8000-000000000001',true);
 begin perform public.outreach_reminder_preference('50000000-0000-4000-8000-000000000002',true); raise exception 'Cross-tenant opt-in permitted'; exception when insufficient_privilege then null; end;
 begin perform public.outreach_reminder_worker('claim'); raise exception 'Member may run service worker'; exception when insufficient_privilege then null; end;
 begin perform * from private.outreach_reminder_preferences; raise exception 'Member may read private recipients'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000013","role":"authenticated","is_anonymous":false}',true);
do $$ begin
 begin perform public.outreach_reminder_preference('50000000-0000-4000-8000-000000000001',true); raise exception 'Unverified address enrolled'; exception when invalid_parameter_value then null; end;
end $$;
set local role postgres;
update private.outreach_reminder_preferences set id='50000000-0000-4000-8000-000000000021' where user_id='50000000-0000-4000-8000-000000000012';
create temp table reminder_test_job(data jsonb);
grant all on reminder_test_job to service_role;
set local role service_role;
insert into reminder_test_job select item from jsonb_array_elements(public.outreach_reminder_worker('claim')) item where item->>'preferenceId'='50000000-0000-4000-8000-000000000021';
do $$ declare job jsonb; payload jsonb; again jsonb; begin
 select data into strict job from reminder_test_job;
 if job::text like '%PRIVATE FICTIONAL%' then raise exception 'Care note leaked to delivery worker'; end if;
 if exists(select 1 from jsonb_array_elements(public.outreach_reminder_worker('claim')) j where j->>'id'=job->>'id') then raise exception 'Active lease claimed twice'; end if;
 payload:=jsonb_build_object('to',jsonb_build_array(job->>'recipient'),'subject','Fictional safe subject','text','Fictional protected link');
 again:=public.outreach_reminder_worker('prepare',job||jsonb_build_object('payload',payload));
 if again<>payload then raise exception 'Envelope was not persisted before send'; end if;
 again:=public.outreach_reminder_worker('prepare',job||jsonb_build_object('payload',payload||'{"text":"Changed deployment template"}'));
 if again<>payload then raise exception 'Retry changed idempotent message envelope'; end if;
 perform public.outreach_reminder_worker('finish',job||'{"error":"temporary"}');
end $$;
set local role postgres;
do $$ begin
 if not exists(select 1 from private.outreach_reminder_jobs where preference_id='50000000-0000-4000-8000-000000000021' and state='retry' and attempts=2 and first_attempt_at is not null) then raise exception 'Temporary send failure was not durable'; end if;
end $$;
update private.outreach_reminder_jobs set next_attempt_at=now()-interval '1 second' where preference_id='50000000-0000-4000-8000-000000000021';
set local role service_role;
delete from reminder_test_job;
insert into reminder_test_job select item from jsonb_array_elements(public.outreach_reminder_worker('claim')) item where item->>'preferenceId'='50000000-0000-4000-8000-000000000021';
do $$ declare job jsonb; event jsonb; begin
 select data into strict job from reminder_test_job;
 -- Webhook arrives before our provider acknowledgement, then is retried.
 event:='{"eventId":"evt_fictional_bounce","providerId":"50000000-0000-4000-8000-000000000031","kind":"email.bounced","occurredAt":"2026-09-10T12:00:00Z"}';
 event:=event||jsonb_build_object('jobId',job->>'id');
 perform public.outreach_reminder_worker('event',event);
 perform public.outreach_reminder_worker('event',event);
 perform public.outreach_reminder_worker('finish',job||'{"providerId":"50000000-0000-4000-8000-000000000031"}');
 perform public.outreach_reminder_worker('event',event||'{"eventId":"evt_fictional_late_delivered","kind":"email.delivered"}');
end $$;
set local role postgres;
do $$ begin
 if not exists(select 1 from private.outreach_reminder_jobs where preference_id='50000000-0000-4000-8000-000000000021' and state='bounced')
  or not exists(select 1 from private.outreach_reminder_preferences where id='50000000-0000-4000-8000-000000000021' and not enabled and suppressed_at is not null)
  or (select count(*) from private.outreach_reminder_events where id='evt_fictional_bounce')<>1 then raise exception 'Out-of-order bounce/deduplication/suppression failed'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000012","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $$ begin
 begin perform public.outreach_reminder_preference('50000000-0000-4000-8000-000000000001',true); raise exception 'Bounce suppression was bypassed'; exception when invalid_parameter_value then null; end;
end $$;
set local role postgres;
-- Restore only fictional fixture state to exercise independent safeguards.
update private.outreach_reminder_preferences set enabled=true,suppressed_at=null where id='50000000-0000-4000-8000-000000000021';
update private.outreach_reminder_jobs set state='retry',provider_id=null,next_attempt_at=now(),lease_until=null where preference_id='50000000-0000-4000-8000-000000000021';
update public.church_memberships set active=false where user_id='50000000-0000-4000-8000-000000000012';
set local role service_role;
do $$ begin perform public.outreach_reminder_worker('claim'); end $$;
set local role postgres;
do $$ begin
 if not exists(select 1 from private.outreach_reminder_jobs where preference_id='50000000-0000-4000-8000-000000000021' and state='suppressed') then raise exception 'Inactive member received work'; end if;
end $$;
update public.church_memberships set active=true where user_id='50000000-0000-4000-8000-000000000012';
update private.outreach_reminder_jobs set state='retry',attempts=6,first_attempt_at=now(),next_attempt_at=now(),lease_until=null where preference_id='50000000-0000-4000-8000-000000000021';
set local role service_role;
do $$ begin perform public.outreach_reminder_worker('claim'); end $$;
set local role postgres;
do $$ begin
 if not exists(select 1 from private.outreach_reminder_jobs where preference_id='50000000-0000-4000-8000-000000000021' and state='unknown' and error_code='ambiguous') then raise exception 'Repeated crashed sends bypassed attempt bound'; end if;
end $$;
update private.outreach_reminder_jobs set attempts=2 where preference_id='50000000-0000-4000-8000-000000000021';
update private.outreach_reminder_jobs set state='retry',first_attempt_at=now()-interval '23 hours 1 minute',next_attempt_at=now(),lease_until=null where preference_id='50000000-0000-4000-8000-000000000021';
set local role service_role;
do $$ begin perform public.outreach_reminder_worker('claim'); end $$;
set local role postgres;
do $$ begin
 if not exists(select 1 from private.outreach_reminder_jobs where preference_id='50000000-0000-4000-8000-000000000021' and state='unknown') then raise exception 'Ambiguous retry exceeded provider idempotency window'; end if;
end $$;
update private.outreach_reminder_jobs set state='retry',first_attempt_at=now(),next_attempt_at=now(),lease_until=null where preference_id='50000000-0000-4000-8000-000000000021';
set local role service_role;
delete from reminder_test_job;
insert into reminder_test_job select item from jsonb_array_elements(public.outreach_reminder_worker('claim')) item where item->>'preferenceId'='50000000-0000-4000-8000-000000000021';
do $$ declare job jsonb; begin
 select data into strict job from reminder_test_job;
 perform public.outreach_reminder_worker('unsubscribe','{"preferenceId":"50000000-0000-4000-8000-000000000021"}');
 if public.outreach_reminder_worker('prepare',job||'{"payload":{}}')<>'null'::jsonb then raise exception 'Unsubscribe did not suppress leased work'; end if;
 perform public.outreach_reminder_worker('unsubscribe','{"preferenceId":"50000000-0000-4000-8000-000000000021"}');
end $$;
set local role postgres;
do $$ declare church uuid:='50000000-0000-4000-8000-000000000001'; member uuid:='50000000-0000-4000-8000-000000000012'; begin
 update public.outreach_tasks set acceptance='declined' where church_id=church;
 if private.outreach_reminder_eligible(church,member,current_date) then raise exception 'Declined task eligible'; end if;
 update public.outreach_tasks set acceptance='accepted',due_date=current_date+10 where church_id=church;
 if private.outreach_reminder_eligible(church,member,current_date) then raise exception 'Future task eligible'; end if;
 update public.outreach_tasks set acceptance='pending' where church_id=church;
 if not private.outreach_reminder_eligible(church,member,current_date) then raise exception 'Pending handoff omitted'; end if;
 update public.outreach_tasks set status='completed' where church_id=church;
 if private.outreach_reminder_eligible(church,member,current_date) then raise exception 'Completed task eligible'; end if;
 if exists(select 1 from private.outreach_reminder_preferences where user_id='50000000-0000-4000-8000-000000000011') then raise exception 'Leader was enrolled by another member'; end if;
 -- The real creator trigger assigns new people to auth.uid(), even for a
 -- privileged fixture insert. Create this private record as the other actor.
 perform set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000011","role":"authenticated","is_anonymous":false}',true);
 insert into public.discipleship_people(id,church_id,created_by,assigned_to,name,faith_status,discipleship_stage,status,preferred_contact)
 values('reminder-private-person',church,'50000000-0000-4000-8000-000000000011','50000000-0000-4000-8000-000000000011','Fictional private person','not_discussed','new_connection','active','none');
 perform set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000012","role":"authenticated","is_anonymous":false}',true);
 update public.outreach_tasks set status='scheduled',due_date=current_date,person_id='reminder-private-person' where church_id=church;
 if private.outreach_reminder_eligible(church,member,current_date) then raise exception 'Inaccessible person task eligible'; end if;
 update public.discipleship_people set shared_user_ids=array[member] where id='reminder-private-person';
 if not private.outreach_reminder_eligible(church,member,current_date) then raise exception 'Accessible person task omitted'; end if;
 insert into public.outreach_restrictions(church_id,id,person_id,channel,reason,created_by)
 values(church,'reminder-person-restriction','reminder-private-person','all','Fictional opt out',member);
 if private.outreach_reminder_eligible(church,member,current_date) then raise exception 'Restricted person task eligible'; end if;
 update public.outreach_restrictions set active=false,corrected_by=member,corrected_at=now(),correction_reason='Fictional fixture correction' where church_id=church and id='reminder-person-restriction';
end $$;
update private.outreach_reminder_preferences set enabled=true where id='50000000-0000-4000-8000-000000000021';
update private.outreach_reminder_jobs set state='retry',attempts=1,first_attempt_at=now(),next_attempt_at=now(),lease_until=null where preference_id='50000000-0000-4000-8000-000000000021';
update auth.users set email='changed-fictional@neighborwalk.test' where id='50000000-0000-4000-8000-000000000012';
set local role service_role;
do $$ begin perform public.outreach_reminder_worker('claim'); end $$;
set local role postgres;
do $$ begin
 if not exists(select 1 from private.outreach_reminder_jobs where preference_id='50000000-0000-4000-8000-000000000021' and state='suppressed') then raise exception 'Changed address inherited consent'; end if;
end $$;
rollback;
\echo 'Opt-in reminder safety passed (all fictional changes rolled back).'
