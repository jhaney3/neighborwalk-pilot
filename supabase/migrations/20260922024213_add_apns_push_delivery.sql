begin;

-- APNs tokens are credentials for a specific app installation. Keep them out
-- of exposed schemas and never copy outreach data into the delivery queue.
create table private.apns_devices (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id uuid not null references auth.sessions(id) on delete cascade,
  installation_id uuid not null,
  device_token text not null,
  apns_environment text not null check (apns_environment in ('sandbox','production')),
  active boolean not null default true,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text check (disabled_reason is null or disabled_reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  unique(user_id,installation_id),
  unique(id,user_id),
  check (device_token ~ '^[0-9a-f]+$' and length(device_token) between 16 and 512 and length(device_token)%2=0),
  check ((active and disabled_at is null and disabled_reason is null) or not active)
);
create unique index apns_devices_live_token_idx
  on private.apns_devices(apns_environment,device_token) where active;
create index apns_devices_live_user_idx
  on private.apns_devices(user_id,updated_at desc) where active;
create index apns_devices_disabled_retention_idx
  on private.apns_devices(disabled_at) where not active;

create table private.apns_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  device_id uuid not null,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  event_kind text not null check(event_kind in ('walk_invitation','follow_up_assignment')),
  source_fingerprint text not null check(source_fingerprint ~ '^[0-9a-f]{64}$'),
  event_fingerprint text not null check(event_fingerprint ~ '^[0-9a-f]{64}$'),
  app_path text not null check(
    (event_kind='walk_invitation' and app_path ~ '^/app/outreach(/[A-Za-z0-9_-]{1,240})?$')
    or (event_kind='follow_up_assignment' and app_path ~ '^/app/followups(/[A-Za-z0-9_-]{1,240})?$')
  ),
  status text not null default 'pending' check(status in ('pending','leased','retry','delivered','failed')),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0 check(attempts between 0 and 8),
  last_reason text check(last_reason is null or last_reason ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  apns_id uuid not null default extensions.gen_random_uuid(),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  finished_at timestamptz,
  unique(device_id,event_fingerprint),
  foreign key(device_id,recipient_user_id) references private.apns_devices(id,user_id) on delete cascade,
  check(
    (status='leased' and lease_token is not null and lease_until is not null)
    or (status<>'leased' and lease_token is null and lease_until is null)
  )
);
create index apns_outbox_ready_idx
  on private.apns_outbox(available_at,created_at)
  where status in ('pending','retry','leased');
create index apns_outbox_device_open_idx
  on private.apns_outbox(device_id,status)
  where status in ('pending','retry','leased');
create index apns_outbox_finished_retention_idx
  on private.apns_outbox(finished_at) where status in ('delivered','failed');
create index apns_outbox_expired_lease_idx
  on private.apns_outbox(lease_until) where status='leased';

alter table private.apns_devices enable row level security;
alter table private.apns_devices force row level security;
alter table private.apns_outbox enable row level security;
alter table private.apns_outbox force row level security;
revoke all on private.apns_devices,private.apns_outbox from public,anon,authenticated;

-- The authenticated-facing functions below are deliberately SECURITY DEFINER:
-- the token tables must stay private. Both functions re-check the live Auth
-- session and bind every mutation to auth.uid(); their names are the only
-- device-token surface granted to authenticated clients.
create function public.register_apns_device(
  target_installation_id uuid,
  target_device_token text,
  target_environment text default 'production'
)
returns table(device_id uuid,registered_at timestamptz)
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  actor_session uuid;
  normalized_token text:=lower(btrim(target_device_token));
  existing_device private.apns_devices;
begin
  if actor is null or not coalesce(private.is_real_user(),false) then
    raise exception 'A live signed-in session is required.' using errcode='42501';
  end if;
  if not exists(select 1 from public.church_memberships m where m.user_id=actor and m.active) then
    raise exception 'An active church membership is required.' using errcode='42501';
  end if;
  if target_installation_id is null or target_device_token is null or target_environment is null
    or target_environment not in ('sandbox','production')
    or normalized_token !~ '^[0-9a-f]+$' or length(normalized_token) not between 16 and 512
    or length(normalized_token)%2<>0 then
    raise exception 'Invalid APNs device registration.' using errcode='22023';
  end if;
  actor_session:=(auth.jwt()->>'session_id')::uuid;

  -- Serialize ownership changes for the same opaque APNs token. This permits a
  -- clean account switch without allowing one token to receive two accounts'
  -- notifications.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_environment||':'||normalized_token,0));
  select * into existing_device from private.apns_devices d
    where d.user_id=actor and d.installation_id=target_installation_id for update;

  update private.apns_outbox o set status='failed',last_reason='TokenReassigned',
      lease_token=null,lease_until=null,finished_at=now()
    where o.device_id in (
      select d.id from private.apns_devices d
      where d.apns_environment=target_environment and d.device_token=normalized_token
        and d.active and (existing_device.id is null or d.id<>existing_device.id)
    ) and o.status in ('pending','retry','leased');
  update private.apns_devices d set active=false,disabled_at=now(),disabled_reason='token_reassigned',updated_at=now()
    where d.apns_environment=target_environment and d.device_token=normalized_token
      and d.active and (existing_device.id is null or d.id<>existing_device.id);

  if existing_device.id is null then
    insert into private.apns_devices(user_id,auth_session_id,installation_id,device_token,apns_environment)
      values(actor,actor_session,target_installation_id,normalized_token,target_environment)
      returning * into existing_device;
  else
    update private.apns_devices d set auth_session_id=actor_session,device_token=normalized_token,apns_environment=target_environment,
      active=true,disabled_at=null,disabled_reason=null,updated_at=now(),registered_at=now()
      where d.id=existing_device.id returning * into existing_device;
  end if;
  return query select existing_device.id,existing_device.registered_at;
