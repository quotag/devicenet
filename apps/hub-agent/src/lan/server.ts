import Fastify, { type FastifyInstance } from 'fastify';
import type { HubIdentity } from '../core/publisher.js';
import type { EventsRepo } from '../store/events.js';
import type { HistoryRepo } from '../store/history.js';
import type { SnapshotRepo } from '../store/snapshot.js';
import { isPrivateIp } from './privateIpGuard.js';
import { S } from './strings.vi.js';
import { configRoute } from './routes/config.js';
import { eventsRoute } from './routes/events.js';
import { healthRoute } from './routes/health.js';
import { historyRoute } from './routes/history.js';
import { setupRoute } from './routes/setup.js';
import { staticRoute } from './routes/static.js';

export interface HealthInfo {
  ok: boolean;
  agentVersion: string;
  z2m: 'online' | 'offline' | 'starting';
  z2mVersion?: string;
  mqttLocal: boolean;
  mqttCloud: boolean;
  firestore: boolean;
  claimed: boolean;
  lastError?: string;
}

export interface ClaimInfo {
  claimed: boolean;
  code?: string;
  /** epoch ms */
  expiresAt?: number;
}

/** Everything the LAN server needs from the rest of the agent (wired in B13). */
export interface LanDeps {
  getHealth(): HealthInfo;
  getClaim(): ClaimInfo;
  getIdentity(): Pick<HubIdentity, 'tenantId' | 'hubId'> | null;
  snapshot: Pick<SnapshotRepo, 'get' | 'all'>;
  /** B17 */
  history?: Pick<HistoryRepo, 'buckets'>;
  events?: Pick<EventsRepo, 'query'>;
  /** resolved path of the LAN web build (config lan.webDir) */
  webDir: string;
  now?: () => number;
  resetClaim?: () => Promise<boolean | void>;
  csrfToken?: string;
}

export interface LanServerOptions {
  bind: string;
  port: number;
  /** disable the private-IP guard (tests only) */
  allowPublic?: boolean;
}

export function buildLanApp(deps: LanDeps, opts: { allowPublic?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const parsed = Object.fromEntries(new URLSearchParams(body as string));
      done(null, parsed);
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  if (!opts.allowPublic) {
    app.addHook('onRequest', async (req, reply) => {
      if (!isPrivateIp(req.ip)) return reply.code(403).send({ error: 'forbidden', message: S.forbidden });
    });
  }
  healthRoute(app, deps);
  configRoute(app, deps);
  setupRoute(app, deps);
  historyRoute(app, deps.history, deps.now);
  eventsRoute(app, deps.events);
  staticRoute(app, deps.webDir);
  return app;
}

export async function startLanServer(deps: LanDeps, opts: LanServerOptions): Promise<{ app: FastifyInstance; close(): Promise<void> }> {
  const app = buildLanApp(deps, opts);
  await app.listen({ host: opts.bind, port: opts.port });
  return { app, close: () => app.close() };
}
