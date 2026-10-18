import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ClaimCode, Hub, HubId, HubSecret } from '@devicenet/shared';
import { db } from '../../src/firebase.js';
import { generateKeyPair, open } from '../../src/services/sealedBox.js';
import { sha256Hex } from '../../src/services/secrets.js';
import { bearer, clearAuth, clearFirestore, createUser, decodeJwt, refreshToken, startApp, type TestUser } from './harness.js';

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST!;

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

interface Owner {
  user: TestUser;
  token: string;
  tenantId: string;
  siteId: string;
}

async function owner(): Promise<Owner> {
  const user = await createUser('owner');
  const r = await app.inject({ method: 'POST', url: '/v1/tenants/bootstrap', headers: bearer(user.idToken), payload: {} });
  expect(r.statusCode).toBe(200);
  return { user, token: await refreshToken(user), ...r.json() };
}

async function newCode() {
  const kp = await generateKeyPair();
  const r = await app.inject({
    method: 'POST',
    url: '/v1/hubs/claim-codes',
    payload: { hubPubKey: kp.pk, agentVersion: '0.0.1', platform: 'windows' },
  });
  expect(r.statusCode).toBe(201);
  return { kp, ...(r.json() as { code: string; expiresAt: number; pollEverySec: number }) };
}

const claim = (o: Owner, code: string, extra: object = {}) =>
  app.inject({
    method: 'POST',
    url: '/v1/hubs/claim',
    headers: bearer(o.token),
    payload: { code, siteId: o.siteId, name: 'Hub phòng khách', ...extra },
  });

const getCredential = (code: string) => app.inject({ method: 'GET', url: `/v1/hubs/claim-codes/${code}/credential` });

async function signInWithCustomToken(token: string) {
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, returnSecureToken: true }),
  });
  expect(r.status).toBe(200);
  return decodeJwt(((await r.json()) as { idToken: string }).idToken);
}

/** Full flow up to the decrypted credential. */
async function claimed() {
  const o = await owner();
  const c = await newCode();
  const r = await claim(o, c.code);
  expect(r.statusCode).toBe(200);
  const g = await getCredential(c.code);
  expect(g.statusCode).toBe(200);
  const cred = JSON.parse(await open(g.json().credential, c.kp.pk, c.kp.sk));
  return { o, c, hubId: r.json().hubId as string, cred };
}

