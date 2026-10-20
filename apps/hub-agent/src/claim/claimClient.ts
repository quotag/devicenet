import { EventEmitter } from 'node:events';
import { z } from 'zod';
import type { Logger } from '../log/index.js';
import { realClock, realTimers, type Clock, type TimerHandle, type TimerHost } from '../core/clock.js';
import { HubCredential, deleteCredentials, readCredentials, writeCredentials } from './credentials.js';
import { httpJson, type HttpJson } from './http.js';
import { loadOrCreateKeyPair, openSealed, type HubKeyPair } from './keys.js';

/** 201 body of POST /v1/hubs/claim-codes. pollEverySec tolerated as any positive number (tests). */
const ClaimCodeResponse = z.object({
  code: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/),
  expiresAt: z.number().int(),
  pollEverySec: z.number().positive(),
});
const CredentialResponse = z.object({ credential: z.string().min(1) });

export type ClaimPhase = 'idle' | 'requesting' | 'waiting' | 'claimed' | 'stopped';

export interface ClaimClientOptions {
  apiBaseUrl: string;
  hubKeyPath: string;
  credentialsPath: string;
  agentVersion: string;
  platform: 'windows' | 'linux';
  log: Pick<Logger, 'info' | 'warn' | 'error' | 'debug'>;
  http?: HttpJson;
  clock?: Clock;
  timers?: TimerHost;
  /** backoff after a failed claim-code request: starts here, doubles, capped at retryMaxMs */
  retryMs?: number;
  retryMaxMs?: number;
}

export interface ClaimClientEvents {
  claimed: [HubCredential];
  code: [{ code: string; expiresAt: number }];
  unclaimed: [];
}

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * FR-H02 claim state machine (data-model 000 §3.1):
 * requesting → POST claim-codes → waiting (poll credential every pollEverySec; D-09 exception)
 *   404 → keep polling until expiresAt, then new code; 410 → new code;
 *   200 → decrypt + validate + save credentials.json → claimed (emit `claimed`, no restart).
 */
export class ClaimClient extends EventEmitter<ClaimClientEvents> {
  private phase: ClaimPhase = 'idle';
  private code: string | undefined;
  private expiresAt: number | undefined;
  private credential: HubCredential | null = null;
  private keys: HubKeyPair | null = null;
  private timer: TimerHandle | null = null;
  private retryDelay: number;
  private readonly http: HttpJson;
  private readonly clock: Clock;
  private readonly timers: TimerHost;

  constructor(private readonly o: ClaimClientOptions) {
    super();
    this.http = o.http ?? httpJson;
    this.clock = o.clock ?? realClock;
    this.timers = o.timers ?? realTimers;
    this.retryDelay = o.retryMs ?? 5_000;
  }

  /** current state for `/setup` (lan ClaimInfo shape) */
  current(): { claimed: boolean; code?: string; expiresAt?: number } {
    if (this.phase === 'claimed') return { claimed: true };
    return { claimed: false, code: this.code, expiresAt: this.expiresAt };
  }

  get state(): ClaimPhase {
    return this.phase;
  }

  getCredential(): HubCredential | null {
    return this.credential;
  }

  /**
   * Already claimed (valid credentials.json) → phase claimed, returns the credential (no event).
   * Otherwise starts requesting a code in the background and returns null; `claimed` fires later.
   */
  async start(): Promise<HubCredential | null> {
    if (this.phase !== 'idle' && this.phase !== 'stopped') return this.credential;
    try {
      this.credential = readCredentials(this.o.credentialsPath);
    } catch (e) {
      this.o.log.warn({ err: (e as Error).message }, 'credentials.json invalid — claiming again');
      this.credential = null;
    }
    if (this.credential) {
      this.phase = 'claimed';
      return this.credential;
    }
    this.keys = await loadOrCreateKeyPair(this.o.hubKeyPath);
    this.phase = 'requesting';
    void this.requestCode();
    return null;
  }

  stop(): void {
    this.timer?.cancel();
    this.timer = null;
    if (this.phase !== 'claimed') this.phase = 'stopped';
  }

