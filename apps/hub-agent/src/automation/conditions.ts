import SunCalc from 'suncalc';
import type { z } from 'zod';
import type { CompareOp, ConditionGroup, LeafCondition, PropertyValue } from '@devicenet/shared';

/** Site info the engine needs (subset of shared `Site`). */
export interface SiteInfo {
  timezone: string;
  lat?: number;
  lng?: number;
}

export interface SunTimes {
  sunrise: number;
  sunset: number;
}

/** Everything a condition needs at evaluation time. */
export interface ConditionContext {
  now: number;
  site: SiteInfo;
  getValue(deviceId: string, property: string): PropertyValue | undefined;
  /** today's sun times at site; default: suncalc. null → unknown (missing coords) */
  sunTimes?(now: number, site: SiteInfo): SunTimes | null;
}

export type Predicate = (cx: ConditionContext) => boolean;

const same = (a: unknown, b: unknown): boolean =>
  a === b || (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && JSON.stringify(a) === JSON.stringify(b));

/** Compare a live value against a rule value. Ordering ops only apply to numbers. `changed` is handled by the trigger. */
export function compare(op: Exclude<CompareOp, 'changed'>, actual: PropertyValue | undefined, expected: PropertyValue | undefined): boolean {
  if (actual === undefined || actual === null) return false;
  switch (op) {
    case 'eq':
      return same(actual, expected);
    case 'neq':
      return !same(actual, expected);
    default: {
      if (typeof actual !== 'number' || typeof expected !== 'number') return false;
      if (op === 'lt') return actual < expected;
      if (op === 'lte') return actual <= expected;
      if (op === 'gt') return actual > expected;
      return actual >= expected;
    }
  }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    fmtCache.set(tz, f);
  }
  return f;
}
const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Minutes since local midnight + weekday (0 = Sunday) in `tz`. */
export function localParts(ms: number, tz: string): { minutes: number; day: number } {
  let h = 0, m = 0, day = 0;
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type === 'hour') h = Number(p.value) % 24;
    else if (p.type === 'minute') m = Number(p.value);
    else if (p.type === 'weekday') day = DAYS[p.value] ?? 0;
  }
  return { minutes: h * 60 + m, day };
}

const hhmm = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** [from, to) in site-local minutes; from > to = overnight; from == to = whole day. */
export function inTimeWindow(minutes: number, from: string, to: string): boolean {
  const f = hhmm(from), t = hhmm(to);
  if (f === t) return true;
  return f < t ? minutes >= f && minutes < t : minutes >= f || minutes < t;
}

/**
 * suncalc picks the solar day whose transit is nearest to `now` in local solar time,
 * i.e. "today" at the site for any hour of the day.
 */
export function defaultSunTimes(now: number, site: SiteInfo): SunTimes | null {
  if (site.lat === undefined || site.lng === undefined) return null;
  const t = SunCalc.getTimes(new Date(now), site.lat, site.lng);
  const sunrise = t.sunrise.getTime(), sunset = t.sunset.getTime();
  if (!Number.isFinite(sunrise) || !Number.isFinite(sunset)) return null; // polar day/night
  return { sunrise, sunset };
}

export type Leaf = z.infer<typeof LeafCondition>;

function compileLeaf(c: Leaf): Predicate {
  switch (c.type) {
    case 'property':
      return (cx) => compare(c.op, cx.getValue(c.deviceId, c.property), c.value);
    case 'timeWindow':
      return (cx) => inTimeWindow(localParts(cx.now, cx.site.timezone).minutes, c.from, c.to);
    case 'dayOfWeek': {
      const days = new Set(c.days);
      return (cx) => days.has(localParts(cx.now, cx.site.timezone).day);
    }
    case 'sun': {
      const off = (c.offsetMin ?? 0) * 60_000;
      return (cx) => {
        const st = (cx.sunTimes ?? defaultSunTimes)(cx.now, cx.site);
        if (!st) return false;
        // afterSunrise: [sunrise+off, sunset) — daytime; afterSunset: [sunset+off, …) or before today's sunrise
        if (c.when === 'afterSunrise') return cx.now >= st.sunrise + off && cx.now < st.sunset;
        return cx.now >= st.sunset + off || cx.now < st.sunrise;
      };
    }
  }
}

type Node = Leaf | { all: Leaf[] } | { any: Leaf[] };

function compileNode(n: Node): Predicate {
  if ('all' in n) return compileAll(n.all.map(compileLeaf));
  if ('any' in n) return compileAny(n.any.map(compileLeaf));
  return compileLeaf(n);
}
const compileAll = (ps: Predicate[]): Predicate => (cx) => ps.every((p) => p(cx));
const compileAny = (ps: Predicate[]): Predicate => (cx) => ps.some((p) => p(cx));

/** Compile a ConditionGroup (all/any, one nesting level) to a predicate. Absent → always true. */
export function compileConditions(group: ConditionGroup | undefined): Predicate {
  if (!group) return () => true;
  if ('all' in group) return compileAll((group.all as Node[]).map(compileNode));
  return compileAny((group.any as Node[]).map(compileNode));
}

/** Leaf conditions (flattened) — for reference / broken checks. */
export function leafConditions(group: ConditionGroup | undefined): Leaf[] {
  if (!group) return [];
  const out: Leaf[] = [];
  const top = ('all' in group ? group.all : group.any) as Node[];
  for (const n of top) {
    if ('all' in n) out.push(...n.all);
    else if ('any' in n) out.push(...n.any);
    else out.push(n);
  }
  return out;
}
