begin;
-- Community conversations record where they happened and what was shared,
-- without new identifying fields. Encounters stay append-only; existing rows
-- keep a null place and no needs.
alter table public.outreach_encounters
  add column place_label text check (place_label is null or length(btrim(place_label)) between 1 and 120),
  add column needs text[] not null default '{}'
    check (needs <@ array['food','housing','transport','health','work','prayer','other']::text[] and cardinality(needs) <= 7);

alter function private.outreach_record_fields(text,jsonb,jsonb,uuid,uuid) rename to outreach_record_fields_before_community_details;
create function private.outreach_record_fields(kind text,r jsonb,old_row jsonb,church uuid,actor uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  mapped jsonb := private.outreach_record_fields_before_community_details(kind,r,old_row,church,actor);
  place text;
  chosen_needs text[];
begin
  if kind <> 'visit' then return mapped; end if;
  if r ? 'needs' and jsonb_typeof(r->'needs') <> 'array' then
    raise exception 'Choose needs from the list.' using errcode='22023'; end if;
  select coalesce(array_agg(distinct value order by value),'{}') into chosen_needs
    from jsonb_array_elements_text(coalesce(r->'needs','[]'));
  if not chosen_needs <@ array['food','housing','transport','health','work','prayer','other']::text[] then
    raise exception 'Choose needs from the list.' using errcode='22023'; end if;
  place := nullif(btrim(r->>'placeLabel'),'');
  if place is not null and coalesce(r->>'context','door')='door' then
    raise exception 'A doorstep visit uses its home, not a place name.' using errcode='22023'; end if;
  if length(place) > 120 then
    raise exception 'Shorten the place name to 120 characters.' using errcode='22023'; end if;
  return mapped || jsonb_build_object('place_label',place,'needs',to_jsonb(chosen_needs));
end $$;
revoke all on function private.outreach_record_fields(text,jsonb,jsonb,uuid,uuid) from public,anon,authenticated;
commit;
