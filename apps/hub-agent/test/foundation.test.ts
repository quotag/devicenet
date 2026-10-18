import { CommandId, DeviceId, EventId, RunId } from '@devicenet/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeTime } from '../src/core/clock.js';
import { newId } from '../src/core/ids.js';
import { FakeConfigStore } from './helpers/fakeConfigStore.js';
import { connectClient, startBroker, type TestBroker, type TestClient } from './helpers/brokers.js';

describe('ids', () => {
  it('produce ids accepted by shared schemas', () => {
    expect(DeviceId.safeParse(newId('dev')).success).toBe(true);
    expect(EventId.safeParse(newId('evt')).success).toBe(true);
    expect(RunId.safeParse(newId('run')).success).toBe(true);
    expect(CommandId.safeParse(newId('cmd')).success).toBe(true);
    expect(DeviceId.safeParse(newId('evt')).success).toBe(false);
  });
  it('are unique', () => {
    expect(new Set(Array.from({ length: 100 }, () => newId('dev'))).size).toBe(100);
  });
});

describe('FakeTime', () => {
  it('fires timeouts and intervals in order and supports cancel', () => {
    const t = new FakeTime(1000);
    const log: string[] = [];
    t.setTimeout(() => log.push('a@' + t.now()), 50);
    const iv = t.setInterval(() => log.push('i@' + t.now()), 20);
    const c = t.setTimeout(() => log.push('cancelled'), 10);
    c.cancel();
    t.advance(70);
    expect(log).toEqual(['i@1020', 'i@1040', 'a@1050', 'i@1060']);
    iv.cancel();
    t.advance(100);
    expect(log).toHaveLength(4);
    expect(t.now()).toBe(1170);
    expect(t.pending()).toBe(0);
  });
});

describe('FakeConfigStore', () => {
  it('records hub writes and notifies listeners', async () => {
    const s = new FakeConfigStore();
    const seen: number[] = [];
    s.onDevices((d) => seen.push(d.length));
    expect(seen).toEqual([0]);
    await expect(s.updateDeviceHubFields('dev_x', {})).rejects.toThrow();
    s.failNext = new Error('offline');
    await expect(s.putEvent({} as never)).rejects.toThrow('offline');
  });
});

describe('broker helpers', () => {
  let broker: TestBroker | undefined;
  const clients: TestClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close();
    await broker?.close();
    broker = undefined;
  });

  it('pub/sub over tcp with waitFor', async () => {
    broker = await startBroker();
    const sub = await connectClient(broker.url);
    const pub = await connectClient(broker.url);
    clients.push(sub, pub);
    await sub.subscribe('t/+/x');
    const p = sub.waitFor('t/+/x', (m) => (m.json as { n: number }).n === 2);
    await pub.publish('t/a/x', { n: 1 });
    await pub.publish('t/b/x', { n: 2 });
    expect((await p).topic).toBe('t/b/x');
    // already-received message resolves immediately
    expect((await sub.waitFor('t/a/x')).json).toEqual({ n: 1 });
    await expect(sub.waitFor('t/zzz/x', undefined, 100)).rejects.toThrow(/timed out/);
  });

  it('works over websocket too', async () => {
    broker = await startBroker({ ws: true });
    const sub = await connectClient(broker.wsUrl!);
    const pub = await connectClient(broker.url);
    clients.push(sub, pub);
    await sub.subscribe('a/#');
    await pub.publish('a/b', 'hi', { retain: false });
    expect((await sub.waitFor('a/b')).payload.toString()).toBe('hi');
  });
});
