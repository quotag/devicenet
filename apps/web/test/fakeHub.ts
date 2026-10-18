/**
 * Minimal hub simulator for transport integration tests (research R13).
 * Publishes retained `status` / `state` / `pairing` with a per-hub monotonically increasing `seq`,
 * answers `cmd` with `ack`, and optionally echoes `set` as a new `state`.
 */
import { connect, type MqttClient } from "mqtt";
import {
  CommandEnvelope,
  SetCommand,
  topicPolicy,
  topics,
  type CommandAck,
  type DeviceId,
  type DeviceState,
  type HubId,
  type PairingState,
  type PropertyValue,
  type TenantId,
} from "@devicenet/shared";

export type AckReply = Partial<Pick<CommandAck, "ok" | "error" | "message" | "result">> | null;

export interface FakeHubOptions {
  url: string;
  tenantId: TenantId;
  hubId: HubId;
  /** Return `null` to stay silent (timeout). Default: `{ ok: true }`. */
  onCommand?: (env: CommandEnvelope, hub: FakeHub) => AckReply | Promise<AckReply>;
  /** Echo every `set` as a new retained `state` (default true). */
  echoSet?: boolean;
  now?: () => number;
}

export class FakeHub {
  readonly client: MqttClient;
  readonly sets: { deviceId: string; cmd: SetCommand }[] = [];
  readonly commands: CommandEnvelope[] = [];
  readonly devices = new Map<string, DeviceState>();
  echoSet: boolean;
  private seq = 0;
  private readonly now: () => number;

  private constructor(
    private readonly opts: FakeHubOptions,
    client: MqttClient,
  ) {
    this.client = client;
    this.echoSet = opts.echoSet ?? true;
    this.now = opts.now ?? Date.now;
    client.on("message", (topic, payload) => void this.onMessage(topic, payload.toString()));
  }

  static async start(opts: FakeHubOptions): Promise<FakeHub> {
    const client = connect(opts.url, {
      clientId: `hub-${opts.hubId}`,
      clean: true,
      reconnectPeriod: 0,
      protocolVersion: 4,
    });
    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve());
      client.once("error", reject);
    });
    const hub = new FakeHub(opts, client);
    await client.subscribeAsync([...topics.hubSubscriptions(opts.tenantId, opts.hubId)], { qos: 1 });
    return hub;
  }

  nextSeq(): number {
    return ++this.seq;
  }

  /** Hub reboot: seq restarts from 0. */
  resetSeq(): void {
    this.seq = -1;
  }

  async publishRaw(kind: keyof typeof topicPolicy, topic: string, body: string, retain?: boolean): Promise<void> {
    const p = topicPolicy[kind];
    await this.client.publishAsync(topic, body, { qos: p.qos, retain: retain ?? p.retain });
  }

  async status(online = true, extra: Record<string, unknown> = {}): Promise<void> {
    const body = { v: 1, ts: this.now(), seq: this.nextSeq(), online, agentVersion: "0.0.0-test", z2m: "online", ...extra };
    await this.publishRaw("status", topics.status(this.opts.tenantId, this.opts.hubId), JSON.stringify(body));
  }

  async state(deviceId: DeviceId, values: Record<string, PropertyValue>, extra: Partial<DeviceState> = {}): Promise<DeviceState> {
    const ts = this.now();
    const prev = this.devices.get(deviceId);
    const s: DeviceState = {
      v: 1,
      ts,
      seq: this.nextSeq(),
      deviceId,
      online: true,
      lastSeen: ts,
      values: { ...(prev?.values ?? {}), ...values },
      at: { ...(prev?.at ?? {}), ...Object.fromEntries(Object.keys(values).map((k) => [k, ts])) },
      ...extra,
    };
    this.devices.set(deviceId, s);
    await this.publishRaw("state", topics.state(this.opts.tenantId, this.opts.hubId, deviceId), JSON.stringify(s));
    return s;
  }

  async clearState(deviceId: DeviceId): Promise<void> {
    this.devices.delete(deviceId);
    await this.publishRaw("state", topics.state(this.opts.tenantId, this.opts.hubId, deviceId), "");
  }

  async pairing(p: Partial<PairingState> & { active: boolean }): Promise<void> {
    const body = { v: 1, ts: this.now(), seq: this.nextSeq(), found: [], ...p };
    await this.publishRaw("pairing", topics.pairing(this.opts.tenantId, this.opts.hubId), JSON.stringify(body));
  }

  async event(e: Record<string, unknown>): Promise<void> {
    const body = { v: 1, ts: this.now(), seq: this.nextSeq(), hubId: this.opts.hubId, ...e };
    await this.publishRaw("events", topics.events(this.opts.tenantId, this.opts.hubId), JSON.stringify(body));
  }

  async stop(): Promise<void> {
    await this.client.endAsync(true);
  }

  private async onMessage(topic: string, text: string): Promise<void> {
    const t = this.opts.tenantId;
    const h = this.opts.hubId;
    if (topic === topics.cmd(t, h)) {
      const env = CommandEnvelope.safeParse(JSON.parse(text));
      if (!env.success) return;
      this.commands.push(env.data);
      const reply = this.opts.onCommand ? await this.opts.onCommand(env.data, this) : { ok: true };
      if (reply === null) return;
      const ack = { v: 1, ts: this.now(), seq: this.nextSeq(), id: env.data.id, ok: true, ...reply };
      await this.publishRaw("ack", topics.ack(t, h), JSON.stringify(ack));
      return;
    }
    const m = /\/d\/([^/]+)\/set$/.exec(topic);
    if (m) {
      const cmd = SetCommand.safeParse(JSON.parse(text));
      if (!cmd.success) return;
      this.sets.push({ deviceId: m[1], cmd: cmd.data });
      if (this.echoSet) await this.state(m[1] as DeviceId, cmd.data.values);
    }
  }
}
