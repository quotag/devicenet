import type { FastifyInstance } from 'fastify';
import { toEventDoc } from '../../sync/eventUploader.js';
import type { EventsRepo } from '../../store/events.js';

/** `GET /api/events?limit&before` → EventDoc[] newest first (limit default 50, max 500). */
export function eventsRoute(app: FastifyInstance, repo?: Pick<EventsRepo, 'query'>): void {
  app.get<{ Querystring: { limit?: string; before?: string } }>('/api/events', async (req, reply) => {
    if (!repo) return reply.code(503).send({ error: 'unavailable' });
    const l = Number(req.query.limit);
    const limit = Number.isFinite(l) && l > 0 ? Math.min(500, Math.floor(l)) : 50;
    const b = req.query.before !== undefined && req.query.before !== '' ? Number(req.query.before) : undefined;
    const rows = repo.query({ limit, ...(b !== undefined && Number.isFinite(b) ? { before: b } : {}) });
    return rows.map((r) => toEventDoc(r.event));
  });
  app.put('/api/lan-settings', async (_req, reply) => reply.code(501).send({ error: 'not_implemented' }));
}
