/**
 * DeviceNet — Rule / Scene schema
 *
 * Authored by the app (S-30), validated with THIS schema on both ends, executed by hub-agent.
 * Rules reference deviceId + property key only — never a driver concept.
 *
 * Units on the wire: `for`, `seconds` are SECONDS. The UI shows minutes and converts.
 * Times are "HH:mm" in the SITE timezone (hub reads site.timezone); never UTC offsets here.
 */
import { z } from "zod";
import { DeviceId, EpochMs, HubId, PropertyKey, Rev, RuleId, SceneId, SiteId } from "./ids";
import { PropertyValue } from "./property";

// ---------- Triggers ----------

export const CompareOp = z.enum(["eq", "neq", "lt", "lte", "gt", "gte", "changed"]);
export type CompareOp = z.infer<typeof CompareOp>;

/**
 * Fires on the RISING EDGE: when the expression goes false→true.
 * `for` (seconds): expression must stay true for this long; timer cancelled if it goes false.
 * op "changed": fires on any value change (value ignored; `for` not allowed).
 */
export const PropertyTrigger = z.object({
  type: z.literal("property"),
  deviceId: DeviceId,
  property: PropertyKey,
  op: CompareOp,
  value: PropertyValue.optional(),
  for: z.number().int().min(0).max(86_400).optional(),
});

export const ScheduleTrigger = z.object({
  type: z.literal("schedule"),
  /** "HH:mm" 24h in site timezone */
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** 0 = Sunday … 6 = Saturday. Empty/omitted = every day */
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

export const SunTrigger = z.object({
  type: z.literal("sun"),
  event: z.enum(["sunrise", "sunset"]),
  /** minutes, negative = before */
  offsetMin: z.number().int().min(-180).max(180).default(0),
});

/** Scenes only (Tap-to-run). Never valid in a rule. */
export const ManualTrigger = z.object({ type: z.literal("manual") });

export const Trigger = z
  .discriminatedUnion("type", [PropertyTrigger, ScheduleTrigger, SunTrigger])
  .superRefine((t, ctx) => {
    if (t.type !== "property") return;
    if (t.op === "changed" && (t.value !== undefined || t.for !== undefined))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "op=changed takes no value/for" });
    if (t.op !== "changed" && t.value === undefined)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "value required" });
  });
export type Trigger = z.infer<typeof Trigger>;

// ---------- Conditions ----------

export const PropertyCondition = z.object({
  type: z.literal("property"),
  deviceId: DeviceId,
  property: PropertyKey,
  op: CompareOp.exclude(["changed"]),
  value: PropertyValue,
});

