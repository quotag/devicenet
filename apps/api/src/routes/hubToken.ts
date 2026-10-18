import type { FastifyInstance } from 'fastify';
import { hubAuth } from '../auth/hubAuth.js';
import { sendError } from '../errors.js';
import { mintHubToken } from '../services/hubCredential.js';

/** POST /v1/hubs/{hubId}/token — FR-A07: hub secret → fresh Firebase custom token. */
export async function hubTokenRoutes(app: FastifyInstance) {
  app.post<{ Params: { hubId: string } }>('/v1/hubs/:hubId/token', { preHandler: hubAuth }, async (req, reply) => {
    if (req.params.hubId !== req.hubId || !req.hubTenant) return sendError(reply, 403, 'FORBIDDEN', 'hub mismatch');
    reply.header('cache-control', 'no-store');
    return { firebaseCustomToken: await mintHubToken(req.hubTenant, req.hubId) };
  });
}
