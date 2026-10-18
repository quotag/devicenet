import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startBroker, connectClient, type TestBroker, type TestClient } from '../helpers/brokers.js';
import { MockZ2m } from '../mock-z2m/index.js';
import { Zigbee2mqttDriver } from '../../src/drivers/zigbee2mqtt/driver.js';
import type { DiscoveredDevice } from '../../src/drivers/Driver.js';

const IEEE = '0xa4c138f1b2c3d4e5';
const until = async (fn: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('until timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('Zigbee2mqttDriver + mock Z2M', () => {
  let broker: TestBroker;
  let mock: MockZ2m;
  let driver: Zigbee2mqttDriver;
  let spy: TestClient;
  const found: DiscoveredDevice[] = [];
  const states: Array<[string, Record<string, unknown>]> = [];
  const avail: Array<[string, boolean]> = [];

  beforeEach(async () => {
    found.length = 0;
    states.length = 0;
    avail.length = 0;
    broker = await startBroker();
    mock = new MockZ2m({ url: broker.url, latencyMs: 5 });
    driver = new Zigbee2mqttDriver({ url: broker.url, requestTimeoutMs: 500 });
    driver.onDeviceDiscovered((d) => found.push(d));
    driver.onState((id, raw) => states.push([id, raw]));
    driver.onAvailability((id, o) => avail.push([id, o]));
    spy = await connectClient(broker.url);
    await spy.subscribe('zigbee2mqtt/#');
    await mock.start();
    await driver.start();
    // retained bridge/devices arrives on subscribe
    await until(() => found.length > 0);
  });

  afterEach(async () => {
    await driver.stop();
    await mock.stop();
    await spy.close();
    await broker.close();
  });

  it('discovers the TS011F from bridge/devices (coordinator skipped)', () => {
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ externalId: IEEE, model: 'TS011F_plug_1', vendor: 'Tuya', interviewed: true });
    expect(driver.buildProperties(found[0]!.exposes).state?.access).toBe('rw');
  });

  it('delivers state and availability callbacks', async () => {
    mock.reportState(IEEE, { power: 33.3 });
    await until(() => states.some(([, s]) => s.power === 33.3));
    expect(states.at(-1)![0]).toBe(IEEE);
    mock.setOffline(IEEE, true);
    await until(() => avail.some(([, o]) => o === false));
    mock.setOffline(IEEE, false);
    await until(() => avail.at(-1)?.[1] === true);
  });

  it('set round-trips through <fn>/set and the echoed state', async () => {
    const prop = driver.buildProperties(found[0]!.exposes).state!;
    await driver.setProperty(IEEE, 'state', false, prop);
    await spy.waitFor('zigbee2mqtt/' + IEEE + '/set', (m) => (m.json as any)?.state === 'OFF');
    await until(() => states.some(([, s]) => s.state === 'OFF'));
    expect(driver.fromDriverValue(prop, states.at(-1)![1].state)).toBe(false);
  });

  it('startPairing sends permit_join and resolves on the response', async () => {
    await driver.startPairing(120);
    expect(mock.permitJoinTime).toBe(120);
    expect(mock.requests.at(-1)).toMatchObject({ path: 'permit_join', payload: { time: 120 } });
    await driver.stopPairing();
    expect(mock.permitJoinTime).toBe(0);
  });

  it('interview event yields a discovered device; rename/assign/remove work', async () => {
    const n = found.length;
    const ieee = mock.emitInterview('0xa4c138aaaaaaaaaa');
    await until(() => found.length > n);
    expect(found.at(-1)!.externalId).toBe(ieee);

    await driver.assignFriendlyName(ieee, 'dev_01TEST');
    expect(mock.devices.get(ieee)!.info.friendly_name).toBe('dev_01TEST');
    await driver.rename(ieee, 'Ổ bếp');
    expect(mock.devices.get(ieee)!.info.description).toBe('Ổ bếp');
    expect(mock.requests.at(-1)!.payload).toMatchObject({ id: 'dev_01TEST', options: { description: 'Ổ bếp' } });

    // state now flows under the new name
    const prop = driver.buildProperties(found.at(-1)!.exposes).state!;
    await driver.setProperty(ieee, 'state', true, prop);
    await until(() => states.some(([id, s]) => id === ieee && s.state === 'ON'));

    await driver.removeDevice(ieee, true);
    expect(mock.devices.has(ieee)).toBe(false);
  });

  it('ping publishes <fn>/get and rejects on error responses / timeout', async () => {
    await driver.ping(IEEE);
    await spy.waitFor(`zigbee2mqtt/${IEEE}/get`);
    await expect(driver.removeDevice('0xdeadbeef', false)).rejects.toThrow(/does not exist/);
    mock.echo = true;
    await mock.stop();
    await expect(driver.startPairing(10)).rejects.toThrow(/timed out/);
  });
});
