import { Device, HubEvent, PairingState, topics } from '@devicenet/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeTime } from '../../src/core/clock.js';
import { PairingManager, pickPrimaryProperty, pickToggleProperty } from '../../src/core/pairing.js';
import { Publisher } from '../../src/core/publisher.js';
import { Registry } from '../../src/core/registry.js';
import { buildProperties } from '../../src/drivers/zigbee2mqtt/exposes.js';
import { FakeConfigStore } from '../helpers/fakeConfigStore.js';
import { IDENTITY, fixtureDevice, recordingLink, until, type Sent } from './helpers.js';
import { startStack, type Stack } from './stack.js';

const pairingTopic = topics.pairing(IDENTITY.tenantId, IDENTITY.hubId);

function unit(opts: { claimed?: boolean; cloud?: boolean } = {}) {
  const t = new FakeTime(5_000);
  const registry = new Registry({ clock: t });
  const publisher = new Publisher({ registry, clock: t, timers: t });
  const sent: Sent[] = [];
  publisher.addLink('local', recordingLink('local', sent));
  if (opts.claimed !== false) publisher.setIdentity(IDENTITY);
  const driver = {
    startPairing: vi.fn(async () => {}),
    stopPairing: vi.fn(async () => {}),
    ping: vi.fn(async () => {}),
    buildProperties,
  };
  const cfg = new FakeConfigStore();
  const pm = new PairingManager({
    driver,
    registry,
    publisher,
    events: { emit: () => null },
    configStore: () => (opts.cloud === false ? null : cfg),
    clock: t,
    timers: t,
  });
  const pairings = () => sent.filter((s) => s.topic === pairingTopic).map((s) => PairingState.parse(s.json));
  return { t, pm, driver, pairings };
}

describe('PairingManager (unit)', () => {
  it('start → permit_join + retained {active, startedAt, expiresAt}; expiry → {active:false} + permit_join 0', async () => {
    const { t, pm, driver, pairings } = unit();
    expect(await pm.start(120)).toEqual({ ok: true, result: { expiresAt: 125_000 } });
    expect(driver.startPairing).toHaveBeenCalledWith(120);
    expect(pairings().at(-1)).toMatchObject({ active: true, startedAt: 5_000, expiresAt: 125_000, found: [] });
    t.advance(119_999);
    expect(pairings().at(-1)!.active).toBe(true);
    t.advance(1);
    await Promise.resolve();
    expect(pairings().at(-1)).toMatchObject({ active: false });
    expect(driver.stopPairing).toHaveBeenCalledTimes(1);
  });

  it('start while active → busy with current expiresAt', async () => {
    const { pm, driver } = unit();
    await pm.start(60);
    expect(await pm.start(100)).toEqual({ ok: false, error: 'busy', result: { expiresAt: 65_000 } });
    expect(driver.startPairing).toHaveBeenCalledTimes(1);
  });

  it('stop → {active:false} and permit_join 0', async () => {
    const { pm, driver, pairings } = unit();
    await pm.start(60);
    expect(await pm.stop()).toEqual({ ok: true });
    expect(pairings().at(-1)!.active).toBe(false);
    expect(driver.stopPairing).toHaveBeenCalled();
    expect(pm.isActive).toBe(false);
  });

  it.each([{ claimed: false }, { cloud: false }])('refused without claim/cloud (D-12): %o', async (o) => {
    const { pm, driver } = unit(o);
    const r = await pm.start(60);
    expect(r.ok).toBe(false);
    expect(driver.startPairing).not.toHaveBeenCalled();
  });

  it('driver failure → error ack, stays idle', async () => {
    const { pm, driver } = unit();
    driver.startPairing.mockRejectedValueOnce(new Error('z2m request permit_join timed out'));
    expect(await pm.start(60)).toMatchObject({ ok: false, error: 'timeout' });
    expect(pm.isActive).toBe(false);
  });

  it('primary/toggle property selection', () => {
    const props = buildProperties(fixtureDevice.definition.exposes);
    expect(pickPrimaryProperty(props)).toBe('power');
    expect(pickToggleProperty(props)).toBe('state');
    expect(pickPrimaryProperty({})).toBeUndefined();
  });
});

