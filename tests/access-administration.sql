\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('30000000-0000-4000-8000-000000000011','access-leader@neighborwalk.test',now()),
 ('30000000-0000-4000-8000-000000000012','access-volunteer@neighborwalk.test',now()),
 ('30000000-0000-4000-8000-000000000013','access-invited@neighborwalk.test',now()),
 ('30000000-0000-4000-8000-000000000014','access-other@neighborwalk.test',now());
insert into auth.sessions(id,user_id) values
 ('30000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000011'),
 ('30000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000012'),
 ('30000000-0000-4000-8000-000000000023','30000000-0000-4000-8000-000000000013');
insert into public.churches(id,name,created_by) values
 ('30000000-0000-4000-8000-000000000001','Fictional Access Church','30000000-0000-4000-8000-000000000011'),
 ('30000000-0000-4000-8000-000000000002','Fictional Other Church','30000000-0000-4000-8000-000000000014');
insert into public.church_memberships(church_id,user_id,role,active,member_email) values
 ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000011','leader',true,'access-leader@neighborwalk.test'),
 ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000012','volunteer',true,'access-volunteer@neighborwalk.test'),
 ('30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000014','leader',true,'access-other@neighborwalk.test');
insert into public.workspace_snapshots(church_id,schema_version,data,updated_by) values
 ('30000000-0000-4000-8000-000000000001',9,'{"sentinel":"frozen original","volunteers":[]}','30000000-0000-4000-8000-000000000011');
insert into public.outreach_tasks(church_id,id,owner_id,due_date,status) values
 ('30000000-0000-4000-8000-000000000001','suspended-owner-task','30000000-0000-4000-8000-000000000012',current_date,'scheduled');
create function pg_temp.access_claims(actor integer,age integer default 0) returns text language sql as $$
 select jsonb_build_object('sub','30000000-0000-4000-8000-0000000000'||actor,'role','authenticated','is_anonymous',false,
  'session_id','30000000-0000-4000-8000-0000000000'||(actor+10),
  'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())-age)))::text;
$$;
create function pg_temp.change_member(target uuid,expected_role text,expected_active boolean,role text,active boolean) returns jsonb language sql as $$
 select public.outreach_update_member(target,expected_role,expected_active,role,active,'Fictional roster access review');
$$;
select set_config('request.jwt.claims',pg_temp.access_claims(11),true);
set local role authenticated;
do $$ declare changed jsonb; rev bigint; invitation record; token text; rejected boolean; begin
  select outreach_revision into rev from public.churches where id='30000000-0000-4000-8000-000000000001';
  changed:=pg_temp.change_member('30000000-0000-4000-8000-000000000012','volunteer',true,'volunteer',false);
  if changed->>'changed'<>'true' or (select outreach_revision from public.churches where id='30000000-0000-4000-8000-000000000001')<>rev+1 then raise exception 'Access did not advance workspace revision'; end if;
  if not exists(select 1 from public.outreach_tasks where id='suspended-owner-task' and owner_id='30000000-0000-4000-8000-000000000012' and status='scheduled') then raise exception 'Suspension discarded responsibility'; end if;
  rejected:=false; begin perform pg_temp.change_member('30000000-0000-4000-8000-000000000012','volunteer',true,'leader',true); exception when sqlstate 'PT409' then rejected:=true; end;
  if not rejected then raise exception 'Stale access review succeeded'; end if;
  rejected:=false; begin perform pg_temp.change_member('30000000-0000-4000-8000-000000000011','leader',true,'volunteer',false); exception when sqlstate '22023' then rejected:=true; end;
  if not rejected then raise exception 'Self-removal of last leader succeeded'; end if;
  rejected:=false; begin perform pg_temp.change_member('30000000-0000-4000-8000-000000000014','leader',true,'volunteer',false); exception when sqlstate '42501' then rejected:=true; end;
  if not rejected then raise exception 'Cross-church access mutation succeeded'; end if;
  perform set_config('request.jwt.claims',pg_temp.access_claims(12),true);
  rejected:=false; begin perform public.outreach_workspace_info('30000000-0000-4000-8000-000000000001'); exception when sqlstate '42501' then rejected:=true; end;
  if not rejected or exists(select 1 from public.outreach_tasks where id='suspended-owner-task') then raise exception 'Suspended account retained connected access'; end if;
  perform set_config('request.jwt.claims',pg_temp.access_claims(11,1800),true);
  rejected:=false; begin perform public.create_church_invitation('access-invited@neighborwalk.test'); exception when sqlstate '42501' then rejected:=true; end;
  if not rejected then raise exception 'Old sign-in created invitation'; end if;
  perform set_config('request.jwt.claims',pg_temp.access_claims(11),true);
  select * into invitation from public.create_church_invitation('access-invited@neighborwalk.test'); token:=invitation.invitation_token;
  if exists(select 1 from public.outreach_audit where details::text like '%'||token||'%' or details::text like '%access-invited@%') then raise exception 'Audit contains invite token or email'; end if;
  perform set_config('request.jwt.claims',pg_temp.access_claims(12),true);
  rejected:=false; begin perform public.accept_church_invitation(token); exception when sqlstate '42501' then rejected:=true; end;
  if not rejected then raise exception 'Wrong email accepted invitation'; end if;
  perform set_config('request.jwt.claims',pg_temp.access_claims(13),true);
  perform public.accept_church_invitation(token);
  perform public.accept_church_invitation(token);
  if (select count(*) from public.church_memberships where user_id=auth.uid())<>1 then raise exception 'Invitation retry duplicated membership'; end if;
  rejected:=false; begin perform public.create_church_invitation('unallowed@neighborwalk.test'); exception when sqlstate '42501' then rejected:=true; end;
  if not rejected then raise exception 'Volunteer created invitation'; end if;
  perform set_config('request.jwt.claims',pg_temp.access_claims(11),true);
  perform pg_temp.change_member('30000000-0000-4000-8000-000000000013','volunteer',true,'volunteer',false);
  perform set_config('request.jwt.claims',pg_temp.access_claims(13),true);
  rejected:=false; begin perform public.accept_church_invitation(token); exception when sqlstate '42501' then rejected:=true; end;
  if not rejected then raise exception 'Invitation retry reactivated suspended account'; end if;
  perform set_config('request.jwt.claims',pg_temp.access_claims(11),true);
  select * into invitation from public.create_church_invitation('revoked@neighborwalk.test');
  if not public.revoke_church_invitation(invitation.invitation_id) or public.revoke_church_invitation(invitation.invitation_id) then raise exception 'Revoke was not singular'; end if;
  if (select count(*) from public.outreach_audit where action='access.invitation_accepted' and church_id='30000000-0000-4000-8000-000000000001')<>1 then raise exception 'Invitation retry duplicated audit'; end if;
  if not exists(select 1 from public.outreach_audit where action='access.member_updated' and details->>'beforeActive'='true' and details->>'active'='false' and details->>'reason'='Fictional roster access review') then raise exception 'Access audit lost decision details'; end if;
end $$;
reset role;
do $$ begin
 if (select data from public.workspace_snapshots where church_id='30000000-0000-4000-8000-000000000001')<>'{"sentinel":"frozen original","volunteers":[]}'::jsonb then raise exception 'Access operation rewrote frozen legacy snapshot'; end if;
end $$;
rollback;
select 'PASS: reviewed membership, live suspension, revision, preserved responsibilities, invitation retry/matching/revocation, recent-auth, private audit and frozen legacy snapshot' as result;
