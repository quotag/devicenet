import type { FastifyInstance } from 'fastify';
import type { LanDeps } from '../server.js';

export function healthRoute(app: FastifyInstance, deps: LanDeps): void {
  app.get('/api/health', async () => {
    const h = deps.getHealth();
    return { ...h, ts: (deps.now ?? Date.now)() };
  });
}
