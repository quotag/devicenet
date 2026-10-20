import { describe, expect, it, vi } from 'vitest';
import type { Device, Rule } from '@devicenet/shared';
import { FakeTime } from '../../src/core/clock.js';
import { AutomationEngine, type RuleFire } from '../../src/automation/engine.js';
import { brokenReason, buildIndex, compileRule } from '../../src/automation/compile.js';
import { newId } from '../../src/core/ids.js';
import { makeRule, plugRegistry, TZ } from './helpers.js';
import { makeDevice } from '../core/helpers.js';

function setup(
  initial: Record<string, unknown>,
  rules: (devId: string) => Rule[],
  extra: Partial<ConstructorParameters<typeof AutomationEngine>[0]> = {},
  deviceOver: Partial<Device> = {},
) {
  const time = new FakeTime(Date.UTC(2026, 9, 18, 3, 0)); // 10:00 Asia/Ho_Chi_Minh
  const p = plugRegistry(initial, deviceOver);
  const fires: RuleFire[] = [];
  const engine = new AutomationEngine({ registry: p.registry, clock: time, timers: time, site: { timezone: TZ }, onFire: (f) => fires.push(f), ...extra });
  engine.attach();
  const rs = rules(p.device.id);
  engine.load(rs);
  return { ...p, time, fires, engine, rules: rs };
}

const lowPower = (deviceId: string, forS?: number) =>
  makeRule({ trigger: { type: 'property', deviceId, property: 'power', op: 'lt', value: 5, ...(forS ? { for: forS } : {}) } });

const autoOffRule = (deviceId: string, forS = 60, targetProp = 'state') =>
  makeRule({
    trigger: { type: 'property', deviceId, property: 'power', op: 'lt', value: 5, for: forS },
    actions: [{ type: 'setProperty', deviceId, property: targetProp, value: false }],
  });

describe('AutomationEngine — property triggers (constitution VI)', () => {
  it('fires only on the rising edge', () => {
    const s = setup({ power: 10 }, (d) => [lowPower(d)]);
    s.report({ power: 4 });
    expect(s.fires).toHaveLength(1);
    s.report({ power: 3 }); // still true → no new edge
    s.report({ power: 2 });
    expect(s.fires).toHaveLength(1);
    s.report({ power: 8 }); // false
    s.report({ power: 1 }); // rising again
    expect(s.fires).toHaveLength(2);
    expect(s.fires[1]!.trigger).toEqual({ deviceId: s.device.id, property: 'power', value: 1 });
  });

  it('for=180: 4 W↔6 W oscillation never fires; stable <5 W for 180 s fires exactly once (spec §8)', () => {
    const s = setup({ power: 10 }, (d) => [lowPower(d, 180)]);
    for (let i = 0; i < 20; i++) {
      s.report({ power: 4 });
      s.time.advance(60_000);
      s.report({ power: 6 });
      s.time.advance(60_000);
    }
    expect(s.fires).toHaveLength(0);
    expect(s.time.pending()).toBe(0);

    s.report({ power: 4 });
    s.time.advance(179_000);
    s.report({ power: 3 }); // still < 5: does not restart the timer
    expect(s.fires).toHaveLength(0);
    s.time.advance(1_000);
    expect(s.fires).toHaveLength(1);
    s.report({ power: 2 });
    s.time.advance(600_000);
    expect(s.fires).toHaveLength(1);
  });

  it('for timer is cancelled when the expression goes false just before expiry', () => {
    const s = setup({ power: 10 }, (d) => [lowPower(d, 180)]);
    s.report({ power: 4 });
    s.time.advance(179_999);
    s.report({ power: 6 });
    s.time.advance(10_000);
    expect(s.fires).toHaveLength(0);
  });

  it('boot seeding: prev from current state → no fire at load; next real edge fires', () => {
    const s = setup({ power: 2, state: true }, (d) => [
      lowPower(d),
      lowPower(d, 60),
      makeRule({ trigger: { type: 'property', deviceId: d, property: 'state', op: 'eq', value: true } }),
    ]);
    s.time.advance(3_600_000);
    expect(s.fires).toHaveLength(0);
    s.report({ power: 2.5 }); // changed but still true
    expect(s.fires).toHaveLength(0);
    s.report({ power: 9 });
    s.report({ power: 1 });
    expect(s.fires).toHaveLength(1);
    s.time.advance(60_000);
    expect(s.fires).toHaveLength(2);
  });

  it('value unknown at load counts as false → first true report fires', () => {
    const s = setup({}, (d) => [lowPower(d)]);
    s.report({ power: 1 });
    expect(s.fires).toHaveLength(1);
  });

  it('op changed fires on every value change, not at load, not on identical reports', () => {
    const s = setup({ state: false }, (d) => [makeRule({ trigger: { type: 'property', deviceId: d, property: 'state', op: 'changed' } })]);
    expect(s.fires).toHaveLength(0);
    s.report({ state: true });
    s.report({ state: true });
    s.report({ state: false });
    expect(s.fires.map((f) => f.trigger.value)).toEqual([true, false]);
  });

  it('only rules indexed on the changed dev.prop are evaluated', () => {
    const s = setup({ power: 10, voltage: 230 }, (d) => [lowPower(d), makeRule({ trigger: { type: 'property', deviceId: d, property: 'voltage', op: 'gt', value: 240 } })]);
    s.report({ voltage: 250 });
    expect(s.fires.map((f) => f.trigger.property)).toEqual(['voltage']);
  });

  it('conditions are checked at fire time (after for)', () => {
    const s = setup({ power: 10, state: true }, (d) => [
      makeRule({
        trigger: { type: 'property', deviceId: d, property: 'power', op: 'lt', value: 5, for: 10 },
        conditions: { all: [{ type: 'property', deviceId: d, property: 'state', op: 'eq', value: true }] },
      }),
    ]);
    s.report({ power: 1 });
    s.report({ state: false });
    s.time.advance(10_000);
    expect(s.fires).toHaveLength(0);
    // conditions failing does not re-arm until a new edge
    s.report({ state: true });
    s.time.advance(10_000);
    expect(s.fires).toHaveLength(0);
    s.report({ power: 9 });
    s.report({ power: 1 });
    s.time.advance(10_000);
    expect(s.fires).toHaveLength(1);
  });

  it('disabled rules never fire; reload with same rev keeps pending for timer; new rev resets', () => {
    const s = setup({ power: 10 }, (d) => [lowPower(d, 100)]);
    const r = s.rules[0]!;
    s.report({ power: 1 });
    s.time.advance(50_000);
    s.engine.load([{ ...r }]); // same rev → timer kept
    s.time.advance(50_000);
    expect(s.fires).toHaveLength(1);

    s.report({ power: 9 });
    s.report({ power: 1 });
    s.engine.load([{ ...r, rev: 2 }]); // new rev → prev re-seeded (true) and timer cancelled
    s.time.advance(200_000);
    expect(s.fires).toHaveLength(1);

    s.engine.load([{ ...r, rev: 3, enabled: false }]);
    s.report({ power: 9 });
    s.report({ power: 1 });
    s.time.advance(200_000);
    expect(s.fires).toHaveLength(1);
    expect(s.time.pending()).toBe(0);
  });

  it('stop cancels timers and unsubscribes', () => {
    const s = setup({ power: 10 }, (d) => [lowPower(d, 10)]);
    s.report({ power: 1 });
    s.engine.stop();
    expect(s.time.pending()).toBe(0);
    s.report({ power: 9 });
    s.report({ power: 1 });
    expect(s.fires).toHaveLength(0);
  });
});

