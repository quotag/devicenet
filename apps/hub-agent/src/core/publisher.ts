import { MQTT_CONTRACT_VERSION, topicPolicy, topics, type DeviceState, type PairingState } from '@devicenet/shared';
import type { Clock, TimerHandle, TimerHost } from './clock.js';
import { realClock, realTimers } from './clock.js';
import type { Registry } from './registry.js';

export type TopicKind = keyof typeof topicPolicy;

export interface PublishOptions {
  qos: 0 | 1;
  retain: boolean;
}

/** One broker connection (local Mosquitto, cloud EMQX). Receives identical bytes. */
export interface PublishLink {
  publish(topic: string, payload: Buffer, opts: PublishOptions): void | Promise<void>;
}

export interface HubIdentity {
  tenantId: string;
  hubId: string;
  siteId: string;
}

export interface PublisherOptions {
  registry: Registry;
  clock?: Clock;
  timers?: TimerHost;
  /** initial seq counter (defaults to clock.now()) */
  initialSeq?: number;
  /** coalescing window for state changes (realtime §2.5) */
  coalesceMs?: number;
  /** min interval between two state publishes of one device */
  minIntervalMs?: number;
  /** forced republish after this long without a publish */
  heartbeatMs?: number;
  onError?: (err: unknown, topic: string) => void;
}

export interface Envelope {
  v: typeof MQTT_CONTRACT_VERSION;
  ts: number;
  seq: number;
}

interface DeviceTimers {
  lastPublishAt: number;
  flush?: TimerHandle;
  heartbeat?: TimerHandle;
}

/**
 * Single outbound path for every hub → app topic: stamps `{v,ts,seq}` with one per-hub `seq`,
 * applies `topicPolicy`, fans out the same bytes to every registered link, and coalesces `state`.
 * Without an identity (unclaimed hub) nothing is published (data-model §4).
 */
export class Publisher {
  private seq: number;
  private links = new Map<string, PublishLink>();
  private identity: HubIdentity | null = null;
  private devTimers = new Map<string, DeviceTimers>();
  /** last retained bodies (without envelope) to replay on republishAll */
  private lastPairing: Omit<PairingState, 'v' | 'ts' | 'seq'> | null = null;
  private statusProvider: (() => Record<string, unknown>) | null = null;
  private readonly registry: Registry;
  private readonly clock: Clock;
  private readonly timers: TimerHost;
  private readonly coalesceMs: number;
  private readonly minIntervalMs: number;
  private readonly heartbeatMs: number;
  private readonly onError: (err: unknown, topic: string) => void;

  constructor(opts: PublisherOptions) {
    this.registry = opts.registry;
    this.clock = opts.clock ?? realClock;
    this.timers = opts.timers ?? realTimers;
    this.coalesceMs = opts.coalesceMs ?? 200;
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.heartbeatMs = opts.heartbeatMs ?? 60_000;
    this.onError = opts.onError ?? (() => {});
    this.seq = opts.initialSeq !== undefined ? opts.initialSeq : this.clock.now();
  }

  addLink(name: string, link: PublishLink): () => void {
    this.links.set(name, link);
    return () => {
      if (this.links.get(name) === link) this.links.delete(name);
    };
  }

  setIdentity(id: HubIdentity | null): void {
    this.identity = id;
  }
  getIdentity(): HubIdentity | null {
    return this.identity;
  }

  /** Optional retained status body (B10/B13 wire this); replayed by `republishAll`. */
  setStatusProvider(fn: (() => Record<string, unknown>) | null): void {
    this.statusProvider = fn;
  }

  /** current seq (last used) */
  get lastSeq(): number {
    return this.seq;
  }

  /** Add `{v, ts, seq}` (seq strictly increasing per hub). */
  stamp<T extends object>(body: T): Envelope & T {
    return { v: MQTT_CONTRACT_VERSION, ts: this.clock.now(), seq: ++this.seq, ...body };
  }

