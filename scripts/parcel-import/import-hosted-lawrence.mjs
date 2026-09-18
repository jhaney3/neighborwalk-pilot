#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const DEFAULT_INPUT = resolve(repositoryRoot, "work/geodata/hosted-lawrence-2026-09-12");
const DEFAULT_COUNTY_FILE = resolve(repositoryRoot, "work/geodata/downloads/tl_2025_us_county.zip");
const DUCKDB = resolve(repositoryRoot, "work/geodata/bin/duckdb");
const LOCAL_DATABASE = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const COUNTY_FIPS = "47099";
const SOURCE = "NeighborWalk hosted parcel snapshot";
const EXPECTED_FIELDS = [
  "county_fips", "geometry_base64", "gislink", "imported_at", "is_residential",
  "land_use", "property_class", "situs_address", "source_updated_on",
].sort();

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function md5(value) {
  return createHash("md5").update(value).digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function strictBase64(value) {
  if (typeof value !== "string" || value.length === 0 || /[^A-Za-z0-9+/=\t\n\r ]/.test(value)) return null;
  const normalized = value.replace(/[\t\n\r ]/g, "");
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null;
  const decoded = Buffer.from(normalized, "base64");
  return decoded.length > 8 && decoded.toString("base64") === normalized ? decoded : null;
}

function nullableText(value, maximum, field) {
  if (value === null) return;
  if (typeof value !== "string" || value.length > maximum) throw new Error(`${field} is invalid.`);
}

function exportMetadata(inputDirectory) {
  const path = resolve(inputDirectory, "source-verification.json");
  if (!existsSync(path)) throw new Error("source-verification.json is required.");
  const metadata = JSON.parse(readFileSync(path, "utf8"));
  if (metadata.source !== SOURCE || metadata.county_fips !== COUNTY_FIPS
    || metadata.total !== 25754 || metadata.residential !== 21055
    || metadata.unique_ids !== 25754 || metadata.invalid_geometry !== 0
    || metadata.parts !== 52 || metadata.geometry_encoding !== "PostGIS EWKB base64, unchanged"
    || metadata.content_fingerprint_before !== metadata.content_fingerprint_after
    || !/^[a-f0-9]{32}$/.test(metadata.content_fingerprint_after)
    || metadata.last_import !== "2026-08-13 23:19:44.20541+00") {
    throw new Error("Hosted source verification metadata does not match the approved Lawrence export.");
  }
  return metadata;
}

export function inspectExport(inputDirectory = DEFAULT_INPUT) {
  const directory = resolve(inputDirectory);
  const directoryMode = statSync(directory).mode & 0o777;
  if ((directoryMode & 0o077) !== 0) throw new Error("Export directory must not be accessible to group or other users.");
  const metadata = exportMetadata(directory);
  const partNames = readdirSync(directory).filter((name) => /^part-\d{3}\.json$/.test(name)).sort();
  if (partNames.length !== metadata.parts
    || partNames.some((name, index) => name !== `part-${String(index).padStart(3, "0")}.json`)) {
    throw new Error("Export parts must be the contiguous sequence part-000.json through part-051.json.");
  }

  const transferHash = createHash("sha256");
  const records = [];
  const identities = new Set();
  let residential = 0;
  let maxImportedAt = "";
  const partHashes = [];

  for (const [partIndex, partName] of partNames.entries()) {
    const partPath = resolve(directory, partName);
    if ((statSync(partPath).mode & 0o077) !== 0) throw new Error(`${partName} must not be accessible to group or other users.`);
    const bytes = readFileSync(partPath);
    transferHash.update(`${partName}\0${bytes.length}\0`);
    transferHash.update(bytes);
    transferHash.update("\0");
    partHashes.push({ file: partName, sha256: sha256(bytes) });
    const part = JSON.parse(bytes.toString("utf8"));
    const expectedPartRows = partIndex === metadata.parts - 1 ? 254 : 500;
    if (!Array.isArray(part) || part.length !== expectedPartRows) throw new Error(`${partName} has an unexpected row count.`);

    for (const record of part) {
      if (!record || typeof record !== "object" || Array.isArray(record)
        || JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(EXPECTED_FIELDS)) {
        throw new Error(`${partName} contains an unexpected field set.`);
      }
      if (record.county_fips !== COUNTY_FIPS || typeof record.gislink !== "string"
        || record.gislink.length < 1 || record.gislink.length > 120 || identities.has(record.gislink)) {
        throw new Error(`${partName} contains an invalid or duplicate parcel identity.`);
      }
      identities.add(record.gislink);
      nullableText(record.situs_address, 300, "situs_address");
      nullableText(record.property_class, 1000, "property_class");
      nullableText(record.land_use, 1000, "land_use");
      if (typeof record.is_residential !== "boolean") throw new Error("is_residential must be boolean.");
      if (record.source_updated_on !== null
        && (typeof record.source_updated_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.source_updated_on))) {
        throw new Error("source_updated_on must be a date or null.");
      }
      if (typeof record.imported_at !== "string" || !Number.isFinite(Date.parse(record.imported_at))) {
        throw new Error("imported_at must be a timestamp.");
      }
      if (!strictBase64(record.geometry_base64)) throw new Error("geometry_base64 is not canonical base64 EWKB.");
      residential += Number(record.is_residential);
      if (record.imported_at > maxImportedAt) maxImportedAt = record.imported_at;
      records.push(record);
    }
  }

  const ordered = [...records].sort((left, right) => Buffer.compare(Buffer.from(left.gislink), Buffer.from(right.gislink)));
  const contentFingerprint = md5(ordered.map((record) => {
    const geometryHex = strictBase64(record.geometry_base64).toString("hex");
    return md5([
      record.gislink, geometryHex, String(record.is_residential), record.property_class ?? "",
      record.land_use ?? "", record.situs_address ?? "", record.source_updated_on ?? "",
    ].join("|"));
  }).join(""));

  if (records.length !== metadata.total || identities.size !== metadata.unique_ids
    || residential !== metadata.residential || maxImportedAt !== metadata.last_import
    || contentFingerprint !== metadata.content_fingerprint_after) {
    throw new Error("Export rows do not reproduce the hosted source counts or content fingerprint.");
  }

  return {
    directory, metadata, records, partHashes,
    transferSha256: transferHash.digest("hex"), contentFingerprint, maxImportedAt,
  };
}