describe('compile + broken rules', () => {
  it('indexes property-triggered rules by dev.prop', () => {
    const { registry, device } = plugRegistry();
    const lookup = (id: string) => registry.get(id);
    const a = compileRule(lowPower(device.id), lookup);
    const b = compileRule(makeRule({ trigger: { type: 'schedule', at: '07:00' } }), lookup);
    expect(a.ok && b.ok).toBe(true);
    const idx = buildIndex([a, b].map((r) => ({ compiled: (r as Extract<typeof r, { ok: true }>).compiled })));
    expect([...idx.keys()]).toEqual([`${device.id}.power`]);
  });

  it('detects removed device, missing property, missing site coordinates', () => {
    const { registry, device } = plugRegistry();
    const lookup = (id: string) => registry.get(id);
    const ghost = newId('dev');
    expect(brokenReason(lowPower(ghost), lookup)).toBe(`device_removed:${ghost}`);
    expect(
      brokenReason(makeRule({ trigger: { type: 'property', deviceId: device.id, property: 'nope', op: 'eq', value: 1 } }), lookup),
    ).toBe(`property_missing:${device.id}.nope`);
    expect(
      brokenReason(makeRule({ trigger: lowPower(device.id).trigger, actions: [{ type: 'setProperty', deviceId: ghost, property: 'state', value: true }] }), lookup),
    ).toBe(`device_removed:${ghost}`);
    const sunCond = makeRule({ trigger: lowPower(device.id).trigger, conditions: { any: [{ type: 'sun', when: 'afterSunset', offsetMin: 0 }] } });
    expect(brokenReason(sunCond, lookup, { timezone: TZ })).toBe('site_missing_coordinates');
    expect(brokenReason(sunCond, lookup, { timezone: TZ, lat: 10.8, lng: 106.7 })).toBeUndefined();
    expect(brokenReason(sunCond, lookup, undefined)).toBeUndefined();
    registry.updateDevice(device.id, { status: 'removed' });
    expect(brokenReason(lowPower(device.id), lookup)).toBe(`device_removed:${device.id}`);
  });

  it('engine reports broken once: lastResult/brokenReason + rule.broken event; does not index it', async () => {
    const emit = vi.fn();
    const updateRuleHubFields = vi.fn(async () => {});
    const ghost = newId('dev');
    const s = setup({ power: 10 }, (d) => [lowPower(d), lowPower(ghost)], {
      events: { emit },
      configStore: () => ({ updateRuleHubFields }) as never,
    });
    const broken = s.rules[1]!;
    expect(emit).toHaveBeenCalledWith({ type: 'rule.broken', ruleId: broken.id, reason: `device_removed:${ghost}` });
    expect(updateRuleHubFields).toHaveBeenCalledWith(broken.id, { lastResult: 'broken', brokenReason: `device_removed:${ghost}` });
    expect(s.engine.brokenReason(broken.id)).toBe(`device_removed:${ghost}`);
    expect(s.engine.activeRuleIds()).toEqual([s.rules[0]!.id]);
    s.engine.load(s.rules);
    s.engine.refresh();
    expect(emit).toHaveBeenCalledTimes(1);
    // already recorded in Firestore → no rewrite
    const e2 = vi.fn();
    const s2 = setup({}, () => [{ ...lowPower(ghost), lastResult: 'broken', brokenReason: `device_removed:${ghost}` }], { events: { emit: e2 } });
    expect(e2).not.toHaveBeenCalled();
    expect(s2.engine.activeRuleIds()).toEqual([]);
  });

  it('refresh after device removal breaks the rule and cancels its timer', () => {
    const emit = vi.fn();
    const s = setup({ power: 10 }, (d) => [lowPower(d, 60)], { events: { emit } });
    s.report({ power: 1 });
    s.registry.remove(s.device.id);
    s.engine.refresh();
    expect(s.time.pending()).toBe(0);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'rule.broken', reason: `device_removed:${s.device.id}` }));
  });

  describe('output target state awareness (current !== target)', () => {
    it('initial load with power=0 and state=true arms timer and fires after 60s', () => {
      const s = setup({ power: 0, state: true }, (d) => [autoOffRule(d, 60)]);
      expect(s.fires).toHaveLength(0);
      s.time.advance(59_000);
      expect(s.fires).toHaveLength(0);
      s.time.advance(1_000);
      expect(s.fires).toHaveLength(1);
      expect(s.fires[0]!.trigger).toEqual({ deviceId: s.device.id, property: 'power', value: 0 });
    });

    it('initial load with state=false (already at target) does not arm timer', () => {
      const s = setup({ power: 0, state: false }, (d) => [autoOffRule(d, 60)]);
      s.time.advance(3_600_000);
      expect(s.fires).toHaveLength(0);
    });

    it('manual turn on (state: false -> true) while power is 0 arms timer and fires after 60s', () => {
      const s = setup({ power: 0, state: false }, (d) => [autoOffRule(d, 60)]);
      expect(s.fires).toHaveLength(0);
      // User manually turns on the switch
      s.report({ state: true });
      s.time.advance(59_000);
      expect(s.fires).toHaveLength(0);
      s.time.advance(1_000);
      expect(s.fires).toHaveLength(1);
    });

    it('manual turn off while timer is running cancels timer', () => {
      const s = setup({ power: 0, state: false }, (d) => [autoOffRule(d, 60)]);
      s.report({ state: true });
      s.time.advance(30_000);
      // User manually turns off the switch at 30s
      s.report({ state: false });
      s.time.advance(60_000);
      expect(s.fires).toHaveLength(0);
    });

    it('power rising >= 5W while timer is running cancels timer', () => {
      const s = setup({ power: 0, state: true }, (d) => [autoOffRule(d, 60)]);
      s.time.advance(30_000);
      // Heavy appliance turns on -> power = 100W
      s.report({ power: 100 });
      s.time.advance(60_000);
      expect(s.fires).toHaveLength(0);
    });

    it('multi-gang switch: action targets state_l2, state_l1 change does not trigger', () => {
      const binProp = (key: string): any => ({ key, label: key, type: 'binary', access: 'rw', category: 'control' });
      const baseDevice = makeDevice();
      const s = setup(
        { power: 0, state_l1: false, state_l2: false },
        (d) => [autoOffRule(d, 60, 'state_l2')],
        {},
        { properties: { ...baseDevice.properties, state_l1: binProp('state_l1'), state_l2: binProp('state_l2') } },
      );
      expect(s.engine.brokenReason(s.rules[0]!.id)).toBeUndefined();
      s.report({ state_l1: true });
      s.time.advance(120_000);
      expect(s.fires).toHaveLength(0);

      s.report({ state_l2: true });
      s.time.advance(60_000);
      expect(s.fires).toHaveLength(1);
    });
  });
});
