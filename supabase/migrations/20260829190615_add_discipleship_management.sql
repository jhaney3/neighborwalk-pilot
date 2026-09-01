begin;

alter table public.workspace_snapshots disable trigger workspace_snapshots_version_update;

update public.workspace_snapshots as snapshot
set
  data = jsonb_set(
    jsonb_set(
      jsonb_set(
        snapshot.data,
        '{schemaVersion}',
        to_jsonb(8),
        true
      ),
      '{residents}',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'discipleshipStage', 'new_connection',
            'assignedVolunteerId', coalesce(
              nullif(snapshot.data #>> '{preferences,activeVolunteerId}', ''),
              'volunteer_migration'
            ),
            'status', 'active'
          ) || (resident.value - 'notes')
          order by resident.ordinality
        )
        from jsonb_array_elements(
          case
            when jsonb_typeof(snapshot.data -> 'residents') = 'array' then snapshot.data -> 'residents'
            else '[]'::jsonb
          end
        ) with ordinality as resident(value, ordinality)
      ), '[]'::jsonb),
      true
    ),
    '{personNotes}',
    (
      case
        when jsonb_typeof(snapshot.data -> 'personNotes') = 'array' then snapshot.data -> 'personNotes'
        else '[]'::jsonb
      end
    ) || coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', 'person_note_legacy_' || (resident.value ->> 'id'),
          'churchId', coalesce(resident.value ->> 'churchId', snapshot.church_id::text),
          'residentId', resident.value ->> 'id',
          'authorId', coalesce(
            nullif(resident.value ->> 'assignedVolunteerId', ''),
            nullif(snapshot.data #>> '{preferences,activeVolunteerId}', ''),
            'volunteer_migration'
          ),
          'kind', 'general',
          'body', btrim(resident.value ->> 'notes'),
          'createdAt', coalesce(
            nullif(resident.value ->> 'createdAt', ''),
            to_char(snapshot.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          )
        )
        order by resident.ordinality
      )
      from jsonb_array_elements(
        case
          when jsonb_typeof(snapshot.data -> 'residents') = 'array' then snapshot.data -> 'residents'
          else '[]'::jsonb
        end
      ) with ordinality as resident(value, ordinality)
      where nullif(btrim(resident.value ->> 'notes'), '') is not null
        and nullif(resident.value ->> 'id', '') is not null
    ), '[]'::jsonb),
    true
  ),
  schema_version = 8,
  revision = revision + 1,
  updated_at = now()
where schema_version < 8;

alter table public.workspace_snapshots enable trigger workspace_snapshots_version_update;

create or replace function private.guard_workspace_schema_floor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.schema_version >= 8 and new.schema_version < 8 then
    raise exception 'This workspace requires a newer NeighborWalk app version';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_workspace_schema_floor() from public, anon, authenticated;

comment on function private.guard_workspace_schema_floor() is
  'Prevents older clients from dropping discipleship ownership, care plans, and person note history introduced in schema version 8.';

commit;
