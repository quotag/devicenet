import type { EventDoc } from "@devicenet/shared";
import type { z } from "zod";
import { vi } from "@/i18n/vi";

export type EventT = z.infer<typeof EventDoc>;
export const HISTORY_DAYS = 7;
const DAY = 86_400_000;

export interface EventView {
  id: string;
  ts: number;
  time: string;
  title: string;
  sub: string;
  error: boolean;
}
export interface DayGroup {
  key: string;
  label: string;
  items: EventView[];
}

export function hhmm(ms?: number): string {
  if (!ms) return "--:--";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function dayLabel(ts: number, now: number): string {
  const h = vi.hist;
  const diff = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
  if (diff <= 0) return h.today;
  if (diff === 1) return h.yesterday;
  const d = new Date(ts);
  return `${h.weekdays[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}`;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

export function isErrorEvent(e: EventT): boolean {
  if (e.type === "rule.broken") return true;
  const r = e.result?.toLowerCase();
  return r === "error" || r === "failed" || r === "fail" || r === "partial" || r === "broken";
}

/** Presentation of one event row; names fall back to rule/scene docs when `title` is absent. */
export function toView(e: EventT, names: { rules: Record<string, { name: string }>; scenes: Record<string, { name: string }> }): EventView {
  const h = vi.hist;
  const err = isErrorEvent(e);
  const title =
    e.title ?? (e.ruleId ? names.rules[e.ruleId]?.name : undefined) ?? (e.sceneId ? names.scenes[e.sceneId]?.name : undefined) ?? h.untitled;
  const reason = str(e.detail?.reason) ?? str(e.detail?.error) ?? str(e.detail?.message);
  let sub: string;
  if (e.type === "rule.broken") sub = h.kindBroken(reason);
  else if (err) {
    const done = num(e.detail?.done);
    const total = num(e.detail?.total);
    sub = e.type === "scene.run" && done !== undefined && total !== undefined ? h.sceneParts(done, total) : h.failed(reason);
  } else if (e.type === "scene.run") sub = h.kindScene;
  else if (e.type === "notify") sub = h.kindNotify;
  else sub = h.kindRule;
  return { id: e.id, ts: e.ts, time: hhmm(e.ts), title, sub, error: err };
}

/** Events within the last 7 days, newest first, grouped by local day. */
export function groupByDay(
  events: readonly EventT[],
  now: number,
  onlyErrors: boolean,
  names: Parameters<typeof toView>[1],
): DayGroup[] {
  const from = now - HISTORY_DAYS * DAY;
  const out: DayGroup[] = [];
  for (const e of [...events].sort((a, b) => b.ts - a.ts)) {
    if (e.ts < from) continue;
    const v = toView(e, names);
    if (onlyErrors && !v.error) continue;
    const key = String(startOfDay(e.ts));
    let g = out[out.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: dayLabel(e.ts, now), items: [] };
      out.push(g);
    }
    g.items.push(v);
  }
  return out;
}
