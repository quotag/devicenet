import type { FastifyInstance } from 'fastify';

export async function healthzRoutes(app: FastifyInstance) {
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/health', async () => ({ ok: true }));
  app.get('/api/health', async () => ({ ok: true }));
}
