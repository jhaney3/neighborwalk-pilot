import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NeighborWalkDatabase } from "../lib/supabase";
import { GuideLibraryReadError, guideLibraryErrorMessage, loadConnectedGuideLibrary } from "../lib/conversation-guides";
import { IncompleteCollectionError } from "../lib/complete-pages";

const church = "00000000-0000-4000-8000-000000000001";
const user = "00000000-0000-4000-8000-000000000011";
const guideId = (i: number) => "00000000-0000-4000-8001-" + String(i).padStart(12, "0");
function row(i: number) {
  return { id: guideId(i), church_id: church, scope: "church", owner_user_id: null, title: "Fictional guide " + i,
    description: "Fictional complete-read fixture", sort_order: i % 10,
    steps: [{ id: "step", order: 1, eyebrow: "Listen", title: "Ask permission", coaching: "Respect their choice", sampleWords: "May I listen?", reminder: "No pressure", scriptureReferences: [] }],
    created_by: user, updated_by: user, created_at: "2026-09-10T10:00:00+00:00", updated_at: "2026-09-10T10:00:00+00:00" };
}
type Row = Record<string, unknown>;
function clientFor(guides: Row[], defaults: Row[] = [], favorite?: string) {
  const calls: { table: string; cursor?: string }[] = [];
  const tables: Record<string, Row[]> = {
    conversation_guides: guides,
    conversation_guide_team_defaults: defaults,
    conversation_guide_preferences: favorite ? [{ favorite_guide_id: favorite }] : [],
  };
  const client = { from(table: string) {
    let cursor: string | undefined; let order = "id"; let limit = 1_000;
    const builder = {
      select() { return builder; },
      eq(column: string, value: string) { expect(value).toBe(column === "user_id" ? user : church); return builder; },
      order(column: string) { order = column; return builder; },
      limit(value: number) { limit = value; return builder; },
      gt(column: string, value: string) { expect(column).toBe(order); cursor = value; return builder; },
      maybeSingle() { return Promise.resolve({ data: tables[table][0] ?? null, error: null }); },
      then(resolve: (result: { data: Row[]; error: null }) => unknown) {
        calls.push({ table, cursor });
        const data = tables[table].filter((item) => !cursor || String(item[order]) > cursor)
          .toSorted((a, b) => String(a[order]).localeCompare(String(b[order])))
          // Simulate a server cap lower than both the request and default cap.
          .slice(0, Math.min(limit, 73));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return builder;
  } } as unknown as SupabaseClient<NeighborWalkDatabase>;
  return { client, calls };
}

describe("connected guide library reads", () => {
  it("shows controlled recovery messages without exposing raw service diagnostics", () => {
    expect(guideLibraryErrorMessage(new GuideLibraryReadError("Fictional safe content warning"))).toBe("Fictional safe content warning");
    expect(guideLibraryErrorMessage(new IncompleteCollectionError("Fictional safe size warning"))).toBe("Fictional safe size warning");
    expect(guideLibraryErrorMessage(new Error("Fictional sensitive service detail"))).not.toContain("sensitive");
  });
  it("reads every guide and group default beyond 1,000 rows, with no N-by-M reference scan", async () => {
    const guides = Array.from({ length: 1_007 }, (_, i) => row(i));
    const defaults = guides.map((g, i) => ({ team_id: "group_" + String(i).padStart(5, "0"), guide_id: g.id }));
    const { client, calls } = clientFor(guides, defaults, guideId(1_006));
    const library = await loadConnectedGuideLibrary(client, church, user);
    expect(library.guides).toHaveLength(1_007);
    expect(Object.keys(library.teamGuideDefaults)).toHaveLength(1_007);
    expect(library.favoriteGuideId).toBe(guideId(1_006));
    expect(library.teamGuideDefaults.group_01006).toBe(guideId(1_006));
    expect(calls.filter((c) => c.table === "conversation_guides").at(-1)?.cursor).toBe(guideId(1_006));
    expect(calls.filter((c) => c.table === "conversation_guide_team_defaults").at(-1)?.cursor).toBe("group_01006");
    expect(library.guides[0].createdAt).toBe("2026-09-10T10:00:00.000Z");
    expect(library.guides[0].sortOrder).toBe(0);
    expect(library.guides.at(-1)?.sortOrder).toBe(9);
  });
  it("rejects malformed content instead of silently dropping a guide", async () => {
    const { client } = clientFor([row(0), { ...row(1), steps: [{ title: "Incomplete legacy step" }] }]);
    await expect(loadConnectedGuideLibrary(client, church, user)).rejects.toThrow(/safely read/);
  });
  it("rejects a wrong tenant or another person's private guide", async () => {
    for (const guide of [{ ...row(0), church_id: "other" }, { ...row(0), scope: "personal", owner_user_id: "other" }]) {
      await expect(loadConnectedGuideLibrary(clientFor([guide]).client, church, user)).rejects.toThrow(/safely read/);
    }
  });
  it("does not silently omit an unavailable favorite or invalid group choice", async () => {
    await expect(loadConnectedGuideLibrary(clientFor([row(0)], [], guideId(1)).client, church, user)).rejects.toThrow(/unavailable reference/);
    await expect(loadConnectedGuideLibrary(clientFor([row(0)], [{ team_id: "group", guide_id: guideId(1) }]).client, church, user)).rejects.toThrow(/unavailable reference/);
    const personal = { ...row(0), scope: "personal", owner_user_id: user };
    await expect(loadConnectedGuideLibrary(clientFor([personal], [{ team_id: "group", guide_id: personal.id }]).client, church, user)).rejects.toThrow(/unavailable reference/);
  });
});
