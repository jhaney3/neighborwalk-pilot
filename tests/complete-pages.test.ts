import { describe, expect, it } from "vitest";
import { readCompletePages } from "../lib/complete-pages";

describe("complete bounded keyset reads", () => {
  it("continues through short server-clamped pages and requires an empty terminal page", async () => {
    const rows = Array.from({ length: 1_007 }, (_, i) => ({ id: String(i).padStart(5, "0") }));
    const cursors: (string | undefined)[] = [];
    const result = await readCompletePages(async (after) => {
      cursors.push(after);
      return { data: rows.filter((r) => !after || r.id > after).slice(0, 37), error: null };
    }, (r) => r.id);
    expect(result).toEqual(rows);
    expect(cursors.at(-1)).toBe(rows.at(-1)?.id);
    expect(cursors.length).toBeGreaterThan(27);
  });
  it("does not accept a repeated cursor or overlapping page", async () => {
    await expect(readCompletePages(async () => ({ data: [{ id: "same" }], error: null }), (r) => r.id)).rejects.toThrow(/cursor/);
    await expect(readCompletePages(async () => ({ data: [{ id: "a" }, { id: "a" }], error: null }), (r) => r.id)).rejects.toThrow(/cursor/);
  });
  it("rejects errors or null data after a successfully read page", async () => {
    await expect(readCompletePages(async (after) => after
      ? { data: null, error: { message: "Fictional unavailable page" } }
      : { data: [{ id: "first" }], error: null }, (r) => r.id)).rejects.toThrow("Fictional unavailable page");
    await expect(readCompletePages(async () => ({ data: null, error: null }), (r: { id: string }) => r.id)).rejects.toThrow(/completely/);
  });
  it("bounds device memory and record count without returning a truncated success", async () => {
    const page = async () => ({ data: [{ id: "a", content: "x".repeat(100) }], error: null });
    await expect(readCompletePages(page, (r) => r.id, { records: 10, bytes: 20 })).rejects.toThrow(/limit/);
    await expect(readCompletePages(page, (r) => r.id, { records: 0, bytes: 1000 })).rejects.toThrow(/limit/);
  });
});
