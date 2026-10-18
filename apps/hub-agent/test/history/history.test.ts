import { describe, expect, it } from 'vitest';
import type { HubEvent } from '@devicenet/shared';
import { historyGet } from '../../src/core/handlers/history.get.js';
import type { CommandContext } from '../../src/core/handlers/types.js';
import { buildLanApp, type LanDeps } from '../../src/lan/server.js';
import { openStore } from '../../src/store/index.js';
import { attachHistoryWriter, queryBuckets } from '../../src/store/history.js';
import { runRetention } from '../../src/store/retention.js';

type Chg = Parameters<Parameters<Parameters<typeof attachHistoryWriter>[0]['onChange']>[0]>[0];

function fakeRegistry() {
  let cb: ((c: Chg) => void) | undefined;
  return {
    onChange: (f: (c: Chg) => void) => ((cb = f), () => void (cb = undefined)),
    fire: (values: Record<string, unknown>, changed: string[]) => cb?.({ entry: { device: { id: 'd1' }, values }, changed }),
  };
}

const ev = (id: string, ts: number) => ({ v: 1, id, hubId: 'hub_1', ts, type: 'device.online', deviceId: 'd1' }) as unknown as HubEvent;

describe('history writer', () => {
  it('numeric only, <=1 row/10 s/property', () => {
    const store = openStore(':memory:');
    const reg = fakeRegistry();
    let t = 1_000_000;
    attachHistoryWriter(reg, store.history, { now: () => t });
    reg.fire({ temp: 20, on: true, mode: 'x' }, ['temp', 'on', 'mode']);
    t += 5_000;
    reg.fire({ temp: 21 }, ['temp']); // throttled
    t += 5_000;
    reg.fire({ temp: 22 }, ['temp']); // 10 s elapsed
    reg.fire({ hum: 50 }, ['hum']); // other property not throttled
    expect(store.history.query('d1', 'temp', 0, 9e9).map((p) => p.value)).toEqual([20, 22]);
    expect(store.history.query('d1', 'on', 0, 9e9)).toHaveLength(0);
    expect(store.history.query('d1', 'hum', 0, 9e9)).toHaveLength(1);
  });
});

describe('buckets', () => {
  it('averages per step and caps at 300', () => {
    const store = openStore(':memory:');
    store.history.insert('d1', 'p', 0, 10);
    store.history.insert('d1', 'p', 30_000, 20);
    store.history.insert('d1', 'p', 60_000, 40);
    expect(queryBuckets(store.history, 'd1', 'p', 0, 120_000, 60)).toEqual([[0, 15], [60_000, 40]]);
    for (let i = 0; i < 400; i++) store.history.insert('d2', 'p', i * 60_000, i);
    const pts = queryBuckets(store.history, 'd2', 'p', 0, 400 * 60_000, 60);
    expect(pts).toHaveLength(300);
    expect(pts[299][0]).toBe(399 * 60_000);
  });
});

describe('routes + handler', () => {
  const mk = () => {
    const store = openStore(':memory:');
    const deps = { history: store.history, events: store.events, now: () => 100 * 3600_000, webDir: 'dist-lan' } as unknown as LanDeps;
    return { store, app: buildLanApp(deps, { allowPublic: true }) };
  };

  it('GET /api/history defaults to 24 h / step 300', async () => {
    const { store, app } = mk();
    const now = 100 * 3600_000;
    store.history.insert('d1', 'p', now - 25 * 3600_000, 1); // outside default window
    store.history.insert('d1', 'p', now - 1000, 5);
    const r = await app.inject('/api/history/d1/p');
    expect(r.statusCode).toBe(200);
    expect(r.json().points).toHaveLength(1);
    expect(r.json().points[0][1]).toBe(5);
    const r2 = await app.inject(`/api/history/d1/p?from=0&to=${now}&step=3600`);
    expect(r2.json().points).toHaveLength(2);
  });

  it('GET /api/events newest first, limit + before', async () => {
    const { store, app } = mk();
    for (let i = 1; i <= 5; i++) store.events.insert(ev(`evt_${i}`, i * 1000));
    const r = await app.inject('/api/events?limit=2');
    expect(r.json().map((e: { id: string }) => e.id)).toEqual(['evt_5', 'evt_4']);
    const r2 = await app.inject('/api/events?limit=2&before=4000');
    expect(r2.json().map((e: { id: string }) => e.id)).toEqual(['evt_3', 'evt_2']);
    expect(r.json()[0]).toMatchObject({ type: 'device.online', hubId: 'hub_1', deviceId: 'd1' });
  });

  it('history.get handler ack result.points', async () => {
    const store = openStore(':memory:');
    store.history.insert('d1', 'p', 1000, 3);
    const ctx = { history: store.history } as unknown as CommandContext;
    const cmd = { type: 'history.get', deviceId: 'd1', property: 'p', from: 0, to: 10_000, step: 60 } as never;
    const res = await historyGet(cmd, ctx, {} as never);
    expect(res).toEqual({ ok: true, result: { points: [[0, 3]] } });
    expect((await historyGet({ ...(cmd as object), to: -1 } as never, ctx, {} as never)).ok).toBe(false);
  });
});

describe('retention', () => {
  it('deletes history > 7 d and events > 30 d', () => {
    const store = openStore(':memory:');
    const now = 100 * 24 * 3600_000;
    const d = 24 * 3600_000;
    store.history.insert('d1', 'p', now - 8 * d, 1);
    store.history.insert('d1', 'p', now - 6 * d, 2);
    store.events.insert(ev('evt_old', now - 31 * d));
    store.events.insert(ev('evt_new', now - 29 * d));
    expect(runRetention(store, now)).toEqual({ history: 1, events: 1 });
    expect(store.history.query('d1', 'p', 0, now)).toHaveLength(1);
    expect(store.events.query().map((e) => e.id)).toEqual(['evt_new']);
  });
});
