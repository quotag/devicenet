/**
 * S-30 RuleEditor draft state (FR-F08). Pure reducer, no UI.
 *
 * The draft is a loose, UI-friendly shape: fields may be missing while the user is still
 * filling sheets. Durations are kept in MINUTES here and converted to SECONDS on the wire
 * (D-13, see `toWire`). Wire shapes come from `@devicenet/shared` only.
 */
import { ulid } from "ulid";
import type { Action, CompareOp, ConditionGroup, PropertyValue, Rule, Scene, Trigger } from "@devicenet/shared";

export type EditorMode = "rule" | "scene";
export type Combinator = "all" | "any";

// ---------- Draft shapes ----------

export interface DraftPropertyTrigger {
  type: "property";
  deviceId?: string;
  property?: string;
  op?: CompareOp;
  value?: PropertyValue;
  /** "Liên tục trong {n} phút" — minutes in the UI, `for = n*60` on the wire. */
  forMin?: number;
}
export interface DraftScheduleTrigger { type: "schedule"; at?: string; days?: number[] }
export interface DraftSunTrigger { type: "sun"; event?: "sunrise" | "sunset"; offsetMin?: number }
export type DraftTrigger = DraftPropertyTrigger | DraftScheduleTrigger | DraftSunTrigger;

export interface DraftPropertyCondition {
  type: "property";
  deviceId?: string;
  property?: string;
  op?: Exclude<CompareOp, "changed">;
  value?: PropertyValue;
}
export interface DraftTimeWindowCondition { type: "timeWindow"; from?: string; to?: string }
export interface DraftDayOfWeekCondition { type: "dayOfWeek"; days?: number[] }
export interface DraftSunCondition { type: "sun"; when?: "afterSunrise" | "afterSunset"; offsetMin?: number }
export type DraftLeafCondition =
  | DraftPropertyCondition
  | DraftTimeWindowCondition
  | DraftDayOfWeekCondition
  | DraftSunCondition;
/** Nested sub-group loaded from an existing rule (editor does not author these, but keeps them). */
export type DraftNestedGroup = { all: unknown[] } | { any: unknown[] };
export type DraftCondition = DraftLeafCondition | DraftNestedGroup;

export type DraftAction =
  | { type: "setProperty"; deviceId?: string; property?: string; value?: PropertyValue }
  /** "Chờ" — minutes in the UI, `seconds = n*60` on the wire. */
  | { type: "delay"; minutes?: number }
  | { type: "runScene"; sceneId?: string }
  | { type: "notify"; title?: string; body?: string; level?: "info" | "warning" | "critical" };

/** Stable client key per list item (React keys, dnd-kit ids, issue → block mapping). */
export interface Keyed<T> { key: string; item: T }

export interface EditorDraft {
  mode: EditorMode;
  /** `rule_…` / `scn_…`, generated for new drafts. */
  id: string;
  /** false once the doc exists in Firestore. */
  isNew: boolean;
  /** Rev of the stored doc (0 for new); save writes `rev + 1`. */
  rev: number;
  name: string;
  icon?: string;
  enabled: boolean;
  /** Rule only (scene hides "Khi"). */
  trigger?: DraftTrigger;
  /** Rule only (scene hides "Và nếu"). */
  conditions: { op: Combinator; items: Keyed<DraftCondition>[] };
  actions: Keyed<DraftAction>[];
}

let keySeq = 0;
const newKey = () => `k${++keySeq}`;
const keyed = <T>(item: T): Keyed<T> => ({ key: newKey(), item });

// ---------- Unit conversion (D-13) ----------

export const minutesToSeconds = (min: number): number => Math.round(min * 60);
export const secondsToMinutes = (sec: number): number => sec / 60;

// ---------- Constructors ----------

export function newDraft(mode: EditorMode): EditorDraft {
  return {
    mode,
    id: mode === "rule" ? `rule_${ulid()}` : `scn_${ulid()}`,
    isNew: true,
    rev: 0,
    name: "",
    enabled: true,
    conditions: { op: "all", items: [] },
    actions: [],
  };
}

function triggerToDraft(t: Trigger): DraftTrigger {
  if (t.type === "property") {
    const d: DraftPropertyTrigger = { type: "property", deviceId: t.deviceId, property: t.property, op: t.op };
    if (t.value !== undefined) d.value = t.value;
    if (t.for !== undefined && t.for > 0) d.forMin = secondsToMinutes(t.for);
    return d;
  }
  return { ...t };
}

function actionToDraft(a: Action): DraftAction {
  if (a.type === "delay") return { type: "delay", minutes: secondsToMinutes(a.seconds) };
  return { ...a } as DraftAction;
}

function conditionsToDraft(c: ConditionGroup | undefined): EditorDraft["conditions"] {
  if (!c) return { op: "all", items: [] };
  const op: Combinator = "all" in c ? "all" : "any";
  const list = ("all" in c ? c.all : c.any) as DraftCondition[];
  return { op, items: list.map((x) => keyed(structuredClone(x))) };
}

/** Template shape for S-02 suggestion cards and anything that pre-fills a new draft (wire units). */
export interface DraftTemplate {
  name: string;
  icon?: string;
  enabled?: boolean;
  trigger?: Trigger;
  conditions?: ConditionGroup;
  actions: Action[];
}

function fromTemplate(base: EditorDraft, t: DraftTemplate): EditorDraft {
  return {
    ...base,
    name: t.name,
    icon: t.icon,
    enabled: t.enabled ?? base.enabled,
    trigger: base.mode === "rule" && t.trigger ? triggerToDraft(t.trigger) : undefined,
    conditions: base.mode === "rule" ? conditionsToDraft(t.conditions) : { op: "all", items: [] },
    actions: t.actions.map((a) => keyed(actionToDraft(a))),
  };
}

