import { describe, expect, it } from "vitest";
import { drawingBoundaryReady, drawingGestureIntent, moveDrawingCorner, rectangleBoundary, undoDrawingPoint } from "../lib/map-drawing";

describe("shared map drawing", () => {
  it("creates a rectangle from two opposite corners", () => {
    expect(rectangleBoundary([1, 2], [4, 6])).toEqual([[1, 2], [4, 2], [4, 6], [1, 6]]);
    expect(drawingBoundaryReady(rectangleBoundary([1, 2], [4, 6]), "rectangle")).toBe(true);
  });

  it.each([
    [0, [0, 1], [[0, 1], [4, 1], [4, 6], [0, 6]]],
    [1, [5, 1], [[1, 1], [5, 1], [5, 6], [1, 6]]],
    [2, [5, 7], [[1, 2], [5, 2], [5, 7], [1, 7]]],
    [3, [0, 7], [[0, 2], [4, 2], [4, 7], [0, 7]]],
  ] as const)("keeps corner %i at the same index while resizing", (index, next, expected) => {
    expect(moveDrawingCorner(rectangleBoundary([1, 2], [4, 6]), "rectangle", index, [...next])).toEqual(expected);
  });

  it("continues moving the same corner across repeated drag events", () => {
    const firstMove = moveDrawingCorner(rectangleBoundary([1, 2], [4, 6]), "rectangle", 1, [5, 1]);
    expect(moveDrawingCorner(firstMove, "rectangle", 1, [6, 0])).toEqual([[1, 0], [6, 0], [6, 6], [1, 6]]);
  });

  it("never starts a new rectangle while a completed rectangle exists", () => {
    const rectangle = rectangleBoundary([1, 2], [4, 6]);
    expect(drawingGestureIntent(rectangle, "rectangle", undefined, [8, 9])).toEqual({ kind: "none" });
    expect(drawingGestureIntent(rectangle, "rectangle", 2, [4, 6])).toEqual({ kind: "move-corner", index: 2 });
  });

  it("clears a completed rectangle and only removes the last polygon corner", () => {
    expect(undoDrawingPoint(rectangleBoundary([1, 2], [4, 6]), "rectangle")).toEqual([]);
    expect(undoDrawingPoint([[1, 2], [3, 4], [5, 6]], "polygon")).toEqual([[1, 2], [3, 4]]);
  });

  it("does not mark a crossing polygon ready", () => {
    expect(drawingBoundaryReady([[0, 0], [2, 2], [0, 2], [2, 0]], "polygon")).toBe(false);
  });
});
