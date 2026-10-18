import type { FastifyContextConfig, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import { Hub, HubSecret, SiteId } from '@devicenet/shared';
import { db } from '../firebase.js';
import { firebaseAuth } from '../auth/firebaseAuth.js';
import { ApiError, sendError } from '../errors.js';
import { rateLimitFor } from '../rateLimit.js';
import { CLAIM_CODE_RE, normalizeClaimCode } from '../services/claimCode.js';
import { newHubSecret, sha256Hex } from '../services/secrets.js';
import { buildCredential, mintHubToken } from '../services/hubCredential.js';
import { seal } from '../services/sealedBox.js';

const Body = z.object({
  code: z.string(),
  siteId: z.string(),
  name: z.string().trim().min(1).max(60),
});

/**
 * POST /v1/hubs/claim — research R6. Custom token + secret are created before the transaction
 * (no non-Firestore I/O inside retries); the tx validates the code, site, and creates the hub.
 */
export async function claimRoutes(app: FastifyInstance) {
  app.post('/v1/hubs/claim', { preHandler: firebaseAuth, config: rateLimitFor('claim') as FastifyContextConfig }, async (req, reply) => {
    const tenantId = req.tenant;
    if (!tenantId) return sendError(reply, 403, 'NO_TENANT', 'call /v1/tenants/bootstrap first');
    const body = Body.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, 400, 'INVALID_BODY', body.error.issues[0]?.message ?? 'invalid body');
    const code = normalizeClaimCode(body.data.code);
    if (!CLAIM_CODE_RE.test(code)) return sendError(reply, 400, 'INVALID_CODE', 'invalid code format');
    const { siteId, name } = body.data;
    if (!SiteId.safeParse(siteId).success) return sendError(reply, 400, 'INVALID_SITE', 'invalid siteId');

    const uid = req.uid!;
    const hubId = `hub_${ulid()}`;
    const secret = newHubSecret();
    const customToken = await mintHubToken(tenantId, hubId);
    const credentialJson = JSON.stringify(buildCredential({ tenantId, hubId, siteId, secret, customToken }));

    const fs = db();
    const codeRef = fs.collection('claimCodes').doc(code);
    const siteRef = fs.doc(`tenants/${tenantId}/sites/${siteId}`);
    const hubRef = fs.doc(`tenants/${tenantId}/hubs/${hubId}`);
    const secretRef = hubRef.collection('private').doc('secret');

    await fs.runTransaction(async (tx) => {
      const [cc, site] = await Promise.all([tx.get(codeRef), tx.get(siteRef)]);
      if (!cc.exists) throw new ApiError(400, 'INVALID_CODE', 'unknown code');
      const now = Date.now();
      if ((cc.get('expiresAt') as number) < now) throw new ApiError(400, 'EXPIRED', 'code expired');
      if (cc.get('used') === true) {
        // TODO-OQ-3: a used code claimed by another tenant means the hub belongs elsewhere
        if (cc.get('tenantId') !== tenantId) {
          throw new ApiError(409, 'HUB_BELONGS_TO_OTHER_TENANT', 'hub is claimed by another account');
        }
        throw new ApiError(400, 'ALREADY_USED', 'code already used');
      }
      if (!site.exists) throw new ApiError(400, 'INVALID_SITE', 'site not found in your tenant');

      const credential = await seal(credentialJson, cc.get('hubPubKey') as string);
      const hub = Hub.parse({
        id: hubId,
        siteId,
        name,
        claimedAt: now,
        claimedBy: uid,
        online: false,
        lastSeen: 0,
        drivers: ['zigbee2mqtt'],
      });
      tx.create(hubRef, hub);
      tx.create(secretRef, HubSecret.parse({ secretHash: sha256Hex(secret), alg: 'sha256', rotatedAt: now }));
      tx.update(codeRef, { used: true, tenantId, hubId, credential });
    });
    return { hubId };
  });
}
