\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('90000000-0000-4000-8000-000000000011','guide-leader@neighborwalk.test'),
 ('90000000-0000-4000-8000-000000000012','guide-volunteer@neighborwalk.test'),
 ('90000000-0000-4000-8000-000000000013','guide-other@neighborwalk.test');
insert into auth.sessions(id,user_id) select id,id from auth.users where id::text like '90000000-%';
insert into public.churches(id,name,created_by) values
 ('90000000-0000-4000-8000-000000000001','Fictional Guide Church','90000000-0000-4000-8000-000000000011'),
 ('90000000-0000-4000-8000-000000000002','Other Fictional Guide Church','90000000-0000-4000-8000-000000000013');
insert into public.church_memberships(church_id,user_id,role,active) values
 ('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000011','leader',true),
 ('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000012','volunteer',true),
 ('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000013','leader',true);
insert into public.outreach_teams(church_id,id,name) values
 ('90000000-0000-4000-8000-000000000001','guide-group','Fictional Guide Group');
create function pg_temp.guide_claims(actor integer) returns text language sql as $$
 select jsonb_build_object('sub','90000000-0000-4000-8000-0000000000'||actor,'session_id','90000000-0000-4000-8000-0000000000'||actor,'role','authenticated','is_anonymous',false)::text;
$$;
create function pg_temp.guide_content(privacy text default 'church') returns jsonb language sql as $$
 select jsonb_build_object('scope',privacy,'title','Fictional Permission Guide','description','Fictional content','sortOrder',0,'steps',
 '[{"id":"first","order":1,"eyebrow":"Listen","title":"Ask permission","coaching":"Leave room to decline","sampleWords":"May I listen?","reminder":"Respect their answer","scriptureReferences":[]}]'::jsonb);
