begin;

alter table public.conversation_guides add column version bigint not null default 1 check (version > 0);
alter table public.conversation_guides add column archived_at timestamptz;
alter table public.conversation_guide_preferences add column version bigint not null default 1 check (version > 0);
alter table public.conversation_guide_preferences alter column favorite_guide_id drop not null;
alter table public.conversation_guide_team_defaults add column version bigint not null default 1 check (version > 0);
alter table public.conversation_guide_team_defaults alter column guide_id drop not null;
create index conversation_guides_active_cursor_idx on public.conversation_guides(church_id,id) where archived_at is null;

-- Keep original timestamps/content untouched during migration. Subsequent
-- writes participate in the same church revision and lock as field commands.
create function private.version_guide_library_record()
returns trigger language plpgsql security definer set search_path = '' as $$
declare church uuid;
begin
  church:=case when tg_op='DELETE' then old.church_id else new.church_id end;
  if tg_op='UPDATE' and new.church_id is distinct from old.church_id then
    raise exception 'Guide records cannot move between churches.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(church::text,0));
  update public.churches set outreach_revision=outreach_revision+1 where id=church;
  if tg_op='DELETE' then return old; end if;
  new.version:=case when tg_op='INSERT' then 1 else old.version+1 end;
  return new;
end $$;
revoke all on function private.version_guide_library_record() from public,anon,authenticated;
create trigger guide_library_version before insert or update or delete on public.conversation_guides
  for each row execute function private.version_guide_library_record();
create trigger guide_preference_version before insert or update or delete on public.conversation_guide_preferences
  for each row execute function private.version_guide_library_record();
create trigger guide_group_default_version before insert or update or delete on public.conversation_guide_team_defaults
  for each row execute function private.version_guide_library_record();

-- Historical outings retain their guide identity. Current/reopened outings
-- cannot newly depend on an archived guide, even through the field command API.
create function private.enforce_active_outing_guide()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.guide_id is not null and new.deleted_at is null and new.status not in ('completed','cancelled','archived') then
    perform pg_advisory_xact_lock(hashtextextended(new.church_id::text,0));
    if not exists(select 1 from public.conversation_guides g where g.id=new.guide_id and g.church_id=new.church_id and g.scope='church' and g.archived_at is null) then
      raise exception 'Choose a current church guide for this outing.' using errcode='22023'; end if;
  end if;
  return new;
end $$;
revoke all on function private.enforce_active_outing_guide() from public,anon,authenticated;
create trigger outreach_outing_active_guide before insert or update on public.outreach_outings
  for each row execute function private.enforce_active_outing_guide();

