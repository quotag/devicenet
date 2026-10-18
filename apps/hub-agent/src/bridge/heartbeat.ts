import { networkInterfaces } from 'node:os';
import type { HubStatus } from '@devicenet/shared';
import type { TimerHandle, TimerHost } from '../core/clock.js';
import { realTimers } from '../core/clock.js';
import type { Publisher } from '../core/publisher.js';

/** `HubStatus` without the envelope (publisher stamps `{v,ts,seq}`). */
export type HubStatusBody = Omit<HubStatus, 'v' | 'ts' | 'seq'>;

export interface StatusSource {
  agentVersion: string;
  z2m: () => HubStatus['z2m'];
  z2mVersion?: () => string | undefined;
  lanUrl?: () => string | undefined;
  ip?: () => string | undefined;
  platform?: HubStatus['platform'];
  deviceCount: () => number;
}

/** First non-internal IPv4 address (best effort). */
export function primaryIpv4(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return undefined;
}

export const currentPlatform = (): HubStatus['platform'] => (process.platform === 'win32' ? 'windows' : 'linux');

/** Build the status body; optional fields are omitted when unknown. */
export function buildStatus(s: StatusSource): HubStatusBody {
  const z2mVersion = s.z2mVersion?.();
  const lanUrl = s.lanUrl?.();
  const ip = s.ip ? s.ip() : primaryIpv4();
  return {
    online: true,
    agentVersion: s.agentVersion,
    z2m: s.z2m(),
    ...(z2mVersion ? { z2mVersion } : {}),
    ...(lanUrl ? { lanUrl } : {}),
    ...(ip ? { ip } : {}),
    platform: s.platform ?? currentPlatform(),
    deviceCount: s.deviceCount(),
  };
}

export interface HeartbeatOptions {
  publisher: Publisher;
  status: () => HubStatusBody;
  intervalMs?: number;
  timers?: TimerHost;
}

/**
 * Retained `status` heartbeat (FR-H10): published on connect (`publishNow`) and every 30 s.
 * The publisher fans it out to both brokers; also registered as the publisher's status provider
 * so `republishAll()` includes it.
 */
export class Heartbeat {
  private timer?: TimerHandle;
  private readonly intervalMs: number;
  private readonly timers: TimerHost;

  constructor(private readonly o: HeartbeatOptions) {
    this.intervalMs = o.intervalMs ?? 30_000;
    this.timers = o.timers ?? realTimers;
    o.publisher.setStatusProvider(() => o.status());
  }

  publishNow(): HubStatus | null {
    return this.o.publisher.publishHub('status', this.o.status()) as HubStatus | null;
  }

  /** Graceful shutdown: retained `online:false` (same shape as the LWT, but stamped). */
  publishOffline(): HubStatus | null {
    return this.o.publisher.publishHub('status', { ...this.o.status(), online: false }) as HubStatus | null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = this.timers.setInterval(() => this.publishNow(), this.intervalMs);
  }

  stop(): void {
    this.timer?.cancel();
    this.timer = undefined;
  }
}
