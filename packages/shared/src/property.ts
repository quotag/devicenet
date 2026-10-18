/**
 * DeviceNet — Property schema (driver-independent)
 *
 * A Device exposes N Properties. The hub-agent driver (zigbee2mqtt) builds these
 * from Z2M `definition.exposes`. The app NEVER sees Zigbee concepts; it renders
 * controls purely from this schema.
 *
 * CANONICAL VALUES ON THE WIRE (decision D-01, see data-model.md):
 *   binary   -> boolean (true/false). Driver maps to/from ON/OFF, 1/0, etc.
 *   numeric  -> number (JS number). `unit`, `precision` tell the app how to format.
 *   enum     -> string, must be one of `values`.
 *   text     -> string
 *   composite-> object (opaque to v1 UI; shown as JSON in "Kỹ thuật")
 */
import { z } from "zod";
import { PropertyKey } from "./ids";

export const PropertyType = z.enum(["binary", "numeric", "enum", "text", "composite"]);
export type PropertyType = z.infer<typeof PropertyType>;

export const PropertyAccess = z.enum(["r", "w", "rw"]);
export type PropertyAccess = z.infer<typeof PropertyAccess>;

/**
 * control -> shown as a control on the tile / "Điều khiển" group (needs access w or rw)
 * sensor  -> shown as a number on the tile / "Cảm biến" group
 * config  -> only in device detail "Cấu hình" group
 * diag    -> only in "Kỹ thuật" (linkquality, battery_low, etc.) — never on tile
 */
export const PropertyCategory = z.enum(["control", "sensor", "config", "diag"]);
export type PropertyCategory = z.infer<typeof PropertyCategory>;

const Base = z.object({
  key: PropertyKey,
  /** User-editable display label (default: humanised key, e.g. "Công suất") */
  label: z.string().min(1).max(60),
  access: PropertyAccess,
  category: PropertyCategory,
  /** Driver-specific hint, opaque to the app (e.g. z2m expose name, endpoint) */
  driverMeta: z.record(z.string(), z.unknown()).optional(),
});

export const BinaryProperty = Base.extend({
  type: z.literal("binary"),
  /** Labels for true/false shown in UI. Default: "Bật"/"Tắt" */
  trueLabel: z.string().max(30).optional(),
  falseLabel: z.string().max(30).optional(),
});

export const NumericProperty = Base.extend({
  type: z.literal("numeric"),
  unit: z.string().max(12).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  /** Decimal places to display. Default 0 for integers, 1 otherwise. App formats with locale (vi-VN: 0,38). */
  precision: z.number().int().min(0).max(4).optional(),
});

export const EnumProperty = Base.extend({
  type: z.literal("enum"),
  values: z.array(z.string().min(1)).min(1).max(64),
  /** Optional UI labels per value: { previous: "Nhớ" } */
  valueLabels: z.record(z.string(), z.string()).optional(),
});

export const TextProperty = Base.extend({
  type: z.literal("text"),
  maxLength: z.number().int().positive().optional(),
});

export const CompositeProperty = Base.extend({
  type: z.literal("composite"),
});

export const Property = z.discriminatedUnion("type", [
  BinaryProperty,
  NumericProperty,
  EnumProperty,
  TextProperty,
  CompositeProperty,
]);
export type Property = z.infer<typeof Property>;

/** Map keyed by property key — the shape stored in Firestore `devices.properties` */
export const PropertyMap = z.record(PropertyKey, Property);
export type PropertyMap = z.infer<typeof PropertyMap>;

/** A runtime value for any property type */
export const PropertyValue = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.record(z.string(), z.unknown()),
]);
export type PropertyValue = z.infer<typeof PropertyValue>;

/**
 * Validate a value against a property definition (used by hub before sending to driver,
 * by app before publishing `set`, and by rule validation for setProperty/property trigger).
 */
export function validateValue(prop: Property, value: unknown): { ok: true; value: PropertyValue } | { ok: false; error: string } {
  switch (prop.type) {
    case "binary":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: "binary expects boolean" };
    case "numeric": {
      if (typeof value !== "number" || Number.isNaN(value)) return { ok: false, error: "numeric expects number" };
      if (prop.min !== undefined && value < prop.min) return { ok: false, error: `below min ${prop.min}` };
      if (prop.max !== undefined && value > prop.max) return { ok: false, error: `above max ${prop.max}` };
      return { ok: true, value };
    }
    case "enum":
      return typeof value === "string" && prop.values.includes(value)
        ? { ok: true, value }
        : { ok: false, error: `enum expects one of ${prop.values.join(",")}` };
    case "text":
      return typeof value === "string" ? { ok: true, value } : { ok: false, error: "text expects string" };
    case "composite":
      return typeof value === "object" && value !== null ? { ok: true, value: value as Record<string, unknown> } : { ok: false, error: "composite expects object" };
    default:
      return { ok: false, error: "unknown property type" };
  }
}

/** True when the property may be written (setProperty / tile toggle) */
export const isWritable = (p: Property) => p.access === "w" || p.access === "rw";

/**
 * Z2M access bitmask → PropertyAccess. (Z2M: 1 = published, 2 = settable, 4 = gettable)
 * Property with bit 2 → "rw" if also published (bit 1) else "w"; otherwise "r".
 */
export function accessFromZ2M(mask: number): PropertyAccess {
  const published = (mask & 1) !== 0;
  const settable = (mask & 2) !== 0;
  if (settable && published) return "rw";
  if (settable) return "w";
  return "r";
}