export function extractCountyCoverage(countyFile = DEFAULT_COUNTY_FILE) {
  const resolvedCountyFile = resolve(countyFile);
  if (!existsSync(DUCKDB)) throw new Error("The repository-pinned DuckDB executable is missing.");
  const version = spawnSync(DUCKDB, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (version.status !== 0 || !version.stdout.startsWith("v1.5.5 ")) throw new Error("Repository-pinned DuckDB 1.5.5 is required.");
  if (!existsSync(resolvedCountyFile)) throw new Error("The pinned TIGER county ZIP is missing.");
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "neighborwalk-lawrence-coverage-"));
  const output = resolve(temporaryDirectory, "coverage.json");
  const escapedCountyFile = resolvedCountyFile.replaceAll("'", "''");
  const escapedOutput = output.replaceAll("'", "''");
  const sql = `LOAD spatial;
COPY (
  SELECT geoid AS county_fips,
    ST_AsGeoJSON(ST_Transform(geom, 'EPSG:4269', 'EPSG:4326', always_xy := true)) AS geometry_json
  FROM ST_Read('/vsizip/${escapedCountyFile}')
  WHERE geoid = '${COUNTY_FIPS}'
) TO '${escapedOutput}' (FORMAT JSON, ARRAY true);`;
  try {
    const result = spawnSync(DUCKDB, ["-light-mode", ":memory:", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result.status !== 0) throw new Error(`DuckDB could not extract Lawrence TIGER coverage: ${result.stderr.trim()}`);
    const rows = JSON.parse(readFileSync(output, "utf8"));
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].county_fips !== COUNTY_FIPS) {
      throw new Error("TIGER coverage did not contain exactly Lawrence County.");
    }
    const geometry = typeof rows[0].geometry_json === "string" ? JSON.parse(rows[0].geometry_json) : rows[0].geometry_json;
    if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type) || !Array.isArray(geometry.coordinates)) {
      throw new Error("TIGER Lawrence coverage geometry is invalid.");
    }
    return { geometry, sourceSha256: sha256(readFileSync(resolvedCountyFile)) };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function csvJson(value) {
  return `"${JSON.stringify(value).replaceAll('"', '""')}"\n`;
}

