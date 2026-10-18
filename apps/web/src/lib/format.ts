/**
 * Format utilities for display of values, timestamps.
 * All output in Vietnamese.
 */

import { Property, PropertyValue } from "@devicenet/shared";

/**
 * Format a device property value with unit and locale-aware decimals (vi-VN).
 * @param prop Property definition with type, unit, precision
 * @param value The property value (number, boolean, string, enum)
 * @returns Formatted string like "0,38 A", "Bật", "28,5°C"
 */
export function formatValue(prop: Property, value: PropertyValue): string {
  switch (prop.type) {
    case "binary":
      if (typeof value !== "boolean") return String(value);
      return value ? (prop.trueLabel || "Bật") : (prop.falseLabel || "Tắt");

    case "numeric": {
      if (typeof value !== "number") return String(value);
      const precision = prop.precision ?? (Number.isInteger(value) ? 0 : 1);
      // Format with vi-VN locale (comma decimal separator)
      const formatted = new Intl.NumberFormat("vi-VN", {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }).format(value);
      return prop.unit ? `${formatted} ${prop.unit}` : formatted;
    }

    case "enum":
      if (typeof value !== "string") return String(value);
      return prop.valueLabels?.[value] ?? value;

    case "text":
      return String(value);

    case "composite":
      return JSON.stringify(value);

    default:
      return String(value);
  }
}

/**
 * Format a relative time in Vietnamese: "x giây trước", "x phút trước", etc.
 * @param timestampMs Timestamp (epoch ms) of the event
 * @param nowMs Current time (epoch ms); if omitted, uses Date.now()
 * @returns String like "12 giây trước", "5 phút trước", "2 giờ trước"
 */
export function relativeTime(timestampMs: number, nowMs: number = Date.now()): string {
  const diffMs = nowMs - timestampMs;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec} giây trước`;
  if (diffMin < 60) return `${diffMin} phút trước`;
  if (diffHour < 24) return `${diffHour} giờ trước`;
  return `${diffDay} ngày trước`;
}

/**
 * Format a timestamp as HH:mm in the given timezone.
 * @param timestampMs Timestamp (epoch ms)
 * @param timezoneName IANA timezone (e.g. "Asia/Ho_Chi_Minh")
 * @returns String like "14:30"
 */
export function hhmm(timestampMs: number, timezoneName: string): string {
  const date = new Date(timestampMs);
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezoneName,
  }).format(date);
}
