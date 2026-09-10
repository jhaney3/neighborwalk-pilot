# Database recovery and cutover safeguards

This runbook describes implemented **application-database capture and isolated restore**, not a claim that production managed backups, off-site storage, provider recovery, or a production cutover are complete.

## Three different tools

| Tool | Purpose | Important boundary |
| --- | --- | --- |
| Data & health CSV / accessible-record JSON | Deliberate exchange or review by an authorized leader | Not a complete database backup; JSON does not include every separately stored guide, authentication or provider record |
| Operator encrypted application-database bundle | Consistent record/schema capture and an isolated local restoration drill | Database credentials and a separate encryption key are required; not a live-database overwrite tool |
| Supabase managed backup/PITR plus provider recovery | Production disaster recovery under an approved recovery objective | Requires verified plan/configuration, authorized restoration, retained keys, storage objects and service settings |

The operator bundle captures `public`, `private`, `auth`, `storage`, `supabase_migrations`, and `extensions`. This includes normalized outreach, the preserved legacy snapshot and protected records, guides, guide preferences/defaults, restrictions and aliases, audit/receipts, reminders, users/identities/sessions, reference parcels, and migration history **when present in the source**. Capture discovers the tables; it does not maintain a partial hard-coded list of app entities.

It excludes cluster roles/passwords, JWT/provider/encryption-root keys, storage object files, hosting configuration, external schedules, deployed functions, and schemas outside that scope. Non-empty Vault secrets, database large objects, or unreviewed extensions stop this implementation's capture rather than silently accepting an unsupported recovery case. A database bundle must never be presented as a complete hosted-environment backup.

## Prerequisites and key custody

- Node 22 and `psql`, `pg_dump`, `pg_restore`, and `createdb` from PostgreSQL 17 or newer. The dump client must support the source server version. Local restore requires the **same server major** and matching extension versions. The default GitHub Ubuntu 24.04 image currently provides PostgreSQL 16; do not assume its native dump client can capture a PostgreSQL 17 server.
- A source database connection with adequate read/dump access. A publishable/anon API key is not a database password. Use a direct or session-pooler connection, not the transaction pooler.
- Store configuration, keys, and bundles outside this repository. The tool rejects repository paths, symlink files, publicly readable credential/key/manifest files, and output overwrites. Use private directories (mode 700) and files (mode 600).
- Keep an access-controlled copy of the encryption key **separate from off-site backup copies**. Losing the key loses access to the encrypted archive. Copy only the bundle directory to the approved off-site destination, not the directory containing its key/configuration. No off-site destination or key-custody owner has been configured by this rework.

Create a private JSON configuration outside Git. This example is deliberately only the local sandbox:

```json
{
  "projectRef": "local",
  "host": "127.0.0.1",
  "port": 54322,
  "database": "postgres",
  "user": "postgres",
  "password": "postgres"
}
```

For a hosted source, use the actual 20-character project reference, the project's direct host with user `postgres`, or its session-pooler host with user `postgres.PROJECT_REF`, port 5432 and database `postgres`. Hosted connections require certificate-verified TLS. Do not put real passwords in documentation, shell history, chat, application environment variables, or command arguments; write them into the owner-only configuration through your secure local credential workflow. Do not reset a live database password as an incidental backup step.

## Capture and authenticate

From the repository, use `npm run backup:database -- --help`. Example paths below are placeholders and must exist outside Git; each output bundle directory must be new.

```sh
npm run backup:database -- keygen --key-file /private/keys/church-backup.key
npm run backup:database -- capture --config /private/config/source.json --expect-source PROJECT_REF --key-file /private/keys/church-backup.key --out /private/backups/new-capture
npm run backup:database -- inspect --bundle /private/backups/new-capture --expect-source PROJECT_REF --key-file /private/keys/church-backup.key
```

Capture uses a repeatable-read, read-only exported snapshot shared with `pg_dump`. Table counts and deterministic SHA-256 row-multiset digests are computed within that snapshot. A slow/blocked operation fails rather than weakening consistency. Keep schema changes out of the capture window; concurrent ordinary writes do not become a mixed-version export.

The compressed archive streams through AES-256-GCM encryption. The manifest, including source/scope/counts/digests, is authenticated as associated data. A durable manifest is written only after the database producer completes cleanly and the archive is flushed. An incomplete directory without a valid manifest is not a usable backup. Warnings or failed dump processes do not produce an accepted completion marker.

