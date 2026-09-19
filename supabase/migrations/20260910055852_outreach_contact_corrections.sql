begin;
-- CLI-generated migration; authoritative restrictions outlive task history.
-- Corrections remain server-authoritative and cannot revive cancelled tasks.
alter function private.outreach_apply_operation(uuid,uuid,text,jsonb) rename to outreach_apply_operation_v1;
create function private.outreach_apply_operation(church uuid,actor uuid,command_id text,op jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare result jsonb; restricted_person text; target_channel text; r jsonb:=op->'record';
begin
  if op->>'entityType'='restriction' then
    if nullif(r->>'propertyId','') is not null and coalesce(r->>'channel','all') not in ('all','visit') then
      raise exception 'Location restrictions apply to visits.' using errcode='22023'; end if;
    if coalesce((r->>'active')::boolean,true) and length(btrim(coalesce(r->>'reason','')))<3 then
      raise exception 'Record a brief factual reason for this restriction.' using errcode='22023'; end if;
    select person_id,channel into restricted_person,target_channel from public.outreach_restrictions where church_id=church and id=op->>'entityId';
  end if;
  result := private.outreach_apply_operation_v1(church,actor,command_id,op);
  if op->>'entityType'='restriction' and r->>'active'='false' and restricted_person is not null and target_channel='all'
    and not exists(select 1 from public.outreach_restrictions where church_id=church and person_id=restricted_person and channel='all' and active) then
    update public.discipleship_people set contact_permission='not_recorded',version=version+1 where church_id=church and id=restricted_person and contact_permission='do_not_contact';
    insert into public.outreach_audit(church_id,actor_id,command_id,action,entity_type,entity_id)
    values(church,actor,command_id,'resident.contact_restriction_corrected','resident',restricted_person);
  end if;
  return result;
end $$;
revoke all on function private.outreach_apply_operation(uuid,uuid,text,jsonb) from public,anon,authenticated;

-- Profile/ownership history follows current profile access, not creator identity.
drop policy audit_leader_or_actor_read on public.outreach_audit;
create policy audit_permitted_read on public.outreach_audit for select to authenticated using (
  (select private.is_church_member(church_id)) and
  (case when entity_type in ('resident','handoff') then private.can_view_discipleship_person(entity_id)
    else actor_id=(select auth.uid()) or (select private.is_church_leader(church_id)) end)
);
commit;