/** Overnight windows allowed (from 22:00 to 06:00). Site timezone. */
export const TimeWindowCondition = z.object({
  type: z.literal("timeWindow"),
  from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export const DayOfWeekCondition = z.object({
  type: z.literal("dayOfWeek"),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});

export const SunCondition = z.object({
  type: z.literal("sun"),
  /** "afterSunset" = now is between sunset and next sunrise, etc. */
  when: z.enum(["afterSunrise", "afterSunset"]),
  offsetMin: z.number().int().min(-180).max(180).default(0),
});

export const LeafCondition = z.discriminatedUnion("type", [
  PropertyCondition, TimeWindowCondition, DayOfWeekCondition, SunCondition,
]);

/** One level of nesting only: all[] of (leaf | any[] of leaf) or vice versa. */
export const ConditionGroup = z.union([
  z.object({ all: z.array(z.union([LeafCondition, z.object({ any: z.array(LeafCondition).min(1).max(10) })])).min(1).max(10) }),
  z.object({ any: z.array(z.union([LeafCondition, z.object({ all: z.array(LeafCondition).min(1).max(10) })])).min(1).max(10) }),
]);
export type ConditionGroup = z.infer<typeof ConditionGroup>;

// ---------- Actions ----------

export const SetPropertyAction = z.object({
  type: z.literal("setProperty"),
  deviceId: DeviceId,
  property: PropertyKey,
  value: PropertyValue,
});

export const DelayAction = z.object({
  type: z.literal("delay"),
  seconds: z.number().int().min(1).max(3600),
});

/** Hub refuses nesting deeper than 1 (scene A runs scene B, B may not run scenes). */
export const RunSceneAction = z.object({
  type: z.literal("runScene"),
  sceneId: SceneId,
});

export const NotifyAction = z.object({
  type: z.literal("notify"),
  title: z.string().min(1).max(80),
  body: z.string().max(300).optional(),
  level: z.enum(["info", "warning", "critical"]).default("info"),
});

export const Action = z.discriminatedUnion("type", [SetPropertyAction, DelayAction, RunSceneAction, NotifyAction]);
export type Action = z.infer<typeof Action>;

// ---------- Rule & Scene documents ----------

export const RuleLastResult = z.enum(["ok", "partial", "failed", "broken"]);

/** Firestore: tenants/{t}/rules/{ruleId} */
export const Rule = z.object({
  id: RuleId,
  siteId: SiteId,
  hubId: HubId,
  name: z.string().min(1).max(60),
  icon: z.string().max(40).optional(),
  enabled: z.boolean(),
  trigger: Trigger,
  conditions: ConditionGroup.optional(),
  actions: z.array(Action).min(1).max(20),
  // --- app writes ---
  rev: Rev,
  updatedAt: EpochMs,
  // --- hub writes (app must NOT write these) ---
  appliedRev: Rev.optional(),
  lastRunAt: EpochMs.optional(),
  lastResult: RuleLastResult.optional(),
  /** Set by hub when a referenced device is removed / property missing */
  brokenReason: z.string().max(200).optional(),
});
export type Rule = z.infer<typeof Rule>;

/** Firestore: tenants/{t}/scenes/{sceneId} */
export const Scene = z.object({
  id: SceneId,
  siteId: SiteId,
  hubId: HubId,
  name: z.string().min(1).max(60),
  icon: z.string().max(40).optional(),
  actions: z.array(Action).min(1).max(20),
  rev: Rev,
  updatedAt: EpochMs,
  appliedRev: Rev.optional(),
  lastRunAt: EpochMs.optional(),
  lastResult: RuleLastResult.optional(),
  brokenReason: z.string().max(200).optional(),
});
export type Scene = z.infer<typeof Scene>;

// ---------- Shared helpers (single source of the 1-line summary shown in S-02 / logs) ----------

export interface SummaryContext {
  deviceName: (id: string) => string;
  propertyLabel: (deviceId: string, key: string) => string;
  unit: (deviceId: string, key: string) => string | undefined;
  sceneName: (id: string) => string;
}

const OP_VI: Record<CompareOp, string> = { eq: "=", neq: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥", changed: "đổi" };
const DAYS_VI = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export function summarizeTrigger(t: Trigger, cx: SummaryContext): string {
  switch (t.type) {
    case "property": {
      const name = cx.deviceName(t.deviceId);
      const label = cx.propertyLabel(t.deviceId, t.property).toLowerCase();
      if (t.op === "changed") return `Khi ${label} ${name} đổi`;
      const unit = cx.unit(t.deviceId, t.property);
      const val = typeof t.value === "boolean" ? (t.value ? "bật" : "tắt") : `${t.value}${unit ? " " + unit : ""}`;
      const dur = t.for ? ` trong ${formatDuration(t.for)}` : "";
      return `Khi ${label} ${name} ${OP_VI[t.op]} ${val}${dur}`;
    }
    case "schedule": {
      const days = !t.days || t.days.length === 0 || t.days.length === 7 ? "Mỗi ngày" : t.days.map((d) => DAYS_VI[d]).join(", ");
      return `${days} lúc ${t.at}`;
    }
    case "sun": {
      const ev = t.event === "sunrise" ? "mặt trời mọc" : "mặt trời lặn";
      const off = t.offsetMin === 0 ? "" : ` ${t.offsetMin > 0 ? "+" : "−"}${Math.abs(t.offsetMin)} phút`;
      return `Lúc ${ev}${off}`;
    }
    default:
      return "";
  }
}

export function summarizeAction(a: Action, cx: SummaryContext): string {
  switch (a.type) {
    case "setProperty": {
      const name = cx.deviceName(a.deviceId);
      if (typeof a.value === "boolean") return `${a.value ? "Bật" : "Tắt"} ${name}`;
      return `Đặt ${cx.propertyLabel(a.deviceId, a.property).toLowerCase()} ${name} = ${a.value}`;
    }
    case "delay": return `Chờ ${formatDuration(a.seconds)}`;
    case "runScene": return `Chạy scene ${cx.sceneName(a.sceneId)}`;
    case "notify": return `Thông báo "${a.title}"`;
    default: return "";
  }
}

export function formatDuration(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} giờ`;
  if (seconds % 60 === 0) return `${seconds / 60} phút`;
  return `${seconds} giây`;
}

/** Collect every deviceId/sceneId a rule or scene references (SH-4 "sẽ lỗi" list, hub broken detection). */
export function referencedIds(doc: Pick<Rule, "trigger" | "conditions" | "actions"> | Pick<Scene, "actions">): { devices: Set<string>; scenes: Set<string> } {
  const devices = new Set<string>();
  const scenes = new Set<string>();
  const visitCond = (c: unknown) => {
    if (!c || typeof c !== "object") return;
    const o = c as Record<string, unknown>;
    if (o.type === "property" && typeof o.deviceId === "string") devices.add(o.deviceId);
    for (const k of ["all", "any"]) if (Array.isArray(o[k])) (o[k] as unknown[]).forEach(visitCond);
  };
  if ("trigger" in doc && doc.trigger.type === "property") devices.add(doc.trigger.deviceId);
  if ("conditions" in doc) visitCond(doc.conditions);
  for (const a of doc.actions) {
    if (a.type === "setProperty") devices.add(a.deviceId);
    if (a.type === "runScene") scenes.add(a.sceneId);
  }
  return { devices, scenes };
}