describe('Pairing + mock Z2M', () => {
  let s: Stack;
  afterEach(async () => s?.close());

  const NEW_IEEE = '0xa4c1380000000042';
  const eventsOf = (type: string) =>
    s.sent.filter((m) => m.topic === topics.events(IDENTITY.tenantId, IDENTITY.hubId) && m.json.type === type).map((m) => HubEvent.parse(m.json));

  it('interview → Device created (status new) in store, friendly_name = dev id, device.found, found += id, initial state', async () => {
    s = await startStack({ withDevice: false });
    const ack = await s.core.pairing.start(60);
    expect(ack.ok).toBe(true);
    expect(s.mock.permitJoinTime).toBe(60);
    s.mock.emitInterview(NEW_IEEE);
    await until(() => s.cfg.devices.size === 1);
    const doc = Device.parse([...s.cfg.devices.values()][0]);
    expect(doc).toMatchObject({
      status: 'new',
      externalId: NEW_IEEE,
      hubId: IDENTITY.hubId,
      siteId: IDENTITY.siteId,
      roomId: null,
      icon: 'plug',
      primaryProperty: 'power',
      toggleProperty: 'state',
      model: fixtureDevice.definition.model,
    });
    expect(doc.name).toBe(fixtureDevice.description || fixtureDevice.definition.model);
    expect(Object.keys(doc.properties)).toContain('state');
    // Z2M friendly_name renamed to the device id
    await until(() => s.mock.devices.get(NEW_IEEE)!.info.friendly_name === doc.id);
    expect(s.core.registry.get(doc.id)!.synced).toBe(true);
    await until(() => eventsOf('device.found').length === 1);
    expect(eventsOf('device.found')[0]).toMatchObject({ deviceId: doc.id, model: doc.model });
    await until(() => s.sent.some((m) => m.topic === pairingTopic && m.json.found?.includes(doc.id)));
    // initial state with values (via /get)
    const stateTopic = topics.state(IDENTITY.tenantId, IDENTITY.hubId, doc.id);
    await until(() => s.sent.some((m) => m.topic === stateTopic && m.json?.values?.state !== undefined));
    await s.core.pairing.stop();
    expect(s.mock.permitJoinTime).toBe(0);
  });

  it('Firestore offline during pairing → registry still has the device (synced=0), pairing.found still emitted', async () => {
    s = await startStack({ withDevice: false });
    await s.core.pairing.start(60);
    s.cfg.createDevice = async () => {
      throw new Error('unavailable');
    };
    s.mock.emitInterview(NEW_IEEE);
    await until(() => s.core.registry.getByExternalId(NEW_IEEE) !== undefined);
    const e = s.core.registry.getByExternalId(NEW_IEEE)!;
    await until(() => s.sent.some((m) => m.topic === pairingTopic && m.json.found?.includes(e.device.id)));
    expect(e.synced).toBe(false);
    expect(s.store.devices.unsynced().map((r) => r.id)).toEqual([e.device.id]);
    expect(s.cfg.devices.size).toBe(0);
  });

  it('recovery: device present in Z2M but unknown to registry → created at start (status new)', async () => {
    s = await startStack({ withDevice: true });
    await until(() => s.cfg.devices.size === 1);
    expect([...s.cfg.devices.values()][0]).toMatchObject({ status: 'new', externalId: fixtureDevice.ieee_address });
  });

  it('re-pair during active window: known device with old hub/site identity is migrated, recreated in store (status new), and added to pairing.found', async () => {
    s = await startStack({ withDevice: false });
    const oldDev = Device.parse({
      id: 'dev_01M5A000000000000000000001',
      hubId: 'hub_01M5A000000000000000000001',
      siteId: 'site_01M5A000000000000000000001',
      roomId: null,
      driver: 'zigbee2mqtt',
      externalId: NEW_IEEE,
      name: 'Old Plug',
      icon: 'plug',
      properties: buildProperties(fixtureDevice.definition.exposes),
      status: 'active',
      createdAt: 1000,
      updatedAt: 1000,
    });
    s.core.registry.insert(oldDev, { friendlyName: oldDev.id, synced: true });

    const ack = await s.core.pairing.start(60);
    expect(ack.ok).toBe(true);

    s.mock.emitInterview(NEW_IEEE);

    await until(() => s.cfg.devices.size === 1);
    const doc = Device.parse([...s.cfg.devices.values()][0]);
    expect(doc.id).toBe(oldDev.id);
    expect(doc.hubId).toBe(IDENTITY.hubId);
    expect(doc.siteId).toBe(IDENTITY.siteId);
    expect(doc.status).toBe('new');

    await until(() => s.sent.some((m) => m.topic === pairingTopic && m.json.found?.includes(oldDev.id)));
    await until(() => eventsOf('device.found').length === 1);
  });

  it('unclaimed hub: no device creation, nothing published', async () => {
    s = await startStack({ withDevice: true, claimed: false });
    await new Promise((r) => setTimeout(r, 300));
    expect(s.core.registry.size).toBe(0);
    expect(s.sent).toHaveLength(0);
    expect((await s.core.pairing.start(60)).ok).toBe(false);
  });

  it('re-pair after removal: device was deleted, interview creates new device without UNIQUE constraint failure', async () => {
    s = await startStack({ withDevice: false });
    await s.core.pairing.start(60);
    s.mock.emitInterview(NEW_IEEE);
    await until(() => s.cfg.devices.size === 1);
    const firstDevId = [...s.cfg.devices.values()][0].id;
    await s.core.pairing.stop();

    await s.core.lifecycle.removeDevice(firstDevId, true);
    expect(s.core.registry.get(firstDevId)).toBeUndefined();
    expect(s.store.devices.get(firstDevId)?.doc.status).toBe('removed');

    // Start pairing again and emit interview for the same IEEE
    await s.core.pairing.start(60);
    s.mock.emitInterview(NEW_IEEE);
    await until(() => s.core.registry.getByExternalId(NEW_IEEE) !== undefined);
    const newEntry = s.core.registry.getByExternalId(NEW_IEEE)!;
    expect(newEntry.device.id).not.toBe(firstDevId);
    expect(newEntry.device.status).toBe('new');
    expect(s.core.registry.get(newEntry.device.id)).toBeDefined();
    expect(s.store.devices.get(newEntry.device.id)?.doc.status).toBe('new');
    expect(s.store.devices.get(firstDevId)).toBeUndefined();
    await until(() => s.sent.some((m) => m.topic === pairingTopic && m.json.found?.includes(newEntry.device.id)));
  });

  it('pairing starts with already-known interviewed device unknown to registry → immediately discovered', async () => {
    s = await startStack({ withDevice: false });
    s.mock.emitInterview(NEW_IEEE);
    await until(() => s.driver.knownDevices().some((d) => d.externalId === NEW_IEEE));

    await s.core.pairing.start(60);
    await until(() => s.core.registry.getByExternalId(NEW_IEEE) !== undefined);
    const entry = s.core.registry.getByExternalId(NEW_IEEE)!;
    expect(entry.device.status).toBe('new');
    await until(() => s.sent.some((m) => m.topic === pairingTopic && m.json.found?.includes(entry.device.id)));
  });
});