$$;
create function pg_temp.guide_request(action text,key text,guide integer,version bigint,extra jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_object('schemaVersion',1,'churchId','90000000-0000-4000-8000-000000000001','userId',auth.uid(),'id',key,'action',action,
   'guideId',case when guide is not null then '90000000-0000-4000-8000-0000000000'||guide end,'expectedVersion',version)||extra;
$$;
create function pg_temp.guide_denied(request jsonb,expected text) returns void language plpgsql as $$
declare denied boolean:=false;
begin
 begin perform public.outreach_guide_action(request); exception when others then if sqlstate<>expected then raise; end if; denied:=true; end;
 if not denied then raise exception 'Unexpected guide request success'; end if;
end $$;
set local role authenticated;
do $$ declare request jsonb; result jsonb; revision bigint; invalid jsonb;
begin
 perform set_config('request.jwt.claims',pg_temp.guide_claims(11),true);
 revision:=(public.outreach_guide_state('90000000-0000-4000-8000-000000000001')->>'revision')::bigint;
 request:=pg_temp.guide_request('save','create-church',31,0,jsonb_build_object('content',pg_temp.guide_content()));
 result:=public.outreach_guide_action(request);
 if (result->>'revision')::bigint<>revision+1 or result->>'version'<>'1' or result->>'createdAt' is null then raise exception 'Guide revision/created timestamp missing'; end if;
 if result<>public.outreach_guide_action(request) or (select count(*) from public.outreach_audit where command_id='guide_create-church')<>1 then raise exception 'Guide retry duplicated or changed receipt'; end if;
 perform pg_temp.guide_denied(request||jsonb_build_object('content',pg_temp.guide_content()||'{"title":"Conflicting payload"}'),'PT409');
 perform pg_temp.guide_denied(request||'{"id":"stale-create"}','PT409');
 perform pg_temp.guide_denied(pg_temp.guide_request('save','privacy-change',31,1,jsonb_build_object('content',pg_temp.guide_content('personal'))),'22023');
 perform pg_temp.guide_denied(request||'{"churchId":"90000000-0000-4000-8000-000000000002"}','42501');
 perform pg_temp.guide_denied(request||'{"schemaVersion":"1"}','22023');
 perform pg_temp.guide_denied(request||'{"userId":"90000000-0000-4000-8000-000000000012"}','42501');
 for invalid in select v from jsonb_array_elements(jsonb_build_array(
   pg_temp.guide_content()||'{"unknown":"not allowed"}',
   pg_temp.guide_content()||'{"title":false}',
   pg_temp.guide_content()||'{"steps":[{"title":"Malformed"}]}',
   pg_temp.guide_content()||'{"sortOrder":0.1}',
   jsonb_set(pg_temp.guide_content(),'{steps,0,scriptureReferences}','[false]'),
   jsonb_set(pg_temp.guide_content(),'{steps,0,sampleWords}','""'),
   jsonb_set(pg_temp.guide_content(),'{steps,0,order}','2')
 )) v loop
   perform pg_temp.guide_denied(pg_temp.guide_request('save','invalid-create',33,0,jsonb_build_object('content',invalid)),'22023');
 end loop;
 result:=public.outreach_guide_action(pg_temp.guide_request('save','edit-church',31,1,jsonb_build_object('content',pg_temp.guide_content()||'{"title":"Reviewed guide title"}')));
 if result->>'version'<>'2' then raise exception 'Guide update lost version'; end if;
 begin update public.conversation_guides set title='Bypassed' where id='90000000-0000-4000-8000-000000000031'; raise exception 'Direct guide write bypasses RPC'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',pg_temp.guide_claims(12),true);
 perform pg_temp.guide_denied(pg_temp.guide_request('save','volunteer-church',33,0,jsonb_build_object('content',pg_temp.guide_content())),'42501');
 perform pg_temp.guide_denied(pg_temp.guide_request('save','volunteer-edit',31,2,jsonb_build_object('content',pg_temp.guide_content())),'42501');
 perform public.outreach_guide_action(pg_temp.guide_request('save','personal-create',32,0,jsonb_build_object('content',pg_temp.guide_content('personal'))));
 perform public.outreach_guide_action(pg_temp.guide_request('favorite','favorite-one',31,0));
 perform pg_temp.guide_denied(pg_temp.guide_request('favorite','favorite-stale',32,0),'PT409');
 perform public.outreach_guide_action(pg_temp.guide_request('favorite','favorite-clear',null,1));
 result:=public.outreach_guide_state('90000000-0000-4000-8000-000000000001');
 if result->>'favoriteGuideId' is not null or result->>'favoriteVersion'<>'2' then raise exception 'Clearing favorite reset its version'; end if;
 perform pg_temp.guide_denied(pg_temp.guide_request('group_default','volunteer-default',31,0,'{"teamId":"guide-group"}'),'42501');
 perform set_config('request.jwt.claims',pg_temp.guide_claims(11),true);
 if exists(select 1 from public.conversation_guides where id='90000000-0000-4000-8000-000000000032') then raise exception 'Leader read another user personal guide'; end if;
 if exists(select 1 from public.outreach_audit where command_id in ('guide_personal-create','guide_favorite-one')) then raise exception 'Personal guide activity entered leader-visible audit'; end if;
 perform pg_temp.guide_denied(pg_temp.guide_request('save','leader-private',32,1,jsonb_build_object('content',pg_temp.guide_content('personal'))),'42501');
 perform pg_temp.guide_denied(pg_temp.guide_request('favorite','leader-private-favorite',32,0),'42501');
 perform pg_temp.guide_denied(pg_temp.guide_request('group_default','personal-default',32,0,'{"teamId":"guide-group"}'),'22023');
 perform public.outreach_guide_action(pg_temp.guide_request('group_default','group-choice',31,0,'{"teamId":"guide-group"}'));
 perform pg_temp.guide_denied(pg_temp.guide_request('archive','group-dependent',31,2,'{"confirmation":"ARCHIVE GUIDE; KEEP HISTORY"}'),'22023');
 perform public.outreach_guide_action(pg_temp.guide_request('group_default','group-clear',null,1,'{"teamId":"guide-group"}'));
 perform pg_temp.guide_denied(pg_temp.guide_request('group_default','group-stale',31,0,'{"teamId":"guide-group"}'),'PT409');
end $$;
reset role;
insert into public.outreach_outings(church_id,id,name,starts_at,ends_at,guide_id,status) values
 ('90000000-0000-4000-8000-000000000001','guide-outing','Fictional Guide Outing',now(),now(),'90000000-0000-4000-8000-000000000031','draft');
create temp table guide_before_archive as select to_jsonb(g) record from public.conversation_guides g where id='90000000-0000-4000-8000-000000000031';
set local role authenticated;
do $$ begin
 perform pg_temp.guide_denied(pg_temp.guide_request('archive','outing-dependent',31,2,'{"confirmation":"ARCHIVE GUIDE; KEEP HISTORY"}'),'22023');
end $$;
reset role;
update public.outreach_outings set status='completed' where church_id='90000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare result jsonb; begin
 result:=public.outreach_guide_action(pg_temp.guide_request('archive','archive-guide',31,2,'{"confirmation":"ARCHIVE GUIDE; KEEP HISTORY"}'));
 if result->>'version'<>'3' then raise exception 'Archive version is incorrect'; end if;
 perform pg_temp.guide_denied(pg_temp.guide_request('favorite','archived-favorite',31,0),'42501');
 perform pg_temp.guide_denied(pg_temp.guide_request('save','archived-edit',31,3,jsonb_build_object('content',pg_temp.guide_content())),'PT409');
end $$;
reset role;
do $$ declare original jsonb; current_row jsonb; begin
 select record into original from guide_before_archive;
 select to_jsonb(g) into current_row from public.conversation_guides g where id='90000000-0000-4000-8000-000000000031';
 if current_row->>'archived_at' is null or current_row-array['version','updated_at','updated_by','archived_at'] is distinct from original-array['version','updated_at','updated_by','archived_at'] then raise exception 'Archive changed original guide content'; end if;
 if not exists(select 1 from public.outreach_outings where id='guide-outing' and guide_id='90000000-0000-4000-8000-000000000031') then raise exception 'Archive discarded historical outing link'; end if;
 begin update public.outreach_outings set status='draft' where id='guide-outing'; raise exception 'Reopened outing used archived guide'; exception when invalid_parameter_value then null; end;
end $$;
delete from auth.sessions where id='90000000-0000-4000-8000-000000000011';
set local role authenticated;
do $$ begin
 perform pg_temp.guide_denied(pg_temp.guide_request('archive','archive-guide',31,2,'{"confirmation":"ARCHIVE GUIDE; KEEP HISTORY"}'),'42501');
 begin perform public.outreach_guide_state('90000000-0000-4000-8000-000000000001'); raise exception 'Revoked session read guide state'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: versioned guide writes, idempotent receipts, private scope, strict content, favorite/default versions, archive dependencies and retained history' as result;
