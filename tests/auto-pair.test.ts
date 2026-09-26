import { describe, expect, it } from "vitest";
import { autoPair } from "../lib/auto-pair";

describe("autoPair", () => {
  it("spreads people evenly across routes", () => {
    expect(autoPair(["north", "south"], ["a", "b", "c", "d", "e"])).toEqual({ north: ["a", "c", "e"], south: ["b", "d"] });
  });

  it("keeps saved teams together and places them first", () => {
    const crews = autoPair(["north", "south", "west"], ["a", "b", "c", "d", "e", "f"], [{ memberIds: ["e", "f", "z"] }, { memberIds: ["a", "gone"] }]);
    expect(crews.north).toEqual(["e", "f"]);
    expect(crews.south).toEqual(["a", "c"]);
    expect(crews.west).toEqual(["b", "d"]);
  });

  it("handles no routes or no one here", () => {
    expect(autoPair([], ["a"])).toEqual({});
    expect(autoPair(["north"], [])).toEqual({ north: [] });
  });
});