  /**
   * Reset claim state: deletes credentials.json, stops active timers,
   * transitions to 'requesting' and requests a new claim code.
   */
  async reset(): Promise<void> {
    this.stop();
    this.credential = null;
    this.code = undefined;
    this.expiresAt = undefined;
    deleteCredentials(this.o.credentialsPath);
    this.keys = await loadOrCreateKeyPair(this.o.hubKeyPath);
    this.phase = 'requesting';
    this.emit('unclaimed');
    void this.requestCode();
  }

  private schedule(fn: () => Promise<void>, ms: number): void {
    this.timer?.cancel();
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void fn();
    }, ms);
  }

  private get live(): boolean {
    return this.phase === 'requesting' || this.phase === 'waiting';
  }

  private async requestCode(): Promise<void> {
    if (!this.live) return;
    this.phase = 'requesting';
    this.code = undefined;
    this.expiresAt = undefined;
    try {
      const res = await this.http({
        method: 'POST',
        url: `${this.o.apiBaseUrl}/v1/hubs/claim-codes`,
        body: { hubPubKey: this.keys!.pk, agentVersion: this.o.agentVersion, platform: this.o.platform },
      });
      if (!this.live) return;
      const parsed = res.status === 201 ? ClaimCodeResponse.safeParse(res.body) : null;
      if (!parsed?.success) throw new Error(`claim-codes HTTP ${res.status}`);
      const { code, expiresAt, pollEverySec } = parsed.data;
      this.code = code;
      this.expiresAt = expiresAt;
      this.phase = 'waiting';
      this.retryDelay = this.o.retryMs ?? 5_000;
      this.o.log.info({ code, expiresAt }, `CLAIM CODE: ${code} (hết hạn ${hhmm(expiresAt)})`);
      this.emit('code', { code, expiresAt });
      this.schedule(() => this.poll(code, pollEverySec * 1000), pollEverySec * 1000);
    } catch (e) {
      if (!this.live) return;
      const delay = this.retryDelay;
      this.retryDelay = Math.min(delay * 2, this.o.retryMaxMs ?? 60_000);
      this.o.log.warn({ err: (e as Error).message, retryInMs: delay }, 'claim code request failed');
      this.schedule(() => this.requestCode(), delay);
    }
  }

  private async poll(code: string, everyMs: number): Promise<void> {
    if (this.phase !== 'waiting' || this.code !== code) return;
    if (this.expiresAt !== undefined && this.clock.now() >= this.expiresAt) {
      this.o.log.info({ code }, 'claim code expired — requesting a new one');
      return this.requestCode();
    }
    let res;
    try {
      res = await this.http({ method: 'GET', url: `${this.o.apiBaseUrl}/v1/hubs/claim-codes/${code}/credential` });
    } catch (e) {
      this.o.log.debug({ err: (e as Error).message }, 'credential poll failed');
      if (this.phase === 'waiting' && this.code === code) this.schedule(() => this.poll(code, everyMs), everyMs);
      return;
    }
    if (this.phase !== 'waiting' || this.code !== code) return;
    if (res.status === 410) {
      this.o.log.info({ code }, 'claim code gone (410) — requesting a new one');
      return this.requestCode();
    }
    if (res.status === 200) {
      const body = CredentialResponse.safeParse(res.body);
      try {
        if (!body.success) throw new Error('credential response missing `credential`');
        const cred = HubCredential.parse(JSON.parse(await openSealed(body.data.credential, this.keys!)));
        if (this.phase !== 'waiting' || this.code !== code) return;
        writeCredentials(this.o.credentialsPath, cred);
        this.credential = cred;
        this.phase = 'claimed';
        this.code = undefined;
        this.expiresAt = undefined;
        this.timer?.cancel();
        this.timer = null;
        this.o.log.info({ tenantId: cred.tenantId, hubId: cred.hubId, siteId: cred.siteId }, 'hub claimed');
        this.emit('claimed', cred);
      } catch (e) {
        // blob is single-read on the server: it is gone, so start over with a fresh code
        this.o.log.error({ err: (e as Error).message }, 'credential unusable — requesting a new code');
        void this.requestCode();
      }
      return;
    }
    if (res.status !== 404) this.o.log.warn({ status: res.status }, 'unexpected credential poll status');
    this.schedule(() => this.poll(code, everyMs), everyMs);
  }
}
