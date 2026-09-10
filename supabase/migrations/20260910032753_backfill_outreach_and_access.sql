begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function private.outreach_member_id(target_church uuid, volunteer_key text)
returns uuid language sql stable set search_path = '' as $$
  select user_id from public.church_memberships
  where church_id=target_church and private.volunteer_id_for_user(user_id)=volunteer_key;
$$;
revoke all on function private.outreach_member_id(uuid,text) from public,anon,authenticated;

insert into public.outreach_outings(church_id,id,name,starts_at,ends_at,timezone,status)
select s.church_id,v->>'id',v->>'name',(v->>'startsAt')::timestamptz,(v->>'endsAt')::timestamptz,
  s.data#>>'{church,timezone}',v->>'status'
from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'events') v;

insert into public.outreach_teams(church_id,id,name,status,legacy_event_id)
select s.church_id,v->>'id',v->>'name',v->>'status',v->>'eventId'
from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'teams') v;

insert into public.outreach_team_members(church_id,team_id,volunteer_id,user_id)
select distinct s.church_id,v->>'id',member_id,private.outreach_member_id(s.church_id,member_id)
from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'teams') v
cross join lateral jsonb_array_elements_text(v->'memberIds') member_id;

insert into public.outreach_territories(church_id,id,name,color,longitude,latitude,zoom,boundary,legacy_event_id)
select s.church_id,v->>'id',v->>'name',v->>'color',(v#>>'{center,0}')::double precision,
  (v#>>'{center,1}')::double precision,(v->>'zoom')::double precision,v->'boundary',v->>'eventId'
from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'territories') v;

insert into public.outreach_assignments(church_id,id,outing_id,territory_id,team_id)
select s.church_id,'assignment_legacy_'||(v->>'id'),o.id,t.id,g.id
from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'territories') v
join public.outreach_outings o on o.church_id=s.church_id and o.id=v->>'eventId'
join public.outreach_territories t on t.church_id=s.church_id and t.id=v->>'id'
join public.outreach_teams g on g.church_id=s.church_id and g.id=v->>'assignedTeamId';

insert into public.outreach_locations(church_id,id,territory_id,legacy_territory_id,address,unit,longitude,latitude,building_geometry,parcel_reference,source,created_at,updated_at)
select s.church_id,v->>'id',t.id,v->>'territoryId',v->>'address',nullif(v->>'unit',''),
  (v#>>'{coordinates,0}')::double precision,(v#>>'{coordinates,1}')::double precision,
  nullif(v->'buildingGeometry','null'),nullif(v->'parcel','null'),v->>'source',
  (v->>'createdAt')::timestamptz,(v->>'updatedAt')::timestamptz
from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'properties') v
left join public.outreach_territories t on t.church_id=s.church_id and t.id=v->>'territoryId';

alter table public.discipleship_people add column legacy_property_id text;
alter table public.discipleship_people add column legacy_creator_access boolean not null default false;
-- Preserve historical creator visibility until an explicit reviewed handoff.
-- New records do not acquire permanent access merely through their creator.
alter table public.discipleship_people disable trigger discipleship_people_touch_updated_at;
update public.discipleship_people set legacy_creator_access=true,legacy_property_id=property_id;
insert into public.outreach_migration_issues(church_id,entity_type,entity_id,issue)
select church_id,'person',id,'Legacy location no longer exists; the original reference is preserved for review.'
from public.discipleship_people p where p.property_id is not null and not exists (
  select 1 from public.outreach_locations l where l.church_id=p.church_id and l.id=p.property_id);
update public.discipleship_people p set property_id=null
where p.property_id is not null and not exists (
  select 1 from public.outreach_locations l where l.church_id=p.church_id and l.id=p.property_id);
alter table public.discipleship_people enable trigger discipleship_people_touch_updated_at;
alter table public.discipleship_people add constraint discipleship_person_location_church_fkey
  foreign key (church_id,property_id) references public.outreach_locations(church_id,id);
create index discipleship_people_location_idx on public.discipleship_people(church_id,property_id);

insert into public.outreach_encounters(church_id,id,outing_id,territory_id,location_id,legacy_links,actor_id,actor_key,outcome,objective_note,occurred_at,device_id)
select s.church_id,v->>'id',o.id,t.id,l.id,
  jsonb_build_object('eventId',v->>'eventId','territoryId',v->>'territoryId','propertyId',v->>'propertyId'),
  private.outreach_member_id(s.church_id,v->>'volunteerId'),v->>'volunteerId',v->>'outcome',
  nullif(v->>'objectiveNote',''),(v->>'recordedAt')::timestamptz,v->>'deviceId'
from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'visits') v
left join public.outreach_outings o on o.church_id=s.church_id and o.id=v->>'eventId'
left join public.outreach_territories t on t.church_id=s.church_id and t.id=v->>'territoryId'
left join public.outreach_locations l on l.church_id=s.church_id and l.id=v->>'propertyId';

