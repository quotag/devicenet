import type { FastifyInstance } from 'fastify';
import { HubStatus, parseTopic } from '@devicenet/shared';
import { db } from '../firebase.js';
import { emqxToken } from '../auth/emqxToken.js';

interface WebhookBody {
  topic?: unknown;
  payload?: unknown;
  publish_received_at?: unknown;
}

/** POST /v1/emqx/webhook — mirrors hub `status` into tenants/{t}/hubs/{h}. Everything else is a 204 no-op. */
export async function webhookRoutes(app: FastifyInstance) {
  app.post('/v1/emqx/webhook', { preHandler: emqxToken }, async (req, reply) => {
    const body = (req.body ?? {}) as WebhookBody;
    if (typeof body.topic !== 'string') return reply.code(204).send();
    const parsed = parseTopic(body.topic);
    // events (OQ-2) and every non-status topic: no-op
    if (!parsed || parsed.kind !== 'status') return reply.code(204).send();

    let raw: unknown = body.payload;
    if (typeof raw === 'string') {
      if (raw.trim() === '') return reply.code(204).send();
      try {
        raw = JSON.parse(raw);
      } catch {
        return reply.code(204).send();
      }
    }
    if (raw == null) return reply.code(204).send();
    const st = HubStatus.safeParse(raw);
    if (!st.success) return reply.code(204).send();
    const s = st.data;
    const receivedAt =
      typeof body.publish_received_at === 'number' ? body.publish_received_at : Date.now();
    const isLwt = s.ts === 0;

    const ref = db().doc(`tenants/${parsed.tenantId}/hubs/${parsed.hubId}`);
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return; // unknown hub
      const stored = (snap.get('lastSeen') as number | undefined) ?? 0;
      if (isLwt) {
        tx.update(ref, { online: false, lastSeen: receivedAt });
        return;
      }
      if (s.ts < stored) return; // stale
      const upd: Record<string, unknown> = { online: s.online, lastSeen: s.ts, agentVersion: s.agentVersion };
      if (s.z2mVersion !== undefined) upd.z2mVersion = s.z2mVersion;
      if (s.platform !== undefined) upd.platform = s.platform;
      if (s.lanUrl !== undefined) upd.lanUrl = s.lanUrl;
      if (s.ip !== undefined) upd.ip = s.ip;
      if (s.deviceCount !== undefined) upd.deviceCount = s.deviceCount;
      tx.update(ref, upd);
    });
    return reply.code(204).send();
  });
}
