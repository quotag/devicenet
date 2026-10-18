import type { PropertyValue, Rule } from '@devicenet/shared';
import type { Clock, TimerHandle, TimerHost } from '../core/clock.js';
import { realClock, realTimers } from '../core/clock.js';
import type { HubEventBody } from '../core/events.js';
import type { Registry, RegistryChange } from '../core/registry.js';
import type { ConfigStore } from '../sync/ConfigStore.js';
import { buildIndex, compileRule, type CompiledRule } from './compile.js';
import type { ConditionContext, SiteInfo } from './conditions.js';

type Log = { warn(obj: object, msg?: string): void; debug?(obj: object, msg?: string): void };

export interface RuleFire {
  rule: Rule;
  at: number;
  trigger: { deviceId: string; property: string; value: PropertyValue | undefined };
}

export interface AutomationEngineOptions {
  registry: Pick<Registry, 'get' | 'onChange'>;
  clock?: Clock;
  timers?: TimerHost;
  /** null/undefined until the site doc is known */
  site?: SiteInfo | null;
  events?: { emit(body: HubEventBody): unknown };
  configStore?: () => ConfigStore | null | undefined;
  /** called when a rule fires (trigger + conditions passed); B15 runner hooks here */
  onFire?: (f: RuleFire) => void;
  sunTimes?: ConditionContext['sunTimes'];
  log?: Log;
}

interface Slot {
  compiled: CompiledRule;
  /** last value of the trigger expression (rising-edge detection) */
  prev: boolean;
  timer?: TimerHandle;
}

const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

/**
 * Event-driven automation engine (FR-H08, realtime §5): rules compiled to closures, property triggers
 * indexed by `dev.prop`, fire on the rising edge, `for` via a cancellable timer, `prev` seeded from the
 * current registry state at load (no false fire at boot). Schedule/sun triggers belong to B16.
 */
export class AutomationEngine {
  private docs: Rule[] = [];
  private slots = new Map<string, Slot>();
  private index = new Map<string, Slot[]>();
  private broken = new Map<string, string>();
  /** `${id}|${rev}|${reason}` already reported */
  private reported = new Set<string>();
  private site: SiteInfo | null | undefined;
  private readonly clock: Clock;
  private readonly timers: TimerHost;
  private onFire?: (f: RuleFire) => void;
  private unsub?: () => void;

  constructor(private readonly o: AutomationEngineOptions) {
    this.clock = o.clock ?? realClock;
    this.timers = o.timers ?? realTimers;
    this.site = o.site;
    this.onFire = o.onFire;
  }

  setOnFire(fn: ((f: RuleFire) => void) | undefined): void {
    this.onFire = fn;
  }

  /** Subscribe to registry changes. */
  attach(): () => void {
    this.unsub?.();
    this.unsub = this.o.registry.onChange((c) => this.handleChange(c));
    return () => this.detach();
  }

  detach(): void {
    this.unsub?.();
    this.unsub = undefined;
  }

  /** Replace the rule set (full snapshot of this hub's rules). Unchanged rules (same id+rev) keep edge/timer state. */
  load(rules: Rule[]): void {
    this.docs = rules;
    this.rebuild();
  }

  setSite(site: SiteInfo | null): void {
    this.site = site;
    this.rebuild();
  }

  /** Re-run compile/broken checks against the current registry (device removed / properties changed). */
  refresh(): void {
    this.rebuild();
  }

  brokenReason(ruleId: string): string | undefined {
    return this.broken.get(ruleId);
  }

  /** compiled & enabled rule ids */
  activeRuleIds(): string[] {
    return [...this.slots.keys()];
  }

  /** compiled rule (for schedule/sun runners) */
  getCompiled(ruleId: string): CompiledRule | undefined {
    return this.slots.get(ruleId)?.compiled;
  }

  stop(): void {
    this.detach();
    for (const s of this.slots.values()) s.timer?.cancel();
    this.slots.clear();
    this.index.clear();
  }