export function buildPublishSql({ stagePath, coverage, verification, transferSha256, commit }) {
  const release = `hosted-lawrence-2026-09-12-${transferSha256}`;
  const finish = commit ? "commit;" : "rollback;";
  return `\\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';
select pg_advisory_xact_lock(hashtextextended('neighborwalk:parcel-import:47099', 0));
create temp table hosted_parcel_import_context(
  release text not null, source text not null, county_fips text not null,
  expected_rows bigint not null, expected_residential bigint not null,
  expected_fingerprint text not null, expected_max_imported_at timestamptz not null,
  other_parcel_rows bigint not null, coverage_json jsonb not null
) on commit drop;
insert into hosted_parcel_import_context
select ${sqlLiteral(release)}, ${sqlLiteral(SOURCE)}, '${COUNTY_FIPS}',
  ${verification.metadata.total}, ${verification.metadata.residential},
  ${sqlLiteral(verification.contentFingerprint)}, ${sqlLiteral(verification.maxImportedAt)},
  count(*) filter(where county_fips <> '${COUNTY_FIPS}'), ${sqlLiteral(JSON.stringify(coverage.geometry))}::jsonb
from public.parcels;
create temp table hosted_parcel_import_stage(payload jsonb not null) on commit drop;
\\copy hosted_parcel_import_stage(payload) from ${sqlLiteral(resolve(stagePath))} with (format csv)

do $validate_payload$
declare unexpected boolean;
begin
  select exists(
    select 1 from hosted_parcel_import_stage stage
    where jsonb_typeof(stage.payload) <> 'object'
      or not stage.payload ?& array['county_fips','geometry_base64','gislink','imported_at','is_residential','land_use','property_class','situs_address','source_updated_on']
      or exists(
        select 1 from jsonb_object_keys(stage.payload) key
        where key <> all(array['county_fips','geometry_base64','gislink','imported_at','is_residential','land_use','property_class','situs_address','source_updated_on'])
      )
  ) into unexpected;
  if unexpected then raise exception 'Staged export contains an unexpected JSON shape.'; end if;
  if exists(select 1 from public.parcels where county_fips='${COUNTY_FIPS}') then
    raise exception 'Local Lawrence parcels already exist; refusing to overwrite or merge.';
  end if;
end
$validate_payload$;

create temp table hosted_parcel_import_parsed on commit drop as
select
  payload->>'county_fips' as county_fips,
  payload->>'gislink' as gislink,
  payload->>'situs_address' as situs_address,
  payload->>'property_class' as property_class,
  payload->>'land_use' as land_use,
  (payload->>'is_residential')::boolean as is_residential,
  nullif(payload->>'source_updated_on','')::date as source_updated_on,
  (payload->>'imported_at')::timestamptz as imported_at,
  extensions.st_geomfromewkb(decode(payload->>'geometry_base64','base64')) as geometry
from hosted_parcel_import_stage;

do $validate_rows$
declare
  actual_rows bigint;
  residential_rows bigint;
  unique_rows bigint;
  actual_fingerprint text;
  actual_max_imported_at timestamptz;
  context hosted_parcel_import_context;
begin
  select * into context from hosted_parcel_import_context;
  select count(*), count(*) filter(where is_residential), count(distinct gislink), max(imported_at),
    md5(string_agg(md5(gislink||'|'||encode(extensions.st_asewkb(geometry),'hex')||'|'||is_residential::text||'|'||
      coalesce(property_class,'')||'|'||coalesce(land_use,'')||'|'||coalesce(situs_address,'')||'|'||
      coalesce(source_updated_on::text,'')),'' order by gislink))
  into actual_rows,residential_rows,unique_rows,actual_max_imported_at,actual_fingerprint
  from hosted_parcel_import_parsed;
  if actual_rows <> context.expected_rows or residential_rows <> context.expected_residential
    or unique_rows <> context.expected_rows or actual_fingerprint <> context.expected_fingerprint
    or actual_max_imported_at <> context.expected_max_imported_at then
    raise exception 'Staged rows do not reproduce the verified hosted source.';
  end if;
  if exists(
    select 1 from hosted_parcel_import_parsed parcel
    where parcel.county_fips <> context.county_fips
      or length(parcel.gislink) not between 1 and 120
      or extensions.st_geometrytype(parcel.geometry) <> 'ST_MultiPolygon'
      or extensions.st_srid(parcel.geometry) <> 4326
      or extensions.st_isempty(parcel.geometry)
      or not extensions.st_isvalid(parcel.geometry)
  ) then raise exception 'Staged parcel identity or geometry is invalid.'; end if;
end
$validate_rows$;

insert into public.parcels(
  county_fips,gislink,situs_address,property_class,land_use,is_residential,
  geometry,source_updated_on,imported_at
)
select county_fips,gislink,situs_address,property_class,land_use,is_residential,
  geometry,source_updated_on,imported_at
from hosted_parcel_import_parsed
order by gislink;

do $validate_local$
declare
  context hosted_parcel_import_context;
  coverage_shape extensions.geometry;
begin
  select * into context from hosted_parcel_import_context;
  coverage_shape := extensions.st_multi(
    extensions.st_setsrid(extensions.st_geomfromgeojson(context.coverage_json::text),4326)
  );
  if extensions.st_geometrytype(coverage_shape) <> 'ST_MultiPolygon'
    or not extensions.st_isvalid(coverage_shape) or extensions.st_isempty(coverage_shape) then
    raise exception 'Lawrence TIGER coverage is invalid.';
  end if;
  if (select count(*) from public.parcels where county_fips=context.county_fips) <> context.expected_rows
    or (select count(*) from public.parcels where county_fips=context.county_fips and is_residential) <> context.expected_residential
    or (select count(*) from public.parcels where county_fips<>context.county_fips) <> context.other_parcel_rows then
    raise exception 'Local parcel counts changed outside the approved Lawrence insert.';
  end if;
  -- Hosted county assignment and the Census edge differ for 46 records. Keep
  -- every verified source row unchanged, but never expand the TIGER coverage:
  -- the public RPC still requires the request itself to be wholly covered.
  insert into private.outreach_parcel_releases(
    release,county_fips,source,complete,expected_rows,imported_rows,coverage
  ) values(
    context.release,context.county_fips,context.source,true,
    context.expected_rows,context.expected_rows,coverage_shape
  );
end
$validate_local$;

do $validate_publication$
declare response jsonb; context hosted_parcel_import_context;
begin
  select * into context from hosted_parcel_import_context;
  response := public.public_map_parcels_for_boundary_v1(
    '{"type":"Polygon","coordinates":[[[-87.345,35.235],[-87.325,35.235],[-87.325,35.255],[-87.345,35.255],[-87.345,35.235]]]}'::jsonb
  );
  if response->>'availability' <> 'available' or not (response->>'complete')::boolean
    or response->>'datasetRevision' <> context.release
    or jsonb_array_length(response->'features') = 0 then
    raise exception 'Lawrence public parcel publication did not become available.';
  end if;
end
$validate_publication$;

select ${sqlLiteral(commit ? "Lawrence parcel publication PASS" : "Lawrence parcel staging rollback PASS")} as result,
  ${verification.metadata.total}::bigint as rows,
  ${verification.metadata.residential}::bigint as residential,
  ${sqlLiteral(verification.contentFingerprint)} as source_fingerprint,
  ${sqlLiteral(transferSha256)} as transfer_sha256;
${finish}
`;
}

