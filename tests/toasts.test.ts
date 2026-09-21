import { describe, expect, it } from "vitest";
import { compactToastMessage } from "../lib/toasts";

describe("compactToastMessage", () => {
  it("keeps short toast messages unchanged", () => {
    expect(compactToastMessage("Visit saved")).toBe("Visit saved");
  });

  it("limits toast messages to two words", () => {
    expect(compactToastMessage("This notification is much too long")).toBe("This notification");
  });

  it("normalizes surrounding and repeated whitespace", () => {
    expect(compactToastMessage("  Address   found  ")).toBe("Address found");
  });
});
