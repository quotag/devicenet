import { DeviceState, HubEvent, topics } from '@devicenet/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Registry } from '../../src/core/registry.js';
import { SetQueue } from '../../src/core/setQueue.js';
import type { HubEventBody } from '../../src/core/events.js';
import { fromDriverValue } from '../../src/drivers/zigbee2mqtt/values.js';
import { IDENTITY, IEEE, makeDevice, until } from './helpers.js';
import { connectClient } from '../helpers/brokers.js';
import { startStack, type Stack } from './stack.js';

function unit() {
  const registry = new Registry();
  const dev = makeDevice();
  registry.insert(dev, { friendlyName: IEEE });
  const rejected: HubEventBody[] = [];
  const driver = { setProperty: vi.fn(async () => {}) };
  const q = new SetQueue({ registry, driver, events: { emit: (b) => (rejected.push(b), null) }, confirmTimeoutMs: 50 });
  return { registry, dev, rejected, driver, q };
}

describe('SetQueue (unit)', () => {
  it.each([
    ['invalid json', '{nope', 'invalid_json'],
    ['empty values', { values: {} }, 'invalid_payload'],
    ['unknown key', { values: { foo: 1 } }, 'unknown_property:foo'],
    ['read-only key', { values: { power: 5 } }, 'not_writable:power'],
    ['wrong type', { values: { state: 'ON' } }, 'invalid_value:state'],
    ['bad enum', { values: { power_on_behavior: 'maybe' } }, 'invalid_value:power_on_behavior'],
  ])('%s → set.rejected, whole message dropped', async (_n, payload, reason) => {
    const { q, dev, rejected, driver } = unit();
    const body = typeof payload === 'string' ? payload : { v: 1, ...payload };
    const r = await q.handle(dev.id, body);
    expect(r.ok).toBe(false);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ type: 'set.rejected', deviceId: dev.id });
    expect((rejected[0] as { reason: string }).reason.startsWith(reason)).toBe(true);
    expect(driver.setProperty).not.toHaveBeenCalled();
  });

  it('one invalid key rejects the whole message (valid keys not sent)', async () => {
    const { q, dev, driver } = unit();
    const r = await q.handle(dev.id, { values: { state: true, power: 1 } });
    expect(r).toEqual({ ok: false, reason: 'not_writable:power' });
    expect(driver.setProperty).not.toHaveBeenCalled();
  });

  it('unknown device → not_found', async () => {
    const { q, rejected } = unit();
    const other = makeDevice().id;
    expect(await q.handle(other, { values: { state: true } })).toEqual({ ok: false, reason: 'not_found' });
    expect(rejected[0]).toMatchObject({ deviceId: other });
  });

  it('offline device → device_offline immediately, queue not blocked', async () => {
    const { q, dev, registry, driver } = unit();
    registry.setOnline(dev.id, false);
    const t0 = Date.now();
    expect(await q.handle(dev.id, { values: { state: true } })).toEqual({ ok: false, reason: 'device_offline' });
    expect(Date.now() - t0).toBeLessThan(1000);
    registry.setOnline(dev.id, true);
    const r = await q.handle(dev.id, { values: { state: true } });
    expect(r.ok).toBe(true);
    expect(driver.setProperty).toHaveBeenCalledTimes(1);
  });

  it('runs sets of one device sequentially, each waiting for its confirming state', async () => {
    const { q, dev, registry, driver } = unit();
    const order: string[] = [];
    driver.setProperty.mockImplementation(async (_e: string, _k: string, v: unknown) => {
      order.push(`send:${v}`);
      setTimeout(() => registry.applyState(dev.id, { state: v ? 'ON' : 'OFF' }, fromDriverValue), 10);
    });
    const a = q.handle(dev.id, { values: { state: true } });
    const b = q.handle(dev.id, { values: { state: false } });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual({ ok: true, confirmed: true });
    expect(rb).toEqual({ ok: true, confirmed: true });
    expect(order).toEqual(['send:true', 'send:false']);
    expect(registry.get(dev.id)!.values.state).toBe(false);
  });

  it('never publishes a synthetic state: unconfirmed set times out, value unchanged', async () => {
    const { q, dev, registry } = unit();
    registry.applyState(dev.id, { state: 'OFF' }, fromDriverValue);
    const r = await q.handle(dev.id, { values: { state: true } });
    expect(r).toEqual({ ok: true, confirmed: false });
    expect(registry.get(dev.id)!.values.state).toBe(false);
  });
});

