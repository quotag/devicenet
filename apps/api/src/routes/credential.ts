import type { FastifyInstance } from 'fastify';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase.js';
import { ApiError, sendError } from '../errors.js';
import { CLAIM_CODE_RE } from '../services/claimCode.js';

/**
 * GET /v1/hubs/claim-codes/{code}/credential — single read (FR-A03). 404 until claimed;
 * 410 when expired, consumed (api-internal `credentialTakenAt`, data-model §5) or unknown.
 */
export async function credentialRoutes(app: FastifyInstance) {
  app.get<{ Params: { code: string } }>('/v1/hubs/claim-codes/:code/credential', async (req, reply) => {
    const { code } = req.params;
    if (!CLAIM_CODE_RE.test(code)) return sendError(reply, 400, 'INVALID_CODE', 'invalid code format');
    const ref = db().collection('claimCodes').doc(code);
    const credential = await db().runTransaction(async (tx) => {
      const cc = await tx.get(ref);
      if (!cc.exists) throw new ApiError(410, 'GONE', 'unknown code');
      if (cc.get('credentialTakenAt') !== undefined) throw new ApiError(410, 'CONSUMED', 'credential already taken');
      const now = Date.now();
      if ((cc.get('expiresAt') as number) < now) throw new ApiError(410, 'EXPIRED', 'code expired');
      const blob = cc.get('credential') as string | undefined;
      if (cc.get('used') !== true || !blob) throw new ApiError(404, 'NOT_CLAIMED', 'not claimed yet');
      tx.update(ref, { credential: FieldValue.delete(), credentialTakenAt: now });
      return blob;
    });
    reply.header('cache-control', 'no-store');
    return { credential };
  });
}
