import type { FastifyInstance } from 'fastify';
import { emqxToken } from '../auth/emqxToken.js';
import { HUB_USERNAME_RE, verifyHubPassword } from '../services/hubCache.js';

/** POST /v1/emqx/auth — EMQX HTTP authn for `hub:<hubId>` users. Always 200 `{result}`. */
export async function emqxAuthRoutes(app: FastifyInstance) {
  app.post('/v1/emqx/auth', { preHandler: emqxToken }, async (req) => {
    const b = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const m = typeof b.username === 'string' ? HUB_USERNAME_RE.exec(b.username) : null;
    if (!m || typeof b.password !== 'string' || b.password === '' || b.password.length > 256) {
      return { result: 'deny' };
    }
    const tenant = await verifyHubPassword(m[1]!, b.password);
    return tenant ? { result: 'allow', is_superuser: false } : { result: 'deny' };
  });
}
