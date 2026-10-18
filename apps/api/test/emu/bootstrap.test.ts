import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TenantId, SiteId, Tenant, Member, Site } from '@devicenet/shared';
import { auth, db } from '../../src/firebase.js';
import { bearer, clearAuth, clearFirestore, createUser, decodeJwt, refreshToken, startApp } from './harness.js';

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

const bootstrap = (token: string, payload?: object) =>
  app.inject({ method: 'POST', url: '/v1/tenants/bootstrap', headers: bearer(token), payload: payload ?? {} });

describe('POST /v1/tenants/bootstrap', () => {
  it('creates tenant, owner member, default site with default timezone', async () => {
    const u = await createUser();
    const r = await bootstrap(u.idToken);
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.created).toBe(true);
    expect(TenantId.safeParse(body.tenantId).success).toBe(true);
    expect(SiteId.safeParse(body.siteId).success).toBe(true);

    const t = await db().doc(`tenants/${body.tenantId}`).get();
    expect(Tenant.safeParse(t.data()).success).toBe(true);
    expect(t.get('ownerUid')).toBe(u.uid);
    const m = await db().doc(`tenants/${body.tenantId}/members/${u.uid}`).get();
    expect(Member.safeParse(m.data()).success).toBe(true);
    expect(m.get('role')).toBe('owner');
    const s = await db().doc(`tenants/${body.tenantId}/sites/${body.siteId}`).get();
    expect(Site.safeParse(s.data()).success).toBe(true);
    expect(s.get('name')).toBe('Nhà');
    expect(s.get('timezone')).toBe('Asia/Ho_Chi_Minh');
  });

  it('uses timezone / lat / lng from body', async () => {
    const u = await createUser();
    const { tenantId, siteId } = (await bootstrap(u.idToken, { timezone: 'Asia/Bangkok', lat: 10.8, lng: 106.7 })).json();
    const s = (await db().doc(`tenants/${tenantId}/sites/${siteId}`).get()).data()!;
    expect(s).toMatchObject({ timezone: 'Asia/Bangkok', lat: 10.8, lng: 106.7 });
  });

  it('is idempotent: second call returns same ids with created=false', async () => {
    const u = await createUser();
    const a = (await bootstrap(u.idToken)).json();
    const b = (await bootstrap(u.idToken)).json();
    expect(b).toEqual({ tenantId: a.tenantId, siteId: a.siteId, created: false });
    expect((await db().collection('tenants').get()).size).toBe(1);
  });

  it('recovers if claims were never set (crash after commit)', async () => {
    const u = await createUser();
    const a = (await bootstrap(u.idToken)).json();
    await auth().setCustomUserClaims(u.uid, {});
    const b = (await bootstrap(u.idToken)).json();
    expect(b).toEqual({ tenantId: a.tenantId, siteId: a.siteId, created: false });
    expect((await auth().getUser(u.uid)).customClaims?.tenant).toBe(a.tenantId);
  });

  it('sets custom claims {tenant, role:"user", acl} visible in refreshed ID token', async () => {
    const u = await createUser();
    const { tenantId } = (await bootstrap(u.idToken)).json();
    const claims = decodeJwt(await refreshToken(u));
    expect(claims.tenant).toBe(tenantId);
    expect(claims.role).toBe('user');
    expect(claims.acl).toEqual({
      pub: [`t/${tenantId}/h/+/d/+/set`, `t/${tenantId}/h/+/cmd`],
      sub: [`t/${tenantId}/#`],
    });
  });

  it('different users get different tenants', async () => {
    const a = (await bootstrap((await createUser()).idToken)).json();
    const b = (await bootstrap((await createUser()).idToken)).json();
    expect(a.tenantId).not.toBe(b.tenantId);
  });

  it('401 without or with bad token; 400 on bad body', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/tenants/bootstrap' })).statusCode).toBe(401);
    expect((await bootstrap('garbage')).statusCode).toBe(401);
    const u = await createUser();
    const r3 = await bootstrap(u.idToken, { lat: 999 });
    expect(r3.statusCode).toBe(400);
    expect(r3.json().error.code).toBe('INVALID_BODY');
  });
});