  /** Serialize once, publish to every link with the topic policy of `kind`. */
  send(kind: TopicKind, topic: string, payload: object | null): void {
    const p = topicPolicy[kind];
    const buf = payload === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(payload), 'utf8');
    const opts: PublishOptions = { qos: p.qos, retain: p.retain };
    for (const link of this.links.values()) {
      try {
        const r = link.publish(topic, buf, opts);
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch((e) => this.onError(e, topic));
      } catch (e) {
        this.onError(e, topic);
      }
    }
  }

  /** Stamp + send a hub topic (`status`, `ack`, `events`, `pairing`, `runs`). Returns the stamped payload, or null when unclaimed. */
  publishHub<T extends object>(kind: 'status' | 'ack' | 'events' | 'pairing' | 'runs', body: T): (Envelope & T) | null {
    const id = this.identity;
    if (!id) return null;
    const msg = this.stamp(body);
    const topic = kind === 'ack' ? topics.ack(id.tenantId, id.hubId) : topics[kind](id.tenantId, id.hubId);
    this.send(kind, topic, msg);
    return msg;
  }

  publishPairing(body: Omit<PairingState, 'v' | 'ts' | 'seq'>): PairingState | null {
    this.lastPairing = body;
    return this.publishHub('pairing', body) as PairingState | null;
  }

  // ---------- state ----------

  private snapshot(deviceId: string): Omit<DeviceState, 'v' | 'ts' | 'seq'> | null {
    const e = this.registry.get(deviceId);
    if (!e) return null;
    return {
      deviceId,
      online: e.online,
      lastSeen: e.lastSeen,
      values: { ...e.values },
      at: { ...e.at },
      ...(e.lqi !== undefined ? { lqi: e.lqi } : {}),
    };
  }

  private timersFor(deviceId: string): DeviceTimers {
    let t = this.devTimers.get(deviceId);
    if (!t) {
      t = { lastPublishAt: -Infinity };
      this.devTimers.set(deviceId, t);
    }
    return t;
  }

  /** A device changed: publish one coalesced snapshot after ≥ coalesceMs, at most 1/minIntervalMs. */
  stateChanged(deviceId: string): void {
    const t = this.timersFor(deviceId);
    if (t.flush) return; // already scheduled → merged into that snapshot
    const now = this.clock.now();
    const at = Math.max(now + this.coalesceMs, t.lastPublishAt + this.minIntervalMs);
    t.flush = this.timers.setTimeout(() => {
      t.flush = undefined;
      this.publishStateNow(deviceId);
    }, at - now);
  }

  /** Publish the current snapshot immediately (also re-arms the 60 s heartbeat). */
  publishStateNow(deviceId: string): DeviceState | null {
    const t = this.timersFor(deviceId);
    t.flush?.cancel();
    t.flush = undefined;
    t.heartbeat?.cancel();
    t.heartbeat = undefined;
    const id = this.identity;
    const snap = this.snapshot(deviceId);
    if (!snap) return null;
    // heartbeat re-armed even while unclaimed so a later claim picks up quickly
    t.heartbeat = this.timers.setTimeout(() => {
      t.heartbeat = undefined;
      this.publishStateNow(deviceId);
    }, this.heartbeatMs);
    if (!id) return null;
    const msg = this.stamp(snap) as DeviceState;
    t.lastPublishAt = this.clock.now();
    this.send('state', topics.state(id.tenantId, id.hubId, deviceId), msg);
    return msg;
  }

  /** Device removed: clear the retained state (empty payload, retain) and stop its timers. */
  clearState(deviceId: string): void {
    const t = this.devTimers.get(deviceId);
    t?.flush?.cancel();
    t?.heartbeat?.cancel();
    this.devTimers.delete(deviceId);
    const id = this.identity;
    if (id) this.send('state', topics.state(id.tenantId, id.hubId, deviceId), null);
  }

  /** Republish every retained topic: status, pairing, state of all registry devices. */
  republishAll(): void {
    if (!this.identity) return;
    if (this.statusProvider) this.publishHub('status', this.statusProvider());
    if (this.lastPairing) this.publishHub('pairing', this.lastPairing);
    for (const e of this.registry.all()) this.publishStateNow(e.device.id);
  }

  /** Cancel all timers (shutdown). */
  stop(): void {
    for (const t of this.devTimers.values()) {
      t.flush?.cancel();
      t.heartbeat?.cancel();
    }
    this.devTimers.clear();
  }
}
