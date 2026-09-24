import { readFile } from 'node:fs/promises';
import { privateFile, validateSource } from './lib/backup-files.mjs';
import { BackupSql, sqlLiteral } from './lib/backup-postgres.mjs';

const usage = 'npm run deletion:inventory -- --config /private/source.json --expect-source PROJECT_REF [--request UUID]\nRead-only counts and deadlines. Does not erase data, revoke sessions, send email or certify fulfillment. Config must be owner-only and outside the repository, as for database backups.';
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log(usage); process.exit(0); }
const options = {};
for (let i=0;i<args.length;i+=2) {
  const name=args[i];
  if (!['--config','--expect-source','--request'].includes(name) || !args[i+1] || options[name]) throw new Error(usage);
  options[name]=args[i+1];
}
if (!options['--config'] || !options['--expect-source'] || (options['--request'] && !/^[a-f0-9-]{36}$/i.test(options['--request']))) throw new Error(usage);
let session;
try {
  const config=validateSource(JSON.parse(await readFile(await privateFile(options['--config'],16384),'utf8')),options['--expect-source']);
  session=new BackupSql(config);
  const sql=options['--request']
    ? `select private.account_deletion_inventory(${sqlLiteral(options['--request'])}::uuid)`
    : `select coalesce(jsonb_agg(jsonb_build_object('request_id',id,'requested_at',requested_at,'due_at',due_at,'overdue',due_at<now(),'apple_revoked_at',apple_revoked_at) order by due_at),'[]'::jsonb) from private.account_deletion_requests`;
  const result=await session.query(sql);
  console.log(JSON.stringify(result,null,2));
} catch { console.error('Deletion inventory unavailable. Check the private connection configuration, privileges and deployed migration. No data was changed.'); process.exitCode=1; }
finally { await session?.close(); }
