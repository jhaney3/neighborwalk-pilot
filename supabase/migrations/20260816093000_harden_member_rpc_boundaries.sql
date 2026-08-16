begin;

alter function public.create_church_invitation(text, text, integer) set schema private;
alter function private.create_church_invitation(text, text, integer) rename to create_church_invitation_impl;

alter function public.accept_church_invitation(text) set schema private;
alter function private.accept_church_invitation(text) rename to accept_church_invitation_impl;

alter function public.revoke_church_invitation(uuid) set schema private;
alter function private.revoke_church_invitation(uuid) rename to revoke_church_invitation_impl;

alter function public.update_church_member(uuid, text, boolean) set schema private;
alter function private.update_church_member(uuid, text, boolean) rename to update_church_member_impl;

create function public.create_church_invitation(
  invited_email text,
  invitation_role text default 'volunteer',
  valid_for_hours integer default 168
)
returns table (
  invitation_id uuid,
  invitation_token text,
  email text,
  role text,
  expires_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.create_church_invitation_impl(invited_email, invitation_role, valid_for_hours);
$$;

create function public.accept_church_invitation(invitation_token text)
returns table (
  church_id uuid,
  user_id uuid,
  role text,
  member_email text,
  display_name text
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.accept_church_invitation_impl(invitation_token);
$$;

create function public.revoke_church_invitation(invitation_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.revoke_church_invitation_impl(invitation_id);
$$;

create function public.update_church_member(
  target_user_id uuid,
  member_role text,
  member_active boolean
)
returns table (
  user_id uuid,
  role text,
  active boolean
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.update_church_member_impl(target_user_id, member_role, member_active);
$$;

revoke execute on function private.create_church_invitation_impl(text, text, integer) from public, anon;
grant execute on function private.create_church_invitation_impl(text, text, integer) to authenticated;
revoke execute on function private.accept_church_invitation_impl(text) from public, anon;
grant execute on function private.accept_church_invitation_impl(text) to authenticated;
revoke execute on function private.revoke_church_invitation_impl(uuid) from public, anon;
grant execute on function private.revoke_church_invitation_impl(uuid) to authenticated;
revoke execute on function private.update_church_member_impl(uuid, text, boolean) from public, anon;
grant execute on function private.update_church_member_impl(uuid, text, boolean) to authenticated;

revoke execute on function public.create_church_invitation(text, text, integer) from public, anon;
grant execute on function public.create_church_invitation(text, text, integer) to authenticated;
revoke execute on function public.accept_church_invitation(text) from public, anon;
grant execute on function public.accept_church_invitation(text) to authenticated;
revoke execute on function public.revoke_church_invitation(uuid) from public, anon;
grant execute on function public.revoke_church_invitation(uuid) to authenticated;
revoke execute on function public.update_church_member(uuid, text, boolean) from public, anon;
grant execute on function public.update_church_member(uuid, text, boolean) to authenticated;

create index church_invitations_created_by_idx on public.church_invitations (created_by);
create index church_invitations_accepted_by_idx on public.church_invitations (accepted_by)
  where accepted_by is not null;

commit;
