// Runs the actual migration and existing auth guards in isolated PostgreSQL/WASM.
// Minimal prior-schema fixture; this does not replace a full migration rehearsal.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite({ extensions: { pgcrypto } });
const source = (name) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
const helper = (name, file) => {
  const sql = source(file);
  const start = sql.indexOf(`create or replace function private.${name}(`) >= 0 ? sql.indexOf(`create or replace function private.${name}(`) : sql.indexOf(`create function private.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2) + 3);
};
await db.exec(`create role anon; create role authenticated; create schema auth; create schema private; create schema extensions; create extension pgcrypto with schema extensions;
create table auth.users(id uuid primary key,email text,phone text,email_confirmed_at timestamptz,phone_confirmed_at timestamptz,deleted_at timestamptz,raw_user_meta_data jsonb default '{}');
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
create table public.churches(id uuid primary key,name text,outreach_revision bigint default 0);
create table public.church_memberships(church_id uuid references public.churches,user_id uuid references auth.users,role text,active boolean,member_email text,display_name text,primary key(church_id,user_id));
create unique index one_active_church on public.church_memberships(user_id) where active;
create table public.outreach_audit(church_id uuid,actor_id uuid,command_id text,action text,entity_type text,entity_id text,details jsonb);
grant usage on schema private,auth to authenticated;`);
for (const [name,file] of [['is_real_user','20260910110738_live_session_authorization'],['is_church_leader','20260812233000_initial_neighborwalk'],['outreach_require_recent_leader','20260910060146_outreach_reviewed_administration'],['outreach_access_changed','20260910063012_outreach_access_administration']]) await db.exec(helper(name,file));
await db.exec(source('20260919214330_flexible_church_invitations'));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
for (let n=1;n<=8;n++) {
  await db.query(`insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values($1,$2,$3,$4,$5)`,[id(n),n===4?null:`person${n}@${n===2?'privaterelay.appleid.com':'example.com'}`,n===3||n===4?null:new Date(),n===4?'+16155550123':null,n===4?new Date():null]);
  await db.query(`insert into auth.sessions values($1,$2,null)`,[id(n+100),id(n)]);
}
await db.query(`insert into public.churches(id,name) values($1,'First Church'),($2,'Second Church')`,[id(20),id(21)]);
await db.query(`insert into public.church_memberships values($1,$2,'leader',true,'person1@example.com','Leader'),($3,$4,'leader',true,'person5@example.com','Other leader')`,[id(20),id(1),id(21),id(5)]);
const auth = async (n,{old=false,anonymous=false}={}) => {
  await db.exec('reset role; set role authenticated;');
  await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)`,[id(n),JSON.stringify({session_id:id(n+100),is_anonymous:anonymous,amr:[{method:'oauth',timestamp:Math.floor(Date.now()/1000)-(old?3600:0)}]})]);
};
const rpc = async (sql,args=[]) => (await db.query(sql,args)).rows[0]?.result;
const create = async (contact='invited@example.com',kind='email',role='volunteer') => rpc('select public.create_shared_invitation($1,$2,$3,$4) result',[kind,contact,'Invitee',role]);
const accept = async (token,yes=true) => rpc('select public.shared_invitation($1,$2) result',[token,yes]);
await db.exec('set role anon');
await assert.rejects(()=>create(),/permission denied/);
await auth(1,{old:true}); await assert.rejects(()=>create(),/Sign in again/);
await auth(1); await assert.rejects(()=>create('555'),/valid email/);
const invitation = await create(); assert.match(invitation.token,/^[a-f0-9]{64}$/);
await assert.rejects(()=>db.query('select * from private.shared_invitations'),/permission denied/);
await auth(2); await assert.rejects(()=>create(),/active church leader/);
await assert.rejects(()=>rpc('select public.list_shared_invitations()'),/leader account/);
assert.equal((await accept(invitation.token,false)).churchName,'First Church');
assert.equal((await accept(invitation.token.toUpperCase())).joined,true); // Different Apple relay email works.
assert.equal((await accept(invitation.token)).joined,true); // Retry after lost response.
await auth(6); await assert.rejects(()=>accept(invitation.token),/already been used/);
await db.exec('reset role'); await db.query('update public.church_memberships set active=false where user_id=$1',[id(2)]);
await auth(2); await assert.rejects(()=>accept(invitation.token),/review your access/);
await auth(1); const suspended = await create('suspended@example.com');
await auth(2); await assert.rejects(()=>accept(suspended.token),/already has a workspace/);
await auth(1); const phone = await create('+16155550123','phone');
await auth(3); await assert.rejects(()=>accept(phone.token),/Verify your email or phone/);
await auth(4,{anonymous:true}); await assert.rejects(()=>accept(phone.token),/Sign in/);
await auth(4); assert.equal((await accept(phone.token)).joined,true);
await auth(1); const revoked = await create('revoked@example.com');
await auth(5); assert.equal(await rpc('select public.revoke_shared_invitation($1) result',[revoked.id]),false);
assert.deepEqual(await rpc('select public.list_shared_invitations() result'),[]);
await auth(1); assert.equal(await rpc('select public.revoke_shared_invitation($1) result',[revoked.id]),true);
await auth(6); await assert.rejects(()=>accept(revoked.token),/revoked/);
await auth(1); const expired = await create('expired@example.com');
await db.exec('reset role'); await db.query("update private.shared_invitations set expires_at=now()-interval '1 second' where id=$1",[expired.id]);
await auth(6); await assert.rejects(()=>accept(expired.token),/expired/);
await auth(1); const replaced = await create('replaced@example.com'); const replacement = await create('replaced@example.com');
await auth(6); await assert.rejects(()=>accept(replaced.token),/revoked/);
assert.equal((await accept(replacement.token,false)).joined,false);
await db.exec('reset role'); await db.query('delete from auth.sessions where user_id=$1',[id(6)]);
await auth(6); await assert.rejects(()=>accept(replacement.token),/Sign in/);
await auth(5); await assert.rejects(()=>accept(replacement.token),/already has a workspace/);
await auth(1); const list=await rpc('select public.list_shared_invitations() result'); assert.ok(list.every(x=>!('token' in x)&&!('token_hash' in x)));
for(let n=0;n<18;n++) await create(`limit${n}@example.com`);
await assert.rejects(()=>create('limited@example.com'),/Invitation limit/);
await db.exec('reset role');
const roster = await db.query('select member_email from public.church_memberships where user_id=$1',[id(2)]);
assert.equal(roster.rows[0].member_email,'person2@privaterelay.appleid.com');
await db.close();
console.log('PASS: different Apple email, phone-only identity, anonymous/unverified/revoked sessions, leader/recent-auth guards, tenant isolation, single use, retry, suspended/existing memberships, expiry, revoke, replacement, rate limit, token confidentiality.');
