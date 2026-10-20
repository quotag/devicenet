import { CommandAck, HubEvent, topics, type Rule, type Scene } from '@devicenet/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/core/ids.js';
import { IDENTITY, IEEE, makeDevice, until } from './helpers.js';
import { startStack, type Stack } from './stack.js';

const cmdTopic = topics.cmd(IDENTITY.tenantId, IDENTITY.hubId);
const env = (cmd: unknown) => JSON.stringify({ v: 1, id: newId('cmd'), sentAt: 1, cmd });

describe('device lifecycle (mock Z2M)', () => {
  let s: Stack;
  afterEach(async () => s?.close());

  const start = async () => {
    const dev = makeDevice();
    s = await startStack({ before: (core) => core.registry.insert(dev, { friendlyName: IEEE, synced: true }) });
    s.cfg.devices.set(dev.id, dev);
    await until(() => {
      s.mock.reportState(IEEE, {});
      return Object.keys(s.core.registry.get(dev.id)!.values).length > 0;
    });
    return dev;
  };
  const events = (type: string) =>
    s.sent.filter((m) => m.topic === topics.events(IDENTITY.tenantId, IDENTITY.hubId) && m.json.type === type).map((m) => HubEvent.parse(m.json));
  const acks = () => s.sent.filter((m) => m.topic === topics.ack(IDENTITY.tenantId, IDENTITY.hubId)).map((m) => CommandAck.parse(m.json));

  it('availability changes emit device.offline/online once and update state.online', async () => {
    const dev = await start();
    s.mock.setOffline(IEEE, true);
    await until(() => !s.core.registry.get(dev.id)!.online);
    s.mock.setOffline(IEEE, true); // repeat → no new event
    await new Promise((r) => setTimeout(r, 100));
    expect(events('device.offline')).toHaveLength(1);
    s.mock.setOffline(IEEE, false);
    await until(() => s.core.registry.get(dev.id)!.online);
    expect(events('device.online')).toHaveLength(1);
  });

  it('device.ping acks ok; unknown device → not_found', async () => {
    const dev = await start();
    await s.core.handleMessage(cmdTopic, env({ type: 'device.ping', deviceId: dev.id }), 'lan');
    await s.core.handleMessage(cmdTopic, env({ type: 'device.ping', deviceId: newId('dev') }), 'lan');
    const a = acks();
    expect(a[0]).toMatchObject({ ok: true });
    expect(a[1]).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('device.remove: Z2M removed, status removed, retained state cleared, rules/scenes broken', async () => {
    const dev = await start();
    const other = newId('dev');
    const base = { siteId: IDENTITY.siteId, hubId: IDENTITY.hubId, rev: 1, updatedAt: 1 };
    const setAct = (deviceId: string) => ({ type: 'setProperty' as const, deviceId, property: 'state', value: true });
    const scene = { ...base, id: newId('scn'), name: 's', actions: [setAct(dev.id)] } as unknown as Scene;
    const sceneOk = { ...base, id: newId('scn'), name: 'ok', actions: [setAct(other)] } as unknown as Scene;
    const mk = (name: string, actions: unknown[]) =>
      ({ ...base, id: newId('rule'), name, enabled: true, trigger: { type: 'schedule', at: '07:00' }, actions }) as unknown as Rule;
    const ruleDirect = mk('direct', [setAct(dev.id)]);
    const ruleViaScene = mk('via', [{ type: 'runScene', sceneId: scene.id }]);
    const ruleOk = mk('ok', [setAct(other)]);
    s.cfg.setScene(scene);
    s.cfg.setScene(sceneOk);
    for (const r of [ruleDirect, ruleViaScene, ruleOk]) s.cfg.setRule(r);

    await s.core.handleMessage(cmdTopic, env({ type: 'device.remove', deviceId: dev.id, force: true }), 'cloud');
    expect(acks().at(-1)).toMatchObject({ ok: true });
    expect(s.mock.devices.has(IEEE)).toBe(false);
    expect(s.core.registry.get(dev.id)).toBeUndefined();
    const fd = s.cfg.devices.get(dev.id)!;
    expect(fd.status).toBe('removed');
    expect(typeof fd.removedAt).toBe('number');
    const clear = s.sent.filter((m) => m.topic === topics.state(IDENTITY.tenantId, IDENTITY.hubId, dev.id)).at(-1)!;
    expect(clear.payload.length).toBe(0);
    expect(clear.opts.retain).toBe(true);
    expect(events('device.removed')).toHaveLength(1);
    expect(s.cfg.scenes.get(scene.id)!.brokenReason).toBeTruthy();
    expect(s.cfg.scenes.get(sceneOk.id)!.brokenReason).toBeUndefined();
    expect(s.cfg.rules.get(ruleDirect.id)).toMatchObject({ lastResult: 'broken' });
    expect(s.cfg.rules.get(ruleViaScene.id)).toMatchObject({ lastResult: 'broken' });
    expect(s.cfg.rules.get(ruleOk.id)!.brokenReason).toBeUndefined();
    expect(events('rule.broken')).toHaveLength(2);
    // row kept in SQLite as removed; not loaded on restart
    expect(s.store.devices.all().find((r) => r.id === dev.id)?.doc.status).toBe('removed');
  });

  it('device.remove on unknown device → not_found', async () => {
    await start();
    await s.core.handleMessage(cmdTopic, env({ type: 'device.remove', deviceId: newId('dev'), force: false }), 'cloud');
    expect(acks().at(-1)).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('device.remove succeeds even when device does not exist in Z2M (already left)', async () => {
    const dev = await start();
    s.mock.devices.delete(IEEE);
    await s.core.handleMessage(cmdTopic, env({ type: 'device.remove', deviceId: dev.id, force: true }), 'cloud');
    expect(acks().at(-1)).toMatchObject({ ok: true });
    expect(s.core.registry.get(dev.id)).toBeUndefined();
    expect(s.cfg.devices.get(dev.id)!.status).toBe('removed');
  });

  it('startup recovery: Z2M device without registry entry → created with status new', async () => {
    s = await startStack({ withDevice: true, claimed: false });
    await until(() => s.driver.knownDevices().length > 0);
    expect(s.core.registry.size).toBe(0);
    s.core.setIdentity(IDENTITY);
    await until(() => s.core.registry.size === 1);
    const e = s.core.registry.all()[0]!;
    expect(e.device.status).toBe('new');
    expect(e.device.externalId).toBe(s.driver.knownDevices()[0]!.externalId);
    await until(() => s.cfg.devices.has(e.device.id));
  });
});
