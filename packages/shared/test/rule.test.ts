import { describe, expect, it } from "vitest";
import * as S from "../src";
import { D, H, RULE, S as SITE, SCN, cx, id } from "./fixtures";

const pt = { type: "property", deviceId: D, property: "power", op: "gt", value: 1000, for: 300 };
const setOn = { type: "setProperty", deviceId: D, property: "state", value: true };
const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => s.safeParse(v).success;

describe("Triggers", () => {
  it("CompareOp", () => { expect(ok(S.CompareOp, "gte")).toBe(true); expect(ok(S.CompareOp, "like")).toBe(false); });
  it("PropertyTrigger", () => {
    expect(ok(S.PropertyTrigger, pt)).toBe(true);
    expect(ok(S.PropertyTrigger, { ...pt, for: 86_401 })).toBe(false);
  });
  it("ScheduleTrigger", () => {
    expect(ok(S.ScheduleTrigger, { type: "schedule", at: "22:30", days: [1, 2] })).toBe(true);
    expect(ok(S.ScheduleTrigger, { type: "schedule", at: "24:00" })).toBe(false);
  });
  it("SunTrigger", () => {
    expect(S.SunTrigger.parse({ type: "sun", event: "sunset" }).offsetMin).toBe(0);
    expect(ok(S.SunTrigger, { type: "sun", event: "noon" })).toBe(false);
    expect(ok(S.SunTrigger, { type: "sun", event: "sunset", offsetMin: 181 })).toBe(false);
  });
  it("ManualTrigger", () => {
    expect(ok(S.ManualTrigger, { type: "manual" })).toBe(true);
    expect(ok(S.ManualTrigger, { type: "schedule" })).toBe(false);
  });
  it("Trigger union + refinements", () => {
    expect(ok(S.Trigger, pt)).toBe(true);
    expect(ok(S.Trigger, { type: "property", deviceId: D, property: "state", op: "changed" })).toBe(true);
    expect(ok(S.Trigger, { type: "property", deviceId: D, property: "state", op: "changed", value: true })).toBe(false);
    expect(ok(S.Trigger, { type: "property", deviceId: D, property: "state", op: "eq" })).toBe(false);
    expect(ok(S.Trigger, { type: "manual" })).toBe(false);
  });
});

describe("Conditions", () => {
  const prop = { type: "property", deviceId: D, property: "state", op: "eq", value: true };
  it("PropertyCondition", () => {
    expect(ok(S.PropertyCondition, prop)).toBe(true);
    expect(ok(S.PropertyCondition, { ...prop, op: "changed" })).toBe(false);
  });
  it("TimeWindowCondition (overnight ok)", () => {
    expect(ok(S.TimeWindowCondition, { type: "timeWindow", from: "22:00", to: "06:00" })).toBe(true);
    expect(ok(S.TimeWindowCondition, { type: "timeWindow", from: "7:00", to: "06:00" })).toBe(false);
  });
  it("DayOfWeekCondition", () => {
    expect(ok(S.DayOfWeekCondition, { type: "dayOfWeek", days: [0, 6] })).toBe(true);
    expect(ok(S.DayOfWeekCondition, { type: "dayOfWeek", days: [] })).toBe(false);
  });
  it("SunCondition", () => {
    expect(ok(S.SunCondition, { type: "sun", when: "afterSunset" })).toBe(true);
    expect(ok(S.SunCondition, { type: "sun", when: "beforeSunset" })).toBe(false);
  });
  it("LeafCondition", () => {
    expect(ok(S.LeafCondition, prop)).toBe(true);
    expect(ok(S.LeafCondition, { type: "nope" })).toBe(false);
  });
  it("ConditionGroup allows one nesting level only", () => {
    const tw = { type: "timeWindow", from: "22:00", to: "06:00" };
    expect(ok(S.ConditionGroup, { all: [prop, { any: [tw, prop] }] })).toBe(true);
    expect(ok(S.ConditionGroup, { any: [tw] })).toBe(true);
    expect(ok(S.ConditionGroup, { all: [{ any: [{ all: [tw] }] }] })).toBe(false);
    expect(ok(S.ConditionGroup, { all: [] })).toBe(false);
  });
});

describe("Actions", () => {
  it("SetPropertyAction", () => {
    expect(ok(S.SetPropertyAction, setOn)).toBe(true);
    expect(ok(S.SetPropertyAction, { ...setOn, value: null })).toBe(false);
  });
  it("DelayAction", () => {
    expect(ok(S.DelayAction, { type: "delay", seconds: 60 })).toBe(true);
    expect(ok(S.DelayAction, { type: "delay", seconds: 0 })).toBe(false);
    expect(ok(S.DelayAction, { type: "delay", seconds: 3601 })).toBe(false);
  });
  it("RunSceneAction", () => {
    expect(ok(S.RunSceneAction, { type: "runScene", sceneId: SCN })).toBe(true);
    expect(ok(S.RunSceneAction, { type: "runScene", sceneId: D })).toBe(false);
  });
  it("NotifyAction", () => {
    expect(S.NotifyAction.parse({ type: "notify", title: "Quá tải" }).level).toBe("info");
    expect(ok(S.NotifyAction, { type: "notify", title: "" })).toBe(false);
  });
  it("Action union", () => {
    expect(ok(S.Action, setOn)).toBe(true);
    expect(ok(S.Action, { type: "reboot" })).toBe(false);
  });
});

