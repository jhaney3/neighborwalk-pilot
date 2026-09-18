begin;

create table public.outreach_outing_participants (
  church_id uuid not null,
  id text not null check(length(id) between 1 and 240),
  outing_id text not null,
  volunteer_id text not null check(length(volunteer_id) between 1 and 240),
  user_id uuid,
  status text not null default 'invited' check(status in ('invited','going','not_going','checked_in')),
  version bigint not null default 1 check(version>0),
  deleted_at timestamptz,
  primary key(church_id,id),
  foreign key(church_id,outing_id) references public.outreach_outings(church_id,id),
  foreign key(church_id,user_id) references public.church_memberships(church_id,user_id)
);
create unique index outreach_outing_participant_live_member_idx
  on public.outreach_outing_participants(church_id,outing_id,volunteer_id) where deleted_at is null;
create index outreach_outing_participant_user_idx
  on public.outreach_outing_participants(church_id,user_id) where deleted_at is null;

-- Preserve visibility for existing outings, but stop using target ownership as
-- the invitation model after this migration.
with candidates as (
  select a.church_id,a.outing_id,private.volunteer_id_for_user(a.assignee_id) volunteer_id,a.assignee_id user_id,
    case a.status when 'completed' then 'checked_in' when 'accepted' then 'going' when 'declined' then 'not_going' else 'invited' end status,
    case a.status when 'completed' then 4 when 'accepted' then 3 when 'assigned' then 2 else 1 end priority
  from public.outreach_assignments a where a.deleted_at is null and a.status<>'cancelled' and a.assignee_id is not null
  union all
  select a.church_id,a.outing_id,tm.volunteer_id,tm.user_id,
    case a.status when 'completed' then 'checked_in' when 'accepted' then 'going' when 'declined' then 'not_going' else 'invited' end,
    case a.status when 'completed' then 4 when 'accepted' then 3 when 'assigned' then 2 else 1 end
  from public.outreach_assignments a join public.outreach_team_members tm on tm.church_id=a.church_id and tm.team_id=a.team_id
  where a.deleted_at is null and a.status<>'cancelled' and a.team_id is not null
), ranked as (
  select *,row_number() over(partition by church_id,outing_id,volunteer_id order by priority desc) position from candidates
)
insert into public.outreach_outing_participants(church_id,id,outing_id,volunteer_id,user_id,status)
select church_id,'participant_backfill_'||md5(outing_id||':'||volunteer_id),outing_id,volunteer_id,user_id,status
from ranked where position=1;

alter table public.outreach_outing_participants enable row level security;
alter table public.outreach_outing_participants force row level security;
create policy outing_participant_read on public.outreach_outing_participants for select to authenticated
  using(deleted_at is null and (select private.is_church_member(church_id))
    and ((select private.is_church_leader(church_id)) or user_id=(select auth.uid())));
revoke all on public.outreach_outing_participants from anon,authenticated;
grant select on public.outreach_outing_participants to authenticated;