function conciseSummary(verification, coverage) {
  return {
    status: "verified",
    source: SOURCE,
    county_fips: COUNTY_FIPS,
    rows: verification.metadata.total,
    residential: verification.metadata.residential,
    unique_ids: verification.metadata.unique_ids,
    invalid_geometry: verification.metadata.invalid_geometry,
    source_fingerprint: verification.contentFingerprint,
    transfer_sha256: verification.transferSha256,
    max_imported_at: verification.maxImportedAt,
    parts: verification.partHashes.length,
    tiger_county_sha256: coverage.sourceSha256,
  };
}

async function main() {
  const action = process.argv[2];
  if (!["check", "stage", "publish"].includes(action)) {
    throw new Error("Usage: import-hosted-lawrence.mjs check|stage|publish [--input-dir path] [--county-file path] [--expected-transfer-sha256 hash] [--confirm-local-write]");
  }
  const verification = inspectExport(option("input-dir", DEFAULT_INPUT));
  const coverage = extractCountyCoverage(option("county-file", DEFAULT_COUNTY_FILE));
  const expectedTransfer = option("expected-transfer-sha256", "");
  if (expectedTransfer && (!/^[a-f0-9]{64}$/.test(expectedTransfer) || expectedTransfer !== verification.transferSha256)) {
    throw new Error("Transfer SHA-256 does not match the reviewed export.");
  }
  if (action === "check") {
    process.stdout.write(`${JSON.stringify(conciseSummary(verification, coverage), null, 2)}\n`);
    return;
  }
  if (!expectedTransfer) throw new Error("Stage and publish require --expected-transfer-sha256 from a reviewed check.");
  if (!process.argv.includes("--confirm-local-write")) throw new Error("Stage and publish require --confirm-local-write.");
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "neighborwalk-lawrence-import-"));
  const stagePath = resolve(temporaryDirectory, "parcels.csv");
  try {
    writeFileSync(stagePath, verification.records.map(csvJson).join(""), { encoding: "utf8", mode: 0o600, flag: "wx" });
    const sql = buildPublishSql({
      stagePath, coverage, verification, transferSha256: verification.transferSha256,
      commit: action === "publish",
    });
    const result = spawnSync("psql", [LOCAL_DATABASE, "-X", "-v", "ON_ERROR_STOP=1"], {
      input: sql, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"],
    });
    if (result.status !== 0) throw new Error(`${action} failed; the database transaction was not committed.`);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
