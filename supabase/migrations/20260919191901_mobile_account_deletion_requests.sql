-- Additive only. This queues a verified user's deletion request; it does NOT
-- pretend that disabling membership is deletion. See docs/ios-release.md for
-- the required operator fulfillment and confirmation procedure before release.
create table private.account_deletion_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  due_at timestamptz not null default now() + interval '30 days'
);
alter table private.account_deletion_requests enable row level security;
revoke all on private.account_deletion_requests from public, anon, authenticated;

create function private.request_account_deletion()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); receipt private.account_deletion_requests;
begin
  if actor is null or not exists(select 1 from auth.users where id = actor and deleted_at is null) then
    raise exception 'Sign in before requesting deletion.' using errcode = '42501';
  end if;
  insert into private.account_deletion_requests(user_id) values(actor)
    on conflict(user_id) do nothing;
  select * into strict receipt from private.account_deletion_requests where user_id = actor;
  return jsonb_build_object('request_id', receipt.id, 'requested_at', receipt.requested_at, 'due_at', receipt.due_at);
end $$;
revoke all on function private.request_account_deletion() from public, anon;
grant execute on function private.request_account_deletion() to authenticated;

create function public.request_account_deletion()
returns jsonb language sql security invoker set search_path = '' as $$
  select private.request_account_deletion();
$$;
revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;
