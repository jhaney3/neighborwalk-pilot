\set ON_ERROR_STOP on
begin;
-- Fictional fixtures only; the runner hard-codes loopback and this rolls back.
insert into auth.users(id,email) values
 ('40000000-0000-4000-8000-000000000011','task-leader@neighborwalk.test'),
 ('40000000-0000-4000-8000-000000000012','task-volunteer@neighborwalk.test');
insert into public.churches(id,name,created_by) values
 ('40000000-0000-4000-8000-000000000001','Fictional Task Church','40000000-0000-4000-8000-000000000011');
insert into public.church_memberships(church_id,user_id,role,active,display_name) values
 ('40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','leader',true,'Task Leader'),
 ('40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000012','volunteer',true,'Task Volunteer');
insert into public.outreach_locations(church_id,id,address,source) values
 ('40000000-0000-4000-8000-000000000001','task-location-a','Fictional A','manual'),
 ('40000000-0000-4000-8000-000000000001','task-location-b','Fictional B','manual');
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000011","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
create function pg_temp.task_command(command_id text, task_id text, version integer, record jsonb) returns jsonb language sql as $$
 select jsonb_build_object('id',command_id,'churchId','40000000-0000-4000-8000-000000000001','schemaVersion',1,'operations',jsonb_build_array(
  jsonb_build_object('entityType','follow_up','entityId',task_id,'operation','upsert','expectedVersion',version,'record',record)));
$$;
create function pg_temp.task_denied(command jsonb) returns void language plpgsql as $$
declare denied boolean:=false;
begin
 begin perform public.outreach_apply_command(command);
 exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Expected task lifecycle validation to reject the command'; end if;
end $$;
do $$ declare r jsonb; begin
 r:='{"dueAt":"2026-09-14","propertyId":"task-location-a","assignedVolunteerId":"volunteer_40000000000040008000000000000012","acceptance":"pending","status":"scheduled"}';
 perform public.outreach_apply_command(pg_temp.task_command('task-create','task-a',0,r));
 perform pg_temp.task_denied(pg_temp.task_command('pending-complete','task-a',1,r||'{"status":"completed"}'));
 perform pg_temp.task_denied(pg_temp.task_command('pending-reschedule','task-a',1,r||'{"dueAt":"2026-09-15"}'));
 perform pg_temp.task_denied(pg_temp.task_command('change-task-location','task-a',1,r||'{"propertyId":"task-location-b"}'));
 perform pg_temp.task_denied(pg_temp.task_command('new-resolved-task','task-resolved',0,r||'{"status":"completed"}'));
 perform pg_temp.task_denied(pg_temp.task_command('historical-cancel-reason','task-a',1,r||'{"status":"cancelled","history":[{"action":"cancelled","note":"Earlier reason"},{"action":"note","note":"Unrelated"}]}'));
 perform public.outreach_apply_command(pg_temp.task_command('task-create-cancel','task-cancel',0,r));
 perform public.outreach_apply_command(pg_temp.task_command('task-cancel-current','task-cancel',1,r||'{"status":"cancelled","history":[{"action":"cancelled","note":"Neighbor no longer requested this step."}]}'));
 if (select count(*) from public.outreach_task_activity where task_id='task-cancel') <> 2 then raise exception 'Cancellation history was not appended exactly once'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000012","role":"authenticated","is_anonymous":false}',true);
do $$ declare r jsonb; begin
 r:='{"dueAt":"2026-09-14","propertyId":"task-location-a","assignedVolunteerId":"volunteer_40000000000040008000000000000012","acceptance":"declined","status":"scheduled"}';
 perform public.outreach_apply_command(pg_temp.task_command('decline-task','task-a',1,r));
 perform pg_temp.task_denied(pg_temp.task_command('declined-complete','task-a',2,r||'{"status":"completed"}'));
 perform public.outreach_apply_command(pg_temp.task_command('accept-task','task-a',2,r||'{"acceptance":"accepted"}'));
 perform public.outreach_apply_command(pg_temp.task_command('complete-task','task-a',3,r||'{"acceptance":"accepted","status":"completed","completionNote":"Fictional completion."}'));
 perform pg_temp.task_denied(pg_temp.task_command('reopen-task','task-a',4,r||'{"acceptance":"accepted"}'));
 perform pg_temp.task_denied(pg_temp.task_command('rewrite-resolved-task','task-a',4,r||'{"acceptance":"accepted","status":"completed","note":"Overwrite history"}'));
 perform public.outreach_apply_command(pg_temp.task_command('subsequent-task','task-next',0,r||'{"parentFollowUpId":"task-a","acceptance":"accepted"}'));
 perform pg_temp.task_denied(pg_temp.task_command('subsequent-open-parent','task-invalid-next',0,r||'{"parentFollowUpId":"task-next","acceptance":"accepted"}'));
 if (select count(*) from public.outreach_task_activity where task_id='task-a') <> 4 then raise exception 'Task lifecycle history was rewritten or duplicated'; end if;
end $$;
rollback;
\echo 'Follow-up lifecycle guards passed (all fictional changes rolled back).'
