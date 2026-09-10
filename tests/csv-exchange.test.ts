import { describe, expect, it } from "vitest";
import { csvCell, csvImportOperations, exportCsv, parseCsv, previewCsv } from "../lib/csv-exchange";
import { createSeedData } from "../lib/seed";
describe("reviewed CSV exchange", () => {
  it("parses quoted commas, escaped quotes, BOM and embedded newlines without evaluating cells", () => {
    expect(parseCsv('\uFEFFname,email\r\n"Alex, ""A""",alex@example.test')).toEqual([["name","email"],['Alex, "A"',"alex@example.test"]]);
    expect(parseCsv('name\n"Two\nlines"')).toEqual([["name"],["Two\nlines"]]);
    expect(() => parseCsv('name\n"never closed')).toThrow("not closed");
    expect(() => parseCsv('name\n"closed"extra')).toThrow("Malformed");
  });
  it("neutralizes spreadsheet formulas including whitespace/control-prefix attacks", () => {
    for (const input of ["=HYPERLINK(1)", "+SUM(1)", "-1+2", "@formula", "  =formula", "\t=cmd", "\rhidden"]) expect(csvCell(input).startsWith('"\'')).toBe(true);
    expect(csvCell('Alex "A"')).toBe('"Alex ""A"""');
  });
  it("previews errors and within-file/existing duplicates, with no silent overwrite", () => {
    const data = createSeedData(); data.residents = [];
    const preview = previewCsv('name,email,preferred_contact\nAlex,alex@example.test,email\nAlex,,none\nSam,,email', "people", data);
    expect(preview.rows.map((r) => r.problems.length > 0)).toEqual([false,true,true]);
    expect(() => csvImportOperations(preview, [2,3])).toThrow("nonduplicate");
    expect(csvImportOperations(preview, [2])[0].record).toMatchObject({ name: "Alex", contactPermission: "not_recorded", sharedWithTeamIds: [] });
    expect(() => previewCsv('name,faith_score\nAlex,10', "people", data)).toThrow("Extra columns");
  });
  it("keeps private notes out of ordinary exchange exports", () => {
    const data = createSeedData(); data.followUps[0].note = "Private detail not for CSV";
    expect(exportCsv(data, "tasks")).not.toContain("Private detail");
    expect(() => parseCsv('name\n' + Array.from({ length: 101 }, () => "Alex").join('\n'))).toThrow("100 records");
  });
});
