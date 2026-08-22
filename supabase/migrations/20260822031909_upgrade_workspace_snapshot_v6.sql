create or replace function private.guard_workspace_schema_floor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.schema_version >= 6 and new.schema_version < 6 then
    raise exception 'This workspace requires a newer NeighborWalk app version';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_snapshot_schema_floor on public.workspace_snapshots;
create trigger workspace_snapshot_schema_floor
before update of schema_version on public.workspace_snapshots
for each row execute function private.guard_workspace_schema_floor();

revoke all on function private.guard_workspace_schema_floor() from public, anon, authenticated;

alter table public.workspace_snapshots disable trigger workspace_snapshots_version_update;

update public.workspace_snapshots
set
  data = jsonb_set(
    jsonb_set(data, '{residents}', coalesce(data -> 'residents', '[]'::jsonb), true),
    '{followUps}',
    coalesce((
      select jsonb_agg(
        case
          when follow_up.value ? 'history' then follow_up.value
          else follow_up.value || jsonb_build_object('history', '[]'::jsonb)
        end
        order by follow_up.ordinality
      )
      from jsonb_array_elements(coalesce(data -> 'followUps', '[]'::jsonb))
        with ordinality as follow_up(value, ordinality)
    ), '[]'::jsonb),
    true
  ),
  schema_version = 6,
  revision = revision + 1,
  updated_at = now()
where schema_version < 6;

alter table public.workspace_snapshots enable trigger workspace_snapshots_version_update;

comment on function private.guard_workspace_schema_floor() is
  'Prevents older clients from downgrading a version 6 workspace and dropping newer privacy fields.';
