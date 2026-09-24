import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const database=process.argv[2];
if (process.argv.length!==3 || !/^nw_restore_\d{14}_[a-f0-9]{8}$/.test(database ?? '')) throw new Error('Pass only the nw_restore_* database from a verified local backup drill. The destination is always 127.0.0.1:54322.');
const args=['-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-h','127.0.0.1','-p','54322','-U','postgres','-d',database];
const run=sql=>execFileSync('psql',args,{input:sql,encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},stdio:['pipe','pipe','pipe'],maxBuffer:2*1024*1024});
try {
  const applied=new Set(run('select version from supabase_migrations.schema_migrations;').trim().split('\n'));
  if (!applied.has('20260915024430')) throw new Error('Restore must include the deployed outing-participant baseline.');
  const pending=readdirSync('supabase/migrations').filter(file=>/^\d{14}_[a-z0-9_]+\.sql$/.test(file)&&!applied.has(file.slice(0,14))).sort();
  if (pending.some(file=>file.slice(0,14)<'20260919000000')) throw new Error('Historical migration mismatch: reconcile separately before this iOS release rehearsal.');
  const snapshot=`
create temp table before_tables(schema_name text,table_name text,columns text[],digest text);
do $$ declare t record; cols text[]; hash text; begin
 for t in select n.nspname as n,c.relname as c from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth') and c.relkind='r' loop
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns where table_schema=t.n and table_name=t.c;
  execute format('select md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')) from %I.%I r',t.n,t.c) into hash;
  insert into before_tables values(t.n,t.c,cols,hash);
 end loop;
end $$;`;
  const verify=`
do $$ declare t record; hash text; begin
 for t in select * from before_tables loop
  execute format('select md5(coalesce(string_agg(md5(projected::text),'''' order by md5(projected::text)),'''')) from (select (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(r)) where key=any($1)) projected from %I.%I r) rows',t.schema_name,t.table_name) into hash using t.columns;
  if hash is distinct from t.digest then raise exception 'Original records changed during additive release rehearsal'; end if;
 end loop;
end $$;
select jsonb_build_object('result','additive release rehearsal passed','originalTablesUnchanged',(select count(*) from before_tables),'rolledBack',true);`;
  const migrations=pending.map(file=>readFileSync('supabase/migrations/'+file,'utf8').replace(/^(?:begin|commit);\s*$/gm,''));
  const output=run(['begin;',snapshot,...migrations,verify,readFileSync('tests/push-delivery-rehearsal.sql','utf8'),'rollback;'].join('\n'));
  console.log(JSON.stringify({database,pendingMigrations:pending}));
  console.log(output.split('\n').find(line=>line.startsWith('{')));
  console.log('APNs permission/delivery SQL checks passed. All changes rolled back; no production writes.');
} catch(error) {
  const code=String(error?.stderr ?? '').match(/(?:ERROR|FATAL):\s*([A-Z0-9]{5})\b/)?.[1];
  console.error(code ? `Rehearsal failed and rolled back. SQLSTATE: ${code}` : 'Rehearsal could not start. Check the verified restore name and migration history.');
  process.exitCode=1;
}
