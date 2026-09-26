-- Operator-only, read-only queue. No emails, names, account IDs or content.
begin read only;
select id as request_id, requested_at, due_at,
  due_at < now() as overdue,
  apple_revoked_at
from private.account_deletion_requests
order by due_at;
commit;
