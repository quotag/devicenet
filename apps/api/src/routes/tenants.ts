import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import { auth, db } from '../firebase.js';
import { firebaseAuth } from '../auth/firebaseAuth.js';
import { sendError } from '../errors.js';

const Body = z
  .object({
    timezone: z.string().min(1).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .default({});

export const userClaims = (tenantId: string) => ({
  tenant: tenantId,
  role: 'user',
  acl: {
    pub: [`t/${tenantId}/h/+/d/+/set`, `t/${tenantId}/h/+/cmd`],
    sub: [`t/${tenantId}/#`],
  },
});

interface UserTenantDoc {
  tenantId: string;
  siteId: string;
  createdAt: number;
}

export async function findExistingTenant(uid: string): Promise<{ tenantId: string; siteId: string } | null> {
  // Check userTenants collection first (server-only mapping doc)
  const utDoc = await db().doc(`userTenants/${uid}`).get();
  if (utDoc.exists) {
    const data = utDoc.data() as UserTenantDoc;
    return { tenantId: data.tenantId, siteId: data.siteId };
  }

  // Fallback if tenantId exists on claims but not in userTenants (e.g. legacy/migrated)
  const user = await auth().getUser(uid);
  const tenantId = user.customClaims?.tenant as string | undefined;
  if (tenantId) {
    const sites = await db().collection(`tenants/${tenantId}/sites`).orderBy('order').limit(1).get();
    const siteId = sites.docs[0]?.id;
    if (siteId) {
      await db().doc(`userTenants/${uid}`).set({ tenantId, siteId, createdAt: Date.now() });
      return { tenantId, siteId };
    }
  }

  return null;
}

export async function tenantsRoutes(app: FastifyInstance) {
  app.post('/v1/tenants/bootstrap', { preHandler: firebaseAuth }, async (req, reply) => {
    const body = Body.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'invalid body');
    const uid = req.uid!;

    const userTenantRef = db().doc(`userTenants/${uid}`);

    // Atomic transaction prevents race conditions when concurrent requests bootstrap the same user
    const result = await db().runTransaction(async (tx) => {
      const utSnap = await tx.get(userTenantRef);
      if (utSnap.exists) {
        const data = utSnap.data() as UserTenantDoc;
        return { tenantId: data.tenantId, siteId: data.siteId, created: false };
      }

      const now = Date.now();
      const tenantId = `tenant_${ulid()}`;
      const siteId = `site_${ulid()}`;
      const t = db().doc(`tenants/${tenantId}`);

      tx.create(t, {
        id: tenantId,
        name: req.displayName || 'Nhà của tôi',
        ownerUid: uid,
        createdAt: now,
        plan: 'home',
      });
      tx.create(t.collection('members').doc(uid), {
        uid,
        role: 'owner',
        email: req.email ?? `${uid}@unknown.invalid`,
        ...(req.displayName ? { displayName: req.displayName } : {}),
        ...(req.photoUrl ? { photoUrl: req.photoUrl } : {}),
        joinedAt: now,
      });
      tx.create(t.collection('sites').doc(siteId), {
        id: siteId,
        name: 'Nhà',
        timezone: body.data.timezone ?? 'Asia/Ho_Chi_Minh',
        ...(body.data.lat !== undefined ? { lat: body.data.lat } : {}),
        ...(body.data.lng !== undefined ? { lng: body.data.lng } : {}),
        order: 0,
        createdAt: now,
      });
      tx.create(userTenantRef, {
        tenantId,
        siteId,
        createdAt: now,
      });

      return { tenantId, siteId, created: true };
    });

    const user = await auth().getUser(uid);
    const claims = user.customClaims;
    if (claims?.tenant !== result.tenantId || claims?.role !== 'user') {
      await auth().setCustomUserClaims(uid, userClaims(result.tenantId));
    }

    return result;
  });

  // D-16 placeholder: no deletion performed in v1 (UI hides it)
  app.delete('/v1/tenants/me', { preHandler: firebaseAuth }, async (_req, reply) => reply.code(202).send({ scheduled: false }));
}