describe("Rule / Scene documents", () => {
  const rule = { id: RULE, siteId: SITE, hubId: H, name: "Tắt khi quá tải", enabled: true, trigger: pt,
    actions: [{ ...setOn, value: false }], rev: 1, updatedAt: 1_760_000_000_000 };
  const scene = { id: SCN, siteId: SITE, hubId: H, name: "Đi ngủ", actions: [setOn], rev: 0, updatedAt: 1 };
  it("RuleLastResult", () => { expect(ok(S.RuleLastResult, "broken")).toBe(true); expect(ok(S.RuleLastResult, "x")).toBe(false); });
  it("Rule", () => {
    expect(ok(S.Rule, rule)).toBe(true);
    expect(ok(S.Rule, { ...rule, actions: [] })).toBe(false);
    expect(ok(S.Rule, { ...rule, id: SCN })).toBe(false);
  });
  it("Scene", () => {
    expect(ok(S.Scene, scene)).toBe(true);
    expect(ok(S.Scene, { ...scene, name: "" })).toBe(false);
  });
});

describe("summaries (vi)", () => {
  const tr = (t: unknown) => S.summarizeTrigger(t as S.Trigger, cx);
  const ac = (a: unknown) => S.summarizeAction(a as S.Action, cx);
  it("summarizeTrigger", () => {
    expect(tr(pt)).toMatchInlineSnapshot(`"Khi công suất Ổ cắm phòng khách > 1000 W trong 5 phút"`);
    expect(tr({ type: "property", deviceId: D, property: "state", op: "eq", value: false })).toMatchInlineSnapshot(`"Khi trạng thái Ổ cắm phòng khách = tắt"`);
    expect(tr({ type: "property", deviceId: D, property: "state", op: "changed" })).toMatchInlineSnapshot(`"Khi trạng thái Ổ cắm phòng khách đổi"`);
    expect(tr({ type: "schedule", at: "22:30" })).toMatchInlineSnapshot(`"Mỗi ngày lúc 22:30"`);
    expect(tr({ type: "schedule", at: "07:00", days: [1, 3, 5] })).toMatchInlineSnapshot(`"T2, T4, T6 lúc 07:00"`);
    expect(tr({ type: "sun", event: "sunset", offsetMin: -30 })).toMatchInlineSnapshot(`"Lúc mặt trời lặn −30 phút"`);
    expect(tr({ type: "sun", event: "sunrise", offsetMin: 15 })).toMatchInlineSnapshot(`"Lúc mặt trời mọc +15 phút"`);
    expect(tr({ type: "sun", event: "sunrise", offsetMin: 0 })).toMatchInlineSnapshot(`"Lúc mặt trời mọc"`);
  });
  it("summarizeAction", () => {
    expect(ac(setOn)).toMatchInlineSnapshot(`"Bật Ổ cắm phòng khách"`);
    expect(ac({ ...setOn, value: false })).toMatchInlineSnapshot(`"Tắt Ổ cắm phòng khách"`);
    expect(ac({ type: "setProperty", deviceId: D, property: "power", value: 5 })).toMatchInlineSnapshot(`"Đặt công suất Ổ cắm phòng khách = 5"`);
    expect(ac({ type: "delay", seconds: 90 })).toMatchInlineSnapshot(`"Chờ 90 giây"`);
    expect(ac({ type: "runScene", sceneId: SCN })).toMatchInlineSnapshot(`"Chạy scene Đi ngủ"`);
    expect(ac({ type: "notify", title: "Quá tải" })).toMatchInlineSnapshot(`"Thông báo "Quá tải""`);
  });
  it("formatDuration", () => {
    expect(S.formatDuration(7200)).toBe("2 giờ");
    expect(S.formatDuration(300)).toBe("5 phút");
    expect(S.formatDuration(45)).toBe("45 giây");
  });
});

describe("referencedIds", () => {
  it("collects devices and scenes across trigger/conditions/actions", () => {
    const d2 = id("dev").replace("FG", "FH"), d3 = id("dev").replace("FG", "FJ");
    const r = S.referencedIds({
      trigger: { type: "property", deviceId: D, property: "power", op: "gt", value: 1 },
      conditions: { all: [{ type: "property", deviceId: d2, property: "state", op: "eq", value: true }, { any: [{ type: "property", deviceId: d3, property: "state", op: "eq", value: true }] }] },
      actions: [{ type: "setProperty", deviceId: D, property: "state", value: false }, { type: "runScene", sceneId: SCN }],
    } as never);
    expect([...r.devices].sort()).toEqual([D, d2, d3].sort());
    expect([...r.scenes]).toEqual([SCN]);
  });
  it("works for scenes", () => {
    const r = S.referencedIds({ actions: [{ type: "delay", seconds: 1 }] });
    expect(r.devices.size + r.scenes.size).toBe(0);
  });
});
