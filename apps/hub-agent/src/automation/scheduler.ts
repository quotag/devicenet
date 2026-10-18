import { Cron } from 'croner';
import type { PropertyValue, Rule } from '@devicenet/shared';
import type { Clock, TimerHandle, TimerHost } from '../core/clock.js';
import { realClock, realTimers } from '../core/clock.js';
import type { HubEventBody } from '../core/events.js';
import type { CompiledRule } from './compile.js';
import type { ConditionContext, SiteInfo } from './conditions.js';
import { hasCoordinates, nextSunFire, nextSunRecompute, type SunTimesFn } from './sun.js';

type Log = { warn(obj: object, msg?: string): void; debug?(obj: object, msg?: string): void };

export type TimeTrigger = Extract<Rule['trigger'], { type: 'schedule' | 'sun' }>;

export interface ScheduledFire {
  rule: Rule;
  /** actual fire time */
  at: number;
  /** the planned instant (schedule "HH:mm" / sun ± offset) */
  scheduledAt: number;
  trigger: TimeTrigger;
}

/** What the scheduler needs from the AutomationEngine (B14) — compiled, enabled, non-broken rules. */
export interface CompiledRuleSource {
  activeRuleIds(): string[];
  getCompiled(ruleId: string): CompiledRule | undefined;
}

export interface SchedulerOptions {
  clock?: Clock;
  timers?: TimerHost;
  site?: SiteInfo | null;
  /** live property value for conditions */
  getValue?: (deviceId: string, property: string) => PropertyValue | undefined;
  /** trigger + conditions passed; B15 runner hooks here */
  onFire?: (f: ScheduledFire) => void;
  events?: { emit(body: HubEventBody): unknown };
  /**
   * OQ-6: last time the hub was known alive (meta.lastHeartbeatAt). When set, each schedule rule is checked
   * once (first time it is seen): a last expected fire in (lastAliveAt, now] → no catch-up, one
   * `hub.warning code=schedule_missed`.
   */
  lastAliveAt?: number;
  sunTimes?: SunTimesFn;
  log?: Log;
}

interface Entry {
  compiled: CompiledRule;
  key: string;
  timer?: TimerHandle;
  nextAt?: number;
}

const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';
/** missed-run check only applies to rules seen within this long after start (rules arrive from sync) */
const MISSED_GRACE_MS = 10 * 60_000;

const dowList = (days: number[] | undefined): string =>
  days && days.length > 0 && days.length < 7 ? [...new Set(days)].sort((a, b) => a - b).join(',') : '*';

/** croner pattern for a schedule trigger ("HH:mm", days 0 = Sunday). */
export function schedulePattern(t: Extract<TimeTrigger, { type: 'schedule' }>): string {
  const [h, m] = t.at.split(':').map(Number);
  return `${m} ${h} * * ${dowList(t.days)}`;
}

/** Next schedule fire strictly after `after`, in `tz`. */
export function nextScheduleFire(t: Extract<TimeTrigger, { type: 'schedule' }>, tz: string, after: number): number | null {
  const d = new Cron(schedulePattern(t), { timezone: tz, paused: true }).nextRun(new Date(after));
  return d ? d.getTime() : null;
}

/** Last expected schedule fire in (from, to], or null. */
export function lastScheduleFireIn(t: Extract<TimeTrigger, { type: 'schedule' }>, tz: string, from: number, to: number): number | null {
  if (!(to > from)) return null;
  const cron = new Cron(schedulePattern(t), { timezone: tz, paused: true });
  // start at most 8 days back — a weekly pattern fires at least once per 7 days
  let cur = Math.max(from, to - 8 * 86_400_000);
  let last: number | null = null;
  for (;;) {
    const n = cron.nextRun(new Date(cur));
    if (!n || n.getTime() > to) return last;
    last = n.getTime();
    cur = last;
  }
}

const isTime = (c: CompiledRule): boolean => c.rule.trigger.type === 'schedule' || c.rule.trigger.type === 'sun';

/**
 * Schedule + sun triggers (FR-H08, B16). croner computes fire instants in `site.timezone`; timers run on the
 * injectable TimerHost. Sun rules are recomputed daily at 00:05 site time and whenever the site changes.
 * Missing coordinates are reported as broken by compile (B14) so such rules never reach here.
 */
