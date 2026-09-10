begin;
alter table public.outreach_migration_issues add column if not exists resolution_note text check (length(resolution_note)<=2000);
alter table public.outreach_migration_issues add column if not exists resolved_by uuid references auth.users(id);
create index if not exists outreach_migration_issues_reviewer_idx on public.outreach_migration_issues(resolved_by);
create or replace function private.outreach_require_recent_leader(church uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_church_leader(church) then raise exception 'An active church leader is required.' using errcode='42501'; end if;
  if not exists(select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
    or not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) m
      where m->>'method' in ('password','oauth','otp','totp','sso/saml','magiclink')
      and (m->>'timestamp')::numeric between extract(epoch from now()-interval '15 minutes') and extract(epoch from now()+interval '1 minute')) then
    raise exception 'Sign in again before this sensitive action. A token refresh alone is not reauthentication.' using errcode='42501'; end if;
end $$;
revoke all on function private.outreach_require_recent_leader(uuid) from public,anon,authenticated;

create or replace function private.outreach_retention_plan(church uuid)
returns jsonb language sql stable set search_path = '' as $$
  with cutoff as (select ((now() at time zone c.timezone)::date-c.retention_days)::timestamp at time zone c.timezone as at,c.outreach_version from public.churches c where c.id=church),
  tasks as (select t.id,t.version from public.outreach_tasks t,cutoff c where t.church_id=church and t.deleted_at is null
    and t.person_id is null and t.status in ('completed','cancelled') and t.created_at<c.at
    and coalesce(t.completed_at,t.created_at)<c.at
    and not exists(select 1 from public.outreach_task_activity a where a.church_id=church and a.task_id=t.id and a.occurred_at>=c.at)
    and not exists(select 1 from public.outreach_tasks child where child.church_id=church and child.parent_task_id=t.id and child.deleted_at is null)),
  encounters as (select e.id,e.version from public.outreach_encounters e,cutoff c where e.church_id=church and e.deleted_at is null
    and e.person_id is null and e.occurred_at<c.at and not exists(select 1 from public.outreach_tasks t where t.church_id=church and t.encounter_id=e.id and t.deleted_at is null)),
  payload as (select jsonb_build_object('cutoff',(select at from cutoff),'settingsVersion',(select outreach_version from cutoff),
    'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by id) from tasks t),'[]'::jsonb),
    'encounters',coalesce((select jsonb_agg(to_jsonb(e) order by id) from encounters e),'[]'::jsonb)) as data)
  select data||jsonb_build_object('token',encode(extensions.digest(data::text,'sha256'),'hex'),'taskCount',jsonb_array_length(data->'tasks'),'encounterCount',jsonb_array_length(data->'encounters')) from payload;
$$;
revoke all on function private.outreach_retention_plan(uuid) from public,anon,authenticated;

