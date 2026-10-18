import { summarizeAction, summarizeTrigger, type Action, type SummaryContext, type Trigger } from "@devicenet/shared";
import { vi } from "@/i18n/vi";
import { actionToWire, triggerToWire, type DraftAction, type DraftCondition, type DraftTrigger } from "./state";

const t = vi.s30;
const OP = t.ops;

/** One-line (label, caption) for a block row; incomplete drafts fall back to a neutral label. */
export interface RowText {
  label: string;
  caption?: string;
}

export function triggerText(d: DraftTrigger, cx: SummaryContext): RowText {
  try {
    const s = summarizeTrigger(triggerToWire(d) as Trigger, cx);
    if (!s.includes("undefined")) return { label: s };
  } catch {
    /* incomplete draft */
  }
  return { label: t.pick };
}

export function actionText(d: DraftAction, cx: SummaryContext): RowText {
  try {
    const s = summarizeAction(actionToWire(d) as Action, cx);
    if (!s.includes("undefined") && !s.includes("NaN")) return { label: s };
  } catch {
    /* incomplete draft */
  }
  return { label: t.actionKind[d.type], caption: t.pick };
}

export function conditionText(c: DraftCondition, cx: SummaryContext): RowText {
  if ("all" in c || "any" in c) return { label: "all" in c ? t.andOr[0] : t.andOr[1] };
  switch (c.type) {
    case "property": {
      if (!c.deviceId || !c.property || !c.op || c.value === undefined) return { label: t.pick };
      const unit = cx.unit(c.deviceId, c.property);
      const val = typeof c.value === "boolean" ? (c.value ? t.on : t.off) : `${c.value}${unit ? " " + unit : ""}`;
      return { label: `${cx.deviceName(c.deviceId)} · ${cx.propertyLabel(c.deviceId, c.property)} ${OP[c.op]} ${val}` };
    }
    case "timeWindow":
      return c.from && c.to ? { label: `${t.condKind.timeWindow} · ${c.from} – ${c.to}` } : { label: t.pick };
    case "dayOfWeek":
      return c.days && c.days.length ? { label: `${t.condKind.dayOfWeek} · ${c.days.map((d) => t.dayShort[d]).join(", ")}` } : { label: t.pick };
    case "sun":
      return { label: `${c.when === "afterSunrise" ? t.afterSunrise : t.afterSunset}${c.offsetMin ? ` ${c.offsetMin > 0 ? "+" : ""}${c.offsetMin}'` : ""}` };
  }
}
