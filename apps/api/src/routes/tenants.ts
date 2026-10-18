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

async function findExistingTenant(uid: string): Promise<{ tenantId: string; siteId: string } | null> {
  const user = await auth().getUser(uid);
  let tenantId = user.customClaims?.tenant as string | undefined;
  if (!tenantId) {
    // claims are set last; recover from a crash between the commit and setCustomUserClaims
    const q = await db().collectionGroup('members').where('uid', '==', uid).limit(1).get();
    tenantId = q.docs[0]?.ref.parent.parent?.id;
  }
  if (!tenantId) return null;
  const sites = await db().collection(`tenants/${tenantId}/sites`).orderBy('order').limit(1).get();
  const siteId = sites.docs[0]?.id;
  if (!siteId) return null;
  return { tenantId, siteId };
}

export async function tenantsRoutes(app: FastifyInstance) {
  app.post('/v1/tenants/bootstrap', { preHandler: firebaseAuth }, async (req, reply) => {
    const body = Body.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'invalid body');
    const uid = req.uid!;

    const existing = await findExistingTenant(uid);
    if (existing) {
      const claims = (await auth().getUser(uid)).customClaims;
      if (claims?.tenant !== existing.tenantId || claims?.role !== 'user') {
        await auth().setCustomUserClaims(uid, userClaims(existing.tenantId));
      }
      return { ...existing, created: false };
    }

    const now = Date.now();
    const tenantId = `tenant_${ulid()}`;
    const siteId = `site_${ulid()}`;
    const t = db().doc(`tenants/${tenantId}`);
    const batch = db().batch();
    batch.create(t, {
      id: tenantId,
      name: req.displayName || 'Nhà của tôi',
      ownerUid: uid,
      createdAt: now,
      plan: 'home',
    });
    batch.create(t.collection('members').doc(uid), {
      uid,
      role: 'owner',
      email: req.email ?? `${uid}@unknown.invalid`,
      ...(req.displayName ? { displayName: req.displayName } : {}),
      ...(req.photoUrl ? { photoUrl: req.photoUrl } : {}),
      joinedAt: now,
    });
    batch.create(t.collection('sites').doc(siteId), {
      id: siteId,
      name: 'Nhà',
      timezone: body.data.timezone ?? 'Asia/Ho_Chi_Minh',
      ...(body.data.lat !== undefined ? { lat: body.data.lat } : {}),
      ...(body.data.lng !== undefined ? { lng: body.data.lng } : {}),
      order: 0,
      createdAt: now,
    });
    await batch.commit();
    await auth().setCustomUserClaims(uid, userClaims(tenantId));
    return { tenantId, siteId, created: true };
  });

  // D-16 placeholder: no deletion performed in v1 (UI hides it)
  app.delete('/v1/tenants/me', { preHandler: firebaseAuth }, async (_req, reply) => reply.code(202).send({ scheduled: false }));
}