alter function private.outreach_apply_operation(uuid,uuid,text,jsonb) rename to outreach_apply_operation_before_outing_participants;
create function private.outreach_apply_operation(church uuid,actor uuid,command_id text,op jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare kind text:=op->>'entityType'; record_id text:=op->>'entityId'; operation text:=op->>'operation'; r jsonb:=coalesce(op->'record','{}');
  old_row public.outreach_outing_participants; current_version bigint; incoming_user uuid; outing_status text; next_status text:=r->>'status';
  leader boolean:=private.is_church_leader(church);
begin
  if kind<>'participant' then return private.outreach_apply_operation_before_outing_participants(church,actor,command_id,op); end if;
  if length(coalesce(record_id,'')) not between 1 and 240 or operation not in ('upsert','delete') then
    raise exception 'Invalid outing participant change.' using errcode='22023'; end if;
  select * into old_row from public.outreach_outing_participants where church_id=church and id=record_id for update;
  current_version:=coalesce(old_row.version,0);
  if current_version<>(op->>'expectedVersion')::bigint then
    raise sqlstate 'PT409' using message='This outing invitation changed on another device. Review before retrying.'; end if;
  if old_row.deleted_at is not null then raise sqlstate 'PT409' using message='This outing invitation was removed. Refresh before changing it.'; end if;
  if not leader and (old_row.id is null or operation='delete' or old_row.user_id is distinct from actor) then
    raise exception 'You may respond only to your own outing invitation.' using errcode='42501'; end if;

  if operation='delete' then
    if old_row.status='checked_in' then raise exception 'Remove this person from check-in before deleting their outing invitation.' using errcode='22023'; end if;
    update public.outreach_outing_participants set deleted_at=now(),version=version+1 where church_id=church and id=record_id;
  else
    if r->>'eventId' is null or r->>'volunteerId' is null or next_status not in ('invited','going','not_going','checked_in') then
      raise exception 'Choose an outing, person and valid invitation status.' using errcode='22023'; end if;
    select status into outing_status from public.outreach_outings where church_id=church and id=r->>'eventId' and deleted_at is null;
    if outing_status is null or outing_status not in ('draft','scheduled','ready','active') then
      raise exception 'Invitations may change only while the outing is open.' using errcode='22023'; end if;
    incoming_user:=private.outreach_member_id(church,r->>'volunteerId');
    if incoming_user is null or not private.outreach_active_member(church,incoming_user) then
      raise exception 'Choose an active church member for this outing.' using errcode='22023'; end if;
    if old_row.id is not null and (r->>'eventId' is distinct from old_row.outing_id or r->>'volunteerId' is distinct from old_row.volunteer_id) then
      raise exception 'An outing invitation cannot be reassigned to another person or outing.' using errcode='22023'; end if;
    if not leader and (next_status not in ('going','not_going') or r->>'eventId' is distinct from old_row.outing_id
      or r->>'volunteerId' is distinct from old_row.volunteer_id or old_row.status='checked_in') then
      raise exception 'You may only update your own availability before check-in.' using errcode='42501'; end if;
    insert into public.outreach_outing_participants(church_id,id,outing_id,volunteer_id,user_id,status,version)
      values(church,record_id,r->>'eventId',r->>'volunteerId',incoming_user,next_status,current_version+1)
    on conflict(church_id,id) do update set status=excluded.status,version=excluded.version;
  end if;
  insert into public.outreach_audit(church_id,actor_id,command_id,action,entity_type,entity_id,details)
    values(church,actor,command_id,'participant.'||operation,'participant',record_id,jsonb_build_object('outingId',coalesce(r->>'eventId',old_row.outing_id)));
  return jsonb_build_object('entityType','participant','entityId',record_id,'version',current_version+1);
end $$;
revoke all on function private.outreach_apply_operation_before_outing_participants(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function private.outreach_apply_operation(uuid,uuid,text,jsonb) from public,anon,authenticated;

-- Ready outings may have reviewed targets without day-of crews. The remaining
-- invariants still reject mismatched, overlapping, or empty assigned targets.
create or replace function private.outreach_validate_walk_target_state(target_church uuid)
returns void language plpgsql set search_path='' as $$
begin
  if exists(
    select 1 from public.outreach_assignments a
    join public.outreach_walk_targets t on t.church_id=a.church_id and t.id=a.target_id
    where a.church_id=target_church and a.deleted_at is null and a.status in ('assigned','accepted')
      and (a.outing_id is distinct from t.outing_id or a.territory_id is distinct from t.territory_id or t.deleted_at is not null or t.finished_at is not null)
  ) then raise exception 'Active target assignments must match an unfinished target, outing and parent zone.' using errcode='22023'; end if;

  if exists(
    select 1 from public.outreach_assignments a
    join public.outreach_assignments b on b.church_id=a.church_id and b.outing_id=a.outing_id and b.territory_id=a.territory_id and b.id>a.id
      and b.deleted_at is null and b.status in ('assigned','accepted')
    left join public.outreach_walk_targets ta on ta.church_id=a.church_id and ta.id=a.target_id
    left join public.outreach_walk_targets tb on tb.church_id=b.church_id and tb.id=b.target_id
    where a.church_id=target_church and a.deleted_at is null and a.status in ('assigned','accepted')
      and (a.target_id is null or b.target_id is null or ta.selection_kind='whole_zone' or tb.selection_kind='whole_zone')
  ) then raise exception 'Whole-zone and nightly-target assignments cannot overlap.' using errcode='23505'; end if;

  if exists(
    select 1 from public.outreach_assignments a
    join public.outreach_assignments b on b.church_id=a.church_id and b.outing_id=a.outing_id and b.id>a.id
      and b.deleted_at is null and b.status in ('assigned','accepted') and b.target_id is not null
    join public.outreach_walk_target_parcels ap on ap.church_id=a.church_id and ap.target_id=a.target_id
    join public.outreach_walk_target_parcels bp on bp.church_id=b.church_id and bp.target_id=b.target_id
      and bp.county_fips=ap.county_fips and bp.gislink=ap.gislink
    where a.church_id=target_church and a.deleted_at is null and a.status in ('assigned','accepted') and a.target_id is not null
  ) then raise exception 'A residential parcel may belong to only one active nightly target.' using errcode='23505'; end if;

  if exists(
    select 1 from public.outreach_walk_targets t
    join public.outreach_outings o on o.church_id=t.church_id and o.id=t.outing_id
    where t.church_id=target_church and t.deleted_at is null and t.finished_at is null and o.deleted_at is null
      and not exists(select 1 from public.outreach_walk_target_parcels tp where tp.church_id=t.church_id and tp.target_id=t.id)
      and (exists(select 1 from public.outreach_assignments a where a.church_id=t.church_id and a.target_id=t.id and a.deleted_at is null and a.status='accepted')
        or (o.status in ('ready','active') and exists(select 1 from public.outreach_assignments a
          where a.church_id=t.church_id and a.target_id=t.id and a.deleted_at is null and a.status in ('assigned','accepted'))))
  ) then raise exception 'A target needs at least one residential parcel before readiness or acceptance.' using errcode='22023'; end if;
end $$;
revoke all on function private.outreach_validate_walk_target_state(uuid) from public,anon,authenticated;

create or replace function public.outreach_read_records(target_church uuid,entity_kind text,after_id text default '',page_size integer default 500)
returns table(id text,version bigint,record jsonb)
language plpgsql stable security invoker set search_path='' as $$
declare tab text; key_expression text:='r.id::text'; version_expression text:='r.version'; live_filter text:=' and r.deleted_at is null';
begin
  if auth.uid() is null or not private.is_church_member(target_church) then raise exception 'Active church membership is required.' using errcode='42501'; end if;
  if entity_kind='target_progress' then
    return query select jsonb_build_array(p.target_id,p.county_fips,p.gislink)::text,1::bigint,
      jsonb_build_object('church_id',target_church,'target_id',p.target_id,'county_fips',p.county_fips,'gislink',p.gislink)
      from public.outreach_target_progress(target_church) p
      where jsonb_build_array(p.target_id,p.county_fips,p.gislink)::text>coalesce(after_id,'') order by 1 limit least(greatest(coalesce(page_size,500),1),750);
    return;
  end if;
  if entity_kind='parent_progress' then
    return query select jsonb_build_array(p.territory_id,p.outing_id,p.county_fips,p.gislink)::text,1::bigint,
      jsonb_build_object('church_id',target_church,'territory_id',p.territory_id,'outing_id',p.outing_id,'county_fips',p.county_fips,'gislink',p.gislink)
      from public.outreach_parent_progress(target_church) p
      where jsonb_build_array(p.territory_id,p.outing_id,p.county_fips,p.gislink)::text>coalesce(after_id,'') order by 1 limit least(greatest(coalesce(page_size,500),1),750);
    return;
  end if;
  tab:=case entity_kind when 'event' then 'outreach_outings' when 'participant' then 'outreach_outing_participants'
    when 'team' then 'outreach_teams' when 'team_member' then 'outreach_team_members' when 'territory' then 'outreach_territories'
    when 'target' then 'outreach_walk_targets' when 'target_parcel' then 'outreach_walk_target_parcels'
    when 'assignment' then 'outreach_assignments' when 'property' then 'outreach_locations' when 'visit' then 'outreach_encounters'
    when 'follow_up' then 'outreach_tasks' when 'task_activity' then 'outreach_task_activity' when 'resident' then 'discipleship_people'
    when 'person_note' then 'discipleship_person_notes' when 'restriction' then 'outreach_restrictions' when 'audit' then 'outreach_audit'
    when 'migration_issue' then 'outreach_migration_issues' else null end;
  if tab is null then raise exception 'Unknown record type.' using errcode='22023'; end if;
  if entity_kind='team_member' then key_expression:='jsonb_build_array(r.team_id,r.volunteer_id)::text';version_expression:='1::bigint';live_filter:='';
  elsif entity_kind='target_parcel' then key_expression:='jsonb_build_array(r.target_id,r.county_fips,r.gislink)::text';version_expression:='1::bigint';live_filter:='';
  elsif entity_kind='task_activity' then key_expression:='jsonb_build_array(r.task_id,r.id)::text';version_expression:='1::bigint';live_filter:='';
  elsif entity_kind='audit' then key_expression:='lpad(r.sequence::text,20,''0'')';version_expression:='1::bigint';live_filter:='';
  elsif entity_kind='migration_issue' then key_expression:='jsonb_build_array(r.entity_type,r.entity_id,r.issue)::text';version_expression:='1::bigint';live_filter:=' and r.resolved_at is null';
  elsif entity_kind='restriction' then live_filter:=''; end if;
  return query execute format('select %s,%s,to_jsonb(r) from public.%I r where r.church_id=$1 and %s>$2 %s order by %s limit $3',key_expression,version_expression,tab,key_expression,live_filter,key_expression)
    using target_church,coalesce(after_id,''),least(greatest(coalesce(page_size,500),1),750);
end $$;
revoke all on function public.outreach_read_records(uuid,text,text,integer) from public,anon;
grant execute on function public.outreach_read_records(uuid,text,text,integer) to authenticated;

commit;
