import type { Device, PropertyValue, Rule, Scene } from '@devicenet/shared';
import { compare, compileConditions, leafConditions, type Predicate, type SiteInfo } from './conditions.js';

/** Registry view used at compile time. */
export type DeviceLookup = (deviceId: string) => { device: Device } | undefined;

export const propKey = (deviceId: string, property: string): string => `${deviceId}.${property}`;

export interface CompiledPropertyTrigger {
  key: string;
  deviceId: string;
  property: string;
  /** op "changed": fire on every value change */
  changed: boolean;
  /** expression on the live value (always false for `changed`) */
  test: (v: PropertyValue | undefined) => boolean;
  /** `for` in ms (0 = immediate) */
  forMs: number;
}

export interface CompiledRule {
  rule: Rule;
  id: string;
  rev: number;
  /** null for schedule/sun triggers (B16 owns them) */
  trigger: CompiledPropertyTrigger | null;
  conditions: Predicate;
}

export type CompileResult = { ok: true; compiled: CompiledRule } | { ok: false; reason: string };

const MAX_REASON = 200;

/**
 * Broken detection (FR-H08): a referenced device is removed/unknown, a referenced property is missing,
 * or a sun trigger/condition is used while the site has no coordinates. Returns the reason or undefined.
 * `site` undefined = not known yet → coordinate check skipped.
 */
export function brokenReason(
  doc: Pick<Rule, 'trigger' | 'conditions' | 'actions'> | Pick<Scene, 'actions'>,
  lookup: DeviceLookup,
  site?: SiteInfo | null,
): string | undefined {
  const refs: Array<[string, string]> = [];
  let usesSun = false;
  if ('trigger' in doc) {
    if (doc.trigger.type === 'property') refs.push([doc.trigger.deviceId, doc.trigger.property]);
    if (doc.trigger.type === 'sun') usesSun = true;
  }
  if ('conditions' in doc) {
    for (const c of leafConditions(doc.conditions)) {
      if (c.type === 'property') refs.push([c.deviceId, c.property]);
      if (c.type === 'sun') usesSun = true;
    }
  }
  for (const a of doc.actions) if (a.type === 'setProperty') refs.push([a.deviceId, a.property]);

  for (const [deviceId, property] of refs) {
    const e = lookup(deviceId);
    if (!e || e.device.status === 'removed') return `device_removed:${deviceId}`.slice(0, MAX_REASON);
    if (!(property in e.device.properties)) return `property_missing:${deviceId}.${property}`.slice(0, MAX_REASON);
  }
  if (usesSun && site !== undefined && (site === null || site.lat === undefined || site.lng === undefined)) return 'site_missing_coordinates';
  return undefined;
}

/** Compile a rule into closures. Broken rules are reported, never compiled. */
export function compileRule(rule: Rule, lookup: DeviceLookup, site?: SiteInfo | null): CompileResult {
  const reason = brokenReason(rule, lookup, site);
  if (reason) return { ok: false, reason };
  let trigger: CompiledPropertyTrigger | null = null;
  const t = rule.trigger;
  if (t.type === 'property') {
    const changed = t.op === 'changed';
    const op = t.op;
    trigger = {
      key: propKey(t.deviceId, t.property),
      deviceId: t.deviceId,
      property: t.property,
      changed,
      test: op === 'changed' ? () => false : (v) => compare(op, v, t.value),
      forMs: changed ? 0 : (t.for ?? 0) * 1000,
    };
  }
  return { ok: true, compiled: { rule, id: rule.id, rev: rule.rev, trigger, conditions: compileConditions(rule.conditions) } };
}

/** Index property-triggered rules by `"dev.prop"`. */
export function buildIndex<T extends { compiled: CompiledRule }>(items: Iterable<T>): Map<string, T[]> {
  const idx = new Map<string, T[]>();
  for (const it of items) {
    const k = it.compiled.trigger?.key;
    if (!k) continue;
    const list = idx.get(k);
    if (list) list.push(it);
    else idx.set(k, [it]);
  }
  return idx;
}
