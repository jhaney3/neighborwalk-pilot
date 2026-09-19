import { describe, expect, it } from "vitest";
import { nextTabIndex } from "../lib/tab-navigation";
describe("keyboard tab navigation", () => {
  it("wraps horizontally and leaves vertical scrolling keys alone", () => {
    expect(nextTabIndex("ArrowRight", 2, 3, "horizontal")).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 3, "horizontal")).toBe(2);
    expect(nextTabIndex("ArrowDown", 0, 3, "horizontal")).toBeUndefined();
    expect(nextTabIndex("ArrowUp", 0, 3, "horizontal")).toBeUndefined();
  });
  it("supports vertical arrows, home/end, and does not capture ordinary keys", () => {
    expect(nextTabIndex("ArrowDown", 2, 3, "vertical")).toBe(0);
    expect(nextTabIndex("ArrowUp", 0, 3, "vertical")).toBe(2);
    expect(nextTabIndex("Home", 2, 3, "vertical")).toBe(0);
    expect(nextTabIndex("End", 0, 3, "vertical")).toBe(2);
    expect(nextTabIndex("Tab", 0, 3, "vertical")).toBeUndefined();
    expect(nextTabIndex("ArrowDown", -1, 3, "vertical")).toBeUndefined();
    expect(nextTabIndex("Home", 0, 0, "vertical")).toBeUndefined();
  });
});
