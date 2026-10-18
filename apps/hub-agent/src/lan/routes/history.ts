import type { FastifyInstance } from 'fastify';
import { queryBuckets, type HistoryRepo } from '../../store/history.js';

/** `GET /api/history/{deviceId}/{property}?from&to&step` → `{points: [ts, avg][]}` (≤300). */
export function historyRoute(app: FastifyInstance, repo?: Pick<HistoryRepo, 'buckets'>, now: () => number = Date.now): void {
  app.get<{ Params: { deviceId: string; property: string }; Querystring: { from?: string; to?: string; step?: string } }>(
    '/api/history/:deviceId/:property',
    async (req, reply) => {
      if (!repo) return reply.code(503).send({ error: 'unavailable' });
      const t = now();
      const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
      const to = num(req.query.to, t);
      const from = num(req.query.from, to - 24 * 3600_000);
      const step = Math.min(3600, Math.max(1, Math.floor(num(req.query.step, 300))));
      const points = queryBuckets(repo as HistoryRepo, req.params.deviceId, req.params.property, from, to, step);
      return { points };
    },
  );
}
