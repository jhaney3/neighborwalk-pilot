begin;

-- A volunteer's availability response is not historical completion. Preserve
-- every existing mapper and command guard, but allow the unchanged owner to
-- change a declined response back to accepted. The target-aware command layer
-- still rejects ownership changes, finished targets and conflicting active
-- assignments, and completed/cancelled rows remain terminal history.
create or replace function private.outreach_record_fields_preparation(kind text,r jsonb,old_row jsonb,church uuid,actor uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare mapped jsonb; old_status text:=old_row->>'status'; next_status text:=r->>'status'; point jsonb;
begin
  if kind='event' then
    if (r->>'endsAt')::timestamptz <= (r->>'startsAt')::timestamptz then
      raise exception 'Choose an end time after the start.' using errcode='22023'; end if;
    if old_row is null and coalesce(next_status,'draft') <> 'draft' then
      raise exception 'New outings begin as drafts.' using errcode='22023'; end if;
    if old_row is not null and next_status is distinct from old_status and not (
      (old_status in ('draft','scheduled') and next_status in ('ready','cancelled'))
      or (old_status='ready' and next_status in ('active','completed','cancelled'))
      or (old_status='active' and next_status in ('completed','cancelled'))
      or (old_status='completed' and next_status='archived')
    ) then raise exception 'This outing transition is not available. Repeat a closed outing to make a new plan.' using errcode='22023'; end if;
    if next_status in ('ready','active') and next_status is distinct from old_status
      and (length(btrim(coalesce(r->>'purpose','')))<3 or length(btrim(coalesce(r->>'meetingPoint','')))<3 or length(btrim(coalesce(r->>'leaderContact','')))<3) then
      raise exception 'Before marking ready, add a purpose, meeting point and leader contact.' using errcode='22023'; end if;
  elsif kind='assignment' then
    if not exists(select 1 from public.outreach_outings where church_id=church and id=r->>'eventId' and deleted_at is null) then
      raise exception 'Choose an available outing.' using errcode='22023'; end if;
    if not exists(select 1 from public.outreach_territories where church_id=church and id=r->>'territoryId' and deleted_at is null) then
      raise exception 'Choose an available list or territory.' using errcode='22023'; end if;
    if nullif(r->>'assignedTeamId','') is not null and not exists(select 1 from public.outreach_teams where church_id=church and id=r->>'assignedTeamId' and deleted_at is null) then
      raise exception 'Choose an available church group.' using errcode='22023'; end if;
    if old_row is null and coalesce(next_status,'assigned')<>'assigned' then
      raise exception 'New assignments await acknowledgement.' using errcode='22023'; end if;
    if old_status in ('completed','cancelled') and next_status is distinct from old_status
      or old_status='declined' and next_status is distinct from old_status and next_status<>'accepted' then
      raise exception 'A resolved assignment is history. Create a new assignment if needed.' using errcode='22023'; end if;
  elsif kind='territory' then
    if coalesce(r->>'kind','map') not in ('map','list') then raise exception 'Choose a map or address list.' using errcode='22023'; end if;
    if r->>'kind'='list' then
      if r->'center' is not null and r->'center'<>'null'::jsonb or coalesce(r->'boundary','[]'::jsonb)<>'[]'::jsonb then
        raise exception 'Address lists do not use map geometry.' using errcode='22023'; end if;
      return jsonb_build_object('name',r->>'name','color',r->>'color','kind','list','longitude',null,'latitude',null,'zoom',15,'boundary','[]'::jsonb);
    end if;
    if jsonb_typeof(r->'boundary') is distinct from 'array' then raise exception 'Invalid boundary.' using errcode='22023'; end if;
    for point in select value from jsonb_array_elements(r->'boundary') loop
      if jsonb_typeof(point) is distinct from 'array' then raise exception 'Invalid coordinate.' using errcode='22023'; end if;
      if jsonb_array_length(point)<>2 or jsonb_typeof(point->0) is distinct from 'number' or jsonb_typeof(point->1) is distinct from 'number' then
        raise exception 'Boundary coordinates must be numeric pairs.' using errcode='22023'; end if;
    end loop;
  end if;
  mapped := private.outreach_record_fields_v1(kind,r,old_row,church,actor);
  if kind='territory' then mapped := mapped || jsonb_build_object('kind','map'); end if;
  return mapped;
end $$;
revoke all on function private.outreach_record_fields_preparation(text,jsonb,jsonb,uuid,uuid) from public,anon,authenticated;

commit;
