create or replace function private.guard_workspace_snapshot_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed_keys text[] := array[
    'properties',
    'visits',
    'followUps',
    'residents',
    'audit',
    'preferences',
    'sync',
    'updatedAt'
  ];
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
    and not (select private.is_church_leader(old.church_id))
    and (
      (new.data - allowed_keys) is distinct from (old.data - allowed_keys)
      or new.schema_version is distinct from old.schema_version
    )
  then
    raise exception 'Only a church leader can change territories, teams, members, events, the guide, or church settings.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function private.guard_workspace_resident_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resident jsonb;
  residents jsonb := coalesce(new.data -> 'residents', '[]'::jsonb);
  contact_preference text;
begin
  if jsonb_typeof(residents) <> 'array' then
    raise exception 'Residents must be stored as an array';
  end if;

  if tg_op = 'UPDATE'
    and old.data ? 'residents'
    and jsonb_array_length(coalesce(old.data -> 'residents', '[]'::jsonb)) > 0
    and not (new.data ? 'residents') then
    raise exception 'This client cannot remove existing resident records; update the app and try again';
  end if;

  for resident in select value from jsonb_array_elements(residents)
  loop
    if coalesce(resident ->> 'id', '') = ''
      or coalesce(resident ->> 'propertyId', '') = '' then
      raise exception 'Every resident record must identify its record and property';
    end if;

    if coalesce((resident ->> 'consentToStore')::boolean, false) is not true
      or coalesce(resident ->> 'consentRecordedAt', '') = '' then
      raise exception 'Resident information requires recorded permission to store it';
    end if;

    contact_preference := coalesce(resident ->> 'preferredContact', 'none');
    if (
      coalesce(resident ->> 'phone', '') <> ''
      or coalesce(resident ->> 'email', '') <> ''
      or contact_preference <> 'none'
    ) and coalesce((resident ->> 'consentToContact')::boolean, false) is not true then
      raise exception 'Contact information requires recorded permission to contact';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists workspace_snapshot_resident_consent on public.workspace_snapshots;
create trigger workspace_snapshot_resident_consent
before insert or update of data on public.workspace_snapshots
for each row execute function private.guard_workspace_resident_consent();

revoke all on function private.guard_workspace_snapshot_role() from public, anon, authenticated;
revoke all on function private.guard_workspace_resident_consent() from public, anon, authenticated;

comment on function private.guard_workspace_resident_consent() is
  'Rejects resident information unless permission to store and, when applicable, permission to contact are recorded.';
