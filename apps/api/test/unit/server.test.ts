import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildServer({ hostingOrigins: ['https://devicenet.web.app'] });
});
afterAll(async () => {
  await app.close();
});

describe('server', () => {
  it('GET /healthz', async () => {
    const r = await app.inject({ method: 'GET', url: '/healthz' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });

  it.each([
    ['DELETE', '/v1/hubs/hub_X'],
    ['POST', '/v1/emqx/auth'],
    ['POST', '/v1/emqx/acl'],
    ['DELETE', '/v1/tenants/me'],
  ] as const)('%s %s requires credentials', async (method, url) => {
    const r = await app.inject({ method, url });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('bootstrap requires auth', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/tenants/bootstrap' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('UNAUTHENTICATED');
  });

  // B06 claim flow: rejected before any Firestore access
  it.each([
    ['POST', '/v1/hubs/claim-codes', {}, 400, 'INVALID_BODY'],
    ['POST', '/v1/hubs/claim-codes', { hubPubKey: 'short', agentVersion: '1', platform: 'linux' }, 400, 'INVALID_BODY'],
    ['POST', '/v1/hubs/claim', { code: 'ABCD2345', siteId: 'site_x', name: 'x' }, 401, 'UNAUTHENTICATED'],
    ['GET', '/v1/hubs/claim-codes/abc/credential', undefined, 400, 'INVALID_CODE'],
    ['POST', '/v1/hubs/hub_X/token', undefined, 401, 'UNAUTHENTICATED'],
  ] as const)('%s %s rejects bad input', async (method, url, payload, status, code) => {
    const r = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(r.statusCode).toBe(status);
    expect(r.json().error.code).toBe(code);
  });

  it('unknown route gives error body', async () => {
    const r = await app.inject({ method: 'GET', url: '/nope' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('NOT_FOUND');
  });

  it('CORS allows localhost and hosting origin only', async () => {
    const h = (origin: string) =>
      app
        .inject({ method: 'GET', url: '/healthz', headers: { origin } })
        .then((r) => r.headers['access-control-allow-origin']);
    expect(await h('http://localhost:5173')).toBe('http://localhost:5173');
    expect(await h('https://devicenet.web.app')).toBe('https://devicenet.web.app');
    expect(await h('https://evil.example')).toBeUndefined();
  });

  it('sets helmet headers', async () => {
    const r = await app.inject({ method: 'GET', url: '/healthz' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('trustProxy extracts client IP from x-forwarded-for', async () => {
    const testApp = await buildServer({
      hostingOrigins: ['https://devicenet.web.app'],
      config: {
        nodeEnv: 'production',
        isEmulator: false,
        port: 8080,
        host: '0.0.0.0',
        projectId: 'test-p',
        hostingOrigins: ['https://devicenet.web.app'],
        apiBaseUrl: 'https://api.test',
        mqttHost: 'mqtt.test',
        mqttPort: 8883,
        mqttWssPort: 8084,
        emqxSharedToken: '12345678901234567890123456789012',
        firebaseWebApiKey: 'fake',
        trustProxy: true,
      },
    });
    testApp.get('/test-ip', async (req) => ({ ip: req.ip }));
    const r = await testApp.inject({
      method: 'GET',
      url: '/test-ip',
      headers: { 'x-forwarded-for': '203.0.113.195, 10.0.0.1' },
    });
    expect(r.json()).toEqual({ ip: '203.0.113.195' });
    await testApp.close();
  });

  it('CORS in production rejects localhost and allows hostingOrigins only', async () => {
    const prodApp = await buildServer({
      hostingOrigins: ['https://devicenet.web.app'],
      config: {
        nodeEnv: 'production',
        isEmulator: false,
        port: 8080,
        host: '0.0.0.0',
        projectId: 'test-p',
        hostingOrigins: ['https://devicenet.web.app'],
        apiBaseUrl: 'https://api.test',
        mqttHost: 'mqtt.test',
        mqttPort: 8883,
        mqttWssPort: 8084,
        emqxSharedToken: '12345678901234567890123456789012',
        firebaseWebApiKey: 'fake',
        trustProxy: true,
      },
    });
    const checkOrigin = (origin: string) =>
      prodApp
        .inject({ method: 'GET', url: '/healthz', headers: { origin } })
        .then((r) => r.headers['access-control-allow-origin']);

    expect(await checkOrigin('http://localhost:5173')).toBeUndefined();
    expect(await checkOrigin('https://devicenet.web.app')).toBe('https://devicenet.web.app');
    expect(await checkOrigin('https://evil.example')).toBeUndefined();
    await prodApp.close();
  });
});
