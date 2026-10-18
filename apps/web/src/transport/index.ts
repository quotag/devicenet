/**
 * Transport factory (plan decision 1, contracts/README.md).
 *
 * `createTransport(mode, session)` wires MqttClient → inbound pipeline → stores, HubCommands and a
 * ConfigSource. Cloud pulls Firestore + writes via `await import()` guarded by `import.meta.env.VITE_MODE`
 * so the LAN bundle (`vite build --mode lan`) contains no `firebase/*` code.
 */
import type { CommandAck, DeviceId, HubEvent, HubId, Layout, TenantId } from "@devicenet/shared";
import type { ConfigSource } from "./ConfigSource";
import { HubCommands, type CommandInput } from "./HubCommands";
import { createInbound, type Inbound } from "./inbound";
import { MqttClient, type MqttClientOptions, type TopicKind } from "./MqttClient";
import { LanConfigSource } from "./lan/LanConfigSource";
import type { DevicePresentation, MemberPrefs } from "./writes";

export type TransportMode = "cloud" | "lan";

export interface TransportSession {
  tenantId: TenantId;
  /** Firebase uid (cloud). LAN uses "lan". */
  uid?: string;
  /** Firebase ID token → MQTT password (cloud). */
  idToken?: string | null;
}

/** Cloud presentation writes bound to the session tenant. `null` in LAN (edit UI disabled). */
export interface ConfigWrites {
  updateDevicePresentation(deviceId: DeviceId, p: DevicePresentation): Promise<void>;
  createRoom(siteId: string, name: string, order?: number): Promise<string>;
  createSite(name: string, timezone: string, order?: number): Promise<string>;
  renameHub(hubId: HubId, name: string, siteId?: string): Promise<void>;
  /** Writes `enabled`, `rev = rev + 1`, `updatedAt`. */
  setRuleEnabled(ruleId: string, enabled: boolean, rev: number): Promise<void>;
  /** B21: SH-5 rename room. */
  renameRoom(siteId: string, roomId: string, name: string): Promise<void>;
  /** B21: SH-5 delete room in one batch (devices roomId=null, room doc, layout filter dropped). */
  deleteRoom(siteId: string, roomId: string, deviceIds: readonly string[], layout?: Pick<Layout, "rev" | "filters">): Promise<void>;
  /** B21: SH-6 delete rule / scene doc. */
  deleteRule(ruleId: string): Promise<void>;
  deleteScene(sceneId: string): Promise<void>;
  /** B20: `members/{uid}.prefs` (optional so older fakes still satisfy the type). */
  setPrefs?(uid: string, prefs: MemberPrefs): Promise<void>;
}

export interface TransportCommands {
  sendCommand(hubId: HubId, cmd: CommandInput): Promise<CommandAck>;
  setValues(deviceId: DeviceId, values: Record<string, unknown>): Promise<void>;
}

/** Minimal MQTT surface the transport needs (MqttClient; fakes in tests). */
export interface TransportMqtt {
  start(): void;
  end(): Promise<void>;
  setPassword(token: string): void;
  publish(kind: TopicKind, topic: string, payload: unknown): Promise<void>;
}

export interface Transport {
  readonly mode: TransportMode;
  readonly tenantId: TenantId;
  readonly mqtt: TransportMqtt;
  readonly config: ConfigSource;
  readonly commands: TransportCommands;
  readonly writes: ConfigWrites | null;
  /** Hub-clock "now" (local time + clock offset learned from `status`). */
  hubNow(hubId: HubId): number;
  /** Token refresh (docs §2.6): next CONNECT uses it, the live connection stays up. */
  setPassword(token: string): void;
  dispose(): Promise<void>;
}

export interface CreateTransportOptions {
  /** Override the broker URL (default: cloud `VITE_MQTT_URL`, LAN `ws://${location.hostname}:9001`). */
  mqttUrl?: string;
  /** Inject a ConfigSource (e.g. the LanConfigSource already used for LAN boot, or a test double). */
  config?: ConfigSource;
  /** Inject writes (tests). Ignored in LAN. */
  writes?: ConfigWrites | null;
  /** MQTT factory (tests). */
  createMqtt?: (o: MqttClientOptions) => TransportMqtt;
  onEvent?: (e: HubEvent) => void;
  ackTimeoutMs?: number;
  now?: () => number;
}

