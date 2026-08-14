create or replace function public.parcel_dataset_revision_v1()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(to_char(max(parcel.imported_at), 'YYYY-MM-DD"T"HH24:MI:SS.USOF'), 'empty')
  from public.parcels as parcel;
$$;

revoke execute on function public.parcel_dataset_revision_v1() from public, anon;
grant execute on function public.parcel_dataset_revision_v1() to authenticated;

comment on function public.parcel_dataset_revision_v1()
  is 'Returns a lightweight parcel import revision so clients can refresh cached territory parcels only when the official dataset changes.';
