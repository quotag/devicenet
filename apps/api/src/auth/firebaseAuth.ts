import type { FastifyReply, FastifyRequest } from 'fastify';
import { auth } from '../firebase.js';
import { sendError } from '../errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    uid?: string;
    tenant?: string;
    email?: string;
    displayName?: string;
    photoUrl?: string;
  }
}

/** preHandler: verifies `Authorization: Bearer <ID token>`; exposes uid + tenant claim. */
export async function firebaseAuth(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return sendError(reply, 401, 'UNAUTHENTICATED', 'missing bearer token');
  try {
    const t = await auth().verifyIdToken(h.slice(7));
    if (t.role === 'hub') return sendError(reply, 403, 'FORBIDDEN', 'hub token not allowed');
    req.uid = t.uid;
    req.tenant = typeof t.tenant === 'string' ? t.tenant : undefined;
    req.email = t.email;
    req.displayName = t.name;
    req.photoUrl = t.picture;
  } catch {
    return sendError(reply, 401, 'UNAUTHENTICATED', 'invalid token');
  }
}
