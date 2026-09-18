#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, promises as fs, readFileSync, statfsSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareRelease, REQUIRED_COUNTIES, STREET_RELEASE_SOURCE } from "./sectionize.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sqlTemplatePath = resolve(scriptDirectory, "overture-four-counties.sql");
const repositoryDuckDbPath = resolve(scriptDirectory, "../../work/geodata/bin/duckdb");
export const OVERTURE_TRANSPORTATION_RELEASE = "2026-08-19.0";
export const DUCKDB_VERSION = "1.5.5";
export const DUCKDB_LINUX_AMD64_ARCHIVE_SHA256 = "08c0ca117111fcede14239d0093792352befdc174218c344d232c13279643d05";
const TIGER_COUNTY_URL = "https://www2.census.gov/geo/tiger/TIGER2025/COUNTY/tl_2025_us_county.zip";
const MIN_FREE_BYTES = 10 * 1024 ** 3;
const MIN_MEMORY_BYTES = 2 * 1024 ** 3;
const MAX_RAW_OUTPUT_BYTES = 1024 ** 3;

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
}

function command(name) {
  try { return execFileSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; } catch { return null; }
}

function memoryAvailable() {
  try {
    const match = readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    return Number(match?.[1]) * 1024 || totalmem();
  } catch { return totalmem(); }
}

