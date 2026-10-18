import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { hubAclAllows } from '../../src/routes/emqxAcl.js';
import { kickClient } from '../../src/services/emqxAdmin.js';

process.env.EMQX_SHARED_TOKEN = 'tok';
const T = 'tenant_AAAAAAAAAAAAAAAAAAAAAAAAAA';
const H = 'hub_AAAAAAAAAAAAAAAAAAAAAAAAAA';
const H2 = 'hub_BBBBBBBBBBBBBBBBBBBBBBBBBB';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildServer();
});
afterAll(async () => {
  await app.close();
});
const post = (url: string, payload: unknown, token: string | null = 'tok') =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: token ? { 'x-emqx-token': token } : {} });

describe('hubAclAllows', () => {
  it('publish: only under own hub prefix, no wildcards', () => {
    expect(hubAclAllows(H, 'publish', `t/${T}/h/${H}/status`, T)).toBe(true);
    expect(hubAclAllows(H, 'publish', `t/${T}/h/${H}/d/dev_1/state`, T)).toBe(true);
    expect(hubAclAllows(H, 'publish', `t/${T}/h/${H2}/status`, T)).toBe(false);
    expect(hubAclAllows(H, 'publish', `t/${T}/h/${H}/#`, T)).toBe(false);
    expect(hubAclAllows(H, 'publish', `t/${T}/h/${H}x/status`, T)).toBe(false);
  });
  it('subscribe: only set|cmd of own hub', () => {
    expect(hubAclAllows(H, 'subscribe', `t/${T}/h/${H}/d/+/set`, T)).toBe(true);
    expect(hubAclAllows(H, 'subscribe', `t/${T}/h/${H}/d/+/cmd`, T)).toBe(true);
    expect(hubAclAllows(H, 'subscribe', `t/${T}/h/${H}/cmd`, T)).toBe(true);
    expect(hubAclAllows(H, 'subscribe', `t/${T}/h/${H}/#`, T)).toBe(false);
    expect(hubAclAllows(H, 'subscribe', `t/${T}/h/${H}/d/+/state`, T)).toBe(false);
    expect(hubAclAllows(H, 'subscribe', `t/${T}/h/+/d/+/set`, T)).toBe(false);
    expect(hubAclAllows(H, 'other', `t/${T}/h/${H}/status`, T)).toBe(false);
  });
});

describe('/v1/emqx/auth + acl (rejections need no Firestore)', () => {
  it('401 without/with wrong shared token', async () => {
    expect((await post('/v1/emqx/auth', {}, null)).statusCode).toBe(401);
    expect((await post('/v1/emqx/auth', {}, 'bad')).statusCode).toBe(401);
    expect((await post('/v1/emqx/acl', {}, 'bad')).statusCode).toBe(401);
  });
  it.each([
    {},
    { username: 'alice', password: 'x' },
    { username: 'hub:hub_short', password: 'x' },
    { username: `hub:${H.toLowerCase()}`, password: 'x' },
    { username: `hub:${H}`, password: '' },
    { username: `hub:${H}` },
    { username: 5, password: 'x' },
  ])('auth denies malformed %j', async (body) => {
    const r = await post('/v1/emqx/auth', body);
    expect(r.statusCode).toBe(200);
    expect(r.json().result).toBe('deny');
  });
  it.each([
    {},
    { username: 'alice', topic: `t/${T}/h/${H}/status`, action: 'publish' },
    { username: `hub:${H}`, topic: `t/${T}/h/${H2}/status`, action: 'publish' },
    { username: `hub:${H}`, topic: `t/${T}/h/${H}/#`, action: 'subscribe' },
    { username: `hub:${H}`, topic: `t/${T}/h/${H}/status` },
  ])('acl denies %j', async (body) => {
    const r = await post('/v1/emqx/acl', body);
    expect(r.statusCode).toBe(200);
    expect(r.json().result).toBe('deny');
  });
});

describe('kickClient', () => {
  it('is skipped without EMQX_ADMIN_URL', async () => {
    delete process.env.EMQX_ADMIN_URL;
    expect(await kickClient('hub-x')).toBe(false);
  });
  it('sends DELETE /api/v5/clients/<id> with basic auth; failures do not throw', async () => {
    const calls: Array<{ url: string; method?: string; auth?: string }> = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method, auth: (init.headers as Record<string, string>).authorization });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    process.env.EMQX_ADMIN_URL = 'http://emqx:18083/';
    process.env.EMQX_ADMIN_KEY = 'k';
    process.env.EMQX_ADMIN_SECRET = 's';
    try {
      expect(await kickClient(`hub-${H}`)).toBe(true);
      expect(calls[0]).toEqual({
        url: `http://emqx:18083/api/v5/clients/hub-${H}`,
        method: 'DELETE',
        auth: `Basic ${Buffer.from('k:s').toString('base64')}`,
      });
      globalThis.fetch = (async () => {
        throw new Error('down');
      }) as typeof fetch;
      expect(await kickClient('hub-x')).toBe(false);
    } finally {
      globalThis.fetch = orig;
      delete process.env.EMQX_ADMIN_URL;
    }
  });
});
