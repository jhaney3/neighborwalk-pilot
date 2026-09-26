import { describe, expect, it } from "vitest";
import { rsvpCounts, walkPhase } from "../lib/walk-phase";

const participant = (id: string, status: "invited" | "going" | "not_going" | "checked_in", eventId = "walk") => ({ id, churchId: "c", eventId, volunteerId: id, status });

describe("walkPhase", () => {
  it("follows the walk's status and check-in", () => {
    expect(walkPhase({ id: "walk", status: "draft" }, [])).toBe("plan");
    expect(walkPhase({ id: "walk", status: "scheduled" }, [])).toBe("plan");
    expect(walkPhase({ id: "walk", status: "ready" }, [participant("a", "going")])).toBe("invite");
    expect(walkPhase({ id: "walk", status: "ready" }, [participant("a", "checked_in")])).toBe("checkin");
    expect(walkPhase({ id: "walk", status: "ready" }, [participant("a", "checked_in", "other")])).toBe("invite");
    expect(walkPhase({ id: "walk", status: "active" }, [])).toBe("walk");
    expect(walkPhase({ id: "walk", status: "completed" }, [])).toBe("wrap");
    expect(walkPhase({ id: "walk", status: "archived" }, [])).toBe("wrap");
    expect(walkPhase({ id: "walk", status: "cancelled" }, [])).toBeNull();
  });
});

describe("rsvpCounts", () => {
  it("counts people who are here as going", () => {
    expect(rsvpCounts([participant("a", "going"), participant("b", "checked_in"), participant("c", "invited"), participant("d", "not_going"), participant("e", "going", "other")], "walk"))
      .toEqual({ invited: 4, going: 2, here: 1, notGoing: 1, noReply: 1 });
  });
});
