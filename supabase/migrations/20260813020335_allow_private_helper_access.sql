-- Authenticated requests must be able to resolve the protected helper
-- functions used by RLS and the workspace bootstrap RPC. USAGE does not
-- grant access to create objects or bypass per-function EXECUTE privileges.
revoke usage on schema private from public, anon;
grant usage on schema private to authenticated;
