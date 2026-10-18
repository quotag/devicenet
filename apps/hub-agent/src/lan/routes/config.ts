import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { SnapshotKind } from '../../store/snapshot.js';
import type { LanDeps } from '../server.js';

export function configRoute(app: FastifyInstance, deps: LanDeps): void {
  app.get('/api/config', async (req, reply) => {
    const id = deps.getIdentity();
    const snap = deps.snapshot;
    const site = snap.get('site');
    if (!id || !site) return reply.code(503).send({ error: 'config_unavailable' });
    const arr = (k: SnapshotKind) => (snap.get<unknown[]>(k)?.json ?? []) as unknown[];
    const rows = snap.all();
    const body = {
      tenantId: id.tenantId,
      hubId: id.hubId,
      site: site.json,
      rooms: arr('rooms'),
      devices: arr('devices'),
      scenes: arr('scenes'),
      rules: arr('rules'),
      layout: snap.get('layout')?.json ?? {},
      cachedAt: rows.reduce((m, r) => Math.max(m, r.cachedAt), 0),
    };
    const json = JSON.stringify(body);
    const etag = '"' + createHash('sha1').update(json).digest('hex').slice(0, 20) + '"';
    reply.header('ETag', etag).header('Cache-Control', 'no-cache');
    const inm = req.headers['if-none-match'];
    if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) return reply.code(304).send();
    return reply.type('application/json').send(json);
  });
}
