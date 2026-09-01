begin;

-- The authenticated user who first logs a person is always both creator and
-- initial discipleship owner. Reassignment remains available after creation.
create or replace function private.assign_discipleship_person_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is not null then
    new.created_by := actor_id;
    new.assigned_to := actor_id;
  end if;
  return new;
end;
$$;

drop trigger if exists discipleship_people_assign_creator on public.discipleship_people;
create trigger discipleship_people_assign_creator
before insert on public.discipleship_people
for each row execute function private.assign_discipleship_person_creator();

drop policy if exists discipleship_people_creator_insert on public.discipleship_people;
create policy discipleship_people_creator_insert
on public.discipleship_people for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and assigned_to = (select auth.uid())
  and (select private.valid_discipleship_people_access(church_id, assigned_to, shared_user_ids, shared_team_ids))
);

revoke all on function private.assign_discipleship_person_creator() from public, anon, authenticated;

commit;