export class Scheduler {
  private entries = new Map<string, Entry>();
  private site: SiteInfo | null | undefined;
  private readonly clock: Clock;
  private readonly timers: TimerHost;
  private readonly startedAt: number;
  private onFire?: (f: ScheduledFire) => void;
  private dailyTimer?: TimerHandle;
  private dailyTz?: string;
  /** ruleId → last planned instant that fired (no double fire across reschedules) */
  private lastFired = new Map<string, number>();
  private missedChecked = new Set<string>();

  constructor(private readonly o: SchedulerOptions = {}) {
    this.clock = o.clock ?? realClock;
    this.timers = o.timers ?? realTimers;
    this.site = o.site;
    this.onFire = o.onFire;
    this.startedAt = this.clock.now();
  }

  setOnFire(fn: ((f: ScheduledFire) => void) | undefined): void {
    this.onFire = fn;
  }

  /** Replace the set of rules (any trigger type; non schedule/sun ignored). Unchanged rules keep their timers. */
  load(compiled: Iterable<CompiledRule>): void {
    const next = new Map<string, Entry>();
    const tz = this.tz();
    for (const c of compiled) {
      if (!isTime(c) || !c.rule.enabled) continue;
      const key = `${c.rev}|${JSON.stringify(c.rule.trigger)}|${tz}|${this.site?.lat}|${this.site?.lng}`;
      const old = this.entries.get(c.id);
      if (old && old.key === key) {
        old.compiled = c;
        next.set(c.id, old);
        continue;
      }
      next.set(c.id, { compiled: c, key });
    }
    for (const [id, e] of this.entries) if (next.get(id) !== e) e.timer?.cancel();
    this.entries = next;
    for (const id of [...this.lastFired.keys()]) if (!next.has(id)) this.lastFired.delete(id);
    this.checkMissed();
    for (const e of this.entries.values()) if (!e.timer) this.arm(e);
    this.armDaily();
  }

  /** Pull compiled rules from the engine (call after engine.load / setSite / refresh). */
  sync(source: CompiledRuleSource): void {
    const list: CompiledRule[] = [];
    for (const id of source.activeRuleIds()) {
      const c = source.getCompiled(id);
      if (c) list.push(c);
    }
    this.load(list);
  }

  /** Site changed (timezone / coordinates) → reschedule everything. */
  setSite(site: SiteInfo | null): void {
    this.site = site;
    const list = [...this.entries.values()].map((e) => e.compiled);
    for (const e of this.entries.values()) e.timer?.cancel();
    this.entries.clear();
    this.load(list);
  }

  /** Daily 00:05 (site tz): recompute sun fire times. */
  recomputeSun(): void {
    for (const e of this.entries.values()) {
      if (e.compiled.rule.trigger.type !== 'sun') continue;
      e.timer?.cancel();
      e.timer = undefined;
      this.arm(e);
    }
  }

  /** next planned instant per rule (diagnostics / tests) */
  nextFireAt(ruleId: string): number | undefined {
    return this.entries.get(ruleId)?.nextAt;
  }

  stop(): void {
    for (const e of this.entries.values()) e.timer?.cancel();
    this.entries.clear();
    this.dailyTimer?.cancel();
    this.dailyTimer = undefined;
  }

  private tz(): string {
    return this.site?.timezone || DEFAULT_TZ;
  }

  private nextFor(e: Entry, after: number): number | null {
    const t = e.compiled.rule.trigger;
    if (t.type === 'schedule') return nextScheduleFire(t, this.tz(), after);
    if (t.type === 'sun') {
      if (!hasCoordinates(this.site)) return null;
      return nextSunFire(after, this.site, t.event, t.offsetMin ?? 0, this.o.sunTimes);
    }
    return null;
  }

