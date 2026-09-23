import { describe, expect, it } from "vitest";
import { compactToastMessage } from "../lib/toasts";

describe("compactToastMessage", () => {
  it("keeps short toast messages unchanged", () => {
    expect(compactToastMessage("Visit saved")).toBe("Visit saved");
  });

  it("keeps a clear sentence instead of cutting it to two words", () => {
    expect(compactToastMessage("That home isn’t on this route")).toBe("That home isn’t on this route");
  });

  it("shortens very long messages with an ellipsis", () => {
    const compact = compactToastMessage("This notification is much too long to fit comfortably at the top of a phone");
    expect(compact.length).toBeLessThanOrEqual(48);
    expect(compact.endsWith("…")).toBe(true);
  });

  it("normalizes surrounding and repeated whitespace", () => {
    expect(compactToastMessage("  Address   found  ")).toBe("Address found");
  });
});