describe('POST /v1/hubs/claim-codes', () => {
  it('creates a 15-minute single-use code', async () => {
    const before = Date.now();
    const c = await newCode();
    expect(c.pollEverySec).toBe(3);
    expect(c.expiresAt).toBeGreaterThanOrEqual(before + 15 * 60_000);
    expect(c.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
    const doc = (await db().doc(`claimCodes/${c.code}`).get()).data();
    expect(ClaimCode.parse(doc)).toMatchObject({ code: c.code, hubPubKey: c.kp.pk, used: false, expiresAt: c.expiresAt });
  });

  it('rejects an invalid public key', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/hubs/claim-codes',
      payload: { hubPubKey: 'AAAA', agentVersion: '0.0.1', platform: 'linux' },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('POST /v1/hubs/claim', () => {
  it('happy path: hub + secret created, credential sealed for the hub', async () => {
    const { o, c, hubId, cred } = await claimed();
    expect(HubId.safeParse(hubId).success).toBe(true);

    const hub = Hub.parse((await db().doc(`tenants/${o.tenantId}/hubs/${hubId}`).get()).data());
    expect(hub).toMatchObject({
      id: hubId,
      siteId: o.siteId,
      name: 'Hub phòng khách',
      online: false,
      lastSeen: 0,
      claimedBy: o.user.uid,
      drivers: ['zigbee2mqtt'],
    });

    expect(cred).toMatchObject({
      tenantId: o.tenantId,
      hubId,
      siteId: o.siteId,
      mqtt: { host: '127.0.0.1', port: 1884, wssPort: 8084, username: `hub:${hubId}` },
      apiBaseUrl: expect.any(String),
    });
    const secret = HubSecret.parse((await db().doc(`tenants/${o.tenantId}/hubs/${hubId}/private/secret`).get()).data());
    expect(secret.secretHash).toBe(sha256Hex(cred.mqtt.password));
    expect(JSON.stringify(hub)).not.toContain(cred.mqtt.password);

    const cc = (await db().doc(`claimCodes/${c.code}`).get()).data()!;
    expect(cc).toMatchObject({ used: true, tenantId: o.tenantId, hubId });
    expect(cc.credential).toBeUndefined(); // deleted by the GET
    expect(typeof cc.credentialTakenAt).toBe('number');

    // custom token signs in to the Auth emulator with hub claims
    const claims = await signInWithCustomToken(cred.firebaseCustomToken);
    expect(claims).toMatchObject({ user_id: hubId, tenant: o.tenantId, hubId, role: 'hub' });
  });

  it('accepts lower-case / dashed user input', async () => {
    const o = await owner();
    const c = await newCode();
    const r = await claim(o, `${c.code.slice(0, 4).toLowerCase()}-${c.code.slice(4)}`);
    expect(r.statusCode).toBe(200);
  });

  it('400 INVALID_CODE on bad format and unknown code', async () => {
    const o = await owner();
    for (const code of ['ABC', 'ABCD0123', 'ABCDEFGHI', 'ZZZZ2222']) {
      const r = await claim(o, code);
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('INVALID_CODE');
    }
  });

  it('400 EXPIRED', async () => {
    const o = await owner();
    const c = await newCode();
    await db().doc(`claimCodes/${c.code}`).update({ expiresAt: Date.now() - 1 });
    const r = await claim(o, c.code);
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('EXPIRED');
    expect((await db().collection(`tenants/${o.tenantId}/hubs`).get()).size).toBe(0);
  });

  it('400 ALREADY_USED when the same tenant claims twice', async () => {
    const o = await owner();
    const c = await newCode();
    expect((await claim(o, c.code)).statusCode).toBe(200);
    const r = await claim(o, c.code);
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('ALREADY_USED');
    expect((await db().collection(`tenants/${o.tenantId}/hubs`).get()).size).toBe(1);
  });

  it('409 HUB_BELONGS_TO_OTHER_TENANT when another tenant used the code (OQ-3)', async () => {
    const a = await owner();
    const b = await owner();
    const c = await newCode();
    expect((await claim(a, c.code)).statusCode).toBe(200);
    const r = await claim(b, c.code);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('HUB_BELONGS_TO_OTHER_TENANT');
    expect((await db().collection(`tenants/${b.tenantId}/hubs`).get()).size).toBe(0);
  });

  it('400 INVALID_SITE when the site is not in the caller tenant', async () => {
    const a = await owner();
    const b = await owner();
    const c = await newCode();
    const r = await claim(a, c.code, { siteId: b.siteId });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('INVALID_SITE');
    expect((await db().doc(`claimCodes/${c.code}`).get()).get('used')).toBe(false);
  });

  it('403 NO_TENANT before bootstrap', async () => {
    const u = await createUser();
    const r = await app.inject({
      method: 'POST',
      url: '/v1/hubs/claim',
      headers: bearer(u.idToken),
      payload: { code: 'ABCD2345', siteId: 'site_01J00000000000000000000000', name: 'x' },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('GET /v1/hubs/claim-codes/{code}/credential', () => {
  it('404 until claimed, 200 once, then 410', async () => {
    const o = await owner();
    const c = await newCode();
    expect((await getCredential(c.code)).statusCode).toBe(404);
    expect((await claim(o, c.code)).statusCode).toBe(200);
    expect((await getCredential(c.code)).statusCode).toBe(200);
    const again = await getCredential(c.code);
    expect(again.statusCode).toBe(410);
    expect(again.json().error.code).toBe('CONSUMED');
  });

  it('410 when expired', async () => {
    const c = await newCode();
    await db().doc(`claimCodes/${c.code}`).update({ expiresAt: Date.now() - 1 });
    const r = await getCredential(c.code);
    expect(r.statusCode).toBe(410);
    expect(r.json().error.code).toBe('EXPIRED');
  });

  it('410 for an unknown code', async () => {
    expect((await getCredential('ZZZZ2222')).statusCode).toBe(410);
  });
});

describe('POST /v1/hubs/{hubId}/token', () => {
  it('good secret → custom token with hub claims', async () => {
    const { o, hubId, cred } = await claimed();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/hubs/${hubId}/token`,
      headers: { authorization: `Hub ${hubId}:${cred.mqtt.password}` },
    });
    expect(r.statusCode).toBe(200);
    const claims = await signInWithCustomToken(r.json().firebaseCustomToken);
    expect(claims).toMatchObject({ user_id: hubId, tenant: o.tenantId, hubId, role: 'hub' });
  });

  it('bad secret → 401; another hub id → 401/403', async () => {
    const one = await claimed();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/hubs/${one.hubId}/token`,
      headers: { authorization: `Hub ${one.hubId}:wrong-secret` },
    });
    expect(r.statusCode).toBe(401);

    const other = 'hub_01J0000000000000000000000Z';
    const r2 = await app.inject({
      method: 'POST',
      url: `/v1/hubs/${other}/token`,
      headers: { authorization: `Hub ${one.hubId}:${one.cred.mqtt.password}` },
    });
    expect([401, 403]).toContain(r2.statusCode);
    const r3 = await app.inject({
      method: 'POST',
      url: `/v1/hubs/${other}/token`,
      headers: { authorization: `Hub ${other}:${one.cred.mqtt.password}` },
    });
    expect(r3.statusCode).toBe(401);
  });
});