  private rebuild(): void {
    const lookup = (id: string) => this.o.registry.get(id);
    const next = new Map<string, Slot>();
    const nextBroken = new Map<string, string>();
    for (const rule of this.docs) {
      const res = compileRule(rule, lookup, this.site);
      if (!res.ok) {
        nextBroken.set(rule.id, res.reason);
        this.reportBroken(rule, res.reason);
        continue;
      }
      if (!rule.enabled) continue;
      const old = this.slots.get(rule.id);
      if (old && old.compiled.rev === rule.rev && JSON.stringify(old.compiled.rule.trigger) === JSON.stringify(rule.trigger)) {
        old.compiled = res.compiled;
        next.set(rule.id, old);
        continue;
      }
      next.set(rule.id, { compiled: res.compiled, prev: this.seed(res.compiled) });
    }
    for (const [id, s] of this.slots) if (next.get(id) !== s) s.timer?.cancel();
    this.slots = next;
    this.broken = nextBroken;
    this.index = buildIndex(this.slots.values());
  }

  /** `prev` = expression on the current state → a value already true at load does not fire. */
  private seed(c: CompiledRule): boolean {
    const t = c.trigger;
    if (!t || t.changed) return false;
    return t.test(this.value(t.deviceId, t.property));
  }

  private value(deviceId: string, property: string): PropertyValue | undefined {
    return this.o.registry.get(deviceId)?.values[property];
  }

  private reportBroken(rule: Rule, reason: string): void {
    const key = `${rule.id}|${rule.rev}|${reason}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    if (rule.lastResult === 'broken' && rule.brokenReason === reason) return; // already recorded in Firestore
    this.o.log?.warn({ ruleId: rule.id, reason }, 'rule broken');
    try {
      this.o.events?.emit({ type: 'rule.broken', ruleId: rule.id, reason });
    } catch (e) {
      this.o.log?.warn({ err: (e as Error).message }, 'rule.broken event failed');
    }
    const cs = this.o.configStore?.();
    cs?.updateRuleHubFields(rule.id, { lastResult: 'broken', brokenReason: reason }).catch((e) =>
      this.o.log?.warn({ ruleId: rule.id, err: (e as Error).message }, 'rule broken write failed'),
    );
  }

  /** Registry change hook: evaluate only rules indexed on the changed `dev.prop` keys. */
  handleChange(c: RegistryChange): void {
    const deviceId = c.entry.device.id;
    for (const property of c.changed) {
      const list = this.index.get(`${deviceId}.${property}`);
      if (!list) continue;
      const value = c.entry.values[property];
      for (const slot of [...list]) this.evaluate(slot, value);
    }
  }

  private evaluate(slot: Slot, value: PropertyValue | undefined): void {
    const t = slot.compiled.trigger!;
    if (t.changed) {
      this.fire(slot, value);
      return;
    }
    const now = t.test(value);
    const prev = slot.prev;
    slot.prev = now;
    if (!prev && now) {
      if (t.forMs > 0) {
        slot.timer?.cancel();
        slot.timer = this.timers.setTimeout(() => {
          slot.timer = undefined;
          if (this.slots.get(slot.compiled.id) !== slot) return;
          const v = this.value(t.deviceId, t.property);
          if (t.test(v)) this.fire(slot, v);
        }, t.forMs);
      } else {
        this.fire(slot, value);
      }
    } else if (prev && !now && slot.timer) {
      slot.timer.cancel();
      slot.timer = undefined;
    }
  }

  private fire(slot: Slot, value: PropertyValue | undefined): void {
    const { rule, trigger } = slot.compiled;
    const at = this.clock.now();
    const cx: ConditionContext = {
      now: at,
      site: this.site ?? { timezone: DEFAULT_TZ },
      getValue: (d, p) => this.value(d, p),
      ...(this.o.sunTimes ? { sunTimes: this.o.sunTimes } : {}),
    };
    let pass = false;
    try {
      pass = slot.compiled.conditions(cx);
    } catch (e) {
      this.o.log?.warn({ ruleId: rule.id, err: (e as Error).message }, 'condition eval failed');
    }
    if (!pass) {
      this.o.log?.debug?.({ ruleId: rule.id }, 'rule conditions not met');
      return;
    }
    try {
      this.onFire?.({ rule, at, trigger: { deviceId: trigger!.deviceId, property: trigger!.property, value } });
    } catch (e) {
      this.o.log?.warn({ ruleId: rule.id, err: (e as Error).message }, 'rule fire handler failed');
    }
  }
}
