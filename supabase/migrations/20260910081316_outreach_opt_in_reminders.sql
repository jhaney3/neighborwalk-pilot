begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- No existing member is enrolled. Email content and delivery metadata never
-- become part of a church's shared field cache.
create table private.outreach_reminder_preferences (
  id uuid primary key default extensions.gen_random_uuid(),
  church_id uuid not null,
  user_id uuid not null,
  enabled boolean not null default false,
  consent_email text not null check(length(consent_email)<=320),
  consent_at timestamptz,
  suppressed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(church_id,user_id),
  foreign key(church_id,user_id) references public.church_memberships(church_id,user_id)
);
create index outreach_reminder_preferences_user_idx on private.outreach_reminder_preferences(user_id);
create table private.outreach_reminder_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  preference_id uuid not null references private.outreach_reminder_preferences(id),
  local_day date not null,
  recipient text not null check(length(recipient)<=320),
  state text not null default 'pending' check(state in ('pending','leased','retry','accepted','delivered','failed','unknown','suppressed','bounced','complained')),
  payload jsonb check(payload is null or (jsonb_typeof(payload)='object' and pg_column_size(payload)<=16384)),
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  provider_id uuid unique,
  error_code text check(error_code in ('temporary','rejected','ambiguous','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(preference_id,local_day)
);
create index outreach_reminder_jobs_due_idx on private.outreach_reminder_jobs(next_attempt_at) where state in ('pending','retry','leased');
create table private.outreach_reminder_events (
  id text primary key check(length(id) between 1 and 200),
  provider_id uuid not null,
  kind text not null check(kind in ('email.delivered','email.bounced','email.complained','email.failed','email.suppressed')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index outreach_reminder_events_provider_idx on private.outreach_reminder_events(provider_id);
alter table private.outreach_reminder_preferences enable row level security;
alter table private.outreach_reminder_jobs enable row level security;
alter table private.outreach_reminder_events enable row level security;
revoke all on private.outreach_reminder_preferences,private.outreach_reminder_jobs,private.outreach_reminder_events from public,anon,authenticated,service_role;

create function private.outreach_reminder_eligible(church uuid,member uuid,day date)
returns boolean language sql stable set search_path='' as $$
  select private.outreach_active_member(church,member) and exists(
    select 1 from public.outreach_tasks t where t.church_id=church and t.owner_id=member
      and t.status='scheduled' and t.deleted_at is null and t.acceptance in ('pending','accepted')
      and (t.acceptance='pending' or t.due_date<=day)
      and (t.person_id is null or private.outreach_user_can_view_person(church,t.person_id,member))
      and not exists(select 1 from public.outreach_restrictions x where x.church_id=church and x.active
        and ((x.person_id=t.person_id and x.channel in ('all',t.channel))
          or (x.location_id=t.location_id and t.channel='visit' and x.channel in ('all','visit'))))
  );
$$;

create function private.outreach_reminder_preference(target_church uuid,enabled boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account_email text; pref private.outreach_reminder_preferences; latest private.outreach_reminder_jobs;
begin
  if not private.is_real_user() or not private.outreach_active_member(target_church,auth.uid()) then
    raise exception 'Sign in as an active church member.' using errcode='42501'; end if;
  select lower(u.email) into account_email from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null and u.deleted_at is null;
  if enabled is not null then
    if enabled and (account_email is null or account_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      raise exception 'Verify your account email before enabling reminders.' using errcode='22023'; end if;
    select * into pref from private.outreach_reminder_preferences p where p.church_id=target_church and p.user_id=auth.uid() for update;
    if enabled and pref.suppressed_at is not null and pref.consent_email=account_email then
      raise exception 'Email delivery is paused after a delivery problem. Contact support before re-enabling it.' using errcode='22023'; end if;
    insert into private.outreach_reminder_preferences(church_id,user_id,enabled,consent_email,consent_at)
      values(target_church,auth.uid(),enabled,coalesce(account_email,''),case when enabled then now() end)
    on conflict(church_id,user_id) do update set enabled=excluded.enabled,
      suppressed_at=case when excluded.enabled and outreach_reminder_preferences.consent_email<>excluded.consent_email then null else outreach_reminder_preferences.suppressed_at end,
      consent_email=case when excluded.enabled then excluded.consent_email else outreach_reminder_preferences.consent_email end,
      consent_at=case when excluded.enabled then now() else outreach_reminder_preferences.consent_at end,updated_at=now();
    if not enabled then
      update private.outreach_reminder_jobs j set state='suppressed',updated_at=now()
      from private.outreach_reminder_preferences p where p.id=j.preference_id and p.church_id=target_church and p.user_id=auth.uid() and j.state in ('pending','retry','leased');
    end if;
  end if;
  select * into pref from private.outreach_reminder_preferences p where p.church_id=target_church and p.user_id=auth.uid();
  select * into latest from private.outreach_reminder_jobs j where j.preference_id=pref.id order by j.created_at desc limit 1;
  return jsonb_build_object('enabled',coalesce(pref.enabled and pref.consent_email=account_email and pref.suppressed_at is null,false),
    'emailVerified',account_email is not null,'suppressed',pref.suppressed_at is not null and pref.consent_email=account_email,
    'lastState',latest.state,'lastUpdatedAt',latest.updated_at);
end $$;
create function public.outreach_reminder_preference(target_church uuid,enabled boolean default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.outreach_reminder_preference(target_church,enabled); $$;

-- Apply out-of-order delivery events after acknowledgement too. A late
-- delivered event must never undo a bounce/complaint or re-enable consent.
create function private.outreach_reminder_apply_events(email_id uuid)
returns void language plpgsql set search_path='' as $$
declare outcome text;
begin
  select case when bool_or(kind='email.complained') then 'complained'
    when bool_or(kind='email.bounced') then 'bounced'
    when bool_or(kind='email.suppressed') then 'suppressed'
    when bool_or(kind='email.failed') then 'failed'
    when bool_or(kind='email.delivered') then 'delivered' end into outcome
    from private.outreach_reminder_events where provider_id=email_id;
  if outcome is null then return; end if;
  update private.outreach_reminder_jobs set state=outcome,updated_at=now() where provider_id=email_id;
  if outcome in ('bounced','complained','suppressed') then
    update private.outreach_reminder_preferences p set enabled=false,suppressed_at=now(),updated_at=now()
      where exists(select 1 from private.outreach_reminder_jobs j join private.outreach_reminder_preferences sent on sent.id=j.preference_id
        where j.provider_id=email_id and sent.user_id=p.user_id and j.recipient=p.consent_email);
    update private.outreach_reminder_jobs j set state='suppressed',updated_at=now()
      from private.outreach_reminder_preferences p where p.id=j.preference_id and p.suppressed_at is not null and j.state in ('pending','retry','leased');
  end if;
end $$;

-- This is a narrow service-only capability, not a generic send-email RPC.
-- It never accepts a user-chosen recipient, query, church or care-note body.
create function private.outreach_reminder_worker(action text,args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.outreach_reminder_jobs; pref private.outreach_reminder_preferences; result jsonb:='[]'; current_day date; account_email text; current_zone text;
begin
  if action='claim' then
    insert into private.outreach_reminder_jobs(preference_id,local_day,recipient)
      select p.id,(now() at time zone c.timezone)::date,p.consent_email
      from private.outreach_reminder_preferences p join public.churches c on c.id=p.church_id join auth.users u on u.id=p.user_id
      where p.enabled and p.suppressed_at is null and lower(u.email)=p.consent_email and u.email_confirmed_at is not null and u.deleted_at is null
        and extract(hour from now() at time zone c.timezone) between 9 and 17
        and private.outreach_reminder_eligible(p.church_id,p.user_id,(now() at time zone c.timezone)::date)
      on conflict(preference_id,local_day) do nothing;
    -- Provider idempotency keys last 24 hours. Never send an ambiguous job again
    -- outside a conservative 23-hour window; do not invent delivery success.
    update private.outreach_reminder_jobs set state='unknown',error_code=case when first_attempt_at<now()-interval '23 hours' then 'expired' else 'ambiguous' end,updated_at=now()
      where state in ('retry','leased') and (first_attempt_at<now()-interval '23 hours' or attempts>=6) and coalesce(lease_until,now())<=now();
    for job in select j.* from private.outreach_reminder_jobs j where j.state in ('pending','retry','leased')
      and j.next_attempt_at<=now() and coalesce(j.lease_until,now())<=now()
      order by j.next_attempt_at,j.id for update skip locked limit 10
    loop
      select * into pref from private.outreach_reminder_preferences where id=job.preference_id;
      select c.timezone into current_zone from public.churches c where c.id=pref.church_id;
      current_day:=(now() at time zone current_zone)::date;
      select lower(u.email) into account_email from auth.users u where u.id=pref.user_id and u.email_confirmed_at is not null and u.deleted_at is null;
      if not pref.enabled or pref.suppressed_at is not null or account_email is distinct from job.recipient or pref.consent_email<>job.recipient
        or job.local_day<>current_day or not private.outreach_reminder_eligible(pref.church_id,pref.user_id,current_day) then
        update private.outreach_reminder_jobs set state='suppressed',updated_at=now() where id=job.id;
        continue;
      end if;
      update private.outreach_reminder_jobs set state='leased',lease_token=extensions.gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
        where id=job.id returning * into job;
      result:=result||jsonb_build_array(jsonb_build_object('id',job.id,'preferenceId',job.preference_id,'recipient',job.recipient,'lease',job.lease_token));
    end loop;
    return result;
  elsif action='prepare' then
    select * into job from private.outreach_reminder_jobs where id=(args->>'id')::uuid and lease_token=(args->>'lease')::uuid and state='leased' and lease_until>now() for update;
    if not found then return 'null'; end if;
    select * into pref from private.outreach_reminder_preferences where id=job.preference_id;
    select c.timezone into current_zone from public.churches c where c.id=pref.church_id;
    select lower(u.email) into account_email from auth.users u where u.id=pref.user_id and u.email_confirmed_at is not null and u.deleted_at is null;
    if not pref.enabled or pref.suppressed_at is not null or account_email is distinct from job.recipient or pref.consent_email<>job.recipient
      or not private.outreach_reminder_eligible(pref.church_id,pref.user_id,(now() at time zone current_zone)::date)
      or job.local_day<>(now() at time zone current_zone)::date then
      update private.outreach_reminder_jobs set state='suppressed',updated_at=now() where id=job.id;
      return 'null';
    end if;
    if job.first_attempt_at<now()-interval '23 hours' then
      update private.outreach_reminder_jobs set state='unknown',error_code='expired',updated_at=now() where id=job.id;
      return 'null';
    end if;
    if job.payload is null and (jsonb_typeof(args->'payload') is distinct from 'object' or args#>>'{payload,to,0}' is distinct from job.recipient) then
      raise exception 'Invalid reminder envelope.' using errcode='22023'; end if;
    update private.outreach_reminder_jobs set payload=coalesce(payload,args->'payload'),first_attempt_at=coalesce(first_attempt_at,now()),attempts=attempts+1,updated_at=now()
      where id=job.id returning * into job;
    return job.payload;
  elsif action='finish' then
    select * into job from private.outreach_reminder_jobs where id=(args->>'id')::uuid and lease_token=(args->>'lease')::uuid for update;
    if not found or job.first_attempt_at is null then return 'null'; end if;
    if nullif(args->>'providerId','') is not null then
      update private.outreach_reminder_jobs set provider_id=(args->>'providerId')::uuid,
        state=case when state='suppressed' then state else 'accepted' end,lease_until=null,updated_at=now() where id=job.id;
      perform private.outreach_reminder_apply_events((args->>'providerId')::uuid);
    elsif job.state='leased' then
      update private.outreach_reminder_jobs set state=case when args->>'error'='rejected' then 'failed' when attempts>=6 then 'unknown' else 'retry' end,
        error_code=case when args->>'error'='rejected' then 'rejected' else 'temporary' end,
        next_attempt_at=now()+make_interval(mins=>least(60,5*job.attempts)),lease_until=null,updated_at=now() where id=job.id;
    end if;
    return 'null';
  elsif action='event' then
    -- A signed provider event includes our opaque job tag. Correlate it before
    -- acknowledgement, so a lost send response cannot postpone suppression.
    select * into job from private.outreach_reminder_jobs where id=(args->>'jobId')::uuid and first_attempt_at is not null for update;
    if not found or (job.provider_id is not null and job.provider_id<>(args->>'providerId')::uuid) then return 'null'; end if;
    update private.outreach_reminder_jobs set provider_id=(args->>'providerId')::uuid where id=job.id and provider_id is null;
    insert into private.outreach_reminder_events(id,provider_id,kind,occurred_at)
      values(args->>'eventId',(args->>'providerId')::uuid,args->>'kind',(args->>'occurredAt')::timestamptz) on conflict(id) do nothing;
    perform private.outreach_reminder_apply_events((args->>'providerId')::uuid);
    return 'null';
  elsif action='unsubscribe' then
    update private.outreach_reminder_preferences set enabled=false,updated_at=now() where id=(args->>'preferenceId')::uuid;
    update private.outreach_reminder_jobs set state='suppressed',updated_at=now() where preference_id=(args->>'preferenceId')::uuid and state in ('pending','retry','leased');
    return 'null';
  end if;
  raise exception 'Unknown reminder operation.' using errcode='22023';
end $$;
create function public.outreach_reminder_worker(action text,args jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select private.outreach_reminder_worker(action,args); $$;

revoke all on function private.outreach_reminder_eligible(uuid,uuid,date),private.outreach_reminder_apply_events(uuid) from public,anon,authenticated,service_role;
revoke all on function private.outreach_reminder_preference(uuid,boolean),public.outreach_reminder_preference(uuid,boolean) from public,anon,service_role;
grant execute on function private.outreach_reminder_preference(uuid,boolean),public.outreach_reminder_preference(uuid,boolean) to authenticated;
revoke all on function private.outreach_reminder_worker(text,jsonb),public.outreach_reminder_worker(text,jsonb) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.outreach_reminder_worker(text,jsonb),public.outreach_reminder_worker(text,jsonb) to service_role;
commit;
