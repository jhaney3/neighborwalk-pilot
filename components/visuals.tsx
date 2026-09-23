"use client";
import { useId } from "react";
import { coverageForTerritory } from "../lib/territory-coverage";
import { outcomeMeta, type Coordinates, type NeighborWalkData, type Territory } from "../lib/domain";

type Point = [x: number, y: number];

/** Project longitude/latitude into a square SVG box, keeping true proportions. */
function projector(points: Coordinates[], size: number, padding: number) {
  const midLatitude = points.reduce((sum, [, lat]) => sum + lat, 0) / Math.max(points.length, 1);
  const xScale = Math.cos((midLatitude * Math.PI) / 180);
  const xs = points.map(([lng]) => lng * xScale);
  const ys = points.map(([, lat]) => lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1e-6;
  const inner = size - padding * 2;
  const offsetX = padding + (inner - ((maxX - minX) / span) * inner) / 2;
  const offsetY = padding + (inner - ((maxY - minY) / span) * inner) / 2;
  return ([lng, lat]: Coordinates): Point => [
    offsetX + ((lng * xScale - minX) / span) * inner,
    offsetY + ((maxY - lat) / span) * inner,
  ];
}

/**
 * The shape of a neighborhood with each home as a dot in its visit color.
 * A tile-free "map at a glance" that works offline and in both themes.
 */
export function NeighborhoodShape({ territory, data, size = 120, tone = "paper", showHomes = true, className }: {
  territory: Pick<Territory, "id" | "boundary" | "color">;
  data?: Pick<NeighborWalkData, "properties">;
  size?: number;
  tone?: "paper" | "hero";
  showHomes?: boolean;
  className?: string;
}) {
  const clipId = useId();
  const homes = showHomes && data ? data.properties.filter((property) => property.territoryId === territory.id && !property.mergedIntoId && property.coordinates) : [];
  const boundary = territory.boundary.length >= 3 ? territory.boundary : [];
  const points = [...boundary, ...homes.map((home) => home.coordinates!)];
  if (points.length < 2) {
    return <svg className={`neighborhood-shape ${tone}${className ? ` ${className}` : ""}`} viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={size / 3} className="neighborhood-shape-fill" />
    </svg>;
  }
  const project = projector(points, size, size * 0.1);
  const path = boundary.length ? "M" + boundary.map((point) => project(point).map((value) => value.toFixed(1)).join(",")).join("L") + "Z" : "";
  const dot = Math.max(2.2, size / 42);
  return <svg className={`neighborhood-shape ${tone}${className ? ` ${className}` : ""}`} viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
    {path && <>
      <clipPath id={clipId}><path d={path} /></clipPath>
      <path d={path} className="neighborhood-shape-fill" style={{ "--shape-color": territory.color } as React.CSSProperties} />
      <g clipPath={`url(#${clipId})`} className="neighborhood-shape-streets">
        {Array.from({ length: 7 }, (_, index) => <line key={index} x1={-size} y1={(index + 1) * size / 8 - size / 3} x2={size * 2} y2={(index + 1) * size / 8 + size / 3} />)}
      </g>
      <path d={path} className="neighborhood-shape-edge" />
    </>}
    {homes.map((home) => {
      const [x, y] = project(home.coordinates!);
      const visited = home.currentOutcome !== "unvisited";
      return <circle key={home.id} cx={x} cy={y} r={dot} className={visited ? "neighborhood-home visited" : "neighborhood-home"} style={visited ? { fill: outcomeMeta[home.currentOutcome].color } : undefined} />;
    })}
  </svg>;
}

/** A calm ring for "how much of this is done", with the number in the middle. */
export function ProgressRing({ value, total, size = 64, label, tone = "paper" }: { value: number; total: number; size?: number; label?: string; tone?: "paper" | "hero" }) {
  const stroke = Math.max(4, size / 11);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = total > 0 ? Math.min(1, value / total) : 0;
  return <span className={`progress-ring ${tone}`} role="img" aria-label={label ?? `${value} of ${total}`} style={{ width: size, height: size }}>
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="progress-ring-track" />
      <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="progress-ring-value"
        strokeDasharray={`${circumference * fraction} ${circumference}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
    <span className="progress-ring-number" aria-hidden="true">{total > 0 ? Math.round(fraction * 100) : 0}<small>%</small></span>
  </span>;
}

/** Homes reached in a neighborhood, from saved homes only (works offline). */
export function neighborhoodProgress(data: Pick<NeighborWalkData, "territories" | "properties">, territoryId: string) {
  const coverage = coverageForTerritory(data, territoryId);
  return { touched: coverage.touched, total: coverage.total };
}

const AVATAR_TONES = 6;
/** Stable, warm avatar tint per person so faces are easy to find in lists. */
export function avatarTone(key: string) {
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `tone-${hash % AVATAR_TONES}`;
}

/** The neighborhood a walk covers: its routes first, then assignments, then the active one. */
export function outingTerritory(data: NeighborWalkData, outingId: string | undefined) {
  if (!outingId) return undefined;
  const territoryId = data.walkTargets.find((target) => target.eventId === outingId)?.territoryId
    ?? data.assignments?.find((assignment) => assignment.eventId === outingId && !["cancelled", "declined"].includes(assignment.status))?.territoryId;
  return data.territories.find((territory) => territory.id === territoryId);
}

/** The NeighborWalk mark: a house with its porch light on. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return <svg className="brand-glyph" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path d="M4 11.2 12 4.5l8 6.7V19a1.2 1.2 0 0 1-1.2 1.2H5.2A1.2 1.2 0 0 1 4 19z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M10 20.2v-5.1a.9.9 0 0 1 .9-.9h2.2a.9.9 0 0 1 .9.9v5.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <circle cx="16.6" cy="13.6" r="1.7" className="brand-glyph-light" />
  </svg>;
}

type House = { x: number; w: number; h: number; roof: number; lit: number[] };
const STREET: House[] = [
  { x: 14, w: 58, h: 46, roof: 24, lit: [0] },
  { x: 84, w: 46, h: 58, roof: 20, lit: [1, 2] },
  { x: 142, w: 70, h: 40, roof: 28, lit: [0, 2] },
  { x: 224, w: 50, h: 52, roof: 22, lit: [1] },
  { x: 286, w: 62, h: 44, roof: 26, lit: [0, 1] },
  { x: 358, w: 44, h: 56, roof: 18, lit: [2] },
];

/** A quiet evening street: houses with porch lights on and a dotted walking path. */
export function StreetScene({ className }: { className?: string }) {
  const ground = 132;
  return <svg className={`street-scene${className ? ` ${className}` : ""}`} viewBox="0 0 390 170" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    {[[34, 26], [98, 14], [170, 30], [248, 12], [312, 34], [364, 20], [214, 44]].map(([x, y], index) => <circle key={index} cx={x} cy={y} r={index % 3 === 0 ? 1.4 : 1} className="street-star" />)}
    <circle cx="330" cy="40" r="11" className="street-moon" />
    {STREET.map((house, index) => {
      const top = ground - house.h;
      const windows = [0, 1, 2].map((slot) => ({ x: house.x + 8 + slot * ((house.w - 24) / 2), lit: house.lit.includes(slot) }));
      return <g key={index}>
        <path d={`M${house.x} ${ground}V${top}L${house.x + house.w / 2} ${top - house.roof}L${house.x + house.w} ${top}V${ground}Z`} className="street-house" />
        {windows.map((window, slot) => <rect key={slot} x={window.x} y={top + 10} width="8" height="9" rx="1.5" className={window.lit ? "street-window lit" : "street-window"} />)}
        <rect x={house.x + house.w / 2 - 5} y={ground - 16} width="10" height="16" rx="1.5" className="street-door" />
        {house.lit.length > 1 && <circle cx={house.x + house.w / 2 + 9} cy={ground - 13} r="2.2" className="street-porch" />}
      </g>;
    })}
    <path d={`M0 ${ground}H390V170H0Z`} className="street-ground" />
    <path d="M-10 160C70 146 120 158 196 150S320 142 400 154" className="street-path" />
  </svg>;
}