function duckdbVersion(executable) {
  if (!executable) return null;
  try { return execFileSync(executable, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

export function resourceEstimate(outputDirectory = process.cwd()) {
  const disk = statfsSync(outputDirectory);
  const duckdb = existsSync(repositoryDuckDbPath) ? repositoryDuckDbPath : command("duckdb");
  return {
    duckdb, duckdbVersion: duckdbVersion(duckdb), psql: command("psql"), processors: availableParallelism(),
    availableMemoryBytes: memoryAvailable(), freeDiskBytes: disk.bavail * disk.bsize,
    minimumAvailableMemoryBytes: MIN_MEMORY_BYTES, minimumFreeDiskBytes: MIN_FREE_BYTES,
    boundedEnvelope: { xmin: -88.06, ymin: 34.98, xmax: -86.57, ymax: 35.73 },
    note: "Extraction uses GeoParquet row-group range reads. Reserve 10 GiB scratch and stop if raw output approaches 1 GiB.",
  };
}

function requireExtractionResources(outputDirectory) {
  const estimate = resourceEstimate(outputDirectory);
  if (!estimate.duckdb) throw new Error("DuckDB is not installed; extraction was not started.");
  if (!estimate.duckdbVersion?.startsWith(`v${DUCKDB_VERSION} `)) throw new Error(`DuckDB ${DUCKDB_VERSION} is required; extraction was not started.`);
  if (estimate.availableMemoryBytes < MIN_MEMORY_BYTES) throw new Error("At least 2 GiB available memory is required.");
  if (estimate.freeDiskBytes < MIN_FREE_BYTES) throw new Error("At least 10 GiB free disk is required.");
  return estimate;
}

function sqlLiteral(value) { return String(value).replaceAll("'", "''"); }

export function renderExtractionSql(template, { release, countyFile, outputFile }) {
  return template.replaceAll("{{RELEASE}}", sqlLiteral(release))
    .replaceAll("{{COUNTY_FILE}}", sqlLiteral(`/vsizip/${resolve(countyFile)}`))
    .replaceAll("{{OUTPUT_FILE}}", sqlLiteral(resolve(outputFile)));
}

export function buildPublishSql({ release, source, expectedRows, csvPath }) {
  const literal = (value) => `'${sqlLiteral(value)}'`;
  return `\\set ON_ERROR_STOP on
begin;
create temp table street_import_context(release text primary key, source text not null, expected_rows bigint not null check(expected_rows > 0));
insert into street_import_context values (${literal(release)}, ${literal(source)}, ${Number(expectedRows)});
create temp table street_import_stage(release text not null, id text not null, name text, road_class text, subclass text, geometry_json jsonb not null, county_fips jsonb not null);
\\copy street_import_stage(release,id,name,road_class,subclass,geometry_json,county_fips) from ${literal(resolve(csvPath))} with (format csv, header true)
do $verify$
declare actual_count bigint; actual_counties text[];
begin
  select count(*) into actual_count from street_import_stage;
  select array_agg(distinct county order by county) into actual_counties
    from street_import_stage stage cross join lateral jsonb_array_elements_text(stage.county_fips) county;
  if actual_count <> (select expected_rows from street_import_context) then raise exception 'Prepared row count does not match manifest.'; end if;
  if actual_counties <> array['47055','47099','47101','47181']::text[] then raise exception 'Prepared rows do not cover exactly the approved counties.'; end if;
  if exists(select 1 from street_import_stage where release <> (select release from street_import_context)) then raise exception 'Prepared rows contain another release.'; end if;
  if (select count(distinct id) from street_import_stage) <> actual_count then raise exception 'Prepared section IDs are not unique.'; end if;
  if exists(select 1 from street_import_stage where extensions.st_geometrytype(extensions.st_setsrid(extensions.st_geomfromgeojson(geometry_json::text),4326)) <> 'ST_LineString'
    or not extensions.st_isvalid(extensions.st_setsrid(extensions.st_geomfromgeojson(geometry_json::text),4326))
    or extensions.st_isempty(extensions.st_setsrid(extensions.st_geomfromgeojson(geometry_json::text),4326))) then raise exception 'Prepared section geometry is invalid.'; end if;
end $verify$;
delete from public.outreach_street_segments where release=(select release from street_import_context);
delete from public.outreach_street_releases where release=(select release from street_import_context);
insert into public.outreach_street_segments(release,id,name,road_class,subclass,geometry)
select release,id,name,road_class,subclass,extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(geometry_json::text),4326)) from street_import_stage;
insert into public.outreach_street_releases(release,source,complete,county_fips,expected_rows,imported_rows)
select context.release,context.source,false,array['47055','47099','47101','47181']::text[],context.expected_rows,
  (select count(*) from public.outreach_street_segments segment where segment.release=context.release)
from street_import_context context;
do $publish$
begin
  if not exists(select 1 from public.outreach_street_releases release cross join street_import_context context
    where release.release=context.release and release.source=context.source and release.complete=false
      and release.county_fips=array['47055','47099','47101','47181']::text[]
      and release.expected_rows=context.expected_rows and release.imported_rows=context.expected_rows and release.imported_rows>0)
    then raise exception 'Imported rows do not match the validated manifest.'; end if;
end $publish$;
update public.outreach_street_releases set complete=true where release=(select release from street_import_context);
commit;
`;
}

async function fetchCounties(destination) {
  if (existsSync(destination)) throw new Error(`Refusing to overwrite ${destination}`);
  const response = await fetch(TIGER_COUNTY_URL);
  if (!response.ok || !response.body) throw new Error(`County boundary download failed (${response.status}).`);
  const temporary = `${destination}.partial`;
  await fs.writeFile(temporary, Buffer.from(await response.arrayBuffer()), { flag: "wx" });
  await fs.rename(temporary, destination);
}

async function main() {
  const action = process.argv[2];
  if (action === "check") { process.stdout.write(`${JSON.stringify(resourceEstimate(option("output-dir", process.cwd())), null, 2)}\n`); return; }
  if (action === "fetch-counties") { const output = option("output"); if (!output) throw new Error("--output is required."); await fetchCounties(output); return; }
  if (action === "extract") {
    const countyFile = option("county-file"); const outputFile = option("output"); const release = option("release", OVERTURE_TRANSPORTATION_RELEASE);
    if (!countyFile || !outputFile) throw new Error("--county-file and --output are required.");
    const resources = requireExtractionResources(dirname(resolve(outputFile)));
    if (existsSync(outputFile) || existsSync(`${outputFile}.partial`)) throw new Error("Refusing to overwrite extraction output or a partial run.");
    const template = await fs.readFile(sqlTemplatePath, "utf8");
    const temporaryOutput = `${outputFile}.partial`;
    const result = spawnSync(resources.duckdb, ["-light-mode", ":memory:", "-c", renderExtractionSql(template, { release, countyFile, outputFile: temporaryOutput })], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("DuckDB extraction failed; no release was prepared or published.");
    const extracted = await fs.stat(temporaryOutput);
    if (extracted.size > MAX_RAW_OUTPUT_BYTES) throw new Error("Bounded raw output exceeded 1 GiB; inspect the partial file before retrying.");
    await fs.rename(temporaryOutput, outputFile);
    return;
  }
  if (action === "prepare") {
    const input = option("input"); const output = option("output"); const manifest = option("manifest"); const release = option("release", OVERTURE_TRANSPORTATION_RELEASE);
    if (!input || !output || !manifest) throw new Error("--input, --output, and --manifest are required.");
    process.stdout.write(`${JSON.stringify(await prepareRelease(input, output, manifest, release))}\n`); return;
  }
  if (action === "publish") {
    const databaseUrl = option("database-url"); const csvPath = option("input"); const manifestPath = option("manifest");
    if (!databaseUrl || !csvPath || !manifestPath || !process.argv.includes("--confirm-database-write")) throw new Error("Publish requires --database-url, --input, --manifest, and --confirm-database-write.");
    const host = new URL(databaseUrl).hostname;
    if (!["localhost", "127.0.0.1", "::1"].includes(host) && !process.argv.includes("--allow-remote")) throw new Error("Remote database writes require the separate --allow-remote acknowledgement.");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (!command("psql")) throw new Error("psql is not installed; no database write was attempted.");
    if (manifest.source !== STREET_RELEASE_SOURCE || typeof manifest.release !== "string" || !manifest.release.trim()
      || JSON.stringify(manifest.county_fips) !== JSON.stringify(REQUIRED_COUNTIES)
      || !Number.isSafeInteger(manifest.expected_rows) || manifest.expected_rows < 1) throw new Error("The prepared manifest is invalid.");
    const result = spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1"], { input: buildPublishSql({ release: manifest.release, source: manifest.source, expectedRows: manifest.expected_rows, csvPath }), encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] });
    if (result.status !== 0) throw new Error("Transactional street release publication failed and was rolled back.");
    return;
  }
  throw new Error("Usage: import-streets.mjs check|fetch-counties|extract|prepare|publish [options]");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