describe('SetQueue + mock Z2M (§8 edge cases)', () => {
  let s: Stack;
  afterEach(async () => s?.close());

  const devStart = async () => {
    const dev = makeDevice();
    s = await startStack({ before: (core) => core.registry.insert(dev, { friendlyName: IEEE }) });
    await until(() => {
      s.mock.reportState(IEEE, {}); // initial mock state is not retained → re-report until the driver maps the name
      return Object.keys(s.core.registry.get(dev.id)!.values).length > 0;
    });
    return dev;
  };

  it('set true then false within 100 ms → device ends false, states arrive in increasing seq', async () => {
    const dev = await devStart();
    const stateTopic = topics.state(IDENTITY.tenantId, IDENTITY.hubId, dev.id);
    s.mock.reportState(IEEE, { state: 'OFF' });
    await until(() => s.core.registry.get(dev.id)!.values.state === false);
    await new Promise((r) => setTimeout(r, 1100)); // let the throttle window pass
    const spy = await connectClient(s.broker.url);
    await spy.subscribe('zigbee2mqtt/+/set');
    const before = s.sent.length;
    const setTopic = topics.set(IDENTITY.tenantId, IDENTITY.hubId, dev.id);
    const p1 = s.core.handleMessage(setTopic, JSON.stringify({ v: 1, values: { state: true } }), 'lan');
    await new Promise((r) => setTimeout(r, 50));
    const p2 = s.core.handleMessage(setTopic, JSON.stringify({ v: 1, values: { state: false } }), 'cloud');
    await Promise.all([p1, p2]);
    await until(() => {
      const last = s.sent.slice(before).filter((m) => m.topic === stateTopic).at(-1);
      return last?.json.values.state === false && s.mock.devices.get(IEEE)!.state.state === 'OFF';
    });
    const states = s.sent.slice(before).filter((m) => m.topic === stateTopic).map((m) => DeviceState.parse(m.json));
    expect(states.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < states.length; i++) expect(states[i]!.seq).toBeGreaterThan(states[i - 1]!.seq);
    expect(states.at(-1)!.values.state).toBe(false);
    expect(s.mock.devices.get(IEEE)!.state.state).toBe('OFF');
    expect(spy.messages.map((m) => (m.json as { state: string }).state)).toEqual(['ON', 'OFF']);
    await spy.close();
  });

  it('set to an offline device → events set.rejected reason=device_offline within 1 s', async () => {
    const dev = await devStart();
    s.mock.setOffline(IEEE, true);
    await until(() => s.core.registry.get(dev.id)!.online === false);
    const t0 = Date.now();
    await s.core.handleMessage(topics.set(IDENTITY.tenantId, IDENTITY.hubId, dev.id), JSON.stringify({ values: { state: true } }), 'cloud');
    const ev = s.sent.find((m) => m.topic === topics.events(IDENTITY.tenantId, IDENTITY.hubId) && m.json.type === 'set.rejected');
    expect(ev).toBeDefined();
    expect(Date.now() - t0).toBeLessThan(1000);
    const parsed = HubEvent.parse(ev!.json);
    expect(parsed).toMatchObject({ type: 'set.rejected', deviceId: dev.id, reason: 'device_offline', hubId: IDENTITY.hubId });
    expect(s.store.events.get(parsed.id)).toBeDefined();
  });
});
