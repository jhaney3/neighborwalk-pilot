begin;

alter table public.churches add column outreach_version bigint not null default 1;
alter table public.churches add column outreach_revision bigint not null default 1;
alter table public.churches add column pathway_enabled boolean not null default false;

create policy active_note_read on public.discipleship_person_notes as restrictive for select to authenticated
  using (deleted_at is null);

-- The ordinary membership RLS intentionally hides other members' email
-- addresses. This narrow directory helper exposes names/roles in the caller's
-- church, never other tenants or uninvited auth users.
create function private.outreach_directory(target_church uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_church_member(target_church) then
    raise exception 'Active church membership is required.' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id',private.volunteer_id_for_user(m.user_id),'churchId',m.church_id,
    'name',coalesce(nullif(m.display_name,''),'Church member'),'role',m.role,'active',m.active,
    'email',case when m.user_id=auth.uid() or private.is_church_leader(target_church) then m.member_email else null end
  ) order by m.user_id),'[]') from public.church_memberships m where m.church_id=target_church);
end $$;
revoke all on function private.outreach_directory(uuid) from public,anon;
grant execute on function private.outreach_directory(uuid) to authenticated;

create function public.outreach_workspace_info(target_church uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.is_church_member(target_church) then
    raise exception 'Active church membership is required.' using errcode='42501';
  end if;
  select jsonb_build_object('apiVersion',1,'church',jsonb_build_object(
    'id',c.id,'name',c.name,'timezone',c.timezone,'retentionDays',c.retention_days,
    'defaultFollowUpDays',c.default_follow_up_days,'noteCharacterLimit',c.note_character_limit,
    'pathwayEnabled',c.pathway_enabled),
    'settingsVersion',c.outreach_version,'revision',c.outreach_revision,
    'role',m.role,'userId',m.user_id,'volunteers',private.outreach_directory(c.id)) into result
  from public.churches c join public.church_memberships m on m.church_id=c.id and m.user_id=auth.uid() and m.active
  where c.id=target_church;
  return result;
end $$;
revoke all on function public.outreach_workspace_info(uuid) from public,anon;
grant execute on function public.outreach_workspace_info(uuid) to authenticated;

-- Keyset pagination is explicit and bounded. A full read checks the church
-- revision before/after all pages; a concurrent command causes a retry instead
-- of claiming that a mixed-version read is current.
create function public.outreach_read_records(target_church uuid,entity_kind text,after_id text default '',page_size integer default 500)
returns table(id text,version bigint,record jsonb)
language plpgsql stable security invoker set search_path = '' as $$
declare tab text; key_expression text := 'r.id::text'; version_expression text := 'r.version'; live_filter text := ' and r.deleted_at is null';
begin
  if auth.uid() is null or not private.is_church_member(target_church) then
    raise exception 'Active church membership is required.' using errcode='42501';
  end if;
  tab := case entity_kind
    when 'event' then 'outreach_outings' when 'team' then 'outreach_teams'
    when 'team_member' then 'outreach_team_members' when 'territory' then 'outreach_territories'
    when 'assignment' then 'outreach_assignments' when 'property' then 'outreach_locations'
    when 'visit' then 'outreach_encounters' when 'follow_up' then 'outreach_tasks'
    when 'task_activity' then 'outreach_task_activity' when 'resident' then 'discipleship_people'
    when 'person_note' then 'discipleship_person_notes' when 'restriction' then 'outreach_restrictions'
    when 'audit' then 'outreach_audit' when 'migration_issue' then 'outreach_migration_issues'
    else null end;
  if tab is null then raise exception 'Unknown record type.' using errcode='22023'; end if;
  if entity_kind='team_member' then
    key_expression := 'jsonb_build_array(r.team_id,r.volunteer_id)::text'; version_expression := '1::bigint'; live_filter := '';
  elsif entity_kind='task_activity' then
    key_expression := 'jsonb_build_array(r.task_id,r.id)::text'; version_expression := '1::bigint'; live_filter := '';
  elsif entity_kind='audit' then
    key_expression := 'lpad(r.sequence::text,20,''0'')'; version_expression := '1::bigint'; live_filter := '';
  elsif entity_kind='migration_issue' then
    key_expression := 'jsonb_build_array(r.entity_type,r.entity_id,r.issue)::text'; version_expression := '1::bigint'; live_filter := ' and r.resolved_at is null';
  elsif entity_kind='restriction' then live_filter := '';
  end if;
  return query execute format('select %s,%s,to_jsonb(r) from public.%I r where r.church_id=$1 and %s > $2 %s order by %s limit $3',
    key_expression,version_expression,tab,key_expression,live_filter,key_expression)
  using target_church,coalesce(after_id,''),least(greatest(coalesce(page_size,500),1),750);
end $$;
revoke all on function public.outreach_read_records(uuid,text,text,integer) from public,anon;
grant execute on function public.outreach_read_records(uuid,text,text,integer) to authenticated;

commit;
