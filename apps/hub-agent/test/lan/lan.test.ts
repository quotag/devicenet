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

  it('setup shows code + QR; claimed state', async () => {
    const { app } = mk();
    const r = await app.inject('/setup');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('ABCD2345');
    expect(r.body).toContain('<svg');
    const { app: a2 } = mk({ getClaim: () => ({ claimed: true }) });
    const r2 = await a2.inject('/setup');
    expect(r2.body).toContain('đã được liên kết');
    expect(r2.body).not.toContain('<svg');
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
