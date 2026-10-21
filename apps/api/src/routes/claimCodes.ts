import type { FastifyContextConfig, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Timestamp } from 'firebase-admin/firestore';
import type { ClaimCode } from '@devicenet/shared';
import { db } from '../firebase.js';
import { sendError } from '../errors.js';
import { rateLimitFor } from '../rateLimit.js';
import { CLAIM_TTL_MS, newClaimCode } from '../services/claimCode.js';
import { isValidPubKey } from '../services/sealedBox.js';

const Body = z.object({
  hubPubKey: z.string().refine(isValidPubKey, 'hubPubKey must be base64 of a 32-byte X25519 key'),
  agentVersion: z.string().min(1).max(40),
  platform: z.enum(['windows', 'linux']),
});

const ALREADY_EXISTS = 6; // gRPC status code returned by Firestore create() on collision
const TTL_AFTER_EXPIRES_MS = 24 * 60 * 60 * 1000; // 24h retention after expiry for audit/recovery

/** POST /v1/hubs/claim-codes — unauthenticated, called by an unclaimed hub. */
export async function claimCodesRoutes(app: FastifyInstance) {
  app.post('/v1/hubs/claim-codes', { config: rateLimitFor('claim-codes') as FastifyContextConfig }, async (req, reply) => {
    const body = Body.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, 400, 'INVALID_BODY', body.error.issues[0]?.message ?? 'invalid body');

    for (let attempt = 0; attempt < 5; attempt++) {
      const now = Date.now();
      const expiresAt = now + CLAIM_TTL_MS;
      const expireAt = Timestamp.fromMillis(expiresAt + TTL_AFTER_EXPIRES_MS);
      const doc: z.infer<typeof ClaimCode> = {
        code: newClaimCode(),
        hubPubKey: body.data.hubPubKey,
        createdAt: now,
        expiresAt,
        expireAt,
        used: false,
      };
      try {
        await db().collection('claimCodes').doc(doc.code).create(doc);
      } catch (e) {
        if ((e as { code?: number }).code === ALREADY_EXISTS) continue;
        throw e;
      }
      return reply.status(201).send({ code: doc.code, expiresAt: doc.expiresAt, pollEverySec: 5 });
    }
    return sendError(reply, 503, 'UNAVAILABLE', 'could not allocate a claim code');
  });
}
