import { z } from "zod";

const coordinateSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const lineSchema = z.array(coordinateSchema).min(2).max(2_000);
const ringSchema = z.array(coordinateSchema).min(4).max(2_000);

export const walkTargetGeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: z.array(ringSchema).min(1).max(32) }).strict(),
  z.object({ type: z.literal("MultiLineString"), coordinates: z.array(lineSchema).min(1).max(100) }).strict(),
]);

export const streetSelectionSchema = z.object({
  side: z.enum(["both", "left", "right"]).default("both"),
  corridorMeters: z.number().int().min(5).max(100),
  source: z.string().trim().min(1).max(120),
  sourceRevision: z.string().trim().min(1).max(190),
  segmentIds: z.array(z.string().trim().min(1).max(240)).min(1).max(250),
  streetNames: z.array(z.string().trim().min(1).max(240)).max(100).default([]),
}).strict();

export const walkTargetParcelSchema = z.object({
  countyFips: z.string().regex(/^47(055|099|101|181)$/),
  gislink: z.string().trim().min(1).max(120),
  datasetRevision: z.string().trim().min(1).max(190),
  inclusionSource: z.enum(["polygon_auto", "street_auto", "manual_add"]),
  geometry: z.record(z.string(), z.unknown()).optional(),
  representativePoint: coordinateSchema.optional(),
}).strict();

export const walkTargetSchema = z.object({
  id: z.string().min(1).max(190),
  churchId: z.string().min(1),
  eventId: z.string().min(1),
  territoryId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  selectionKind: z.enum(["polygon", "rectangle", "streets", "whole_zone"]),
  geometry: walkTargetGeometrySchema,
  streetSelection: streetSelectionSchema.optional(),
  parcels: z.array(walkTargetParcelSchema).max(10_000),
  rosterState: z.enum(["draft", "frozen"]),
  frozenAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
}).superRefine((target, context) => {
  if ((target.selectionKind === "streets") !== Boolean(target.streetSelection)) context.addIssue({ code: "custom", path: ["streetSelection"], message: "Street targets require street selection details." });
  if (target.selectionKind === "streets" && target.geometry.type !== "MultiLineString") context.addIssue({ code: "custom", path: ["geometry"], message: "Street targets require line geometry." });
  if (target.selectionKind !== "streets" && target.geometry.type !== "Polygon") context.addIssue({ code: "custom", path: ["geometry"], message: "Area targets require polygon geometry." });
  if (target.rosterState === "frozen" && !target.frozenAt) context.addIssue({ code: "custom", path: ["frozenAt"], message: "A frozen roster needs its freeze time." });
});

export type WalkTargetGeometry = z.infer<typeof walkTargetGeometrySchema>;
export type StreetSelection = z.infer<typeof streetSelectionSchema>;
export type WalkTargetParcel = z.infer<typeof walkTargetParcelSchema>;
export type WalkTarget = z.infer<typeof walkTargetSchema>;
export type WalkTargetInput = Omit<WalkTarget, "id" | "churchId" | "rosterState" | "frozenAt" | "finishedAt">;

export type SaveTarget = (input: WalkTargetInput, id?: string) => Promise<string>;

export function parcelKey(parcel: Pick<WalkTargetParcel, "countyFips" | "gislink">) {
  return `${parcel.countyFips}:${parcel.gislink}`;
}
