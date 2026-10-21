import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { ApiError, sendError } from './errors.js';
import { registerRateLimit } from './rateLimit.js';
import { healthzRoutes } from './routes/healthz.js';
import { tenantsRoutes } from './routes/tenants.js';
import { claimCodesRoutes } from './routes/claimCodes.js';
import { claimRoutes } from './routes/claim.js';
import { credentialRoutes } from './routes/credential.js';
import { hubTokenRoutes } from './routes/hubToken.js';
import { hubDeleteRoutes } from './routes/hubDelete.js';
import { emqxAuthRoutes } from './routes/emqxAuth.js';
import { emqxAclRoutes } from './routes/emqxAcl.js';
import { webhookRoutes } from './routes/webhook.js';
import { type ApiConfig, getConfig } from './config.js';

export interface ServerOptions {
  logger?: boolean;
  config?: ApiConfig;
  /** extra allowed CORS origins; default env HOSTING_ORIGIN (comma separated) */
  hostingOrigins?: string[];
}

export async function buildServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const cfg = opts.config ?? getConfig();
  const loggerOpt =
    opts.logger === true
      ? {
          level: process.env.LOG_LEVEL || 'info',
          redact: [
            'req.headers.authorization',
            'req.headers["x-emqx-token"]',
            'req.headers["x-dn-token"]',
            'req.headers.cookie',
            'password',
            'secret',
            'customToken',
            '*.password',
            '*.secret',
            '*.customToken',
          ],
        }
      : (opts.logger ?? false);

  const app = Fastify({
    logger: loggerOpt,
    trustProxy: cfg.trustProxy ?? ((_addr: string, hop: number) => hop <= 1),
  });
  const hosting = opts.hostingOrigins ?? cfg.hostingOrigins;
  const allowLocalhost = cfg.isEmulator || cfg.nodeEnv === 'test';

  await app.register(helmet);
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const isAllowed = hosting.includes(origin) || (allowLocalhost && /^http:\/\/localhost(:\d+)?$/.test(origin));
      cb(null, isAllowed);
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-EMQX-Token', 'X-DN-Token'],
  });
  await registerRateLimit(app);

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof ApiError) return sendError(reply, err.status, err.code, err.message);
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    const code = status === 429 ? 'RATE_LIMITED' : status === 400 ? 'INVALID_BODY' : status >= 500 ? 'INTERNAL' : 'ERROR';
    return sendError(reply, status, code, status >= 500 ? 'internal error' : err.message);
  });
  app.setNotFoundHandler((_req, reply) => sendError(reply, 404, 'NOT_FOUND', 'not found'));

  for (const r of [
    healthzRoutes, tenantsRoutes, claimCodesRoutes, claimRoutes, credentialRoutes,
    hubTokenRoutes, hubDeleteRoutes, emqxAuthRoutes, emqxAclRoutes, webhookRoutes,
  ]) {
    await app.register(r);
  }
  return app;
}