create or replace function private.outreach_admin_action(request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare church uuid:=(request->>'churchId')::uuid; actor uuid:=auth.uid(); action text:=request->>'action'; key text:=request->>'id';
  fingerprint text; previous private.outreach_receipts; result jsonb; plan jsonb; row jsonb; op jsonb; value jsonb; revision bigint; field text; allowed text[];
begin
  perform private.outreach_require_recent_leader(church);
  if request->>'schemaVersion' is distinct from '1' or length(coalesce(key,'')) not between 1 and 180 or pg_column_size(request)>1048576 then
    raise exception 'Unsupported administration request.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(church::text,0));
  fingerprint:=encode(extensions.digest(request::text,'sha256'),'hex');
  select * into previous from private.outreach_receipts where church_id=church and actor_id=actor and command_id='admin_'||key;
  if found then
    if previous.payload_hash<>fingerprint then raise sqlstate 'PT409' using message='This administration ID was already used for different work.'; end if;
    return previous.result;
  end if;
  select outreach_revision into revision from public.churches where id=church;
  if action='retention_preview' then return private.outreach_retention_plan(church)||jsonb_build_object('revision',revision); end if;
  if (request->>'expectedRevision')::bigint is distinct from revision then raise sqlstate 'PT409' using message='The church records changed. Refresh and review before continuing.'; end if;
  if action='record_export' then
    if coalesce(request->>'kind','') not in ('people','locations','tasks','backup') then raise exception 'Choose a supported export.' using errcode='22023'; end if;
    result:=jsonb_build_object('prepared',true,'kind',request->>'kind','revision',revision);
  elsif action='import' then
    if jsonb_typeof(request->'operations') is distinct from 'array' or jsonb_array_length(request->'operations') not between 1 and 100 then
      raise exception 'Import 1 to 100 reviewed records.' using errcode='22023'; end if;
    for op in select v from jsonb_array_elements(request->'operations') v loop
      if coalesce(op->>'entityType','') not in ('resident','property') or op->>'operation' is distinct from 'upsert' or op->>'expectedVersion' is distinct from '0' then
        raise exception 'CSV imports may create people or locations; they cannot overwrite records.' using errcode='22023'; end if;
      value:=op->'record';
      allowed:=case when op->>'entityType'='resident' then array['name','phone','email','preferredContact','contactPermission','status','sharedWithVolunteerIds','sharedWithTeamIds']
        else array['address','unit','source'] end;
      for field in select jsonb_object_keys(value) loop
        if not field=any(allowed) then raise exception 'This field is not supported by reviewed CSV import.' using errcode='22023'; end if;
      end loop;
      if op->>'entityType'='resident' then
        if coalesce(value->'sharedWithVolunteerIds','[]')<>'[]'::jsonb or coalesce(value->'sharedWithTeamIds','[]')<>'[]'::jsonb then
          raise exception 'Imported people begin under the importing leader without additional sharing.' using errcode='22023'; end if;
        if exists(select 1 from public.discipleship_people p where p.church_id=church and p.deleted_at is null and
          (lower(regexp_replace(btrim(p.name),'\s+',' ','g'))=lower(regexp_replace(btrim(value->>'name'),'\s+',' ','g'))
          or nullif(lower(btrim(p.email)),'')=nullif(lower(btrim(value->>'email')),'')
          or nullif(regexp_replace(p.phone,'\D','','g'),'')=nullif(regexp_replace(value->>'phone','\D','','g'),''))) then
          raise sqlstate 'PT409' using message='A possible person duplicate was found. Refresh the preview; review that record separately.'; end if;
      elsif exists(select 1 from public.outreach_locations l where l.church_id=church and l.deleted_at is null
        and lower(regexp_replace(btrim(l.address),'\s+',' ','g'))=lower(regexp_replace(btrim(value->>'address'),'\s+',' ','g'))
        and lower(btrim(coalesce(l.unit,'')))=lower(btrim(coalesce(value->>'unit','')))) then
        raise sqlstate 'PT409' using message='A possible address duplicate was found. Refresh the preview; no existing record was overwritten.';
      end if;
      -- Apply in this same transaction so duplicate checks include earlier rows.
      perform private.outreach_apply_operation(church,actor,'admin_'||key,op);
    end loop;
    result:=jsonb_build_object('imported',jsonb_array_length(request->'operations'));
  elsif action='retention_archive' then
    plan:=private.outreach_retention_plan(church);
    if request->>'reviewToken' is distinct from plan->>'token' or request->>'confirmation' is distinct from 'ARCHIVE REVIEWED' then
      raise sqlstate 'PT409' using message='Preview and confirm the exact records before archival.'; end if;
    update public.outreach_tasks set deleted_at=now(),version=version+1 where church_id=church and id in (select v->>'id' from jsonb_array_elements(plan->'tasks') v);
    update public.outreach_encounters set deleted_at=now(),version=version+1 where church_id=church and id in (select v->>'id' from jsonb_array_elements(plan->'encounters') v);
    result:=jsonb_build_object('archivedTasks',plan->'taskCount','archivedEncounters',plan->'encounterCount',
      'manifest',jsonb_build_object('cutoff',plan->'cutoff','tasks',plan->'tasks','encounters',plan->'encounters'));
  elsif action='review_migration_issue' then
    if length(btrim(coalesce(request->>'reason','')))<3 or length(request->>'reason')>2000 then raise exception 'Record what was reviewed or corrected.' using errcode='22023'; end if;
    update public.outreach_migration_issues set resolved_at=now(),resolved_by=actor,resolution_note=btrim(request->>'reason') where church_id=church and entity_type=request->>'entityType'
      and entity_id=request->>'entityId' and issue=request->>'issue' and resolved_at is null returning to_jsonb(outreach_migration_issues.*) into row;
    if row is null then raise sqlstate 'PT409' using message='This issue is no longer awaiting review.'; end if;
    result:=jsonb_build_object('reviewed',true);
  else raise exception 'Unsupported administration action.' using errcode='22023'; end if;
  insert into public.outreach_audit(church_id,actor_id,command_id,action,entity_type,entity_id)
  values(church,actor,'admin_'||key,'admin.'||action,'settings',church::text);
  if action<>'record_export' then update public.churches set outreach_revision=outreach_revision+1 where id=church; end if;
  insert into private.outreach_receipts(church_id,actor_id,command_id,payload_hash,result) values(church,actor,'admin_'||key,fingerprint,result);
  return result;
end $$;
revoke all on function private.outreach_admin_action(jsonb) from public,anon;
grant execute on function private.outreach_admin_action(jsonb) to authenticated;
create or replace function public.outreach_admin_action(request jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select private.outreach_admin_action(request); $$;
revoke all on function public.outreach_admin_action(jsonb) from public,anon;
grant execute on function public.outreach_admin_action(jsonb) to authenticated;
commit;
