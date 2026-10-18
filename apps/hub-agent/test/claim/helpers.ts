import { createRequire } from 'node:module';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HubCredential } from '../../src/claim/credentials.js';

const sodium = createRequire(import.meta.url)('libsodium-wrappers') as {
  ready: Promise<void>;
  crypto_box_seal(m: Uint8Array, pk: Uint8Array): Uint8Array;
};

export async function seal(plaintext: string, pkB64: string): Promise<string> {
  await sodium.ready;
  return Buffer.from(sodium.crypto_box_seal(new TextEncoder().encode(plaintext), Buffer.from(pkB64, 'base64'))).toString('base64');
}

export const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

export function makeCredential(apiBaseUrl: string, over: Partial<HubCredential> = {}): HubCredential {
  return {
    tenantId: 'tenant_01J0000000000000000000000T',
    hubId: 'hub_01J0000000000000000000000H',
    siteId: 'site_01J0000000000000000000000S',
    mqtt: { host: '127.0.0.1', port: 1884, wssPort: 8084, username: 'hub:hub_01J0000000000000000000000H', password: 'sekret' },
    firebaseCustomToken: 'tok-1',
    apiBaseUrl,
    ...over,
  };
}

/** In-process fake of the api claim endpoints. The test decides when a code is claimed. */
export class StubApi {
  app: FastifyInstance = Fastify();
  url = '';
  codes: { code: string; hubPubKey: string; agentVersion: string; platform: string }[] = [];
  polls: string[] = [];
  /** code → sealed credential (200 once, then 410) */
  staged = new Map<string, string>();
  gone = new Set<string>();
  ttlMs = 15 * 60_000;
  pollEverySec = 0.02;
  failNextCodes = 0;
  tokenCalls: string[] = [];
  private n = 0;

  async start(): Promise<this> {
    this.app.post('/v1/hubs/claim-codes', async (req, reply) => {
      if (this.failNextCodes > 0) {
        this.failNextCodes--;
        return reply.status(503).send({ error: { code: 'UNAVAILABLE' } });
      }
      const b = req.body as { hubPubKey: string; agentVersion: string; platform: string };
      const code = `ABCDEF${'23456789'[this.n % 8]}${'23456789'[Math.floor(this.n / 8) % 8]}`;
      this.n++;
      this.codes.push({ code, ...b });
      return reply.status(201).send({ code, expiresAt: Date.now() + this.ttlMs, pollEverySec: this.pollEverySec });
    });
    this.app.get('/v1/hubs/claim-codes/:code/credential', async (req, reply) => {
      const { code } = req.params as { code: string };
      this.polls.push(code);
      if (this.gone.has(code)) return reply.status(410).send({ error: { code: 'GONE' } });
      const c = this.staged.get(code);
      if (!c) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
      this.staged.delete(code);
      this.gone.add(code);
      return reply.status(200).send({ credential: c });
    });
    this.app.post('/v1/hubs/:hubId/token', async (req, reply) => {
      const auth = String(req.headers.authorization ?? '');
      this.tokenCalls.push(auth);
      const { hubId } = req.params as { hubId: string };
      if (auth !== `Hub ${hubId}:sekret`) return reply.status(401).send({ error: { code: 'UNAUTHENTICATED' } });
      return { firebaseCustomToken: `tok-${this.tokenCalls.length + 1}` };
    });
    this.url = await this.app.listen({ host: '127.0.0.1', port: 0 });
    return this;
  }

  async claim(code: string, cred: HubCredential | string): Promise<void> {
    const entry = this.codes.find((c) => c.code === code)!;
    this.staged.set(code, await seal(typeof cred === 'string' ? cred : JSON.stringify(cred), entry.hubPubKey));
  }

  close() {
    return this.app.close();
  }
}

export async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}
