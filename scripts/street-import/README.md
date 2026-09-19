# Four-county Overture street release importer

This offline, bounded importer covers Tennessee county FIPS `47055`, `47099`,
`47101`, and `47181`. It pins Overture transportation release `2026-08-19.0`,
preserves canonical source segments, and splits them at every interior connector
linear-reference position. Section IDs include the source segment ID and the
section's start/end linear references.

It never loads global Parquet in the browser. `check`, `fetch-counties`,
`extract`, and `prepare` do not write a database. `publish` is a separate,
explicitly acknowledged admin operation; normal verification must not run it
against a hosted database.

## 1. Preflight

```sh
node scripts/street-import/import-streets.mjs check --output-dir /path/to/scratch
```

Extraction refuses to start without DuckDB, 2 GiB currently available memory,
and 10 GiB free scratch space. It range-reads only the pinned Overture envelope
and refuses to promote raw NDJSON larger than 1 GiB.

The reviewed CLI is DuckDB `1.5.5` for Linux amd64 from
`https://github.com/duckdb/duckdb/releases/download/v1.5.5/duckdb_cli-linux-amd64.zip`.
Its published archive SHA-256 is
`08c0ca117111fcede14239d0093792352befdc174218c344d232c13279643d05`.
Keep the verified binary at `work/geodata/bin/duckdb`; `work/` is ignored. The
resource check reports and enforces this pinned version before extraction.

## 2. Fetch reviewed county boundaries

```sh
node scripts/street-import/import-streets.mjs fetch-counties \
  --output /path/to/scratch/tl_2025_us_county.zip
```

The URL is pinned to the Census 2025 TIGER county archive. Keep the archive
outside the repository and verify it according to the release runbook.

## 3. Extract bounded source rows

```sh
node scripts/street-import/import-streets.mjs extract \
  --county-file /path/to/scratch/tl_2025_us_county.zip \
  --output /path/to/scratch/overture-source.ndjson
```

DuckDB spatial/httpfs filters the official release by a four-county envelope,
then intersects candidates with the four Census county shapes while retaining
the entire canonical geometry, connector positions, and county membership. A
failed extraction remains a `.partial` file and is never promoted.

## 4. Split and validate canonical sections

```sh
node scripts/street-import/import-streets.mjs prepare \
  --input /path/to/scratch/overture-source.ndjson \
  --output /path/to/scratch/street-sections.csv \
  --manifest /path/to/scratch/street-manifest.json
```

Preparation uses WGS84 geodetic lengths for Overture linear references, rejects
malformed or duplicate identities, and requires exactly the four approved
counties. The manifest source is exactly `Overture transportation` and contains
`release`, `county_fips`, and `expected_rows`.

## 5. Transactional publication (admin-only)

For a reviewed local database only:

```sh
node scripts/street-import/import-streets.mjs publish \
  --database-url postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  --input /path/to/scratch/street-sections.csv \
  --manifest /path/to/scratch/street-manifest.json \
  --confirm-database-write
```

The transaction stages CSV rows, validates exact counts, unique IDs, LineString
geometry, and four-county coverage, inserts canonical MultiLineStrings, writes
an incomplete release manifest, verifies `expected_rows = imported_rows > 0`,
and only then marks it complete. Any error rolls back. Remote hosts require a
separate `--allow-remote` acknowledgement; repository verification must not use
it.

Display attribution: `© OpenStreetMap contributors, Overture Maps Foundation`.
Saved targets retain the source revision and canonical geometry; source refreshes
must not rewrite historical target snapshots.
