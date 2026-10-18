import { CommandAck, topics } from '@devicenet/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeTime } from '../../src/core/clock.js';
import { createHubCore, type HubCore } from '../../src/core/hubCore.js';
import { newId } from '../../src/core/ids.js';
import type { Driver } from '../../src/drivers/Driver.js';
import { buildProperties } from '../../src/drivers/zigbee2mqtt/exposes.js';
import { fromDriverValue, toDriverValue } from '../../src/drivers/zigbee2mqtt/values.js';
import { FakeConfigStore } from '../helpers/fakeConfigStore.js';
import { IDENTITY, IEEE, makeDevice, recordingLink, type Sent } from './helpers.js';

function fakeDriver() {
  return {
    id: 'zigbee2mqtt' as const,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    onDeviceDiscovered: vi.fn(),
    onState: vi.fn(),
    onAvailability: vi.fn(),
    setProperty: vi.fn(async () => {}),
    startPairing: vi.fn(async (_s: number) => {}),
    stopPairing: vi.fn(async () => {}),
    removeDevice: vi.fn(async () => {}),
    rename: vi.fn(async (_e: string, _n: string) => {}),
    ping: vi.fn(async () => {}),
    buildProperties,
    toDriverValue,
    fromDriverValue,
  } satisfies Driver;
}

const env = (cmd: unknown, id = newId('cmd')) => JSON.stringify({ v: 1, id, sentAt: 1, cmd });

describe('CommandProcessor', () => {
  let core: HubCore;
  let driver: ReturnType<typeof fakeDriver>;
  let sent: Sent[];
  let time: FakeTime;
  const dev = makeDevice();
  const cmdTopic = topics.cmd(IDENTITY.tenantId, IDENTITY.hubId);
  const acks = () => sent.filter((s) => s.topic === topics.ack(IDENTITY.tenantId, IDENTITY.hubId)).map((s) => CommandAck.parse(s.json));

  beforeEach(() => {
    driver = fakeDriver();
    sent = [];
    time = new FakeTime(10_000);
    // clock is fake (dedupe window), timers real (guard)
    core = createHubCore({ driver, configStore: () => new FakeConfigStore(), clock: time, guardMs: 100 });
    core.publisher.addLink('local', recordingLink('local', sent));
    core.setIdentity(IDENTITY);
    core.registry.insert(dev, { friendlyName: IEEE });
  });

  it('schema failure with a valid id → ack invalid; no id → dropped', async () => {
    const id = newId('cmd');
    const ack = await core.commands.handle(env({ type: 'pairing.start', seconds: 5 }, id), 'lan');
    expect(ack).toMatchObject({ id, ok: false, error: 'invalid' });
    expect(await core.commands.handle('{"cmd":{}}', 'lan')).toBeNull();
    expect(await core.commands.handle('garbage', 'lan')).toBeNull();
    expect(acks()).toHaveLength(1);
  });

  it('dedupes cmd.id for 60 s across sources', async () => {
    const id = newId('cmd');
    await core.handleMessage(cmdTopic, env({ type: 'device.rename', deviceId: dev.id, name: 'Đèn' }, id), 'lan');
    await core.handleMessage(cmdTopic, env({ type: 'device.rename', deviceId: dev.id, name: 'Đèn' }, id), 'cloud');
    expect(driver.rename).toHaveBeenCalledTimes(1);
    expect(acks()).toHaveLength(1);
    time.advance(60_001);
    await core.handleMessage(cmdTopic, env({ type: 'device.rename', deviceId: dev.id, name: 'Đèn' }, id), 'cloud');
    expect(driver.rename).toHaveBeenCalledTimes(2);
  });

  it('ignores cmd for another hub/tenant', async () => {
    await core.handleMessage(topics.cmd(IDENTITY.tenantId, newId('hub')), env({ type: 'state.republish' }), 'cloud');
    expect(acks()).toHaveLength(0);
  });

  it('device.rename → Z2M description (OQ-1), registry name updated; unknown device → not_found', async () => {
    const ack = await core.commands.handle(env({ type: 'device.rename', deviceId: dev.id, name: 'Ổ phòng khách' }));
    expect(ack).toMatchObject({ ok: true });
    expect(driver.rename).toHaveBeenCalledWith(IEEE, 'Ổ phòng khách');
    expect(core.registry.get(dev.id)!.device.name).toBe('Ổ phòng khách');
    const nf = await core.commands.handle(env({ type: 'device.rename', deviceId: newId('dev'), name: 'x' }));
    expect(nf).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('driver slower than the guard → ack timeout', async () => {
    driver.rename.mockImplementation(() => new Promise((r) => setTimeout(r, 400)));
    const ack = await core.commands.handle(env({ type: 'device.rename', deviceId: dev.id, name: 'x' }));
    expect(ack).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('driver error → mapped ack', async () => {
    driver.rename.mockRejectedValueOnce(new Error('z2m request device/options timed out'));
    expect(await core.commands.handle(env({ type: 'device.rename', deviceId: dev.id, name: 'x' }))).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('state.republish → republishes retained topics', async () => {
    const before = sent.length;
    const ack = await core.commands.handle(env({ type: 'state.republish' }));
    expect(ack?.ok).toBe(true);
    expect(sent.slice(before).some((s) => s.topic === topics.state(IDENTITY.tenantId, IDENTITY.hubId, dev.id))).toBe(true);
  });

  it('config.resync calls the sync hook when wired', async () => {
    expect(await core.commands.handle(env({ type: 'config.resync' }))).toMatchObject({ ok: true, message: 'no_sync' });
    const hook = vi.fn(async () => {});
    core.setConfigResync(hook);
    expect(await core.commands.handle(env({ type: 'config.resync' }))).toMatchObject({ ok: true });
    expect(hook).toHaveBeenCalledOnce();
  });

  it('B15: unknown scene → not_found; invalid actions.test → invalid', async () => {
    expect(await core.commands.handle(env({ type: 'scene.run', sceneId: newId('scn') }))).toMatchObject({ ok: false, error: 'not_found' });
    expect(await core.commands.handle(env({ type: 'actions.test', actions: [{}] }))).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('pairing.* serialized: concurrent second start → busy with current expiresAt', async () => {
    let release!: () => void;
    driver.startPairing.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const a = core.commands.handle(env({ type: 'pairing.start', seconds: 60 }));
    const b = core.commands.handle(env({ type: 'pairing.start', seconds: 60 }));
    await new Promise((r) => setTimeout(r, 10));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toMatchObject({ ok: true, result: { expiresAt: 10_000 + 60_000 } });
    expect(rb).toMatchObject({ ok: false, error: 'busy', result: { expiresAt: 70_000 } });
    expect(driver.startPairing).toHaveBeenCalledTimes(1);
    core.stop();
  });

  it('every ack is a valid CommandAck on the ack topic with QoS1, no retain', async () => {
    await core.commands.handle(env({ type: 'state.republish' }));
    const s = sent.find((x) => x.topic === topics.ack(IDENTITY.tenantId, IDENTITY.hubId))!;
    expect(s.opts).toEqual({ qos: 1, retain: false });
    expect(() => CommandAck.parse(s.json)).not.toThrow();
  });
});