function lanMqttUrl(): string {
  const host = typeof location !== "undefined" && location.hostname ? location.hostname : "localhost";
  return `ws://${host}:9001`;
}

async function loadCloud(tenantId: string): Promise<{ config: ConfigSource; writes: ConfigWrites; mqttUrl?: string }> {
  const [{ FirestoreConfigSource }, w, { env }] = await Promise.all([
    import("./cloud/FirestoreConfigSource"),
    import("./writes"),
    import("@/env"),
  ]);
  return {
    config: new FirestoreConfigSource(),
    mqttUrl: env.mqttUrl,
    writes: {
      updateDevicePresentation: (id, p) => w.updateDevicePresentation(tenantId, id, p),
      createRoom: (siteId, name, order) => w.createRoom(tenantId, siteId, name, order),
      createSite: (name, tz, order) => w.createSite(tenantId, name, tz, order),
      renameHub: (hubId, name, siteId) => w.renameHub(tenantId, hubId, name, siteId),
      setRuleEnabled: (ruleId, enabled, rev) => w.setRuleEnabled(tenantId, ruleId, enabled, rev),
      renameRoom: (siteId, roomId, name) => w.renameRoom(tenantId, siteId, roomId, name),
      deleteRoom: (siteId, roomId, ids, layout) => w.deleteRoom(tenantId, siteId, roomId, ids, layout),
      deleteRule: (id) => w.deleteRule(tenantId, id),
      deleteScene: (id) => w.deleteScene(tenantId, id),
      setPrefs: (uid, prefs) => w.setPrefs(tenantId, uid, prefs),
    },
  };
}

export async function createTransport(
  mode: TransportMode,
  session: TransportSession,
  opts: CreateTransportOptions = {},
): Promise<Transport> {
  const { tenantId } = session;
  const lan = import.meta.env.VITE_MODE === "lan" || mode === "lan";
  const owner = lan ? "lan" : (session.uid ?? "anon");

  let config: ConfigSource;
  let writes: ConfigWrites | null = null;
  let url = opts.mqttUrl;
  if (import.meta.env.VITE_MODE !== "lan" && !lan) {
    // Statically dead in the LAN build (VITE_MODE === "lan") → no firebase chunk.
    const needCloud = !opts.config || opts.writes === undefined || !url;
    const cloud = needCloud ? await loadCloud(tenantId) : null;
    config = opts.config ?? cloud!.config;
    writes = opts.writes !== undefined ? opts.writes : cloud!.writes;
    url ??= cloud?.mqttUrl;
    if (!url) throw new Error("VITE_MQTT_URL missing for cloud transport");
  } else {
    config = opts.config ?? new LanConfigSource();
    url ??= lanMqttUrl();
  }

  let mqtt: TransportMqtt | null = null;
  const commands = new HubCommands({
    tenantId,
    by: owner,
    ackTimeoutMs: opts.ackTimeoutMs,
    now: opts.now,
    publish: (kind, topic, payload) =>
      mqtt ? mqtt.publish(kind, topic, payload) : Promise.reject(new Error("MQTT not started")),
  });
  const inbound: Inbound = createInbound({ tenantId, commands, now: opts.now, onEvent: opts.onEvent });

  const mqttOpts: MqttClientOptions = {
    url,
    tenantId,
    owner,
    username: lan ? undefined : session.uid,
    password: lan ? undefined : (session.idToken ?? undefined),
    onMessage: (topic, payload, retained) => inbound.handle(topic, payload, retained),
  };
  mqtt = (opts.createMqtt ?? ((o) => new MqttClient(o)))(mqttOpts);

  config.start(tenantId);
  mqtt.start();

  const now = opts.now ?? Date.now;
  let disposed = false;
  const m = mqtt;
  return {
    mode: lan ? "lan" : "cloud",
    tenantId,
    mqtt: m,
    config,
    commands: {
      sendCommand: (hubId, cmd) => commands.sendCommand(hubId, cmd),
      setValues: (deviceId, values) => commands.setValues(deviceId, values),
    },
    writes,
    hubNow: (hubId) => inbound.clockOffset(hubId).now(now()),
    setPassword: (token) => {
      if (!lan) m.setPassword(token);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      config.stop();
      commands.dispose();
      inbound.reset();
      await m.end();
    },
  };
}

export type { CommandInput } from "./HubCommands";
export type { DevicePresentation } from "./writes";
