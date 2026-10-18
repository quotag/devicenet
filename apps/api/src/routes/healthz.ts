import type { FastifyInstance } from 'fastify';

export async function healthzRoutes(app: FastifyInstance) {
  app.get('/healthz', async () => ({ ok: true }));
}
