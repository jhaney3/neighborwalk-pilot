begin;

-- Keep the upgrade safe for databases that already applied the original walk-target
-- migration. Rebuild the existing function definition with the one intentionally
-- narrow validation change instead of duplicating its large transactional body.
do $migration$
declare
  current_definition text;
  updated_definition text;
  old_validation constant text := 'or parcel->>''inclusionSource''<>''manual_add'' and not extensions.st_covers(target_scope,extensions.st_pointonsurface(authoritative_parcel.geometry))';
  new_validation constant text := 'or parcel->>''inclusionSource''<>''manual_add'' and not extensions.st_intersects(target_scope,authoritative_parcel.geometry)';
begin
  select pg_get_functiondef('private.outreach_apply_operation(uuid,uuid,text,jsonb)'::regprocedure)
    into current_definition;
  updated_definition := replace(current_definition, old_validation, new_validation);
  if updated_definition = current_definition then
    raise exception 'Expected walk-target parcel validation definition was not found.';
  end if;
  execute updated_definition;
end
$migration$;

commit;
