begin;

-- All interactive membership/person guards already depend on this private
-- predicate. JWT verification alone does not detect an explicitly revoked
-- Supabase session until token expiry; require its current database identity.
-- Background workers use their separate service-only eligibility checks.
create or replace function private.is_real_user()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  claims jsonb := (select auth.jwt());
  session_key text := claims->>'session_id';
begin
  if actor is null or coalesce(claims->>'is_anonymous','false') <> 'false'
    or session_key is null
    or session_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from auth.sessions s
    where s.id = session_key::uuid and s.user_id = actor
      and (s.not_after is null or s.not_after > now())
  );
end;
$$;
revoke execute on function private.is_real_user() from public, anon;
grant execute on function private.is_real_user() to authenticated;

-- Historical bootstrap/author shortcuts must not bypass the shared guard.
-- Workspace creation is operator-assisted; past creators without an active
-- membership should not retain access to a church's settings.
alter policy churches_member_read on public.churches
  using ((select private.is_church_member(id)));
alter policy memberships_self_or_leader_read on public.church_memberships
  using ((select private.is_real_user()) and
    (user_id = (select auth.uid()) or (select private.is_church_leader(church_id))));
alter policy discipleship_person_notes_author_delete on public.discipleship_person_notes
  using ((select private.is_real_user()) and (select private.is_church_member(church_id)) and
    (author_id = (select auth.uid()) or (select private.is_church_leader(church_id))));

comment on function private.is_real_user() is
  'Interactive authorization requires a non-anonymous JWT and its matching, non-expired live Auth session. Does not erase previously downloaded offline records.';

commit;
