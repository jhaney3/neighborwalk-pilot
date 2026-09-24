begin;
-- Metadata only: never store Apple codes/tokens or account email in this queue.
alter table private.account_deletion_requests
  add column apple_revoked_at timestamptz,
  add column last_apple_attempt_at timestamptz;

create function public.begin_account_deletion_apple_attempt(request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Edge-only throttle, also serialized across multiple instances.
  if not exists(select 1 from private.account_deletion_requests r where r.id=request_id) then
    raise exception 'Unknown deletion request' using errcode='22023'; end if;
  update private.account_deletion_requests r set last_apple_attempt_at=clock_timestamp()
    where r.id=request_id and (r.last_apple_attempt_at is null or r.last_apple_attempt_at < clock_timestamp()-interval '1 minute');
  if not found then raise exception 'Try Apple confirmation again in one minute' using errcode='P0001'; end if;
end $$;
revoke all on function public.begin_account_deletion_apple_attempt(uuid) from public,anon,authenticated;
grant execute on function public.begin_account_deletion_apple_attempt(uuid) to service_role;

create function public.record_account_deletion_apple_revocation(request_id uuid, apple_subject text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.account_deletion_requests r set apple_revoked_at=clock_timestamp()
  where r.id=request_id and exists(select 1 from auth.identities i where i.user_id=r.user_id
    and i.provider='apple' and i.provider_id=apple_subject);
  if not found then raise exception 'Deletion request identity mismatch' using errcode='22023'; end if;
end $$;
revoke all on function public.record_account_deletion_apple_revocation(uuid,text) from public,anon,authenticated;
grant execute on function public.record_account_deletion_apple_revocation(uuid,text) to service_role;

-- Counts-only operator inventory. No public client receives personal content.
create function private.account_deletion_inventory(request_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r private.account_deletion_requests; result jsonb; item record; count_rows bigint;
begin
  select * into strict r from private.account_deletion_requests where id=request_id;
  result := jsonb_build_object('request_id',r.id,'requested_at',r.requested_at,'due_at',r.due_at,
    'apple_required',exists(select 1 from auth.identities where user_id=r.user_id and provider='apple'),
    'apple_revoked_at',r.apple_revoked_at,'references','[]'::jsonb);
  -- Discover direct and membership FKs instead of silently ignoring future tables.
  for item in
    select distinct n.nspname as schema_name,c.relname as table_name,a.attname as column_name
    from pg_constraint f join pg_class c on c.oid=f.conrelid join pg_namespace n on n.oid=c.relnamespace
      cross join lateral unnest(f.conkey,f.confkey) as keys(local_key,foreign_key)
      join pg_attribute a on a.attrelid=f.conrelid and a.attnum=keys.local_key
      join pg_attribute ref on ref.attrelid=f.confrelid and ref.attnum=keys.foreign_key
    where f.contype='f' and n.nspname in ('public','private','storage')
      and ((f.confrelid='auth.users'::regclass and ref.attname='id')
        or (f.confrelid='public.church_memberships'::regclass and ref.attname='user_id'))
  loop
    execute format('select count(*) from %I.%I where %I=$1', item.schema_name,item.table_name,item.column_name) into count_rows using r.user_id;
    result := jsonb_set(result,'{references}',result->'references'||jsonb_build_array(jsonb_build_object(
      'table',item.schema_name||'.'||item.table_name,'column',item.column_name,'rows',count_rows)));
  end loop;
  return result || jsonb_build_object('manual_review_required',jsonb_build_array(
    'Auth identities, sessions, refresh tokens and provider authorization',
    'Shared church ownership, reassignment and authored content',
    'JSON snapshots, migration checkpoints, audit details, receipts, history and free text',
    'Member UUID arrays, contact-addressed invitations, reminder recipient/provider records',
    'Storage objects, retained exports, provider logs and backup retention',
    'Offline devices and pending work; deletion does not remotely wipe device storage',
    'Confirmation contact captured securely before Auth erasure'));
end $$;
revoke all on function private.account_deletion_inventory(uuid) from public,anon,authenticated;
comment on function private.account_deletion_inventory(uuid) is 'Operator-only counts inventory; not proof of erasure or complete free-text discovery. No automatic retention exemption.';
commit;
