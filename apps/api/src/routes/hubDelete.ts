import type { FastifyInstance } from 'fastify';
import { HubId } from '@devicenet/shared';
import { db } from '../firebase.js';
import { firebaseAuth } from '../auth/firebaseAuth.js';
import { hubAuth } from '../auth/hubAuth.js';
import { sendError } from '../errors.js';
import { rateLimitFor } from '../rateLimit.js';
import { deleteHubCascade } from '../services/hubCascade.js';

/** DELETE /v1/hubs/{hubId} — FR-A06. POST /v1/hubs/{hubId}/unclaim — hub self-unclaim. */
export async function hubDeleteRoutes(app: FastifyInstance) {
  app.delete<{ Params: { hubId: string } }>('/v1/hubs/:hubId', { preHandler: firebaseAuth }, async (req, reply) => {
    const tenant = req.tenant;
    if (!tenant) return sendError(reply, 403, 'FORBIDDEN', 'no tenant');
    const { hubId } = req.params;
    if (!HubId.safeParse(hubId).success) return sendError(reply, 400, 'INVALID_HUB', 'invalid hubId');

    const fs = db();
    const hubRef = fs.doc(`tenants/${tenant}/hubs/${hubId}`);
    const hubSnap = await hubRef.get();
    if (!hubSnap.exists) {
      // Allow idempotent retry if partially deleted (e.g. devices remain)
      const lingering = await fs.collection(`tenants/${tenant}/devices`).where('hubId', '==', hubId).limit(1).get();
      if (lingering.empty) {
        return sendError(reply, 404, 'NOT_FOUND', 'hub not found');
      }
    }

    await deleteHubCascade(tenant, hubId, req.log);
    return reply.code(204).send();
  });

  app.post<{ Params: { hubId: string } }>(
    '/v1/hubs/:hubId/unclaim',
    {
      preHandler: hubAuth,
      config: rateLimitFor('unclaim'),
    },
    async (req, reply) => {
      const { hubId } = req.params;
      if (!HubId.safeParse(hubId).success) return sendError(reply, 400, 'INVALID_HUB', 'invalid hubId');
      if (req.hubId !== hubId || !req.hubTenant) {
        return sendError(reply, 403, 'FORBIDDEN', 'hub mismatch');
      }

      await deleteHubCascade(req.hubTenant, hubId, req.log);
      return reply.code(204).send();
    },
  );
}
