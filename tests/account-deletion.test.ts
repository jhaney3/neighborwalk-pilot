import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const db = new PGlite({ extensions: { pgcrypto } });
const user = (suffix: number) => `70000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const source = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");

function helper(name: string, file: string) {
  const sql = source(file);
  const start = sql.indexOf(`create or replace function private.${name}(`);
  if (start < 0) throw new Error(`Missing ${name} helper`);
  return sql.slice(start, sql.indexOf("$$;", sql.indexOf("$$", start) + 2) + 3);
}

async function authenticate(userId: string, sessionId: string, anonymous = false) {
  await db.exec("reset role; set role authenticated;");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({
    sub: userId,
    session_id: sessionId,
    role: "authenticated",
    is_anonymous: anonymous,
  })]);
}

beforeAll(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema private;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key, deleted_at timestamptz);
    create table auth.identities(user_id uuid references auth.users(id), provider text, provider_id text);
    create table public.church_memberships(church_id uuid, user_id uuid references auth.users(id), primary key(church_id,user_id));
    create table public.authored_notes(id uuid, author_id uuid references auth.users(id));
    create table public.test_membership_refs(church_id uuid, user_id uuid, foreign key(church_id,user_id) references public.church_memberships(church_id,user_id));
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id), not_after timestamptz);
    create function auth.uid() returns uuid language sql as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema auth, private to authenticated;
  `);
  await db.exec(helper("is_real_user", "20260910110738_live_session_authorization"));
  await db.exec(source("20260919191901_mobile_account_deletion_requests"));
  await db.exec(source("20260924032218_account_deletion_fulfillment"));
  for (let index = 1; index <= 3; index += 1) {
    await db.query("insert into auth.users(id) values($1)", [user(index)]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [user(index + 100), user(index)]);
  }
});

afterAll(async () => db.close());

describe("account deletion request RPC", () => {
  it("is private, authenticated, live-session-bound, idempotent and account-scoped", async () => {
    await db.exec("set role anon;");
    await expect(db.query("select public.request_account_deletion()"))
      .rejects.toThrow(/permission denied/);

    await authenticate(user(1), user(101), true);
    await expect(db.query("select public.request_account_deletion()"))
      .rejects.toThrow(/Sign in before requesting deletion/);

    await authenticate(user(1), user(999));
    await expect(db.query("select public.request_account_deletion()"))
      .rejects.toThrow(/Sign in before requesting deletion/);

    await authenticate(user(1), user(101));
    await expect(db.query("select count(*) from private.account_deletion_requests"))
      .rejects.toThrow(/permission denied/);
    const first = (await db.query<{ receipt: { request_id: string; requested_at: string; due_at: string } }>(
      "select public.request_account_deletion() receipt",
    )).rows[0].receipt;
    const retry = (await db.query<{ receipt: typeof first }>("select public.request_account_deletion() receipt")).rows[0].receipt;
    expect(retry).toEqual(first);
    expect(Date.parse(first.due_at) - Date.parse(first.requested_at)).toBe(30 * 24 * 60 * 60 * 1000);

    await authenticate(user(2), user(102));
    const second = (await db.query<{ receipt: typeof first }>("select public.request_account_deletion() receipt")).rows[0].receipt;
    expect(second.request_id).not.toBe(first.request_id);

    await db.exec("reset role;");
    expect((await db.query<{ count: number }>("select count(*)::integer count from private.account_deletion_requests")).rows[0].count).toBe(2);
    await db.query("delete from auth.sessions where id=$1", [user(101)]);
    await authenticate(user(1), user(101));
    await expect(db.query("select public.request_account_deletion()"))
      .rejects.toThrow(/Sign in before requesting deletion/);
  });
});


describe("deletion operator controls", () => {
  it("restricts revocation proof and inventory, binds proof to Apple identity and throttles retries", async () => {
    await db.exec("reset role");
    await db.query("insert into auth.identities values($1,'apple','apple-subject')", [user(3)]);
    await db.query("insert into public.authored_notes values($1,$2)", [user(300),user(3)]);
    await db.query("insert into public.church_memberships values($1,$2)", [user(400),user(3)]);
    await db.query("insert into public.test_membership_refs values($1,$2)", [user(400),user(3)]);
    await authenticate(user(3),user(103));
    const receipt = (await db.query<{r:{request_id:string}}>("select public.request_account_deletion() r")).rows[0].r;
    await expect(db.query("select public.record_account_deletion_apple_revocation($1,'apple-subject')",[receipt.request_id])).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.begin_account_deletion_apple_attempt($1)",[receipt.request_id])).rejects.toThrow(/permission denied/);
    await expect(db.query("select private.account_deletion_inventory($1)",[receipt.request_id])).rejects.toThrow(/permission denied/);
    await db.exec("reset role; set role service_role");
    await db.query("select public.begin_account_deletion_apple_attempt($1)",[receipt.request_id]);
    await expect(db.query("select public.begin_account_deletion_apple_attempt($1)",[receipt.request_id])).rejects.toThrow(/one minute/);
    await expect(db.query("select public.record_account_deletion_apple_revocation($1,'wrong-subject')",[receipt.request_id])).rejects.toThrow(/mismatch/);
    await db.query("select public.record_account_deletion_apple_revocation($1,'apple-subject')",[receipt.request_id]);
    await db.exec("reset role");
    const inventory = (await db.query<{r:{apple_revoked_at:string;references:{table:string;column:string;rows:number}[]}}>("select private.account_deletion_inventory($1) r",[receipt.request_id])).rows[0].r;
    expect(inventory.apple_revoked_at).toBeTruthy();
    expect(inventory.references).toContainEqual({table:'public.authored_notes',column:'author_id',rows:1});
    expect(inventory.references).toContainEqual({table:'public.test_membership_refs',column:'user_id',rows:1});
    expect(JSON.stringify(inventory)).not.toContain('apple-subject');
  });
});
