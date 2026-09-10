begin;

-- The legacy JSON snapshot grants every member control over all ordinary
-- records. Contain that capability before the transactional command cutover.
-- This migration is additive to the release sequence: do not deploy it alone
-- while the only installed client still requires direct snapshot updates.
revoke insert, update, delete on public.workspace_snapshots from authenticated, anon;

comment on table public.workspace_snapshots is
  'Read-only legacy checkpoint for migration/recovery. Browser writes are disabled; church-ready clients use authenticated transactional commands.';

commit;
