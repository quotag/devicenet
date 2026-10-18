/**
 * Thin wrapper around mqtt.js 5 (docs/realtime-and-events.md §2.1, §2.6, §2.7; research R3).
 *
 * - `clean: true`, `keepalive: 30`, protocol 3.1.1, one client per session.
 * - Subscribes `topics.tenantWildcard(tenant)` QoS1 on **every** `connect` (retained replay
 *   re-syncs the stores). mqtt.js `resubscribe` is off so there is exactly one SUBSCRIBE per connect.
 * - Reconnect backoff 1 s → 2 s → 4 s → 8 s → 10 s (cap), reset on successful connect. Driven here
 *   (`reconnectPeriod: 0` + `client.reconnect()`) because mqtt.js only supports a fixed period.
 * - `setPassword(token)` mutates the options used by the next CONNECT; never disconnects.
 * - Status goes to `connection.mqtt` (overridable via `onStatus`).
 * - `publish(kind, …)` takes QoS/retain from `topicPolicy`.
 */
import type { IClientOptions, MqttClient as RawClient } from "mqtt";
import { ulid } from "ulid";
import { topicPolicy, topics, type TenantId } from "@devicenet/shared";
import { connectionStore, type MqttStatus } from "@/stores/connection";

export type TopicKind = keyof typeof topicPolicy;

export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 10_000;
/** Consecutive failed attempts after which the status shows `offline` instead of `reconnecting`. */
export const OFFLINE_AFTER_FAILURES = 3;

export interface MqttClientOptions {
  url: string;
  tenantId: TenantId;
  /** uid (cloud) or "lan" — used in clientId `web-<owner>-<ulid>`. */
  owner: string;
  username?: string;
  password?: string;
  onMessage: (topic: string, payload: Uint8Array, retained: boolean) => void;
  onStatus?: (s: MqttStatus) => void;
  /** Called after each successful connect + subscribe request. */
  onConnect?: () => void;
  backoffMinMs?: number;
  backoffMaxMs?: number;
  connectTimeoutMs?: number;
}

/** Delay before reconnect attempt `n` (0-based): min·2^n capped at max. */
export function backoffDelay(n: number, min = BACKOFF_MIN_MS, max = BACKOFF_MAX_MS): number {
  return Math.min(max, min * 2 ** Math.max(0, n));
}

export class MqttClient {
  readonly clientId: string;
  private client: RawClient | null = null;
  /** Resolves once the lazily loaded mqtt.js has created the client (B25 bundle budget). */
  private loading: Promise<void> | null = null;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private ended = false;
  private status: MqttStatus = "connecting";

  constructor(private readonly opts: MqttClientOptions) {
    this.clientId = `web-${opts.owner}-${ulid()}`;
  }

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  get mqttStatus(): MqttStatus {
    return this.status;
  }

  /** Underlying options (tests / diagnostics). */
  get options(): Readonly<IClientOptions> | undefined {
    return this.client?.options;
  }

  start(): void {
    if (this.client || this.loading) return;
    this.ended = false;
    this.setStatus("connecting");
    // Default import: the browser ESM build (dist/mqtt.esm.js) has only a default export.
    this.loading = import("mqtt")
      .then((m) => {
        if (!this.ended) this.connectWith(m.default);
      })
      .catch((e: unknown) => {
        console.warn("[mqtt] load failed", e);
        this.setStatus("offline");
      })
      .finally(() => {
        this.loading = null;
      });
  }

  private connectWith(mqtt: typeof import("mqtt").default): void {
    const options: IClientOptions = {
      clientId: this.clientId,
      clean: true,
      keepalive: 30,
      protocolVersion: 4,
      reconnectPeriod: 0,
      resubscribe: false,
      connectTimeout: this.opts.connectTimeoutMs ?? 10_000,
      username: this.opts.username,
      password: this.opts.password,
    };
    const c = mqtt.connect(this.opts.url, options);
    this.client = c;

    c.on("connect", () => {
      this.failures = 0;
      this.setStatus("online");
      c.subscribe(topics.tenantWildcard(this.opts.tenantId), { qos: 1 }, (err) => {
        if (err) console.warn("[mqtt] subscribe failed", err);
      });
      this.opts.onConnect?.();
    });
    c.on("message", (topic, payload, packet) => {
      this.opts.onMessage(topic, payload, packet.retain === true);
    });
    c.on("error", (err) => {
      // Connection errors are followed by `close`; keep them out of unhandled-error land.
      console.warn("[mqtt] error", err.message);
    });
    c.on("close", () => this.scheduleReconnect());
  }

  /** Token refresh (docs §2.6): the next CONNECT uses it; the live connection stays up. */
  setPassword(token: string): void {
    this.opts.password = token;
    if (this.client) this.client.options.password = token;
  }

  publish(kind: TopicKind, topic: string, payload: unknown): Promise<void> {
    if (this.ended || (!this.client && !this.loading)) return Promise.reject(new Error("MQTT client not started"));
    const { qos, retain } = topicPolicy[kind];
    const body = payload === "" ? "" : JSON.stringify(payload);
    return (this.loading ?? Promise.resolve()).then(
      () =>
        new Promise<void>((resolve, reject) => {
      const c = this.client;
      if (!c || this.ended) return reject(new Error("MQTT client not started"));
      c.publish(topic, body, { qos, retain }, (err) => (err ? reject(err) : resolve()));
        }),
    );
  }

  async end(): Promise<void> {
    this.ended = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const c = this.client;
    this.client = null;
    if (c) await c.endAsync(true);
    this.setStatus("offline");
  }

  private scheduleReconnect(): void {
    if (this.ended || !this.client || this.retryTimer) return;
    const delay = backoffDelay(this.failures, this.opts.backoffMinMs, this.opts.backoffMaxMs);
    this.failures++;
    this.setStatus(this.failures > OFFLINE_AFTER_FAILURES ? "offline" : "reconnecting");
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.ended || !this.client) return;
      this.client.reconnect();
    }, delay);
  }

  private setStatus(s: MqttStatus): void {
    if (this.status === s && s !== "connecting") return;
    this.status = s;
    if (this.opts.onStatus) this.opts.onStatus(s);
    else connectionStore.getState().setMqtt(s);
  }
}
