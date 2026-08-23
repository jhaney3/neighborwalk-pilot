begin;

-- Approval and retention records now live outside NeighborWalk. Remove the
-- snapshot guard before converting existing workspaces so no person, visit,
-- or follow-up record is discarded during the upgrade.
drop trigger if exists workspace_snapshot_resident_consent on public.workspace_snapshots;
drop function if exists private.guard_workspace_resident_consent();

alter table public.churches
  drop column if exists require_follow_up_consent;

alter table public.workspace_snapshots disable trigger workspace_snapshots_version_update;

update public.workspace_snapshots as snapshot
set
  data = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          snapshot.data #- '{church,requireFollowUpConsent}',
          '{schemaVersion}',
          to_jsonb(7),
          true
        ),
        '{visits}',
        coalesce((
          select jsonb_agg(visit.value - 'followUpConsent' order by visit.ordinality)
          from jsonb_array_elements(
            case
              when jsonb_typeof(snapshot.data -> 'visits') = 'array' then snapshot.data -> 'visits'
              else '[]'::jsonb
            end
          ) with ordinality as visit(value, ordinality)
        ), '[]'::jsonb),
        true
      ),
      '{residents}',
      coalesce((
        select jsonb_agg(
          resident.value - 'consentToStore' - 'consentToContact' - 'consentRecordedAt'
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
    '{audit}',
    coalesce((
      select jsonb_agg(
        case
          when audit.value ->> 'summary' like 'Permission-based person record %' then
            jsonb_set(
              audit.value,
              '{summary}',
              to_jsonb(regexp_replace(audit.value ->> 'summary', '^Permission-based person record ', 'Person record ')),
              true
            )
          when audit.value ->> 'summary' = 'Person record deleted or permission withdrawn' then
            jsonb_set(audit.value, '{summary}', to_jsonb('Person record deleted'::text), true)
          else audit.value
        end
        order by audit.ordinality
      )
      from jsonb_array_elements(
        case
          when jsonb_typeof(snapshot.data -> 'audit') = 'array' then snapshot.data -> 'audit'
          else '[]'::jsonb
        end
      ) with ordinality as audit(value, ordinality)
    ), '[]'::jsonb),
    true
  ),
  schema_version = 7,
  revision = revision + 1,
  updated_at = now()
where schema_version < 7
   or snapshot.data #> '{church,requireFollowUpConsent}' is not null
   or exists (
     select 1
     from jsonb_array_elements(
       case
         when jsonb_typeof(snapshot.data -> 'visits') = 'array' then snapshot.data -> 'visits'
         else '[]'::jsonb
       end
     ) as visit(value)
     where visit.value ? 'followUpConsent'
   )
   or exists (
     select 1
     from jsonb_array_elements(
       case
         when jsonb_typeof(snapshot.data -> 'residents') = 'array' then snapshot.data -> 'residents'
         else '[]'::jsonb
       end
     ) as resident(value)
     where resident.value ?| array['consentToStore', 'consentToContact', 'consentRecordedAt']
   );

alter table public.workspace_snapshots enable trigger workspace_snapshots_version_update;

create or replace function private.guard_workspace_schema_floor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.schema_version >= 7 and new.schema_version < 7 then
    raise exception 'This workspace requires a newer NeighborWalk app version';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_workspace_schema_floor() from public, anon, authenticated;

comment on function private.guard_workspace_schema_floor() is
  'Prevents older clients from restoring removed in-app approval fields or dropping schema version 7 records.';

commit;