  private arm(e: Entry): void {
    const now = this.clock.now();
    const after = Math.max(now, this.lastFired.get(e.compiled.id) ?? -Infinity);
    let at: number | null;
    try {
      at = this.nextFor(e, after);
    } catch (err) {
      this.o.log?.warn({ ruleId: e.compiled.id, err: (err as Error).message }, 'schedule compute failed');
      at = null;
    }
    e.nextAt = at ?? undefined;
    if (at === null) return;
    const planned = at;
    e.timer = this.timers.setTimeout(() => this.due(e, planned), Math.max(0, planned - now));
  }

  private due(e: Entry, planned: number): void {
    e.timer = undefined;
    if (this.entries.get(e.compiled.id) !== e) return;
    const now = this.clock.now();
    if (now < planned) {
      // real timers can wake early; wait the remainder
      e.timer = this.timers.setTimeout(() => this.due(e, planned), planned - now);
      return;
    }
    if ((this.lastFired.get(e.compiled.id) ?? -Infinity) < planned) {
      this.lastFired.set(e.compiled.id, planned);
      this.fire(e, planned, now);
    }
    if (this.entries.get(e.compiled.id) === e && !e.timer) this.arm(e);
  }

  private fire(e: Entry, scheduledAt: number, at: number): void {
    const { rule } = e.compiled;
    const cx: ConditionContext = {
      now: at,
      site: this.site ?? { timezone: DEFAULT_TZ },
      getValue: (d, p) => this.o.getValue?.(d, p),
      ...(this.o.sunTimes ? { sunTimes: this.o.sunTimes } : {}),
    };
    let pass = false;
    try {
      pass = e.compiled.conditions(cx);
    } catch (err) {
      this.o.log?.warn({ ruleId: rule.id, err: (err as Error).message }, 'condition eval failed');
    }
    if (!pass) {
      this.o.log?.debug?.({ ruleId: rule.id }, 'rule conditions not met');
      return;
    }
    try {
      this.onFire?.({ rule, at, scheduledAt, trigger: rule.trigger as TimeTrigger });
    } catch (err) {
      this.o.log?.warn({ ruleId: rule.id, err: (err as Error).message }, 'rule fire handler failed');
    }
  }

  /** OQ-6: missed schedule after downtime → no catch-up, one hub.warning per missed rule. */
  private checkMissed(): void {
    const since = this.o.lastAliveAt;
    if (since === undefined || !Number.isFinite(since)) return;
    const now = this.clock.now();
    for (const e of this.entries.values()) {
      const { rule } = e.compiled;
      if (this.missedChecked.has(rule.id)) continue;
      this.missedChecked.add(rule.id);
      if (rule.trigger.type !== 'schedule' || now - this.startedAt > MISSED_GRACE_MS) continue;
      // a rule edited after the downtime started cannot have "missed" an earlier run
      const from = Math.max(since, rule.updatedAt ?? -Infinity);
      const missed = lastScheduleFireIn(rule.trigger, this.tz(), from, now);
      if (missed === null) continue;
      // no catch-up: never fire this instant later
      this.lastFired.set(rule.id, Math.max(this.lastFired.get(rule.id) ?? -Infinity, missed));
      const message = `rule ${rule.id} missed schedule ${rule.trigger.at} at ${new Date(missed).toISOString()} (hub offline)`;
      this.o.log?.warn({ ruleId: rule.id, missedAt: missed }, 'schedule missed');
      try {
        this.o.events?.emit({ type: 'hub.warning', code: 'schedule_missed', message });
      } catch (err) {
        this.o.log?.warn({ err: (err as Error).message }, 'schedule_missed event failed');
      }
    }
  }

  /** 00:05 site-local daily sun recompute (only while sun rules exist). */
  private armDaily(): void {
    const needed = [...this.entries.values()].some((e) => e.compiled.rule.trigger.type === 'sun');
    const tz = this.tz();
    if (!needed) {
      this.dailyTimer?.cancel();
      this.dailyTimer = undefined;
      return;
    }
    if (this.dailyTimer && this.dailyTz === tz) return;
    this.dailyTimer?.cancel();
    this.dailyTz = tz;
    const now = this.clock.now();
    const at = nextSunRecompute(now, tz);
    this.dailyTimer = this.timers.setTimeout(() => {
      this.dailyTimer = undefined;
      this.recomputeSun();
      this.armDaily();
    }, Math.max(0, at - now));
  }
}

