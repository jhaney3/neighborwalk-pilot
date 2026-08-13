-- INSERT ... RETURNING must also satisfy the table's SELECT policy. Let the
-- authenticated creator read the church row during the atomic bootstrap,
-- before the leader membership is inserted.
alter policy churches_member_read
on public.churches
using (
  created_by = (select auth.uid())
  or (select private.is_church_member(id))
);