create function private.outreach_guide_state(target_church uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare preference public.conversation_guide_preferences; favorite uuid; revision bigint;
begin
  if not private.is_church_member(target_church) then raise exception 'An active church session is required.' using errcode='42501'; end if;
  select outreach_revision into revision from public.churches where id=target_church;
  select * into preference from public.conversation_guide_preferences where church_id=target_church and user_id=auth.uid();
  select id into favorite from public.conversation_guides where church_id=target_church and id=preference.favorite_guide_id
    and archived_at is null and (scope='church' or owner_user_id=auth.uid());
  return jsonb_build_object('apiVersion',1,'churchId',target_church,'userId',auth.uid(),'revision',revision,'favoriteGuideId',favorite,'favoriteVersion',coalesce(preference.version,0));
end $$;
revoke all on function private.outreach_guide_state(uuid) from public,anon;
grant execute on function private.outreach_guide_state(uuid) to authenticated;
create function public.outreach_guide_state(target_church uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.outreach_guide_state(target_church); $$;
revoke all on function public.outreach_guide_state(uuid) from public,anon;
grant execute on function public.outreach_guide_state(uuid) to authenticated;

create function private.validate_guide_content(value jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare step jsonb; ordinal bigint; field text; reference jsonb; ids text[]:='{}';
begin
  if jsonb_typeof(value) is distinct from 'object' then raise exception 'Guide content must be an object.' using errcode='22023'; end if;
  for field in select jsonb_object_keys(value) loop
    if not field=any(array['title','description','steps','scope','sortOrder']) then raise exception 'Unsupported guide field.' using errcode='22023'; end if;
  end loop;
  if jsonb_typeof(value->'title') is distinct from 'string' or jsonb_typeof(value->'description') is distinct from 'string'
    or jsonb_typeof(value->'steps') is distinct from 'array' or jsonb_typeof(value->'sortOrder') is distinct from 'number'
    or coalesce(value->>'scope','') not in ('church','personal') then raise exception 'Complete the guide content and privacy choice.' using errcode='22023'; end if;
  if length(btrim(value->>'title')) not between 1 and 120 or length(value->>'description')>500
    or jsonb_array_length(value->'steps') not between 1 and 24 or (value->>'sortOrder') !~ '^\d+$' then
    raise exception 'Guide content exceeds supported limits.' using errcode='22023'; end if;
  if (value->>'sortOrder')::numeric>10000 then raise exception 'Unsupported guide order.' using errcode='22023'; end if;
  for step,ordinal in select item,position from jsonb_array_elements(value->'steps') with ordinality as steps(item,position) loop
    if jsonb_typeof(step) is distinct from 'object' then raise exception 'Each guide step must be an object.' using errcode='22023'; end if;
    for field in select jsonb_object_keys(step) loop
      if not field=any(array['id','order','eyebrow','title','coaching','sampleWords','reminder','scriptureReferences']) then raise exception 'Unsupported guide step field.' using errcode='22023'; end if;
    end loop;
    foreach field in array array['id','eyebrow','title','coaching','sampleWords','reminder'] loop
      if jsonb_typeof(step->field) is distinct from 'string' then raise exception 'Complete each guide step field.' using errcode='22023'; end if;
    end loop;
    if jsonb_typeof(step->'order') is distinct from 'number' or jsonb_typeof(step->'scriptureReferences') is distinct from 'array' then
      raise exception 'Guide steps require an order and reference list.' using errcode='22023'; end if;
    if (step->>'order')::numeric<>ordinal or length(btrim(step->>'id')) not between 1 and 240 or step->>'id'=any(ids)
      or length(btrim(step->>'eyebrow')) not between 1 and 80 or length(btrim(step->>'title')) not between 1 and 120
      or length(step->>'coaching')>800 or length(step->>'sampleWords')>1600 or length(step->>'reminder')>800
      or jsonb_array_length(step->'scriptureReferences')>12 then raise exception 'Guide step content or order is invalid.' using errcode='22023'; end if;
    ids:=array_append(ids,step->>'id');
    for reference in select item from jsonb_array_elements(step->'scriptureReferences') item loop
      if jsonb_typeof(reference) is distinct from 'string' or length(btrim(reference#>>'{}')) not between 1 and 100 then
        raise exception 'Use a short Scripture reference, not a passage download.' using errcode='22023'; end if;
    end loop;
    if length(btrim(step->>'sampleWords'))=0 and jsonb_array_length(step->'scriptureReferences')=0 then
      raise exception 'Each step needs suggested words or a Scripture reference.' using errcode='22023'; end if;
  end loop;
end $$;
revoke all on function private.validate_guide_content(jsonb) from public,anon,authenticated;

create function private.outreach_guide_action(request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare church uuid; actor uuid:=auth.uid(); key text; action text; selected_guide uuid; group_id text; expected bigint;
  fingerprint text; previous private.outreach_receipts; original public.conversation_guides;
  actual bigint; result jsonb; content jsonb; revision bigint; field text; allowed text[]; audit_change boolean:=false;
begin
  if jsonb_typeof(request) is distinct from 'object' or octet_length(request::text)>262144
    or jsonb_typeof(request->'schemaVersion') is distinct from 'number' or request->>'schemaVersion' is distinct from '1'
    or jsonb_typeof(request->'id') is distinct from 'string' or jsonb_typeof(request->'action') is distinct from 'string' then
    raise exception 'Unsupported guide request.' using errcode='22023'; end if;
  key:=request->>'id'; action:=request->>'action';
  if length(coalesce(key,'')) not between 1 and 180 or coalesce(request->>'churchId','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    or coalesce(action,'') not in ('save','archive','favorite','group_default') then raise exception 'Unsupported guide request.' using errcode='22023'; end if;
  church:=(request->>'churchId')::uuid;
  if request->>'userId' is distinct from actor::text then raise exception 'Sign into the account that authored this guide request.' using errcode='42501'; end if;
  if not private.is_church_member(church) then raise exception 'An active church session is required.' using errcode='42501'; end if;
  allowed:=array['schemaVersion','id','churchId','userId','action','guideId','expectedVersion'];
  if action='save' then allowed:=allowed||array['content']; end if;
  if action='archive' then allowed:=allowed||array['confirmation']; end if;
  if action='group_default' then allowed:=allowed||array['teamId']; end if;
  for field in select jsonb_object_keys(request) loop
    if not field=any(allowed) then raise exception 'Unsupported guide request field.' using errcode='22023'; end if;
  end loop;
  if jsonb_typeof(request->'expectedVersion') is distinct from 'number' or coalesce(request->>'expectedVersion','') !~ '^\d{1,15}$' then
    raise exception 'Refresh the guide version before changing it.' using errcode='22023'; end if;
  expected:=(request->>'expectedVersion')::bigint;
  if request->>'guideId' is not null then
    if (request->>'guideId') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'Choose a valid guide.' using errcode='22023'; end if;
    selected_guide:=(request->>'guideId')::uuid;
  elsif action in ('save','archive') then raise exception 'A guide identity is required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(church::text,0));
  if not private.is_church_member(church) then raise exception 'Church access changed.' using errcode='42501'; end if;
  fingerprint:=encode(extensions.digest(request::text,'sha256'),'hex');
  select * into previous from private.outreach_receipts where church_id=church and actor_id=actor and command_id='guide_'||key;
  if found then
    if previous.payload_hash<>fingerprint then raise sqlstate 'PT409' using message='This guide request was already used for different content.'; end if;
    return previous.result;
  end if;

  if action in ('save','archive') then
    select * into original from public.conversation_guides g where g.church_id=church and g.id=selected_guide;
    if found and ((original.scope='church' and not private.is_church_leader(church)) or (original.scope='personal' and original.owner_user_id<>actor)) then
      raise exception 'This guide cannot be changed by this account.' using errcode='42501'; end if;
    if coalesce(original.version,0)<>expected or original.archived_at is not null then raise sqlstate 'PT409' using message='This guide changed or was archived. Review the latest copy before saving.'; end if;
    if action='save' then
      content:=request->'content'; perform private.validate_guide_content(content);
      if content->>'scope'='church' and not private.is_church_leader(church) then raise exception 'Only leaders publish church guides.' using errcode='42501'; end if;
      if original.id is not null and content->>'scope'<>original.scope then raise exception 'Guide privacy cannot change after creation.' using errcode='22023'; end if;
      if original.id is null then
        insert into public.conversation_guides(id,church_id,scope,owner_user_id,title,description,steps,sort_order,created_by,updated_by)
          values(selected_guide,church,content->>'scope',case when content->>'scope'='personal' then actor end,btrim(content->>'title'),btrim(content->>'description'),content->'steps',(content->>'sortOrder')::integer,actor,actor)
          returning version into actual;
      else
        update public.conversation_guides g set title=btrim(content->>'title'),description=btrim(content->>'description'),steps=content->'steps',sort_order=(content->>'sortOrder')::integer
          where g.church_id=church and g.id=selected_guide returning g.version into actual;
      end if;
      audit_change:=content->>'scope'='church';
    else
      if original.id is null or request->>'confirmation' is distinct from 'ARCHIVE GUIDE; KEEP HISTORY' then raise exception 'Review and confirm this guide archive.' using errcode='22023'; end if;
      if exists(select 1 from public.outreach_outings o where o.church_id=church and o.guide_id=selected_guide and o.deleted_at is null and o.status not in ('completed','cancelled','archived'))
        or exists(select 1 from public.conversation_guide_team_defaults d join public.outreach_teams t on t.church_id=d.church_id and t.id=d.team_id
          where d.church_id=church and d.guide_id=selected_guide and t.deleted_at is null) then
        raise exception 'Choose another guide for current outings and groups before archiving this guide.' using errcode='22023'; end if;
      update public.conversation_guides g set archived_at=now() where g.church_id=church and g.id=selected_guide returning g.version into actual;
      audit_change:=original.scope='church';
    end if;
  elsif action='favorite' then
    if selected_guide is not null and not exists(select 1 from public.conversation_guides g where g.id=selected_guide and g.church_id=church and g.archived_at is null and (g.scope='church' or g.owner_user_id=actor)) then
      raise exception 'Choose an available guide in your library.' using errcode='42501'; end if;
    select p.version into actual from public.conversation_guide_preferences p where p.church_id=church and p.user_id=actor;
    if coalesce(actual,0)<>expected then raise sqlstate 'PT409' using message='Your guide choice changed on another device. Refresh and review it.'; end if;
    if actual is null then
      insert into public.conversation_guide_preferences(church_id,user_id,favorite_guide_id) values(church,actor,selected_guide) returning version into actual;
    else
      update public.conversation_guide_preferences p set favorite_guide_id=selected_guide where p.church_id=church and p.user_id=actor returning p.version into actual;
    end if;
  else
    if not private.is_church_leader(church) then raise exception 'Only leaders choose group guides.' using errcode='42501'; end if;
    group_id:=request->>'teamId';
    if not exists(select 1 from public.outreach_teams t where t.church_id=church and t.id=group_id and (t.deleted_at is null or selected_guide is null)) then
      raise exception 'Choose a current group in this church.' using errcode='22023'; end if;
    if selected_guide is not null and not exists(select 1 from public.conversation_guides g where g.church_id=church and g.id=selected_guide and g.scope='church' and g.archived_at is null) then
      raise exception 'Group defaults require an available church guide.' using errcode='22023'; end if;
    select d.version into actual from public.conversation_guide_team_defaults d where d.church_id=church and d.team_id=group_id;
    if coalesce(actual,0)<>expected then raise sqlstate 'PT409' using message='This group guide choice changed. Refresh and review it.'; end if;
    if actual is null then
      insert into public.conversation_guide_team_defaults(church_id,team_id,guide_id,updated_by) values(church,group_id,selected_guide,actor) returning version into actual;
    else
      update public.conversation_guide_team_defaults d set guide_id=selected_guide,updated_by=actor where d.church_id=church and d.team_id=group_id returning d.version into actual;
    end if;
    audit_change:=true;
  end if;
  select outreach_revision into revision from public.churches where id=church;
  result:=jsonb_build_object('action',action,'guideId',selected_guide,'teamId',group_id,'version',actual,'revision',revision,
    'savedAt',now(),'createdAt',case when action in ('save','archive') then coalesce(original.created_at,now()) end);
  if audit_change then
    insert into public.outreach_audit(church_id,actor_id,command_id,action,entity_type,entity_id,details)
      values(church,actor,'guide_'||key,'guide.'||action,'guide',coalesce(selected_guide::text,group_id),jsonb_build_object('version',actual));
  end if;
  -- Receipts contain identifiers/versions only, never guide content or personal
  -- favorites in the leader-visible audit. They remain scoped to their author.
  insert into private.outreach_receipts(church_id,actor_id,command_id,payload_hash,result) values(church,actor,'guide_'||key,fingerprint,result);
  return result;
end $$;
revoke all on function private.outreach_guide_action(jsonb) from public,anon;
grant execute on function private.outreach_guide_action(jsonb) to authenticated;
create function public.outreach_guide_action(request jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select private.outreach_guide_action(request); $$;
revoke all on function public.outreach_guide_action(jsonb) from public,anon;
grant execute on function public.outreach_guide_action(jsonb) to authenticated;

-- No bypass around version/receipt/privacy checks. Soft archives preserve
-- outing history and original guide identity; current choices remain reviewed.
revoke insert,update,delete on public.conversation_guides,public.conversation_guide_preferences,public.conversation_guide_team_defaults from authenticated,anon;

commit;