insert into public.outreach_tasks(church_id,id,location_id,encounter_id,outing_id,team_id,created_by,due_date,status,note,completion_note,parent_task_id,legacy_links,legacy_due_at,created_at,completed_at)
select s.church_id,v->>'id',l.id,e.id,e.outing_id,g.id,
  private.outreach_member_id(s.church_id,v#>>'{history,0,actorId}'),
  ((v->>'dueAt')::timestamptz at time zone (s.data#>>'{church,timezone}'))::date,
  v->>'status',nullif(v->>'note',''),nullif(v->>'completionNote',''),v->>'parentFollowUpId',
  jsonb_build_object('propertyId',v->>'propertyId','sourceVisitId',v->>'sourceVisitId','assignedTeamId',v->>'assignedTeamId'),
  (v->>'dueAt')::timestamptz,(v->>'createdAt')::timestamptz,(v->>'completedAt')::timestamptz
from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'followUps') v
left join public.outreach_locations l on l.church_id=s.church_id and l.id=v->>'propertyId'
left join public.outreach_encounters e on e.church_id=s.church_id and e.id=v->>'sourceVisitId'
left join public.outreach_teams g on g.church_id=s.church_id and g.id=v->>'assignedTeamId'
where nullif(v->>'residentId','') is null;

insert into public.outreach_tasks(church_id,id,person_id,location_id,encounter_id,outing_id,owner_id,created_by,due_date,status,note,completion_note,parent_task_id,legacy_links,legacy_due_at,created_at,completed_at)
select f.church_id,f.id,f.person_id,l.id,e.id,e.outing_id,p.assigned_to,f.created_by,
  (f.due_at at time zone c.timezone)::date,f.status,f.note,f.completion_note,f.parent_follow_up_id,
  jsonb_build_object('propertyId',f.property_id,'sourceVisitId',f.source_visit_id),f.due_at,f.created_at,f.completed_at
from public.discipleship_follow_ups f
join public.discipleship_people p on p.id=f.person_id and p.church_id=f.church_id
join public.churches c on c.id=f.church_id
left join public.outreach_locations l on l.id=f.property_id and l.church_id=f.church_id
left join public.outreach_encounters e on e.id=f.source_visit_id and e.church_id=f.church_id;

insert into public.outreach_task_activity(church_id,task_id,id,action,actor_id,actor_key,note,due_date,occurred_at)
select s.church_id,v->>'id',h->>'id',h->>'action',private.outreach_member_id(s.church_id,h->>'actorId'),
  h->>'actorId',nullif(h->>'note',''),((h->>'dueAt')::timestamptz at time zone (s.data#>>'{church,timezone}'))::date,(h->>'createdAt')::timestamptz
from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'followUps') v
cross join lateral jsonb_array_elements(coalesce(v->'history','[]')) h
where nullif(v->>'residentId','') is null;

insert into public.outreach_task_activity(church_id,task_id,id,action,actor_id,actor_key,note,due_date,occurred_at)
select f.church_id,f.id,h->>'id',h->>'action',private.outreach_member_id(f.church_id,h->>'actorId'),
  h->>'actorId',nullif(h->>'note',''),((h->>'dueAt')::timestamptz at time zone c.timezone)::date,(h->>'createdAt')::timestamptz
from public.discipleship_follow_ups f join public.churches c on c.id=f.church_id
cross join lateral jsonb_array_elements(f.history) h;

-- Restrictions are separate facts: old outcomes can never erase them.
insert into public.outreach_restrictions(church_id,id,location_id,channel,reason,created_at)
select distinct s.church_id,'restriction_legacy_'||l.id,l.id,'visit','Existing do-not-visit request preserved during migration.',
  coalesce((select min(e.occurred_at) from public.outreach_encounters e where e.church_id=s.church_id and e.location_id=l.id and e.outcome='do_not_visit'),l.updated_at)
from public.workspace_snapshots s cross join lateral jsonb_array_elements(s.data->'properties') v
join public.outreach_locations l on l.church_id=s.church_id and l.id=v->>'id'
where v->>'currentOutcome'='do_not_visit' or exists (
  select 1 from public.outreach_encounters e where e.church_id=s.church_id and e.location_id=l.id and e.outcome='do_not_visit');

insert into public.outreach_migration_issues(church_id,entity_type,entity_id,issue)
select church_id,'location',id,'Legacy territory missing; location retained in the unassigned list.'
from public.outreach_locations where territory_id is null
union all
select church_id,'encounter',id,'One or more legacy links are missing; the original IDs and encounter are preserved.'
from public.outreach_encounters where outing_id is null or territory_id is null or location_id is null
union all
select church_id,'task',id,'No individual owner was recorded. A leader must assign this existing follow-up.'
from public.outreach_tasks where owner_id is null and status='scheduled';

-- Preserve an audit-only copy of the old church metadata before unifying it.
create table private.outreach_migration_checkpoints (
  church_id uuid primary key references public.churches(id),
  original_church jsonb not null,
  snapshot_revision bigint not null,
  migrated_at timestamptz not null default now()
);
alter table private.outreach_migration_checkpoints enable row level security;
revoke all on private.outreach_migration_checkpoints from public,anon,authenticated;
insert into private.outreach_migration_checkpoints(church_id,original_church,snapshot_revision)
select c.id,to_jsonb(c),s.revision from public.churches c join public.workspace_snapshots s on s.church_id=c.id;
update public.churches c set name=s.data#>>'{church,name}',timezone=s.data#>>'{church,timezone}',
  retention_days=(s.data#>>'{church,retentionDays}')::integer,
  default_follow_up_days=(s.data#>>'{church,defaultFollowUpDays}')::integer,
  note_character_limit=(s.data#>>'{church,noteCharacterLimit}')::integer
from public.workspace_snapshots s where s.church_id=c.id;

create or replace function private.can_view_discipleship_person(target_person_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.is_real_user() and exists (
    select 1 from public.discipleship_people p where p.id=target_person_id
    and p.deleted_at is null and private.is_church_member(p.church_id)
    and (private.is_church_leader(p.church_id) or p.assigned_to=auth.uid()
      or (p.legacy_creator_access and p.created_by=auth.uid()) or auth.uid()=any(p.shared_user_ids)
      or exists(select 1 from public.outreach_team_members m join public.outreach_teams g on g.church_id=m.church_id and g.id=m.team_id
        where m.church_id=p.church_id and m.user_id=auth.uid() and m.team_id=any(p.shared_team_ids) and g.deleted_at is null)));
$$;

create or replace function private.can_manage_discipleship_person(target_person_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.is_real_user() and exists (
    select 1 from public.discipleship_people p where p.id=target_person_id and p.deleted_at is null
      and private.is_church_member(p.church_id) and (private.is_church_leader(p.church_id) or p.assigned_to=auth.uid()));
$$;

create or replace function private.valid_discipleship_people_access(target_church_id uuid,target_assignee uuid,target_shared_users uuid[],target_shared_teams text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.is_church_member(target_church_id)
    and exists(select 1 from public.church_memberships m where m.church_id=target_church_id and m.user_id=target_assignee and m.active)
    and not exists(select 1 from unnest(target_shared_users) u where not exists(select 1 from public.church_memberships m where m.church_id=target_church_id and m.user_id=u and m.active))
    and not exists(select 1 from unnest(target_shared_teams) t where not exists(select 1 from public.outreach_teams g where g.church_id=target_church_id and g.id=t and g.deleted_at is null));
$$;

create function private.can_view_outreach_task(target_church uuid,target_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.is_church_member(target_church) and exists (
    select 1 from public.outreach_tasks t where t.church_id=target_church and t.id=target_id and t.deleted_at is null
      and (t.person_id is null or private.can_view_discipleship_person(t.person_id)));
$$;
revoke all on function private.can_view_outreach_task(uuid,text) from public,anon;
grant execute on function private.can_view_outreach_task(uuid,text) to authenticated;

do $$ declare tab text; begin
  foreach tab in array array['outreach_outings','outreach_teams','outreach_territories','outreach_assignments','outreach_locations'] loop
    execute format('create policy member_read on public.%I for select to authenticated using (deleted_at is null and (select private.is_church_member(church_id)))',tab);
  end loop;
end $$;
create policy member_read on public.outreach_team_members for select to authenticated
  using ((select private.is_church_member(church_id)));
create policy permitted_encounter_read on public.outreach_encounters for select to authenticated
  using (deleted_at is null and (select private.is_church_member(church_id)) and (person_id is null or private.can_view_discipleship_person(person_id)));
create policy permitted_task_read on public.outreach_tasks for select to authenticated
  using (deleted_at is null and (select private.is_church_member(church_id)) and (person_id is null or private.can_view_discipleship_person(person_id)));
create policy permitted_activity_read on public.outreach_task_activity for select to authenticated
  using (private.can_view_outreach_task(church_id,task_id));
create policy permitted_restriction_read on public.outreach_restrictions for select to authenticated
  using ((select private.is_church_member(church_id)) and (person_id is null or private.can_view_discipleship_person(person_id)));
create policy audit_leader_or_actor_read on public.outreach_audit for select to authenticated
  using ((select private.is_church_member(church_id)) and (actor_id=(select auth.uid()) or (select private.is_church_leader(church_id))));
create policy migration_leader_read on public.outreach_migration_issues for select to authenticated
  using ((select private.is_church_leader(church_id)));

-- Existing person/note writes also join the command transaction; old clients
-- must not bypass ownership/version/audit checks through their former tables.
revoke insert,update,delete on public.discipleship_people,public.discipleship_person_notes,public.discipleship_follow_ups from authenticated,anon;

commit;
