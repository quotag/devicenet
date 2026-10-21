import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLanApp, type LanDeps } from '../../src/lan/server.js';
import { SnapshotRepo } from '../../src/store/snapshot.js';
import { openStore } from '../../src/store/index.js';

function mk(over: Partial<LanDeps> = {}, allowPublic = true) {
  const dir = mkdtempSync(join(tmpdir(), 'lan-'));
  const store = openStore(join(dir, 'hub.db'));
  const snap: SnapshotRepo = store.snapshot;
  const deps: LanDeps = {
    getHealth: () => ({ ok: true, agentVersion: '0.0.1', z2m: 'online', mqttLocal: true, mqttCloud: false, firestore: false, claimed: false }),
    getClaim: () => ({ claimed: false, code: 'ABCD2345', expiresAt: Date.now() + 600_000 }),
    getIdentity: () => ({ tenantId: 't1', hubId: 'h1' }),
    snapshot: snap,
    webDir: join(dir, 'dist-lan'),
    ...over,
  };
  return { app: buildLanApp(deps, { allowPublic }), dir, snap, store };
}

describe('LAN server', () => {
  it('health', async () => {
    const { app } = mk({ getHealth: () => ({ ok: false, agentVersion: '1', z2m: 'offline', mqttLocal: true, mqttCloud: false, firestore: false, claimed: true, lastError: 'boom' }) });
    const r = await app.inject('/api/health');
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.z2m).toBe('offline');
    expect(j.lastError).toBe('boom');
    expect(typeof j.ts).toBe('number');
  });

  it('config 503 without snapshot, then etag/304', async () => {
    const { app, snap } = mk();
    expect((await app.inject('/api/config')).statusCode).toBe(503);
    snap.put('site', { name: 'Home' }, 1000);
    snap.put('devices', [{ id: 'd1' }], 2000);
    const r = await app.inject('/api/config');
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({ tenantId: 't1', hubId: 'h1', site: { name: 'Home' }, devices: [{ id: 'd1' }], rooms: [], cachedAt: 2000 });
    const etag = r.headers.etag as string;
    expect(etag).toBeTruthy();
    const r2 = await app.inject({ url: '/api/config', headers: { 'if-none-match': etag } });
    expect(r2.statusCode).toBe(304);
    snap.put('rooms', [{ id: 'r1' }], 3000);
    const r3 = await app.inject({ url: '/api/config', headers: { 'if-none-match': etag } });
    expect(r3.statusCode).toBe(200);
  });

  it('guard blocks public ips', async () => {
    const { app } = mk({}, false);
    expect((await app.inject({ url: '/api/health', remoteAddress: '8.8.8.8' })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/health', remoteAddress: '192.168.1.9' })).statusCode).toBe(200);
  });

  it('setup shows code + QR; claimed state with reset button', async () => {
    const { app } = mk();
    const r = await app.inject('/setup');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('ABCD2345');
    expect(r.body).toContain('<svg');
    let resetCalled = false;
    const testCsrf = 'abcd1234abcd1234abcd1234';
    const { app: a2 } = mk({
      getClaim: () => ({ claimed: true }),
      csrfToken: testCsrf,
      resetClaim: async () => {
        resetCalled = true;
      },
    });
    const r2 = await a2.inject('/setup');
    expect(r2.body).toContain('đã được liên kết');
    expect(r2.body).toContain('id="reset-btn"');
    expect(r2.body).toContain(`name="csrf" value="${testCsrf}"`);
    expect(r2.body).not.toContain('<svg');

    // Missing CSRF token -> 403
    const rNoToken = await a2.inject({ method: 'POST', url: '/setup/reset' });
    expect(rNoToken.statusCode).toBe(403);
    expect(resetCalled).toBe(false);

    // Wrong CSRF token -> 403
    const rWrongToken = await a2.inject({
      method: 'POST',
      url: '/setup/reset',
      headers: { 'x-dn-csrf': 'wrong-token' },
    });
    expect(rWrongToken.statusCode).toBe(403);

    // Cross-site Sec-Fetch-Site -> 403
    const rCrossSite = await a2.inject({
      method: 'POST',
      url: '/setup/reset',
      headers: { 'x-dn-csrf': testCsrf, 'sec-fetch-site': 'cross-site' },
    });
    expect(rCrossSite.statusCode).toBe(403);

    // Mismatched origin -> 403
    const rBadOrigin = await a2.inject({
      method: 'POST',
      url: '/setup/reset',
      headers: { 'x-dn-csrf': testCsrf, host: '192.168.1.5:8080', origin: 'http://evil.com' },
    });
    expect(rBadOrigin.statusCode).toBe(403);

    // Valid CSRF via header -> 303 redirect
    const rPost = await a2.inject({
      method: 'POST',
      url: '/setup/reset',
      headers: { 'x-dn-csrf': testCsrf },
    });
    expect(rPost.statusCode).toBe(303);
    expect(rPost.headers.location).toBe('/setup');
    expect(resetCalled).toBe(true);

    // Valid CSRF via form body
    resetCalled = false;
    const rForm = await a2.inject({
      method: 'POST',
      url: '/setup/reset',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `csrf=${testCsrf}`,
    });
    expect(rForm.statusCode).toBe(303);
    expect(resetCalled).toBe(true);

    // When resetClaim returns false (cloud unclaim failed)
    const { app: a3 } = mk({
      getClaim: () => ({ claimed: false, code: 'XYZ12345' }),
      csrfToken: testCsrf,
      resetClaim: async () => false,
    });
    const rPostFailed = await a3.inject({
      method: 'POST',
      url: '/setup/reset',
      headers: { 'x-dn-csrf': testCsrf },
    });
    expect(rPostFailed.statusCode).toBe(303);
    expect(rPostFailed.headers.location).toBe('/setup?cloudError=1');

    const rWarning = await a3.inject('/setup?cloudError=1');
    expect(rWarning.statusCode).toBe(200);
    expect(rWarning.body).toContain('id="cloud-warning"');
    expect(rWarning.body).toContain('Hub cũ trên cloud chưa được gỡ');

    // Rate limiting: 3 per hour limit
    const { app: aRate } = mk({
      getClaim: () => ({ claimed: true }),
      csrfToken: testCsrf,
      resetClaim: async () => true,
    });
    for (let i = 0; i < 3; i++) {
      const res = await aRate.inject({
        method: 'POST',
        url: '/setup/reset',
        headers: { 'x-dn-csrf': testCsrf },
      });
      expect(res.statusCode).toBe(303);
    }
    const rRateLimited = await aRate.inject({
      method: 'POST',
      url: '/setup/reset',
      headers: { 'x-dn-csrf': testCsrf },
    });
    expect(rRateLimited.statusCode).toBe(429);
  });

  it('no credentials leaked across LAN endpoints', async () => {
    const { app, snap } = mk();
    snap.put('site', { name: 'Home' }, 1000);
    snap.put('devices', [{ id: 'd1', name: 'Plug' }], 2000);

    for (const url of ['/api/health', '/api/config', '/setup']) {
      const res = await app.inject(url);
      const text = res.body.toLowerCase();
      expect(text).not.toContain('customtoken');
      expect(text).not.toContain('hubsecret');
      expect(text).not.toContain('"secret"');
      expect(text).not.toContain('"password"');
    }
  });

  it('static: missing dir shows notice; built dir serves files + SPA fallback', async () => {
    const { app, dir } = mk();
    const r = await app.inject('/');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('LAN web chưa build');

    const web = join(dir, 'dist-lan');
    mkdirSync(join(web, 'assets'), { recursive: true });
    writeFileSync(join(web, 'index.html'), '<html>APP</html>');
    writeFileSync(join(web, 'assets', 'a.js'), 'console.log(1)');
    expect((await app.inject('/')).body).toBe('<html>APP</html>');
    expect((await app.inject('/rooms/living')).body).toBe('<html>APP</html>');
    const js = await app.inject('/assets/a.js');
    expect(js.body).toBe('console.log(1)');
    expect(js.headers['content-type']).toContain('javascript');
    expect((await app.inject('/assets/missing.js')).statusCode).toBe(404);
    expect((await app.inject('/api/unknown')).statusCode).toBe(404);
    expect((await app.inject('/..%2f..%2fsecret')).statusCode).toBe(403);
  });

  it('history/events 503 when repos are not wired (B17)', async () => {
    const { app } = mk();
    expect((await app.inject('/api/history/d1/power')).statusCode).toBe(503);
    expect((await app.inject('/api/events')).statusCode).toBe(503);
  });
});
