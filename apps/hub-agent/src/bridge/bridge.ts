import type { IClientOptions, MqttClient } from 'mqtt';
import { hubLwt, topicPolicy, topics } from '@devicenet/shared';
import type { HubConfig } from '../config/schema.js';
import type { TimerHost } from '../core/clock.js';
import type { HubCore } from '../core/hubCore.js';
import { Heartbeat, type HubStatusBody } from './heartbeat.js';
import { MqttLink } from './mqttLink.js';

type Log = { warn(obj: object, msg?: string): void; info?(obj: object, msg?: string): void; debug?(obj: object, msg?: string): void };

/** `mqtt` part of the decrypted hub credential (api.openapi.yaml). */
export interface CloudMqttCredential {
  host: string;
  port: number;
  wssPort?: number;
  username?: string;
  password: string;
}

export interface BridgeOptions {
  core: HubCore;
  config: Pick<HubConfig, 'emulator' | 'cloudMqttTls' | 'mqttLocal'>;
  /** local Mosquitto / embedded broker; url defaults to mqtt://127.0.0.1:{mqttLocal.port}, user `hub` */
  local?: { url?: string; username?: string; password?: string };
  status: () => HubStatusBody;
  heartbeatMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** cloud keepalive seconds (default 30) */
  keepalive?: number;
  timers?: TimerHost;
  log?: Log;
  connect?: (url: string, opts: IClientOptions) => MqttClient;
}

/** OQ-8: `mqtts://` unless DN_EMULATOR=1 or DN_CLOUD_MQTT_TLS=0. */
export function cloudUrl(cred: Pick<CloudMqttCredential, 'host' | 'port'>, cfg: Pick<HubConfig, 'emulator' | 'cloudMqttTls'>): string {
  const tls = !cfg.emulator && cfg.cloudMqttTls;
  return `${tls ? 'mqtts' : 'mqtt'}://${cred.host}:${cred.port}`;
}

/**
 * Dual-broker bridge (FR-H05/FR-H10, realtime §2): local link always, cloud link after claim.
 * Uplink = publisher fan-out to both links (only `t/{tenant}/h/{hubId}/…`; never `zigbee2mqtt/#`);
 * downlink = `set`/`cmd` from both → core (set queue / command processor with cmd.id dedupe).
 * Cloud (re)connect → retained status + pairing + all state republished (seq keeps increasing).
 */
export class Bridge {
  readonly local: MqttLink;
  cloud: MqttLink | null = null;
  readonly heartbeat: Heartbeat;
  private unlinkLocal?: () => void;
  private unlinkCloud?: () => void;
  private started = false;

  constructor(private readonly o: BridgeOptions) {
    this.heartbeat = new Heartbeat({ publisher: o.core.publisher, status: o.status, intervalMs: o.heartbeatMs, timers: o.timers });
    const l = o.local ?? {};
    this.local = this.makeLink('local', l.url ?? `mqtt://127.0.0.1:${o.config.mqttLocal.port}`, {
      clientId: `hub-agent-local-${process.pid}`,
      username: l.username ?? 'hub',
      ...(l.password !== undefined ? { password: l.password } : {}),
      clean: true,
    }, () => this.heartbeat.publishNow());
  }

  private allowUplink = (topic: string): boolean => {
    const id = this.o.core.publisher.getIdentity();
    return !!id && topic.startsWith(`t/${id.tenantId}/h/${id.hubId}/`);
  };

  private makeLink(name: 'local' | 'cloud', url: string, client: IClientOptions, onConnect: () => void): MqttLink {
    const source = name === 'local' ? 'lan' : 'cloud';
    return new MqttLink({
      name,
      url,
      client,
      subscriptions: () => this.o.core.subscriptions(),
      onMessage: (topic, payload) => {
        this.o.core.handleMessage(topic, payload, source).catch((err) => this.o.log?.warn({ link: name, topic, err: (err as Error)?.message }, 'downlink failed'));
      },
      onConnect,
      allowPublish: this.allowUplink,
      minBackoffMs: this.o.minBackoffMs,
      maxBackoffMs: this.o.maxBackoffMs,
      timers: this.o.timers,
      log: this.o.log,
      connect: this.o.connect,
    });
  }

  /** Start the local link + heartbeat. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.unlinkLocal = this.o.core.publisher.addLink('mqtt-local', this.local);
    this.local.start();
    this.heartbeat.start();
  }

  /** Identity set/changed (claim): resubscribe + announce status on the local broker. */
  identityChanged(): void {
    this.local.resubscribe();
    this.cloud?.resubscribe();
    this.heartbeat.publishNow();
  }

  /** Connect the cloud link (after claim; core identity must be set). Replaces an existing cloud link. */
  async connectCloud(cred: CloudMqttCredential): Promise<void> {
    const id = this.o.core.publisher.getIdentity();
    if (!id) throw new Error('connectCloud: hub identity not set (unclaimed)');
    await this.disconnectCloud();
    const lwt = hubLwt();
    const link = this.makeLink(
      'cloud',
      cloudUrl(cred, this.o.config),
      {
        clientId: `hub-${id.hubId}`,
        username: cred.username ?? `hub:${id.hubId}`,
        password: cred.password,
        clean: false,
        keepalive: this.o.keepalive ?? 30,
        will: {
          topic: topics.status(id.tenantId, id.hubId),
          payload: Buffer.from(JSON.stringify(lwt), 'utf8'),
          qos: topicPolicy.status.qos,
          retain: topicPolicy.status.retain,
        },
      },
      () => this.o.core.publisher.republishAll(),
    );
    this.cloud = link;
    this.unlinkCloud = this.o.core.publisher.addLink('mqtt-cloud', link);
    link.start();
  }

  /** Drop the cloud link (unclaim / credential rotation). */
  async disconnectCloud(graceful = true): Promise<void> {
    const c = this.cloud;
    if (!c) return;
    this.unlinkCloud?.();
    this.unlinkCloud = undefined;
    this.cloud = null;
    await c.stop(graceful);
  }

  get localConnected(): boolean {
    return this.local.connected;
  }
  get cloudConnected(): boolean {
    return this.cloud?.connected ?? false;
  }

  /** Graceful shutdown: retained `online:false` status, then close both links. */
  async stop(): Promise<void> {
    this.heartbeat.stop();
    if (this.started) this.heartbeat.publishOffline();
    await this.disconnectCloud();
    this.unlinkLocal?.();
    this.unlinkLocal = undefined;
    await this.local.stop();
    this.started = false;
  }
}
