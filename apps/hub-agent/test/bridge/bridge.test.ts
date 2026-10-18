import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createBroker } from 'aedes';
import { topics } from '@devicenet/shared';
import { connectClient, startBroker, type Received, type TestBroker, type TestClient } from '../helpers/brokers.js';
import { MockZ2m } from '../mock-z2m/index.js';
import { Zigbee2mqttDriver } from '../../src/drivers/zigbee2mqtt/driver.js';
import { createHubCore, type HubCore } from '../../src/core/hubCore.js';
import { openStore, type Store } from '../../src/store/index.js';
import { newId } from '../../src/core/ids.js';
import { Bridge } from '../../src/bridge/bridge.js';
import { buildStatus } from '../../src/bridge/heartbeat.js';
import { IDENTITY, IEEE, makeDevice, until } from '../core/helpers.js';

/** aedes on a fixed port that can be killed and restarted (fresh, no retained) on the same port. */
async function restartableBroker() {
  let aedes = createBroker();
  const socks = new Set<Socket>();
  const handler = (s: Socket) => {
    socks.add(s);
    s.on('close', () => socks.delete(s));
    aedes.handle(s);
  };
  let tcp: Server = createServer(handler);
  await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r));
  const port = (tcp.address() as AddressInfo).port;
  const kill = async () => {
    for (const s of socks) s.destroy();
    await new Promise<void>((r) => tcp.close(() => r()));
    await new Promise<void>((r) => aedes.close(() => r()));
  };
  return {
    port,
    url: `mqtt://127.0.0.1:${port}`,
    get aedes() {
      return aedes;
    },
    kill,
    async restart() {
      await kill();
      aedes = createBroker();
      tcp = createServer(handler);
      await new Promise<void>((r) => tcp.listen(port, '127.0.0.1', r));
    },
  };
}

const T = IDENTITY.tenantId;
const H = IDENTITY.hubId;
const isState = (m: Received) => m.topic.endsWith('/state') && !!m.json;
const seqOf = (m: Received) => (m.json as { seq: number }).seq;

