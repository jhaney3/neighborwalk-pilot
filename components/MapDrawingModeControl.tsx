"use client";

import { MousePointer2, Square } from "lucide-react";
import type { MapDrawingMode } from "../lib/map-drawing";

export function MapDrawingModeControl({ value, disabled = false, onChange }: {
  value?: MapDrawingMode;
  disabled?: boolean;
  onChange: (mode: MapDrawingMode) => void;
}) {
  return <div className="map-drawing-mode-control" role="group" aria-label="Boundary shape">
    <button type="button" className={value === "rectangle" ? "active" : ""} aria-pressed={value === "rectangle"} disabled={disabled} onClick={() => onChange("rectangle")} title="Press and drag to draw a rectangle"><Square size={16} /><span>Rectangle</span></button>
    <button type="button" className={value === "polygon" ? "active" : ""} aria-pressed={value === "polygon"} disabled={disabled} onClick={() => onChange("polygon")} title="Choose each corner of a custom boundary"><MousePointer2 size={16} /><span>Polygon</span></button>
  </div>;
}
