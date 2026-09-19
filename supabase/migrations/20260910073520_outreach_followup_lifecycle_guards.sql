begin;
-- Additive validation only: existing history is not rewritten or deleted.
alter function private.outreach_record_fields(text,jsonb,jsonb,uuid,uuid) rename to outreach_record_fields_encounter_guards;
create function private.outreach_record_fields(kind text,r jsonb,old_row jsonb,church uuid,actor uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare mapped jsonb; field text; linked public.outreach_tasks; note_limit integer;
begin
  mapped := private.outreach_record_fields_encounter_guards(kind,r,old_row,church,actor);
  if kind <> 'follow_up' then return mapped; end if;
  if old_row is null and mapped->>'status' <> 'scheduled' then
    raise exception 'New next steps must start open. Record completion through the task workflow.' using errcode='22023'; end if;
  if old_row is not null then
    foreach field in array array['person_id','location_id','encounter_id','outing_id','parent_task_id'] loop
      if mapped->field is distinct from old_row->field then
        raise exception 'A task cannot be relinked to different history. Cancel it with a reason and create the corrected next step.' using errcode='22023'; end if;
    end loop;
    if mapped->>'status'='completed' or mapped->>'due_date' is distinct from old_row->>'due_date' then
      if mapped->>'acceptance' <> 'accepted' or mapped->>'owner_id' is null then
        raise exception 'The responsible person must accept the task before completion or rescheduling.' using errcode='22023'; end if;
    end if;
    if mapped->>'status'='cancelled' then
      select note_character_limit into note_limit from public.churches where id=church;
      if coalesce(r#>>'{history,-1,action}','') <> 'cancelled'
        or length(btrim(coalesce(r#>>'{history,-1,note}',''))) not between 1 and note_limit then
        raise exception 'Include a current cancellation reason in the final task activity.' using errcode='22023'; end if;
    end if;
  end if;
  if old_row is null and mapped->>'person_id' is not null and not exists (
    select 1 from public.discipleship_people p where p.church_id=church and p.id=mapped->>'person_id'
      and p.property_id is not distinct from mapped->>'location_id' and p.deleted_at is null
  ) then raise exception 'Link this next step to the person’s current location, or no location if they have none.' using errcode='22023'; end if;
  if old_row is null and mapped->>'parent_task_id' is not null then
    select * into linked from public.outreach_tasks where church_id=church and id=mapped->>'parent_task_id' and deleted_at is null;
    if not found or not private.can_view_outreach_task(church,linked.id) or linked.status <> 'completed'
      or linked.person_id is distinct from mapped->>'person_id' then
      raise exception 'A subsequent step must follow an accessible completed task for the same person.' using errcode='22023'; end if;
  end if;
  return mapped;
end $$;
revoke all on function private.outreach_record_fields(text,jsonb,jsonb,uuid,uuid) from public,anon,authenticated;
commit;