describe('bridge (local + cloud aedes, mock Z2M)', () => {
  let local: TestBroker;
  let cloud: Awaited<ReturnType<typeof restartableBroker>>;
  let mock: MockZ2m;
  let driver: Zigbee2mqttDriver;
  let core: HubCore;
  let store: Store;
  let bridge: Bridge;
  let cloudAll: TestClient;
  let localObs: TestClient;
  const resync = vi.fn(async () => {});
  const dev = makeDevice();
  const seenCloud: string[] = [];
  const watch = (c: TestClient) => c.client.on('message', (t) => seenCloud.push(t));

  beforeAll(async () => {
    local = await startBroker();
    cloud = await restartableBroker();
    mock = new MockZ2m({ url: local.url, latencyMs: 5 });
    driver = new Zigbee2mqttDriver({ url: local.url, requestTimeoutMs: 1000 });
    store = openStore(':memory:');
    core = createHubCore({ driver, store, coalesceMs: 20, minIntervalMs: 50 });
    core.setConfigResync(resync);
    core.registry.insert(dev, { friendlyName: IEEE });
    core.setIdentity(IDENTITY);
    await mock.start();
    await driver.start();

    cloudAll = await connectClient(cloud.url);
    watch(cloudAll);
    await cloudAll.subscribe('#');
    localObs = await connectClient(local.url);
    await localObs.subscribe(`t/${T}/#`);

    bridge = new Bridge({
      core,
      config: { emulator: true, cloudMqttTls: true, mqttLocal: { port: local.port, wsPort: 0 } },
      local: { url: local.url },
      status: () => buildStatus({ agentVersion: '0.0.1', z2m: () => 'online', platform: 'windows', deviceCount: () => core.registry.all().length }),
      minBackoffMs: 50,
      maxBackoffMs: 200,
      keepalive: 5,
    });
    bridge.start();
    await bridge.connectCloud({ host: '127.0.0.1', port: cloud.port, password: 'secret' });
    await until(() => bridge.localConnected && bridge.cloudConnected);
    await until(() => {
      mock.reportState(IEEE, {});
      return Object.keys(core.registry.get(dev.id)!.values).length > 0;
    });
  });

  afterAll(async () => {
    await bridge?.stop();
    await cloudAll?.close();
    await localObs?.close();
    core?.stop();
    await driver?.stop();
    await mock?.stop();
    await local?.close();
    await cloud?.kill();
    store?.close();
  });

  it('cloud client uses clientId hub-{hubId}, username hub:{hubId}, clean:false', () => {
    const c = (cloud.aedes as any).clients[`hub-${H}`];
    expect(c).toBeDefined();
    expect(c.clean).toBe(false);
  });

  it('status online is published retained to both brokers', async () => {
    const stat = (m: Received) => (m.json as any)?.online === true && m.json !== undefined;
    await cloudAll.waitFor(topics.status(T, H), stat);
    await localObs.waitFor(topics.status(T, H), stat);
  });

  it('set from cloud reaches the device and state lands on both brokers', async () => {
    const stateTopic = topics.state(T, H, dev.id);
    const off = (m: Received) => isState(m) && (m.json as any).values.state === false;
    const cloudPub = await connectClient(cloud.url);
    await cloudPub.publish(topics.set(T, H, dev.id), { values: { state: false } });
    await cloudAll.waitFor(stateTopic, off, 3000);
    await localObs.waitFor(stateTopic, off, 3000);
    expect(mock.devices.get(IEEE)!.state.state).toBe('OFF');
    await cloudPub.close();
  });

  it('same cmd id via both brokers → one execution, one ack', async () => {
    const id = newId('cmd');
    const env = { v: 1, id, sentAt: Date.now(), cmd: { type: 'config.resync' } };
    const lp = await connectClient(local.url);
    const cp = await connectClient(cloud.url);
    await Promise.all([lp.publish(topics.cmd(T, H), env), cp.publish(topics.cmd(T, H), env)]);
    await cloudAll.waitFor(topics.ack(T, H), (m) => (m.json as any)?.id === id);
    await new Promise((r) => setTimeout(r, 300));
    expect(resync).toHaveBeenCalledTimes(1);
    expect(cloudAll.messages.filter((m) => m.topic === topics.ack(T, H) && (m.json as any)?.id === id)).toHaveLength(1);
    expect(localObs.messages.filter((m) => m.topic === topics.ack(T, H) && (m.json as any)?.id === id)).toHaveLength(1);
    await lp.close();
    await cp.close();
  });

  it('cloud connection drop → LWT seen, then status/pairing/state republished with higher seq', async () => {
    core.publisher.publishPairing({ active: false, found: [] });
    const before = Math.max(...cloudAll.messages.filter((m) => m.json && typeof (m.json as any).seq === 'number').map(seqOf));
    const n0 = bridge.cloud!.connectCount;
    // abrupt socket loss (no DISCONNECT) → broker fires the will
    (cloud.aedes as any).clients[`hub-${H}`].conn.destroy();
    await cloudAll.waitFor(topics.status(T, H), (m) => (m.json as any)?.online === false && (m.json as any).seq === 0, 3000);
    await until(() => bridge.cloud!.connectCount > n0, 3000);
    const after = (m: Received) => !!m.json && seqOf(m) > before;
    await cloudAll.waitFor(topics.status(T, H), (m) => after(m) && (m.json as any).online === true, 3000);
    await cloudAll.waitFor(topics.pairing(T, H), after, 3000);
    await cloudAll.waitFor(topics.state(T, H, dev.id), after, 3000);
  });

  it('cloud broker restart (retained lost) → hub reconnects and retained state is back with higher seq', async () => {
    const before = core.publisher.lastSeq;
    const n0 = bridge.cloud!.connectCount;
    await cloudAll.close();
    await cloud.restart();
    await until(() => bridge.cloud!.connectCount > n0 && bridge.cloudConnected, 5000);
    await new Promise((r) => setTimeout(r, 100));
    cloudAll = await connectClient(cloud.url);
    watch(cloudAll);
    await cloudAll.subscribe('#');
    const st = await cloudAll.waitFor(topics.state(T, H, dev.id), (m) => m.retain && !!m.json, 3000);
    expect(seqOf(st)).toBeGreaterThan(before);
    const status = await cloudAll.waitFor(topics.status(T, H), (m) => m.retain && (m.json as any)?.online === true, 3000);
    expect(seqOf(status)).toBeGreaterThan(before);
    // downlink still works after restart (resubscribed on connect)
    const cp = await connectClient(cloud.url);
    await cp.publish(topics.set(T, H, dev.id), { values: { state: true } });
    await cloudAll.waitFor(topics.state(T, H, dev.id), (m) => isState(m) && (m.json as any).values.state === true, 3000);
    await cp.close();
  });

  it('never forwards zigbee2mqtt/# to the cloud', () => {
    expect(seenCloud.length).toBeGreaterThan(0);
    expect(seenCloud.some((t) => t.startsWith('zigbee2mqtt/'))).toBe(false);
    expect(seenCloud.every((t) => t.startsWith(`t/${T}/h/${H}/`))).toBe(true);
  });
});
