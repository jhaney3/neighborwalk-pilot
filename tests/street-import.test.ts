import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OVERTURE_TRANSPORTATION_RELEASE, buildPublishSql, renderExtractionSql } from "../scripts/street-import/import-streets.mjs";
import { canonicalSectionId, sectionizeSegment, splitLineAtFractions } from "../scripts/street-import/sectionize.mjs";
import { OVERTURE_TRANSPORTATION_RELEASE as CLIENT_RELEASE } from "../lib/street-segments";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
});

describe("bounded street importer", () => {
  it("keeps the importer and client pinned to the same release", () => {
    expect(OVERTURE_TRANSPORTATION_RELEASE).toBe(CLIENT_RELEASE);
  });

  it("splits canonical geometry at interior Overture connector positions", () => {
    const coordinates = [[-87.2, 35.2], [-87.19, 35.2], [-87.18, 35.2]];
    const sections = splitLineAtFractions(coordinates, [0, .5, 1]);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ start: 0, end: .5, coordinates: [coordinates[0], coordinates[1]] });
    expect(sections[1]).toMatchObject({ start: .5, end: 1, coordinates: [coordinates[1], coordinates[2]] });
    expect(canonicalSectionId("gers-main", 0, .5)).toBe("gers-main@0.000000000-0.500000000");
  });

  it("preserves source identity, revision and four-county coverage in an offline fixture", () => {
    const directory = mkdtempSync(join(tmpdir(), "neighborwalk-streets-"));
    temporaryDirectories.push(directory);
    const output = join(directory, "sections.csv");
    const manifest = join(directory, "manifest.json");
    execFileSync(process.execPath, [resolve("scripts/street-import/import-streets.mjs"), "prepare",
      "--input", resolve("scripts/street-import/fixtures/segments.ndjson"), "--output", output,
      "--manifest", manifest], { cwd: resolve("."), encoding: "utf8" });
    expect(JSON.parse(readFileSync(manifest, "utf8"))).toEqual({
      release: OVERTURE_TRANSPORTATION_RELEASE,
      source: "Overture transportation",
      county_fips: ["47055", "47099", "47101", "47181"],
      expected_rows: 3,
    });
    const csv = readFileSync(output, "utf8");
    expect(csv).toContain("gers-main@0.000000000-0.500000000");
    expect(csv).toContain("gers-main@0.500000000-1.000000000");
    expect(csv).toContain("gers-oak@0.000000000-1.000000000");
  });

  it("rejects foreign county membership before a release can be prepared", () => {
    expect(() => sectionizeSegment({ source_segment_id: "foreign", name: "Road", road_class: "residential",
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] }, connectors: [{ at: 0 }, { at: 1 }], county_fips: ["47037"] }, "r1"))
      .toThrow("invalid county membership");
  });

  it("renders bounded extraction paths and a manifest-gated publication transaction", () => {
    const extraction = renderExtractionSql("{{RELEASE}}|{{COUNTY_FILE}}|{{OUTPUT_FILE}}", {
      release: OVERTURE_TRANSPORTATION_RELEASE, countyFile: "county.zip", outputFile: "source.ndjson",
    });
    expect(extraction).toContain(`/vsizip/${resolve("county.zip")}`);
    const publication = buildPublishSql({ release: OVERTURE_TRANSPORTATION_RELEASE, source: "Overture transportation",
      expectedRows: 3, csvPath: "sections.csv" });
    expect(publication).toContain("begin;");
    expect(publication).toContain("select count(*) into actual_count from street_import_stage;");
    expect(publication).toContain("release.complete=false");
    expect(publication).toContain("update public.outreach_street_releases set complete=true");
    expect(publication.trimEnd().endsWith("commit;")).toBe(true);
  });
});
