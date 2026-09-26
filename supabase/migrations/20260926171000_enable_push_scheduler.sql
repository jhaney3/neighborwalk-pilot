begin;

-- Platform prerequisites only. The operator installs the Vault values and
-- activates the job separately after verifying the deployed push worker.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Restrict direct access where the migration role owns the grants. Hosted
-- Supabase owns pg_net as supabase_admin and retains its PUBLIC grants, so
-- these net REVOKEs alone do not establish isolation there. The hosted release
-- must verify that net is NOT exposed by the Data API, client roles have
-- NOLOGIN, and no client-callable SQL function exposes its request queue.
-- See https://supabase.com/docs/guides/database/extensions/pg_net#permissions.
revoke all on schema net from public, anon, authenticated;
revoke all on all tables in schema net from public, anon, authenticated;
revoke all on all functions in schema net from public, anon, authenticated;
revoke all on schema cron from public, anon, authenticated;
revoke all on all tables in schema cron from public, anon, authenticated;

commit;