end;
$$;

create function public.unregister_apns_device(target_installation_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  target_device uuid;
begin
  if actor is null or not coalesce(private.is_real_user(),false) then
    raise exception 'A live signed-in session is required.' using errcode='42501';
  end if;
  select d.id into target_device from private.apns_devices d
    where d.user_id=actor and d.installation_id=target_installation_id for update;
  if target_device is null then return false; end if;
  update private.apns_devices set active=false,disabled_at=now(),disabled_reason='user_unregistered',updated_at=now()
    where id=target_device;
  update private.apns_outbox set status='failed',last_reason='UserUnregistered',
      lease_token=null,lease_until=null,finished_at=now()
    where device_id=target_device and status in ('pending','retry','leased');
  return true;
end;
$$;

revoke all on function public.register_apns_device(uuid,text,text) from public,anon;
revoke all on function public.unregister_apns_device(uuid) from public,anon;
grant execute on function public.register_apns_device(uuid,text,text) to authenticated;
grant execute on function public.unregister_apns_device(uuid) to authenticated;

create function private.enqueue_apns_event(
  target_user uuid,
  target_kind text,
  target_source text,
  target_occurrence text,
  target_path text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare source_hash text; fingerprint text;
begin
  if target_user is null or target_kind not in ('walk_invitation','follow_up_assignment') then return; end if;
  source_hash:=encode(extensions.digest(pg_catalog.convert_to(target_kind||':'||target_source,'UTF8'),'sha256'),'hex');
  fingerprint:=encode(extensions.digest(pg_catalog.convert_to(target_kind||':'||target_occurrence,'UTF8'),'sha256'),'hex');
  insert into private.apns_outbox(device_id,recipient_user_id,event_kind,source_fingerprint,event_fingerprint,app_path,apns_id)
    select d.id,target_user,target_kind,source_hash,fingerprint,target_path,extensions.gen_random_uuid()
    from private.apns_devices d
    join auth.sessions s on s.id=d.auth_session_id and s.user_id=d.user_id and (s.not_after is null or s.not_after>now())
    join auth.users u on u.id=d.user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    join public.church_memberships m on m.user_id=d.user_id and m.active
    where d.user_id=target_user and d.active
    on conflict(device_id,event_fingerprint) do nothing;
end;
$$;
revoke all on function private.enqueue_apns_event(uuid,text,text,text,text) from public,anon,authenticated;

create function private.cancel_apns_source(target_kind text,target_source text,target_reason text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare source_hash text;
begin
  source_hash:=encode(extensions.digest(pg_catalog.convert_to(target_kind||':'||target_source,'UTF8'),'sha256'),'hex');
  update private.apns_outbox set status='failed',last_reason=target_reason,lease_token=null,lease_until=null,finished_at=now()
    where event_kind=target_kind and source_fingerprint=source_hash and status in ('pending','retry','leased');
end;
$$;
revoke all on function private.cancel_apns_source(text,text,text) from public,anon,authenticated;

create function private.outing_invitation_apns_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare path text; source_key text; was_active boolean:=false; is_active boolean:=false;
begin
  source_key:=coalesce(new.church_id,old.church_id)::text||':'||coalesce(new.id,old.id);
  if tg_op<>'INSERT' then
    was_active:=old.deleted_at is null and old.status='invited' and old.user_id is not null;
  end if;
  if tg_op<>'DELETE' then
    is_active:=new.deleted_at is null and new.status='invited' and new.user_id is not null;
  end if;
  if was_active and (not is_active or old.user_id is distinct from new.user_id) then
    perform private.cancel_apns_source('walk_invitation',source_key,'SourceChanged');
  end if;
  if is_active and (not was_active or old.user_id is distinct from new.user_id) then
    perform private.cancel_apns_source('walk_invitation',source_key,'SourceChanged');
    path:=case when new.outing_id ~ '^[A-Za-z0-9_-]{1,240}$'
      then '/app/outreach/'||new.outing_id else '/app/outreach' end;
    perform private.enqueue_apns_event(new.user_id,'walk_invitation',
      source_key,new.church_id::text||':'||new.id||':'||new.user_id::text||':'||new.version::text,path);
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function private.outing_invitation_apns_trigger() from public,anon,authenticated;
create trigger outreach_outing_participant_apns
after insert or update or delete on public.outreach_outing_participants
for each row execute function private.outing_invitation_apns_trigger();

create function private.outing_lifecycle_apns_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare participant record;
begin
  if tg_op='DELETE' or new.deleted_at is not null
    or new.status not in ('draft','scheduled','ready','active') then
    for participant in
      select p.church_id,p.id from public.outreach_outing_participants p
      where p.church_id=coalesce(new.church_id,old.church_id)
        and p.outing_id=coalesce(new.id,old.id) and p.deleted_at is null and p.status='invited'
    loop
      perform private.cancel_apns_source('walk_invitation',participant.church_id::text||':'||participant.id,'SourceChanged');
    end loop;
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function private.outing_lifecycle_apns_trigger() from public,anon,authenticated;
create trigger outreach_outing_lifecycle_apns
after update of status,deleted_at or delete on public.outreach_outings
for each row execute function private.outing_lifecycle_apns_trigger();

create function private.follow_up_assignment_apns_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare path text; source_key text; was_active boolean:=false; is_active boolean:=false;
begin
  source_key:=coalesce(new.church_id,old.church_id)::text||':'||coalesce(new.id,old.id);
  if tg_op<>'INSERT' then
    was_active:=old.deleted_at is null and old.status='scheduled' and old.acceptance in ('pending','accepted') and old.owner_id is not null;
  end if;
  if tg_op<>'DELETE' then
    is_active:=new.deleted_at is null and new.status='scheduled' and new.acceptance in ('pending','accepted') and new.owner_id is not null;
  end if;
  if was_active and (not is_active or old.owner_id is distinct from new.owner_id) then
    perform private.cancel_apns_source('follow_up_assignment',source_key,'SourceChanged');
  end if;
  if is_active and (not was_active or old.owner_id is distinct from new.owner_id)
    and new.owner_id is distinct from auth.uid() then
    perform private.cancel_apns_source('follow_up_assignment',source_key,'SourceChanged');
    path:=case when new.id ~ '^[A-Za-z0-9_-]{1,240}$'
      then '/app/followups/'||new.id else '/app/followups' end;
    perform private.enqueue_apns_event(new.owner_id,'follow_up_assignment',
      source_key,new.church_id::text||':'||new.id||':'||new.owner_id::text||':'||new.version::text,path);
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function private.follow_up_assignment_apns_trigger() from public,anon,authenticated;
create trigger outreach_task_assignment_apns
after insert or update or delete on public.outreach_tasks
for each row execute function private.follow_up_assignment_apns_trigger();

create function private.membership_apns_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare target_user uuid;
begin
  target_user:=coalesce(new.user_id,old.user_id);
  if tg_op='DELETE' or (old.active and not new.active) then
    update private.apns_devices set active=false,disabled_at=now(),disabled_reason='membership_inactive',updated_at=now()
      where user_id=target_user and active;
    update private.apns_outbox set status='failed',last_reason='MembershipInactive',
      lease_token=null,lease_until=null,finished_at=now()
      where recipient_user_id=target_user and status in ('pending','retry','leased');
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function private.membership_apns_trigger() from public,anon,authenticated;
create trigger church_membership_apns
after update of active or delete on public.church_memberships
for each row execute function private.membership_apns_trigger();

-- Edge Functions call these invoker-rights RPCs using only the server-side
-- service role. Explicit private-schema grants avoid a public definer worker.
grant usage on schema private to service_role;
grant usage on schema extensions to service_role;
grant select,update,delete on private.apns_outbox to service_role;
grant select,update,delete on private.apns_devices to service_role;

create function private.prune_invalid_apns_devices()
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  update private.apns_devices d set active=false,disabled_at=now(),disabled_reason='session_revoked',updated_at=now()
    where d.active and not exists(
      select 1 from auth.sessions s join auth.users u on u.id=s.user_id
      where s.id=d.auth_session_id and s.user_id=d.user_id and (s.not_after is null or s.not_after>now())
        and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    );
  update private.apns_outbox o set status='failed',last_reason='MembershipInactive',
      lease_token=null,lease_until=null,finished_at=now()
    where o.status in ('pending','retry','leased') and not exists(
      select 1 from public.church_memberships m where m.user_id=o.recipient_user_id and m.active
    );
  update private.apns_devices d set active=false,disabled_at=now(),disabled_reason='membership_inactive',updated_at=now()
    where d.active and not exists(
      select 1 from public.church_memberships m where m.user_id=d.user_id and m.active
    );
end;
$$;
revoke all on function private.prune_invalid_apns_devices() from public,anon,authenticated;
grant execute on function private.prune_invalid_apns_devices() to service_role;

create function public.claim_apns_deliveries(target_batch_size integer default 25,target_lease_seconds integer default 120)
returns table(
  outbox_id uuid,lease_token uuid,device_token text,apns_environment text,
  event_kind text,title text,body text,app_path text,apns_id uuid,attempt integer
)
language plpgsql
security invoker
set search_path=''
as $$
begin
  if current_user<>'service_role' then raise exception 'Service role required.' using errcode='42501'; end if;
  if target_batch_size not between 1 and 100 or target_lease_seconds not between 30 and 600 then
    raise exception 'Invalid delivery lease request.' using errcode='22023';
  end if;

  perform private.prune_invalid_apns_devices();
  delete from private.apns_devices where not active and disabled_at<now()-interval '30 days';
  delete from private.apns_outbox where status in ('delivered','failed') and finished_at<now()-interval '30 days';
  update private.apns_outbox o set status='failed',last_reason='AttemptsExhausted',
      lease_token=null,lease_until=null,finished_at=now()
    where o.status='leased' and o.lease_until<=now() and o.attempts>=8;
  update private.apns_outbox o set status='failed',last_reason='DeviceInactive',
      lease_token=null,lease_until=null,finished_at=now()
    where o.status in ('pending','retry','leased') and not exists(
      select 1 from private.apns_devices d where d.id=o.device_id and d.active
    );

  return query
  with candidates as (
    select o.id from private.apns_outbox o join private.apns_devices d on d.id=o.device_id and d.active
    where o.available_at<=now() and o.attempts<8
      and (o.status in ('pending','retry') or (o.status='leased' and o.lease_until<=now()))
    order by o.available_at,o.created_at,o.id
    for update of o skip locked limit target_batch_size
  ), leased as (
    update private.apns_outbox o set status='leased',lease_token=extensions.gen_random_uuid(),
      lease_until=now()+pg_catalog.make_interval(secs=>target_lease_seconds),attempts=o.attempts+1
    from candidates c where o.id=c.id returning o.*
  )
  select o.id,o.lease_token,d.device_token,d.apns_environment,o.event_kind,
    case o.event_kind when 'walk_invitation' then 'Walk invitation' else 'New follow-up' end,
    case o.event_kind when 'walk_invitation' then 'You have a new walk invitation in NeighborWalk.'
      else 'A follow-up was assigned to you in NeighborWalk.' end,
    o.app_path,o.apns_id,o.attempts
  from leased o join private.apns_devices d on d.id=o.device_id;
end;
$$;

create function public.finish_apns_delivery(
  target_outbox_id uuid,
  target_lease_token uuid,
  target_outcome text,
  target_reason text default null,
  target_retry_after_seconds integer default null,
  target_apns_id uuid default null
)
returns boolean
language plpgsql
security invoker
set search_path=''
as $$
declare row private.apns_outbox; delay_seconds integer;
begin
  if current_user<>'service_role' then raise exception 'Service role required.' using errcode='42501'; end if;
  if target_outcome not in ('delivered','retry','permanent_failure','invalid_token')
    or (target_reason is not null and target_reason !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$') then
    raise exception 'Invalid delivery outcome.' using errcode='22023';
  end if;
  select * into row from private.apns_outbox o where o.id=target_outbox_id for update;
  if row.id is null or row.status<>'leased' or row.lease_token is distinct from target_lease_token then return false; end if;

  if target_outcome='delivered' then
    update private.apns_outbox set status='delivered',last_reason=null,lease_token=null,lease_until=null,
      delivered_at=now(),finished_at=now(),apns_id=coalesce(target_apns_id,apns_id) where id=row.id;
  elsif target_outcome='retry' and row.attempts<8 then
    delay_seconds:=greatest(15,least(3600,coalesce(target_retry_after_seconds,
      (15*pg_catalog.power(2,greatest(row.attempts-1,0)))::integer)));
    update private.apns_outbox set status='retry',last_reason=coalesce(target_reason,'TransientFailure'),
      lease_token=null,lease_until=null,available_at=now()+pg_catalog.make_interval(secs=>delay_seconds),
      apns_id=coalesce(target_apns_id,apns_id) where id=row.id;
  elsif target_outcome='invalid_token' then
    update private.apns_devices set active=false,disabled_at=now(),disabled_reason='apns_rejected',updated_at=now()
      where id=row.device_id;
    update private.apns_outbox set status='failed',last_reason=coalesce(target_reason,'InvalidToken'),
      lease_token=null,lease_until=null,finished_at=now()
      where device_id=row.device_id and status in ('pending','retry','leased');
  else
    update private.apns_outbox set status='failed',last_reason=coalesce(target_reason,'PermanentFailure'),
      lease_token=null,lease_until=null,finished_at=now(),apns_id=coalesce(target_apns_id,apns_id) where id=row.id;
  end if;
  return true;
end;
$$;

revoke all on function public.claim_apns_deliveries(integer,integer) from public,anon,authenticated;
revoke all on function public.finish_apns_delivery(uuid,uuid,text,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_apns_deliveries(integer,integer) to service_role;
grant execute on function public.finish_apns_delivery(uuid,uuid,text,text,integer,uuid) to service_role;

comment on table private.apns_devices is 'Private per-installation APNs routing credentials. Never expose via the Data API.';
comment on table private.apns_outbox is 'Privacy-minimized APNs delivery queue: generic event kind, opaque app path, and no outreach content.';
comment on function public.register_apns_device(uuid,text,text) is 'Registers the caller device after verifying its current live Auth session.';
comment on function public.unregister_apns_device(uuid) is 'Detaches only the caller device and cancels its queued notifications.';

commit;
