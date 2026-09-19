begin;
-- CLI-generated migration; validation does not alter existing records.
alter function private.outreach_record_fields(text,jsonb,jsonb,uuid,uuid) rename to outreach_record_fields_preparation;
create function private.outreach_record_fields(kind text,r jsonb,old_row jsonb,church uuid,actor uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare note_limit integer; item text; context text:=coalesce(r->>'context','door');
begin
  select note_character_limit into note_limit from public.churches where id=church;
  foreach item in array array['objectiveNote','note','completionNote','body'] loop
    if length(coalesce(r->>item,''))>note_limit then raise exception 'Shorten the note to the church character limit.' using errcode='22023'; end if;
  end loop;
  if kind='resident' and old_row is null and nullif(btrim(r->>'name'),'') is null then
    raise exception 'New people need a name or useful identifying description. Anonymous encounters need no person record.' using errcode='22023';
  elsif kind='property' and nullif(btrim(r->>'address'),'') is null then
    raise exception 'Enter a useful address or location description.' using errcode='22023';
  elsif kind='visit' then
    if nullif(r->>'propertyId','') is null and (context='door' or r->>'outcome' in ('no_answer','do_not_visit','inaccessible')) then
      raise exception 'A doorstep outcome requires a location.' using errcode='22023'; end if;
    if nullif(r->>'residentId','') is not null and nullif(btrim(r->>'objectiveNote'),'') is not null then
      raise exception 'Put private care details in a protected person note or task.' using errcode='22023'; end if;
    if nullif(r->>'residentId','') is not null and nullif(r->>'propertyId','') is not null and not exists (
      select 1 from public.discipleship_people p where p.church_id=church and p.id=r->>'residentId' and p.property_id=r->>'propertyId'
    ) then raise exception 'This person is not linked to the selected location.' using errcode='22023'; end if;
  elsif kind='follow_up' and r->>'status'='cancelled' and old_row->>'status'='scheduled' then
    if not exists(select 1 from jsonb_array_elements(coalesce(r->'history','[]')) a
      where a->>'action'='cancelled' and length(btrim(coalesce(a->>'note',''))) between 1 and note_limit) then
      raise exception 'Record a reason for cancelling this next step.' using errcode='22023'; end if;
  end if;
  return private.outreach_record_fields_preparation(kind,r,old_row,church,actor);
end $$;
revoke all on function private.outreach_record_fields(text,jsonb,jsonb,uuid,uuid) from public,anon,authenticated;
commit;
