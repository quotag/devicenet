import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

const HOUR = 60 * 60 * 1000;

export const rateLimitDisabled = () => process.env.DN_EMULATOR === '1';

/** Registers the plugin (non-global). Routes opt in with `config: rateLimitFor(...)`. */
export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, { global: false });
}

export function rateLimitFor(kind: 'claim-codes' | 'claim') {
  if (rateLimitDisabled()) return { rateLimit: false as const };
  if (kind === 'claim-codes') return { rateLimit: { max: 10, timeWindow: HOUR } };
  return {
    rateLimit: {
      max: 20,
      timeWindow: HOUR,
      // run after the route's firebaseAuth preHandler so req.uid is set (default onRequest runs before auth → IP)
      hook: 'preHandler' as const,
      keyGenerator: (req: { uid?: string; ip: string }) => req.uid ?? req.ip,
    },
  };
}
