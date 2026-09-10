begin;
alter function private.outreach_apply_operation(uuid,uuid,text,jsonb) rename to outreach_apply_operation_contact_corrections;
create function private.outreach_apply_operation(church uuid,actor uuid,command_id text,op jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare previous public.discipleship_people; moving boolean:=false; result jsonb; task public.outreach_tasks; moved integer:=0; reason text:=btrim(op->>'reason');
begin
  if op->>'entityType'='resident' and op->>'operation'='upsert' then
    select * into previous from public.discipleship_people where church_id=church and id=op->>'entityId';
    moving:=previous.id is not null and previous.property_id is distinct from nullif(op#>>'{record,propertyId}','');
    if moving and (coalesce(length(reason),0) not between 3 and 500) then
      raise exception 'Review the open next steps and record a brief reason for this location change.' using errcode='22023'; end if;
  end if;
  -- Existing role, version, relationship and restriction checks still apply.
  -- All side effects, activity and audit records commit with the same receipt.
  result:=private.outreach_apply_operation_contact_corrections(church,actor,command_id,op);
  if moving then
    for task in select * from public.outreach_tasks where church_id=church and person_id=previous.id and status='scheduled' and deleted_at is null loop
      insert into public.outreach_task_activity(church_id,task_id,id,action,actor_id,actor_key,note)
        values(church,task.id,command_id||'_person_move_'||task.id,'note',actor,private.volunteer_id_for_user(actor),'Location updated with the person after review: '||reason);
      moved:=moved+1;
    end loop;
    update public.outreach_audit set action='resident.location_changed',details=jsonb_build_object('reason',reason,
      'previousLocationId',previous.property_id,'locationId',nullif(op#>>'{record,propertyId}',''),'previousVersion',previous.version,'version',result->'version','openTasksMoved',moved)
      where church_id=church and outreach_audit.command_id=outreach_apply_operation.command_id and entity_type='resident' and entity_id=previous.id and action='resident.upsert';
  end if;
  return result;
end $$;
revoke all on function private.outreach_apply_operation(uuid,uuid,text,jsonb) from public,anon,authenticated;
commit;
