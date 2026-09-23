import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REWORK_MIGRATION_FLOOR, selectAdditiveMigrations } from "../scripts/lib/migration-selection.mjs";

describe("production migration rehearsal selection", () => {
  it("selects every additive migration from the normalized cutover through the iOS release additions", () => {
    const selected = selectAdditiveMigrations(readdirSync(new URL("../supabase/migrations/", import.meta.url)));
    expect(selected[0].slice(0, 14) >= REWORK_MIGRATION_FLOOR).toBe(true);
    expect(selected).toEqual(expect.arrayContaining([
      "20260910032223_normalize_outreach_domain.sql",
      "20260912225711_add_walk_targets.sql",
      "20260915024430_add_outing_participants.sql",
      "20260919191901_mobile_account_deletion_requests.sql",
      "20260919214330_flexible_church_invitations.sql",
      "20260922024213_add_apns_push_delivery.sql",
    ]));
  });

  it("rejects pre-cutover and malformed files and returns timestamp order", () => {
    expect(selectAdditiveMigrations([
      "notes.txt",
      "20260919214330_flexible_church_invitations.sql",
      "20260830023113_integrate_person_followups.sql",
      "20260910032223_normalize_outreach_domain.sql",
      "20260919_missing_seconds.sql",
    ])).toEqual([
      "20260910032223_normalize_outreach_domain.sql",
      "20260919214330_flexible_church_invitations.sql",
    ]);
  });
});
