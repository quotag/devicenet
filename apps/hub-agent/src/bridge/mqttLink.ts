import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import type { PublishLink, PublishOptions } from '../core/publisher.js';
import type { TimerHandle, TimerHost } from '../core/clock.js';
import { realTimers } from '../core/clock.js';

type Log = { warn(obj: object, msg?: string): void; info?(obj: object, msg?: string): void; debug?(obj: object, msg?: string): void };

export interface MqttLinkOptions {
  /** for logs ("local", "cloud") */
  name: string;
  url: string;
  /** clientId / username / password / clean / keepalive / will … (reconnect is always manual) */
  client?: IClientOptions;
  /** topic filters (re)subscribed on every connect */
  subscriptions?: () => readonly string[];
  onMessage?: (topic: string, payload: Buffer) => void;
  /** after (re)connect + subscribe */
  onConnect?: () => void;
  onClose?: () => void;
  /** only these topics may be published (uplink guard); default: everything */
  allowPublish?: (topic: string) => boolean;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** graceful `stop()` forces the close after this long (default 2000) */
  endTimeoutMs?: number;
  timers?: TimerHost;
  log?: Log;
  /** injectable for tests */
  connect?: (url: string, opts: IClientOptions) => MqttClient;
}

/**
 * mqtt.js wrapper: manual exponential reconnect backoff (1 → 60 s by default), `connected` state,
 * subscribe on every connect, publish with the topic policy given by the publisher.
 * Publishes while disconnected are dropped (retained topics are republished on reconnect).
 */
export class MqttLink implements PublishLink {
  private client?: MqttClient;
  private retry?: TimerHandle;
  private backoff: number;
  private stopped = true;
  private _connected = false;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;
  private readonly timers: TimerHost;
  /** number of successful connects (diagnostics/tests) */
  connectCount = 0;

  constructor(private readonly o: MqttLinkOptions) {
    this.minBackoff = o.minBackoffMs ?? 1000;
    this.maxBackoff = o.maxBackoffMs ?? 60_000;
    this.backoff = this.minBackoff;
    this.timers = o.timers ?? realTimers;
  }

  get connected(): boolean {
    return this._connected;
  }

  get name(): string {
    return this.o.name;
  }

  /** next reconnect delay (ms) */
  get nextBackoffMs(): number {
    return this.backoff;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const connect = this.o.connect ?? ((u, opts) => mqtt.connect(u, opts));
    const c = connect(this.o.url, { ...this.o.client, reconnectPeriod: 0 });
    this.client = c;
    c.on('connect', () => {
      if (this.client !== c) return;
      this._connected = true;
      this.connectCount++;
      this.backoff = this.minBackoff;
      this.o.log?.info?.({ link: this.o.name }, 'mqtt connected');
      this.resubscribe();
      try {
        this.o.onConnect?.();
      } catch (err) {
        this.o.log?.warn({ link: this.o.name, err: (err as Error)?.message }, 'onConnect failed');
      }
    });
    c.on('message', (topic, payload) => {
      try {
        this.o.onMessage?.(topic, payload);
      } catch (err) {
        this.o.log?.warn({ link: this.o.name, topic, err: (err as Error)?.message }, 'onMessage failed');
      }
    });
    c.on('error', (err) => {
      this.o.log?.warn({ link: this.o.name, err: err?.message }, 'mqtt error');
    });
    c.on('close', () => {
      if (this.client !== c) return;
      const was = this._connected;
      this._connected = false;
      if (was) {
        this.o.log?.warn({ link: this.o.name }, 'mqtt disconnected');
        this.o.onClose?.();
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retry) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
    this.retry = this.timers.setTimeout(() => {
      this.retry = undefined;
      if (this.stopped || !this.client) return;
      this.client.reconnect();
    }, delay);
  }

  /** Subscribe the current filter set (call after identity changes, also done on every connect). */
  resubscribe(): void {
    const subs = [...(this.o.subscriptions?.() ?? [])];
    if (!this.client || !this._connected || subs.length === 0) return;
    this.client.subscribe(subs, { qos: 1 }, (err) => {
      if (err) this.o.log?.warn({ link: this.o.name, err: err.message }, 'subscribe failed');
    });
  }

  publish(topic: string, payload: Buffer, opts: PublishOptions): void {
    if (this.o.allowPublish && !this.o.allowPublish(topic)) {
      this.o.log?.debug?.({ link: this.o.name, topic }, 'publish blocked by link guard');
      return;
    }
    if (!this.client || !this._connected) return;
    this.client.publish(topic, payload, { qos: opts.qos, retain: opts.retain }, (err) => {
      if (err) this.o.log?.warn({ link: this.o.name, topic, err: err.message }, 'publish failed');
    });
  }

  /** Close the connection. `graceful=false` drops the socket without DISCONNECT (broker fires the LWT). */
  async stop(graceful = true): Promise<void> {
    this.stopped = true;
    this.retry?.cancel();
    this.retry = undefined;
    const c = this.client;
    this.client = undefined;
    this._connected = false;
    if (!c) return;
    // graceful end waits for in-flight QoS1 acks; one lost across a reconnect would hang forever → force after a grace period
    await new Promise<void>((res) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        res();
      };
      // a second end() is a no-op while disconnecting → drop the socket ourselves (broker then fires the LWT = offline)
      const t = setTimeout(() => {
        c.stream?.destroy();
        finish();
      }, this.o.endTimeoutMs ?? 2000);
      c.end(!graceful, {}, finish);
    });
  }
}