export function draftFromRule(rule: Rule): EditorDraft {
  return { ...fromTemplate(newDraft("rule"), rule), id: rule.id, isNew: false, rev: rule.rev, enabled: rule.enabled };
}

export function draftFromScene(scene: Scene): EditorDraft {
  return { ...fromTemplate(newDraft("scene"), scene), id: scene.id, isNew: false, rev: scene.rev };
}

export function draftFromSuggestion(mode: EditorMode, t: DraftTemplate): EditorDraft {
  return fromTemplate(newDraft(mode), t);
}

// ---------- Reducer ----------

export type EditorAction =
  | { type: "reset"; draft: EditorDraft }
  | { type: "setName"; name: string }
  | { type: "setIcon"; icon: string | undefined }
  | { type: "setEnabled"; enabled: boolean }
  | { type: "setTrigger"; trigger: DraftTrigger | undefined }
  | { type: "patchTrigger"; patch: Partial<DraftPropertyTrigger> | Partial<DraftScheduleTrigger> | Partial<DraftSunTrigger> }
  | { type: "setConditionOp"; op: Combinator }
  | { type: "addCondition"; condition: DraftCondition }
  | { type: "updateCondition"; key: string; condition: DraftCondition }
  | { type: "removeCondition"; key: string }
  | { type: "addAction"; action: DraftAction }
  | { type: "updateAction"; key: string; action: DraftAction }
  | { type: "removeAction"; key: string }
  | { type: "moveAction"; from: number; to: number }
  | { type: "markSaved"; rev: number };

/** `changed` fires on any change: it takes no value and no `for` (spec §9). */
function normalizeTrigger(t: DraftTrigger | undefined): DraftTrigger | undefined {
  if (!t || t.type !== "property" || t.op !== "changed") return t;
  const { value: _v, forMin: _f, ...rest } = t;
  return rest;
}

export function editorReducer(s: EditorDraft, a: EditorAction): EditorDraft {
  switch (a.type) {
    case "reset":
      return a.draft;
    case "setName":
      return { ...s, name: a.name };
    case "setIcon":
      return { ...s, icon: a.icon };
    case "setEnabled":
      return { ...s, enabled: a.enabled };
    case "setTrigger":
      if (s.mode === "scene") return s;
      return { ...s, trigger: normalizeTrigger(a.trigger) };
    case "patchTrigger":
      if (s.mode === "scene" || !s.trigger) return s;
      return { ...s, trigger: normalizeTrigger({ ...s.trigger, ...a.patch } as DraftTrigger) };
    case "setConditionOp":
      return { ...s, conditions: { ...s.conditions, op: a.op } };
    case "addCondition":
      if (s.mode === "scene") return s;
      return { ...s, conditions: { ...s.conditions, items: [...s.conditions.items, keyed(a.condition)] } };
    case "updateCondition":
      return {
        ...s,
        conditions: {
          ...s.conditions,
          items: s.conditions.items.map((c) => (c.key === a.key ? { key: c.key, item: a.condition } : c)),
        },
      };
    case "removeCondition":
      return { ...s, conditions: { ...s.conditions, items: s.conditions.items.filter((c) => c.key !== a.key) } };
    case "addAction":
      return { ...s, actions: [...s.actions, keyed(a.action)] };
    case "updateAction":
      return { ...s, actions: s.actions.map((x) => (x.key === a.key ? { key: x.key, item: a.action } : x)) };
    case "removeAction":
      return { ...s, actions: s.actions.filter((x) => x.key !== a.key) };
    case "moveAction": {
      const n = s.actions.length;
      if (a.from === a.to || a.from < 0 || a.from >= n || a.to < 0 || a.to >= n) return s;
      const next = [...s.actions];
      const [moved] = next.splice(a.from, 1);
      next.splice(a.to, 0, moved!);
      return { ...s, actions: next };
    }
    case "markSaved":
      return { ...s, isNew: false, rev: a.rev };
  }
}

// ---------- Wire conversion ----------

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function triggerToWire(t: DraftTrigger): Record<string, unknown> {
  if (t.type === "property") {
    const { forMin, ...rest } = t;
    const out: Record<string, unknown> = { ...rest };
    if (t.op === "changed") delete out.value;
    else if (forMin !== undefined && forMin > 0) out.for = minutesToSeconds(forMin);
    return stripUndefined(out);
  }
  if (t.type === "sun") return stripUndefined({ ...t, offsetMin: t.offsetMin ?? 0 });
  return stripUndefined({ ...t });
}

export function actionToWire(a: DraftAction): Record<string, unknown> {
  if (a.type === "delay") return stripUndefined({ type: "delay", seconds: a.minutes === undefined ? undefined : minutesToSeconds(a.minutes) });
  if (a.type === "notify") return stripUndefined({ ...a, body: a.body?.trim() ? a.body : undefined });
  return stripUndefined({ ...a });
}

function conditionToWire(c: DraftCondition): unknown {
  if ("all" in c || "any" in c) return c;
  if (c.type === "sun") return stripUndefined({ ...c, offsetMin: c.offsetMin ?? 0 });
  return stripUndefined({ ...c });
}

/** Unvalidated wire candidate for the user-editable fields (ids/rev/updatedAt added by `validate`). */
export function toWire(d: EditorDraft): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: d.name.trim(),
    actions: d.actions.map((a) => actionToWire(a.item)),
  };
  if (d.icon) base.icon = d.icon;
  if (d.mode === "scene") return base;
  base.enabled = d.enabled;
  base.trigger = d.trigger ? triggerToWire(d.trigger) : undefined;
  if (d.conditions.items.length > 0)
    base.conditions = { [d.conditions.op]: d.conditions.items.map((c) => conditionToWire(c.item)) };
  return base;
}