`inspect` authenticates the **entire archive before passing any bytes to PostgreSQL tooling** and checks its table of contents. This proves readability and integrity, not successful restoration or application operation. Temporary decrypted files are owner-only and removed after the command. Use an encrypted device/filesystem; file removal is not guaranteed forensic erasure on SSDs.

## Isolated restore and verification

Only restore archives from a trusted source/operator. PostgreSQL archives execute source-controlled SQL; a valid encryption tag does not make a malicious source safe.

```sh
npm run backup:database -- restore-local --bundle /private/backups/new-capture --expect-source PROJECT_REF --key-file /private/keys/church-backup.key --confirm "TRUSTED LOCAL RESTORE"
```

There is deliberately no destination URL or overwrite option. The tool uses the standard isolated Supabase development administrator at `127.0.0.1:54322` and creates a fresh `nw_restore_TIMESTAMP_RANDOM` database. It cannot restore over `postgres`, the earlier private preservation rehearsal, or a hosted database. It does not change the app's connection, auth provider, or sender configuration. It never creates/grants cluster roles to make a restore pass.

Matching extensions are initialized before schema/data restoration. PostGIS built-in spatial references must remain present: its native dump exports custom reference additions, not all built-in rows. A wrong reference setup can change geometry JSON serialization even when the stored coordinates are identical. The digest check catches that. An installation with modified built-in extension reference rows needs a supervised extension-specific recovery plan if the exact comparison fails.

Restore uses a single transaction with stop-on-error, keeps original object ownership where the local roles support it, and verifies every captured table's row count/digest, columns and RLS policies, plus extension names/schemas/versions. Failed targets remain isolated for investigation; no automatic database deletion or live replacement occurs. The report explicitly does **not** claim verified application sign-in or provider configuration.

To exercise the whole local loop and all six database permission/workflow suites against the restored copy:

```sh
npm run backup:rehearse:local
```

This fixed-target drill retains a private artifact directory, a test encryption key, a report, and its newly restored database. It is not a hosted production export, off-site backup service, or a reason to put keys into CI artifacts. Schedule drills on an operator-controlled machine with matching PostgreSQL clients. Unit tests for source isolation, private file handling, authenticated encryption, tampering, wrong keys, wrong projects and interrupted producers run in ordinary CI.

## Production cutover gate

Before applying the normalized migrations to the live church:

1. Verify a current managed/off-site recovery point and responsible operator, target recovery time and acceptable data-loss window. Confirm auth/encryption keys, storage objects, provider configuration, DNS and external schedules are recoverable separately.
2. Capture a fresh complete scoped application bundle from production with the actual database credential. The earlier partial export is not this artifact: its 66,252 reference parcels were not downloaded. Do not alter that parcel dataset on the strength of the partial copy.
3. Rehearse restoration and all additive migrations against the new private isolated copy. Verify full field/relationship reconciliation and permission/workflow tests. Original bytes, actors, timestamps, guide settings, receipts and restrictions must be accounted for.
4. Reconcile the actual hosted migration history against local migrations. The hosted project's 17 older versions do not simply match this repository's historical filenames. Do not blindly run `db push` or mark unexecuted migrations applied.
5. Coordinate every pilot device's pending/legacy work before the cutover. Preserve originals and immutable receipts; a server backup cannot capture fieldwork that exists only on a volunteer's phone.
6. Validate the two staged relationship constraints, isolated staging configuration, supported client/update behavior, production authentication and delivery, operational monitoring, policies and commercial hosting gates.
7. Apply the reviewed cutover under its maintenance/runbook controls, verify the live build and workflows, and record the exact database/app checkpoints. Once new writes exist, use a reviewed forward repair where possible; restoring the entire old database would discard those writes.

None of these remaining production gates is waived by a successful local drill. An app “restore” button that replaces a church with arbitrary uploaded JSON is intentionally not provided.

## Verified implementation evidence

On September 10, 2026, a local encrypted capture contained 53 tables and 11,870 records. The successful isolated restore `nw_restore_20260910101045_e7fa74e7` matched all captured row digests, columns and RLS policies. All six rollback-only database permission/workflow suites passed against it. Earlier failed isolated targets were retained, not promoted or attached to the app. These counts describe the fictional local sandbox, **not production**.

Sources: [Supabase backup scope](https://supabase.com/docs/guides/platform/backups), [Supabase CLI backup/restore and separate configuration](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [PostgreSQL consistent dumps and trusted-source warning](https://www.postgresql.org/docs/17/app-pgdump.html), [PostgreSQL snapshot synchronization](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION), [GitHub Ubuntu image tools](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md).
