import type { Coordinates } from "./domain";
import { polygonSelfIntersects } from "./planning-geometry";

export type MapDrawingMode = "rectangle" | "polygon";
export type DrawingGestureIntent =
  | { kind: "move-corner"; index: number }
  | { kind: "create-rectangle"; start: Coordinates }
  | { kind: "none" };

export function rectangleBoundary(first: Coordinates, opposite: Coordinates): Coordinates[] {
  return [
    first,
    [opposite[0], first[1]],
    opposite,
    [first[0], opposite[1]],
  ];
}

export function rectangleHasArea(points: Coordinates[]) {
  return points.length === 4
    && new Set(points.map(([longitude, latitude]) => `${longitude}:${latitude}`)).size === 4
    && points[0][0] !== points[2][0]
    && points[0][1] !== points[2][1];
}

export function drawingGestureIntent(points: Coordinates[], mode: MapDrawingMode, vertexIndex: number | undefined, at: Coordinates): DrawingGestureIntent {
  if (vertexIndex !== undefined) return { kind: "move-corner", index: vertexIndex };
  if (mode === "rectangle" && !rectangleHasArea(points)) return { kind: "create-rectangle", start: at };
  return { kind: "none" };
}

export function moveDrawingCorner(points: Coordinates[], mode: MapDrawingMode, index: number, next: Coordinates): Coordinates[] {
  if (mode === "rectangle" && points.length === 4 && index >= 0 && index < 4) {
    const opposite = points[(index + 2) % 4];
    const [longitude, latitude] = next;
    const [oppositeLongitude, oppositeLatitude] = opposite;
    if (index === 0) return [next, [oppositeLongitude, latitude], opposite, [longitude, oppositeLatitude]];
    if (index === 1) return [[oppositeLongitude, latitude], next, [longitude, oppositeLatitude], opposite];
    if (index === 2) return [opposite, [longitude, oppositeLatitude], next, [oppositeLongitude, latitude]];
    return [[longitude, oppositeLatitude], opposite, [oppositeLongitude, latitude], next];
  }
  return points.map((point, at) => at === index ? next : point);
}

export function undoDrawingPoint(points: Coordinates[], mode: MapDrawingMode) {
  if (!points.length) return [];
  if (mode === "rectangle") return [];
  return points.slice(0, -1);
}

export function drawingBoundaryReady(points: Coordinates[], mode: MapDrawingMode) {
  if (mode === "rectangle") return rectangleHasArea(points);
  if (points.length < 3) return false;
  return new Set(points.map(([longitude, latitude]) => `${longitude}:${latitude}`)).size >= 3
    && !polygonSelfIntersects(points);
}

export function drawingInstruction(mode: MapDrawingMode, points: Coordinates[]) {
  if (mode === "rectangle") {
    if (rectangleHasArea(points)) return "Rectangle ready. Drag a corner to adjust it, or finish.";
    return "Press and drag diagonally across the area to draw a rectangle.";
  }
  if (!points.length) return "Tap the first corner, then continue around the boundary.";
  if (points.length < 3) return `Add ${3 - points.length} more ${points.length === 2 ? "corner" : "corners"}.`;
  if (polygonSelfIntersects(points)) return "Boundary lines cross. Undo the last corner or drag a corner to fix it.";
  return `${points.length} corners added. Drag any corner to adjust it, or finish.`;
}
