import { describe, expect, it } from "vitest";
import * as S from "../src";
import { plugProperties } from "./fixtures";

const base = { key: "x", label: "X", access: "r", category: "sensor" };
const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => s.safeParse(v).success;

describe("Property schemas", () => {
  it("enums", () => {
    expect(ok(S.PropertyType, "binary")).toBe(true);
    expect(ok(S.PropertyType, "bool")).toBe(false);
    expect(ok(S.PropertyAccess, "rw")).toBe(true);
    expect(ok(S.PropertyAccess, "x")).toBe(false);
    expect(ok(S.PropertyCategory, "diag")).toBe(true);
    expect(ok(S.PropertyCategory, "other")).toBe(false);
  });
  it("BinaryProperty", () => {
    expect(ok(S.BinaryProperty, { ...plugProperties.state, trueLabel: "Bật" })).toBe(true);
    expect(ok(S.BinaryProperty, { ...plugProperties.state, type: "numeric" })).toBe(false);
  });
  it("NumericProperty", () => {
    expect(ok(S.NumericProperty, plugProperties.power)).toBe(true);
    expect(ok(S.NumericProperty, { ...plugProperties.power, precision: 9 })).toBe(false);
    expect(ok(S.NumericProperty, { ...plugProperties.power, step: 0 })).toBe(false);
  });
  it("EnumProperty", () => {
    expect(ok(S.EnumProperty, { ...base, type: "enum", values: ["on", "off", "previous"], valueLabels: { previous: "Nhớ" } })).toBe(true);
    expect(ok(S.EnumProperty, { ...base, type: "enum", values: [] })).toBe(false);
  });
  it("TextProperty", () => {
    expect(ok(S.TextProperty, { ...base, type: "text", maxLength: 10 })).toBe(true);
    expect(ok(S.TextProperty, { ...base, type: "text", maxLength: 0 })).toBe(false);
  });
  it("CompositeProperty", () => {
    expect(ok(S.CompositeProperty, { ...base, type: "composite" })).toBe(true);
    expect(ok(S.CompositeProperty, { ...base, type: "composite", label: "" })).toBe(false);
  });
  it("Property union", () => {
    for (const p of Object.values(plugProperties)) expect(ok(S.Property, p)).toBe(true);
    expect(ok(S.Property, { ...base, type: "weird" })).toBe(false);
  });
  it("PropertyMap", () => {
    expect(ok(S.PropertyMap, plugProperties)).toBe(true);
    expect(ok(S.PropertyMap, { Bad: plugProperties.state })).toBe(false);
  });
  it("PropertyValue", () => {
    for (const v of [true, 1.5, "a", { a: 1 }]) expect(ok(S.PropertyValue, v)).toBe(true);
    expect(ok(S.PropertyValue, null)).toBe(false);
    expect(ok(S.PropertyValue, [1])).toBe(false);
  });
});

describe("validateValue", () => {
  const p = (x: unknown) => x as S.Property;
  it("binary", () => {
    expect(S.validateValue(p(plugProperties.state), true)).toEqual({ ok: true, value: true });
    expect(S.validateValue(p(plugProperties.state), "ON").ok).toBe(false);
  });
  it("numeric with range", () => {
    expect(S.validateValue(p(plugProperties.voltage), 229).ok).toBe(true);
    expect(S.validateValue(p(plugProperties.voltage), 301)).toEqual({ ok: false, error: "above max 300" });
    expect(S.validateValue(p(plugProperties.voltage), -1)).toEqual({ ok: false, error: "below min 0" });
    expect(S.validateValue(p(plugProperties.voltage), NaN).ok).toBe(false);
    expect(S.validateValue(p(plugProperties.power), "5").ok).toBe(false);
  });
  it("enum", () => {
    const e = p({ ...plugProperties.state, type: "enum", values: ["on", "off"] });
    expect(S.validateValue(e, "on").ok).toBe(true);
    expect(S.validateValue(e, "toggle").ok).toBe(false);
  });
  it("text", () => {
    const t = p({ ...plugProperties.state, type: "text" });
    expect(S.validateValue(t, "hi").ok).toBe(true);
    expect(S.validateValue(t, 1).ok).toBe(false);
  });
  it("composite", () => {
    const c = p({ ...plugProperties.state, type: "composite" });
    expect(S.validateValue(c, { x: 1 }).ok).toBe(true);
    expect(S.validateValue(c, null).ok).toBe(false);
  });
});

describe("isWritable / accessFromZ2M", () => {
  it("isWritable", () => {
    expect(S.isWritable(plugProperties.state as S.Property)).toBe(true);
    expect(S.isWritable(plugProperties.power as S.Property)).toBe(false);
    expect(S.isWritable({ ...plugProperties.state, access: "w" } as S.Property)).toBe(true);
  });
  it.each([[1, "r"], [2, "w"], [3, "rw"], [7, "rw"], [5, "r"], [4, "r"], [0, "r"], [6, "w"]])("mask %i -> %s", (m, a) => {
    expect(S.accessFromZ2M(m as number)).toBe(a);
  });
});
