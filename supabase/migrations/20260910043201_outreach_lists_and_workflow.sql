begin;
alter table public.outreach_territories add column kind text not null default 'map' check (kind in ('map','list'));
alter table public.outreach_territories alter column longitude drop not null;
alter table public.outreach_territories alter column latitude drop not null;
alter table public.outreach_territories add constraint outreach_territory_geometry_kind_check check (
  (kind='map' and longitude is not null and latitude is not null and jsonb_array_length(boundary)>=3)
  or (kind='list' and longitude is null and latitude is null and boundary='[]'::jsonb)
);
-- Wrap the established closed field mapper; all other commands retain their
-- permissions, version checks, receipt and transaction behavior.
alter function private.outreach_record_fields(text,jsonb,jsonb,uuid,uuid) rename to outreach_record_fields_v1;
create function private.outreach_record_fields(kind text,r jsonb,old_row jsonb,church uuid,actor uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare mapped jsonb;
begin
  if kind='territory' and r->>'kind'='list' then
    return jsonb_build_object('name',r->>'name','color',r->>'color','kind','list','longitude',null,'latitude',null,'zoom',15,'boundary','[]'::jsonb);
  end if;
  mapped := private.outreach_record_fields_v1(kind,r,old_row,church,actor);
  if kind='territory' then mapped := mapped || jsonb_build_object('kind','map'); end if;
  return mapped;
end $$;
revoke all on function private.outreach_record_fields(text,jsonb,jsonb,uuid,uuid) from public,anon,authenticated;
commit;
