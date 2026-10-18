import type { FastifyInstance } from 'fastify';
import { HubId } from '@devicenet/shared';
import { db } from '../firebase.js';
import { firebaseAuth } from '../auth/firebaseAuth.js';
import { sendError } from '../errors.js';
import { kickClient } from '../services/emqxAdmin.js';
import { clearHubCache } from '../services/hubCache.js';

/** DELETE /v1/hubs/{hubId} — FR-A06. */
export async function hubDeleteRoutes(app: FastifyInstance) {
  app.delete<{ Params: { hubId: string } }>('/v1/hubs/:hubId', { preHandler: firebaseAuth }, async (req, reply) => {
    const tenant = req.tenant;
    if (!tenant) return sendError(reply, 403, 'FORBIDDEN', 'no tenant');
    const { hubId } = req.params;
    if (!HubId.safeParse(hubId).success) return sendError(reply, 400, 'INVALID_HUB', 'invalid hubId');
    const fs = db();
    const hubRef = fs.doc(`tenants/${tenant}/hubs/${hubId}`);
    if (!(await hubRef.get()).exists) return sendError(reply, 404, 'NOT_FOUND', 'hub not found');

    // 1. revoke credentials first, then drop the live connection
    await hubRef.collection('private').doc('secret').delete();
    clearHubCache(hubId);
    await kickClient(`hub-${hubId}`, req.log);

    // 2. cascade
    const now = Date.now();
    const [devices, rules, scenes] = await Promise.all(
      ['devices', 'rules', 'scenes'].map((c) =>
        fs.collection(`tenants/${tenant}/${c}`).where('hubId', '==', hubId).get(),
      ),
    );
    const ops: Array<(b: FirebaseFirestore.WriteBatch) => void> = [];
    for (const d of devices!.docs) {
      if (d.get('status') !== 'removed') {
        ops.push((b) => b.update(d.ref, { status: 'removed', removedAt: now, updatedAt: now }));
      }
    }
    for (const d of [...rules!.docs, ...scenes!.docs]) {
      ops.push((b) => b.update(d.ref, { lastResult: 'broken', brokenReason: 'Hub đã bị xóa' }));
    }
    ops.push((b) => b.delete(hubRef));
    for (let i = 0; i < ops.length; i += 400) {
      const b = fs.batch();
      for (const op of ops.slice(i, i + 400)) op(b);
      await b.commit();
    }
    return reply.code(204).send();
  });
}
