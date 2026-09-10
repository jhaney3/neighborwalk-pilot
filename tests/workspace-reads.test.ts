import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NeighborWalkDatabase } from "../lib/supabase";
import { createSeedData } from "../lib/seed";
import { CollectionReadBudget } from "../lib/complete-pages";
import { loadOutreachWorkspace, matchesWorkspaceIdentity, OutreachApiError, readOutreachPages } from "../lib/outreach-client";

const church = "00000000-0000-4000-8000-000000000001";
const user = "00000000-0000-4000-8000-000000000011";
const other = "00000000-0000-4000-8000-000000000012";
const info = () => ({ apiVersion: 1, church: { ...createSeedData().church, id: church }, userId: user,
  role: "leader", revision: 10, settingsVersion: 1, volunteers: [] });
const row = (i: number) => ({ id: "fictional_" + String(i).padStart(6, "0"), version: 1,
  record: { id: "fictional_" + String(i).padStart(6, "0"), church_id: church, address: `Fictional ${i}`, source: "manual",
    created_at: "2026-09-10T12:00:00.000Z", updated_at: "2026-09-10T12:00:00.000Z", created_by: user } });
function clientFor(rpc: (...args: never[]) => unknown) { return { rpc } as unknown as SupabaseClient<NeighborWalkDatabase>; }

describe("complete account-bound workspace reads", () => {
  it("reads 25,000 records under a 137-row server cap through an empty terminal page", async () => {
    const rows = Array.from({ length: 25_000 }, (_, i) => row(i));
    const cursors: string[] = [];
    const client = clientFor(vi.fn(async (name, args) => {
      expect(name).toBe("outreach_read_records"); expect(args.target_church).toBe(church); expect(args.page_size).toBe(500);
      cursors.push(args.after_id);
      const start = args.after_id ? Number(args.after_id.slice(-6)) + 1 : 0;
      return { data: rows.slice(start, start + 137), error: null };
    }));
    expect(await readOutreachPages(client, church, "property")).toEqual(rows);
    expect(cursors.at(-1)).toBe(rows.at(-1)?.id); expect(cursors).toHaveLength(184);
  });
  it("rejects null, overlapping, malformed, unsafe-version and foreign-church rows", async () => {
    for (const data of [null, [row(1), row(1)], [null], [{ ...row(1), version: 0 }], [{ ...row(1), version: Number.MAX_SAFE_INTEGER + 1 }],
      [{ ...row(1), record: { ...row(1).record, church_id: other } }]]) {
      await expect(readOutreachPages(clientFor(vi.fn(async () => ({ data, error: null }))), church, "property")).rejects.toThrow();
    }
  });
  it("does not turn a permission error after a valid page into a partial success or generic retry", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [row(1)], error: null })
      .mockResolvedValue({ data: null, error: { message: "Active church membership is required.", code: "42501" } });
    const promise = readOutreachPages(clientFor(rpc), church, "property");
    await expect(promise).rejects.toBeInstanceOf(OutreachApiError);
    await expect(promise).rejects.toMatchObject({ code: "42501", needsReview: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("bounds the aggregate of concurrent collections, not just each collection separately", async () => {
    const budget = new CollectionReadBudget({ records: 1, bytes: 100_000 });
    const client = clientFor(vi.fn(async (_name, args) => ({ data: args.after_id ? [] : [row(1)], error: null })));
    await expect(Promise.all([readOutreachPages(client, church, "property", budget), readOutreachPages(client, church, "visit", budget)])).rejects.toThrow(/limit/);
    // One terminal read was already in flight before the competing collection
    // exhausted the shared budget. No new collection may start afterward.
    const sent = vi.mocked(client.rpc).mock.calls.length;
    await expect(readOutreachPages(client, church, "resident", budget)).rejects.toThrow(/limit/);
    expect(client.rpc).toHaveBeenCalledTimes(sent); expect(sent).toBeLessThanOrEqual(3);
    const bytes = new CollectionReadBudget({ records: 100, bytes: 1 });
    await expect(readOutreachPages(client, church, "property", bytes)).rejects.toThrow(/limit/);
  });
  it("maps complete pages while limiting concurrent requests to four", async () => {
    let active = 0; let maximum = 0; const terminal = new Set<string>();
    const client = clientFor(vi.fn(async (name, args) => {
      if (name === "outreach_workspace_info") return { data: info(), error: null };
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1)); active--;
      const data = args.entity_kind === "property" && !args.after_id ? [row(1)] : [];
      if (!data.length) terminal.add(args.entity_kind);
      return { data, error: null };
    }));
    const result = await loadOutreachWorkspace(client, church, user);
    expect(result.data.properties).toHaveLength(1); expect(result.data.properties[0].address).toBe("Fictional 1");
    expect(result.data.church.id).toBe(church); expect(result.info.userId).toBe(user);
    expect(maximum).toBe(4); expect(terminal.size).toBe(14);
  });
  it("restarts a changed revision and refuses continuously changing metadata", async () => {
    let calls = 0;
    const changed = clientFor(vi.fn(async (name) => ({ data: name === "outreach_workspace_info"
      ? { ...info(), revision: [10, 11, 11, 11][calls++] } : [], error: null })));
    expect((await loadOutreachWorkspace(changed, church, user)).info.revision).toBe(11); expect(calls).toBe(4);
    calls = 0;
    const unstable = clientFor(vi.fn(async (name) => ({ data: name === "outreach_workspace_info"
      ? { ...info(), settingsVersion: ++calls } : [], error: null })));
    await expect(loadOutreachWorkspace(unstable, church, user)).rejects.toThrow(/mixed-version/); expect(calls).toBe(6);
  });
  it("rejects a different account or church before reading and after reading without publishing", async () => {
    expect(matchesWorkspaceIdentity(info(), church, user)).toBe(true);
    expect(matchesWorkspaceIdentity(null, church, user)).toBe(false);
    expect(matchesWorkspaceIdentity({ userId: user, church: { id: church } }, church, user)).toBe(false);
    for (const wrong of [{ ...info(), userId: other }, { ...info(), church: { ...info().church, id: other } }]) {
      expect(matchesWorkspaceIdentity(wrong, church, user)).toBe(false);
      const first = clientFor(vi.fn(async () => ({ data: wrong, error: null })));
      await expect(loadOutreachWorkspace(first, church, user)).rejects.toMatchObject({ code: "42501" });
      expect(first.rpc).toHaveBeenCalledTimes(1);
      let calls = 0;
      const last = clientFor(vi.fn(async (name) => ({ data: name === "outreach_workspace_info" ? calls++ ? wrong : info() : [], error: null })));
      await expect(loadOutreachWorkspace(last, church, user)).rejects.toMatchObject({ code: "42501" });
      expect(calls).toBe(2);
    }
  });
  it("stops the other collection readers after a failed download", async () => {
    const rpc = vi.fn(async (name, args) => {
      if (name === "outreach_workspace_info") return { data: info(), error: null };
      if (args.entity_kind === "event") return { data: null, error: { code: "42501", message: "Fictional revoked session" } };
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { data: [row(1)], error: null };
    });
    await expect(loadOutreachWorkspace(clientFor(rpc), church, user)).rejects.toMatchObject({ code: "42501" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rpc).toHaveBeenCalledTimes(5);
  });
});
