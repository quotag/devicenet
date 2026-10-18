import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../firebase.js';
import { sendError } from '../errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    hubId?: string;
    hubTenant?: string;
  }
}

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * preHandler: `Authorization: Hub <hubId>:<secret>`. Looks the secret hash up with a
 * collectionGroup('private') equality query (no hubId field stored), then checks the
 * parent path is the claimed hub.
 */
export async function hubAuth(req: FastifyRequest, reply: FastifyReply) {
  const m = /^Hub (hub_[0-9A-Z]{26}):(.+)$/.exec(req.headers.authorization ?? '');
  if (!m) return sendError(reply, 401, 'UNAUTHENTICATED', 'missing hub credentials');
  const hubId = m[1]!;
  const hash = sha256Hex(m[2]!);
  const snap = await db().collectionGroup('private').where('secretHash', '==', hash).get();
  for (const doc of snap.docs) {
    // path: tenants/{t}/hubs/{hubId}/private/secret
    const hubRef = doc.ref.parent.parent;
    if (doc.id !== 'secret' || !hubRef || hubRef.id !== hubId) continue;
    req.hubId = hubId;
    req.hubTenant = hubRef.parent.parent?.id;
    return;
  }
  return sendError(reply, 401, 'UNAUTHENTICATED', 'invalid hub credentials');
}
