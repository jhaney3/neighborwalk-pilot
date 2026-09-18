begin;

-- Church settings participate in the same versioned, audited command stream as
-- the rest of the connected workspace. Remove the initial direct-update path so
-- browser clients cannot bypass conflict detection, validation or revisioning.
drop policy if exists churches_leader_update on public.churches;
revoke update on table public.churches from authenticated;
revoke update (
  name,
  timezone,
  retention_days,
  default_follow_up_days,
  note_character_limit,
  pathway_enabled
) on table public.churches from authenticated;

-- These functions remain as internal links in the administration command
-- chain. Only the current private entry point needs an authenticated grant.
revoke all on function private.outreach_admin_action_before_merges(jsonb) from authenticated;
revoke all on function private.outreach_admin_action_before_encounter_corrections(jsonb) from authenticated;

-- Assignment acknowledgement is a real state transition, not decorative UI.
-- Preserve the established mapper chain and add the missing final guard.
alter function private.outreach_record_fields(text,jsonb,jsonb,uuid,uuid)
  rename to outreach_record_fields_before_assignment_acknowledgement;
create function private.outreach_record_fields(kind text,r jsonb,old_row jsonb,church uuid,actor uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare mapped jsonb;
begin
  mapped := private.outreach_record_fields_before_assignment_acknowledgement(kind,r,old_row,church,actor);
  if kind='assignment' and mapped->>'status'='completed' and coalesce(old_row->>'status','')<>'accepted' then
    raise exception 'Accept this assignment before marking it complete.' using errcode='22023';
  end if;
  return mapped;
end $$;
revoke all on function private.outreach_record_fields_before_assignment_acknowledgement(text,jsonb,jsonb,uuid,uuid) from public,anon,authenticated;
revoke all on function private.outreach_record_fields(text,jsonb,jsonb,uuid,uuid) from public,anon,authenticated;

commit;
