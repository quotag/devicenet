import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/firebase.js';
import { sha256Hex } from '../../src/services/secrets.js';
import { bearer, clearAuth, clearFirestore, createUser, refreshToken, startApp } from './harness.js';

process.env.EMQX_SHARED_TOKEN = 'tok';
const H = 'hub_AAAAAAAAAAAAAAAAAAAAAAAAAA';
const H2 = 'hub_BBBBBBBBBBBBBBBBBBBBBBBBBB';

let app: FastifyInstance;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
});

async function owner() {
  const user = await createUser('o');
  const r = await app.inject({ method: 'POST', url: '/v1/tenants/bootstrap', headers: bearer(user.idToken), payload: {} });
  return { token: await refreshToken(user), tenantId: r.json().tenantId as string };
}

async function seedHub(tenantId: string, hubId: string, secret: string) {
  const ref = db().doc(`tenants/${tenantId}/hubs/${hubId}`);
  await ref.set({ id: hubId, name: 'Hub', online: true });
  await ref.collection('private').doc('secret').set({ secretHash: sha256Hex(secret), alg: 'sha256', rotatedAt: 1 });
}

const emqx = (url: string, payload: object) =>
  app.inject({ method: 'POST', url, payload, headers: { 'x-emqx-token': 'tok' } });

describe('EMQX auth/acl with Firestore', () => {
  it('allows the right secret, denies wrong secret and other hub id', async () => {
    const o = await owner();
    await seedHub(o.tenantId, H, 'sekret');
    expect((await emqx('/v1/emqx/auth', { username: `hub:${H}`, password: 'sekret' })).json().result).toBe('allow');
    expect((await emqx('/v1/emqx/auth', { username: `hub:${H}`, password: 'nope' })).json().result).toBe('deny');
    expect((await emqx('/v1/emqx/auth', { username: `hub:${H2}`, password: 'sekret' })).json().result).toBe('deny');
    const acl = (action: string, topic: string) =>
      emqx('/v1/emqx/acl', { username: `hub:${H}`, action, topic }).then((r) => r.json().result);
    expect(await acl('publish', `t/${o.tenantId}/h/${H}/status`)).toBe('allow');
    expect(await acl('subscribe', `t/${o.tenantId}/h/${H}/d/+/set`)).toBe('allow');
    expect(await acl('subscribe', `t/${o.tenantId}/h/${H}/#`)).toBe('deny');
    // a tenant in the topic that does not own the hub
    expect(await acl('publish', `t/tenant_other/h/${H}/status`)).toBe('deny');
  });
});

describe('DELETE /v1/hubs/{hubId}', () => {
  it('revokes secret, cascades devices/rules/scenes, removes hub, leaves other hubs', async () => {
    const o = await owner();
    const t = `tenants/${o.tenantId}`;
    await seedHub(o.tenantId, H, 'sekret');
    await seedHub(o.tenantId, H2, 'other');
    await db().doc(`${t}/devices/dev_1`).set({ hubId: H, status: 'active', updatedAt: 1 });
    await db().doc(`${t}/devices/dev_2`).set({ hubId: H2, status: 'active', updatedAt: 1 });
    await db().doc(`${t}/rules/rule_1`).set({ hubId: H, enabled: true });
    await db().doc(`${t}/scenes/scene_1`).set({ hubId: H });
    await db().doc(`${t}/rules/rule_2`).set({ hubId: H2, enabled: true });
    // prime the auth cache, then make sure delete invalidates it
    expect((await emqx('/v1/emqx/auth', { username: `hub:${H}`, password: 'sekret' })).json().result).toBe('allow');

    const r = await app.inject({ method: 'DELETE', url: `/v1/hubs/${H}`, headers: bearer(o.token) });
    expect(r.statusCode).toBe(204);

    expect((await db().doc(`${t}/hubs/${H}`).get()).exists).toBe(false);
    expect((await db().doc(`${t}/hubs/${H}/private/secret`).get()).exists).toBe(false);
    expect((await db().doc(`${t}/devices/dev_1`).get()).data()).toMatchObject({ status: 'removed' });
    expect((await db().doc(`${t}/devices/dev_2`).get()).data()).toMatchObject({ status: 'active' });
    expect((await db().doc(`${t}/rules/rule_1`).get()).data()).toMatchObject({ lastResult: 'broken' });
    expect((await db().doc(`${t}/scenes/scene_1`).get()).data()).toMatchObject({ lastResult: 'broken' });
    expect((await db().doc(`${t}/rules/rule_2`).get()).data()?.lastResult).toBeUndefined();
    expect((await db().doc(`${t}/hubs/${H2}`).get()).exists).toBe(true);

    expect((await emqx('/v1/emqx/auth', { username: `hub:${H}`, password: 'sekret' })).json().result).toBe('deny');
  });

  it('404 for other-tenant hub, 400 bad id, 401 unauthenticated', async () => {
    const a = await owner();
    const b = await owner();
    await seedHub(b.tenantId, H, 'x');
    expect((await app.inject({ method: 'DELETE', url: `/v1/hubs/${H}`, headers: bearer(a.token) })).statusCode).toBe(404);
    expect((await db().doc(`tenants/${b.tenantId}/hubs/${H}/private/secret`).get()).exists).toBe(true);
    expect((await app.inject({ method: 'DELETE', url: '/v1/hubs/bad', headers: bearer(a.token) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/v1/hubs/${H}` })).statusCode).toBe(401);
  });

  it('DELETE /v1/tenants/me returns 202 placeholder and deletes nothing', async () => {
    const o = await owner();
    const r = await app.inject({ method: 'DELETE', url: '/v1/tenants/me', headers: bearer(o.token) });
    expect(r.statusCode).toBe(202);
    expect((await db().doc(`tenants/${o.tenantId}`).get()).exists).toBe(true);
  });
});
