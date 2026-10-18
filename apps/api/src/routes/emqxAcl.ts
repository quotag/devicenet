import type { FastifyInstance } from 'fastify';
import { emqxToken } from '../auth/emqxToken.js';
import { HUB_USERNAME_RE, hubSecretExists } from '../services/hubCache.js';

/** Pure ACL decision for a hub. For subscribe, `topic` is the filter. */
export function hubAclAllows(hubId: string, action: string, topic: string, tenant: string): boolean {
  const base = `t/${tenant}/h/${hubId}`;
  if (action === 'publish') return (topic === base || topic.startsWith(`${base}/`)) && !/[+#]/.test(topic);
  if (action === 'subscribe') {
    return topic === `${base}/d/+/set` || topic === `${base}/d/+/cmd` || topic === `${base}/cmd`;
  }
  return false;
}

/** POST /v1/emqx/acl — EMQX HTTP authz for hubs. Always 200 `{result}`. */
export async function emqxAclRoutes(app: FastifyInstance) {
  app.post('/v1/emqx/acl', { preHandler: emqxToken }, async (req) => {
    const b = (req.body ?? {}) as { username?: unknown; topic?: unknown; action?: unknown };
    const m = typeof b.username === 'string' ? HUB_USERNAME_RE.exec(b.username) : null;
    if (!m || typeof b.topic !== 'string' || typeof b.action !== 'string') return { result: 'deny' };
    const hubId = m[1]!;
    const tm = new RegExp(`^t/([A-Za-z0-9_]+)/h/${hubId}(/|$)`).exec(b.topic);
    if (!tm) return { result: 'deny' };
    const tenant = tm[1]!;
    if (!hubAclAllows(hubId, b.action, b.topic, tenant)) return { result: 'deny' };
    return (await hubSecretExists(tenant, hubId)) ? { result: 'allow' } : { result: 'deny' };
  });
}
