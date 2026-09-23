\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('92000000-0000-4000-8000-000000000011','community-leader@neighborwalk.test'),
  ('92000000-0000-4000-8000-000000000012','community-volunteer@neighborwalk.test');
insert into auth.sessions(id,user_id,created_at,updated_at)
select id,id,now(),now() from auth.users where id::text like '92000000-%';
insert into public.churches(id,name,created_by) values
  ('92000000-0000-4000-8000-000000000001','Fictional Community Church','92000000-0000-4000-8000-000000000011');
insert into public.church_memberships(church_id,user_id,role,active,display_name) values
  ('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000011','leader',true,'Community Leader'),
  ('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000012','volunteer',true,'Community Volunteer');
insert into public.outreach_locations(church_id,id,address) values
  ('92000000-0000-4000-8000-000000000001','community-home','9 Fictional Porch Lane');

create function pg_temp.claims(target_user uuid) returns text language sql as $$
  select jsonb_build_object('sub',target_user,'session_id',target_user,'role','authenticated','is_anonymous',false)::text;
$$;
create function pg_temp.visit(visit_key text,details jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id','community-'||visit_key,'churchId','92000000-0000-4000-8000-000000000001','schemaVersion',1,
    'operations',jsonb_build_array(jsonb_build_object('entityType','visit','entityId',visit_key,'operation','upsert','expectedVersion',0,
      'record',jsonb_build_object('outcome','conversation','recordedAt','2026-09-20T18:00:00Z','deviceId','fictional-device') || details)));
$$;
create function pg_temp.expect_denied(command jsonb,expected_state text) returns void language plpgsql as $$
declare denied boolean:=false;
begin
  begin perform public.outreach_apply_command(command);
  exception when others then if sqlstate<>expected_state then raise; end if; denied:=true; end;
  if not denied then raise exception 'Expected denial % but command succeeded',expected_state; end if;
end $$;

select set_config('request.jwt.claims',pg_temp.claims('92000000-0000-4000-8000-000000000012'),true);
set local role authenticated;
do $$ begin
  -- A community conversation keeps its place, sorted unique needs and backdated time.
  perform public.outreach_apply_command(pg_temp.visit('meal-conversation',jsonb_build_object(
    'context','community_meal','placeLabel','  Friday soup supper  ','needs',jsonb_build_array('prayer','food','prayer'),
    'recordedAt','2026-09-18T23:30:00Z','objectiveNote','Fictional shared note')));
  if (select place_label from public.outreach_encounters where id='meal-conversation')<>'Friday soup supper' then
    raise exception 'Place name was not trimmed and saved'; end if;
  if (select needs from public.outreach_encounters where id='meal-conversation')<>array['food','prayer'] then
    raise exception 'Needs were not saved as a sorted, unique list'; end if;
  if (select occurred_at from public.outreach_encounters where id='meal-conversation')<>'2026-09-18T23:30:00Z'::timestamptz then
    raise exception 'A backdated conversation lost its time'; end if;
  if (select record->>'place_label' from public.outreach_read_records('92000000-0000-4000-8000-000000000001','visit') where id='meal-conversation')<>'Friday soup supper' then
    raise exception 'The read API does not return the place name'; end if;

  -- Door visits and older clients keep working without the new fields.
  perform public.outreach_apply_command(pg_temp.visit('door-knock',jsonb_build_object('context','door','propertyId','community-home','outcome','no_answer')));
  if (select needs from public.outreach_encounters where id='door-knock')<>'{}'::text[] or (select place_label from public.outreach_encounters where id='door-knock') is not null then
    raise exception 'A door visit gained community details'; end if;

  perform pg_temp.expect_denied(pg_temp.visit('door-with-place',jsonb_build_object('context','door','propertyId','community-home','placeLabel','Porch')),'22023');
  perform pg_temp.expect_denied(pg_temp.visit('unknown-need',jsonb_build_object('context','service','needs',jsonb_build_array('money'))),'22023');
  perform pg_temp.expect_denied(pg_temp.visit('needs-not-array',jsonb_build_object('context','service','needs','food')),'22023');
  perform pg_temp.expect_denied(pg_temp.visit('long-place',jsonb_build_object('context','other','placeLabel',repeat('x',121))),'22023');
end $$;

reset role;
select 'PASS: community conversations save a place, needs and their real time; door visits are unchanged' as result;
rollback;
