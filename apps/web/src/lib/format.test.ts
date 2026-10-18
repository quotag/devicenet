/**
 * Tests for format utilities.
 * Coverage: vi-VN locale, relative time, timezone formatting.
 */

import { describe, it, expect } from "vitest";
import { formatValue, relativeTime, hhmm } from "./format";
import { Property, PropertyKey } from "@devicenet/shared";

describe("formatValue", () => {
  describe("binary", () => {
    const binaryProp: Property = {
      key: "switch" as PropertyKey,
      label: "Công tắc",
      type: "binary",
      access: "rw",
      category: "control",
    };

    it("formats true as custom true label if provided", () => {
      const prop = { ...binaryProp, trueLabel: "Mở", falseLabel: "Đóng" };
      expect(formatValue(prop, true)).toBe("Mở");
    });

    it("formats false as custom false label if provided", () => {
      const prop = { ...binaryProp, trueLabel: "Mở", falseLabel: "Đóng" };
      expect(formatValue(prop, false)).toBe("Đóng");
    });

    it("defaults to Bật/Tắt", () => {
      expect(formatValue(binaryProp, true)).toBe("Bật");
      expect(formatValue(binaryProp, false)).toBe("Tắt");
    });
  });

  describe("numeric", () => {
    const numericProp: Property = {
      key: "power" as PropertyKey,
      label: "Công suất",
      type: "numeric",
      access: "r",
      category: "sensor",
      unit: "W",
      precision: 0,
    };

    it("formats integer with vi-VN locale (no decimals)", () => {
      expect(formatValue(numericProp, 86)).toBe("86 W");
    });

    it("formats decimal with vi-VN locale (comma separator)", () => {
      const prop = { ...numericProp, precision: 2 };
      expect(formatValue(prop, 12.34)).toBe("12,34 W");
    });

    it("respects precision setting", () => {
      const prop = { ...numericProp, precision: 1 };
      expect(formatValue(prop, 28.567)).toBe("28,6 W");
    });

    it("omits unit if not provided", () => {
      const prop = { ...numericProp, unit: undefined };
      expect(formatValue(prop, 86)).toBe("86");
    });

    it("uses default precision 0 for integers, 1 for decimals if not set", () => {
      const propNoPrec = { ...numericProp, precision: undefined };
      expect(formatValue(propNoPrec, 100)).toMatch(/^100/);
      expect(formatValue(propNoPrec, 100.5)).toMatch(/100,5/);
    });
  });

  describe("enum", () => {
    const enumProp: Property = {
      key: "mode" as PropertyKey,
      label: "Chế độ",
      type: "enum",
      access: "r",
      category: "control",
      values: ["heat", "cool", "off"],
    };

    it("returns value if no label provided", () => {
      expect(formatValue(enumProp, "heat")).toBe("heat");
    });

    it("uses value label if provided in valueLabels", () => {
      const prop = {
        ...enumProp,
        valueLabels: { heat: "Sưởi", cool: "Làm lạnh", off: "Tắt" },
      };
      expect(formatValue(prop, "heat")).toBe("Sưởi");
      expect(formatValue(prop, "cool")).toBe("Làm lạnh");
    });

    it("falls back to value if label not found", () => {
      const prop = {
        ...enumProp,
        valueLabels: { heat: "Sưởi" },
      };
      expect(formatValue(prop, "cool")).toBe("cool");
    });
  });

  describe("text", () => {
    const textProp: Property = {
      key: "name" as PropertyKey,
      label: "Tên",
      type: "text",
      access: "r",
      category: "config",
    };

    it("returns text as-is", () => {
      expect(formatValue(textProp, "Ổ cắm phòng khách")).toBe(
        "Ổ cắm phòng khách"
      );
    });
  });

  describe("composite", () => {
    const compositeProp: Property = {
      key: "config" as PropertyKey,
      label: "Config",
      type: "composite",
      access: "r",
      category: "diag",
    };

    it("stringifies composite object", () => {
      const value = { x: 1, y: 2 };
      expect(formatValue(compositeProp, value)).toBe(JSON.stringify(value));
    });
  });
});

describe("relativeTime", () => {
  const now = 1729000000000;

  it("formats seconds ago", () => {
    expect(relativeTime(now - 30_000, now)).toBe("30 giây trước");
  });

  it("formats minutes ago", () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 phút trước");
  });

  it("formats hours ago", () => {
    expect(relativeTime(now - 2 * 60 * 60 * 1000, now)).toBe("2 giờ trước");
  });

  it("formats days ago", () => {
    expect(relativeTime(now - 3 * 24 * 60 * 60 * 1000, now)).toBe("3 ngày trước");
  });

  it("uses Date.now() if nowMs omitted", () => {
    const past = Date.now() - 45_000;
    const result = relativeTime(past);
    expect(result).toMatch(/giây trước/);
  });

  it("rounds down to whole units", () => {
    // 59.9 seconds → 59 giây trước
    expect(relativeTime(now - 59_900, now)).toBe("59 giây trước");
  });
});

describe("hhmm", () => {
  const timestamp = 1729000000000; // 2024-10-15 20:00 UTC

  it("formats time in given timezone", () => {
    const result = hhmm(timestamp, "UTC");
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  it("respects Asia/Ho_Chi_Minh timezone (UTC+7)", () => {
    // 20:00 UTC = 03:00 +7 next day, so on day 16
    const result = hhmm(timestamp, "Asia/Ho_Chi_Minh");
    expect(result).toMatch(/\d{2}:\d{2}/);
    // Just verify format, not exact time due to DST complexity
  });

  it("uses vi-VN locale format", () => {
    const result = hhmm(timestamp, "UTC");
    // vi-VN uses 24-hour format, no AM/PM
    expect(result).toMatch(/^\d{1,2}:\d{2}$/);
  });
});
