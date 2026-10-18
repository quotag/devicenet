import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/firebase.js';
import { clearFirestore, startApp } from './harness.js';

process.env.EMQX_SHARED_TOKEN = 'test-token';
const T = 'tenant_aaaaaaaaaaaaaaaaaaaaaaaaaa';
const H = 'hub_aaaaaaaaaaaaaaaaaaaaaaaaaa';
const topic = `t/${T}/h/${H}/status`;
const hubPath = `tenants/${T}/hubs/${H}`;

let app: FastifyInstance;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await clearFirestore();
  await db().doc(hubPath).set({ online: false, lastSeen: 1000, name: 'Hub' });
});

const status = (o: object = {}) =>
  JSON.stringify({ v: 1, ts: 5000, seq: 1, online: true, agentVersion: '0.1.0', z2m: 'online', deviceCount: 3, ...o });
const post = (payload: object, token = 'test-token') =>
  app.inject({ method: 'POST', url: '/v1/emqx/webhook', headers: { 'x-emqx-token': token }, payload });
const hub = async () => (await db().doc(hubPath).get()).data()!;

describe('POST /v1/emqx/webhook', () => {
  it('marks hub online and mirrors fields', async () => {
    const r = await post({ topic, payload: status({ ip: '10.0.0.2', platform: 'linux' }), publish_received_at: 5001 });
    expect(r.statusCode).toBe(204);
    expect(await hub()).toMatchObject({ online: true, lastSeen: 5000, agentVersion: '0.1.0', deviceCount: 3, ip: '10.0.0.2', platform: 'linux' });
  });

  it('LWT sets offline with lastSeen = publish_received_at', async () => {
    await post({ topic, payload: status() });
    const lwt = JSON.stringify({ v: 1, ts: 0, seq: 0, online: false, agentVersion: '', z2m: 'offline' });
    expect((await post({ topic, payload: lwt, publish_received_at: 9000 })).statusCode).toBe(204);
    expect(await hub()).toMatchObject({ online: false, lastSeen: 9000 });
  });

  it('ignores stale ts', async () => {
    await post({ topic, payload: status({ ts: 5000 }) });
    await post({ topic, payload: status({ ts: 4000, online: false }) });
    expect(await hub()).toMatchObject({ online: true, lastSeen: 5000 });
  });

  it('401 on bad token', async () => {
    expect((await post({ topic, payload: status() }, 'nope')).statusCode).toBe(401);
    expect((await hub()).online).toBe(false);
  });

  it('204 for unknown hub (no doc created), empty payload, events topic', async () => {
    const other = `t/${T}/h/hub_bbbbbbbbbbbbbbbbbbbbbbbbbb/status`;
    expect((await post({ topic: other, payload: status() })).statusCode).toBe(204);
    expect((await db().doc(`tenants/${T}/hubs/hub_bbbbbbbbbbbbbbbbbbbbbbbbbb`).get()).exists).toBe(false);
    expect((await post({ topic, payload: '' })).statusCode).toBe(204);
    expect((await post({ topic: `t/${T}/h/${H}/events`, payload: '{}' })).statusCode).toBe(204);
    expect((await hub()).online).toBe(false);
  });
});
