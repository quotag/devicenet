/**
 * DeviceNet — MQTT contract (the REAL-TIME path: app ⇄ hub)
 *
 * Everything time-critical travels here, never through Firestore or Cloud Run:
 *   state   (hub → app)   retained snapshots, one topic per device
 *   set     (app → hub)   write properties; confirmed ONLY by a new `state`
 *   cmd/ack (app ⇄ hub)   request/response with correlation id
 *   pairing (hub → app)   retained pairing state with server-side expiresAt
 *   runs    (hub → app)   scene/rule execution progress
 *   events  (hub → app)   fire-and-forget notifications
 *   status  (hub → app)   retained hub liveness with LWT
 *
 * SAME namespace on EMQX (cloud) and Mosquitto (LAN) so the app transport layer is identical.
 * Z2M raw topics (`zigbee2mqtt/#`) never leave the hub.
 *
 * Payload rules (apply to every topic):
 *   - JSON object, UTF-8, < 4 KB.
 *   - `ts` = epoch ms from the HUB clock (hub is NTP-synced; app never uses its own clock to stamp hub data).
 *   - `seq` = per-hub monotonically increasing uint; receivers drop out-of-order duplicates per topic.
 *   - Unknown fields must be ignored (forward compatibility). Additive changes only; breaking → new `v`.
 */
import { z } from "zod";
import { CommandId, DeviceId, EpochMs, HubId, PropertyKey, RuleId, RunId, SceneId, TenantId, EventId, Rev } from "./ids";
import { PropertyValue } from "./property";

export const MQTT_CONTRACT_VERSION = 1;

// ---------- Topics ----------

export const topics = {
  root: (t: TenantId) => `t/${t}`,
  hub: (t: TenantId, h: HubId) => `t/${t}/h/${h}`,
  status: (t: TenantId, h: HubId) => `t/${t}/h/${h}/status`,
  cmd: (t: TenantId, h: HubId) => `t/${t}/h/${h}/cmd`,
  ack: (t: TenantId, h: HubId) => `t/${t}/h/${h}/cmd/ack`,
  events: (t: TenantId, h: HubId) => `t/${t}/h/${h}/events`,
  pairing: (t: TenantId, h: HubId) => `t/${t}/h/${h}/pairing`,
  runs: (t: TenantId, h: HubId) => `t/${t}/h/${h}/runs`,
  state: (t: TenantId, h: HubId, d: DeviceId) => `t/${t}/h/${h}/d/${d}/state`,
  set: (t: TenantId, h: HubId, d: DeviceId) => `t/${t}/h/${h}/d/${d}/set`,
  history: (t: TenantId, h: HubId, d: DeviceId) => `t/${t}/h/${h}/d/${d}/history`, // Phase 2
  /** App subscribes once to everything of its tenant */
  tenantWildcard: (t: TenantId) => `t/${t}/#`,
  /** Hub subscribes to exactly these two patterns */
  hubSubscriptions: (t: TenantId, h: HubId) => [`t/${t}/h/${h}/d/+/set`, `t/${t}/h/${h}/cmd`] as const,
} as const;

/** QoS / retain matrix — enforced by publishers, documented for tests */
export const topicPolicy = {
  status:  { qos: 1, retain: true  },
  state:   { qos: 1, retain: true  },
  pairing: { qos: 1, retain: true  },
  set:     { qos: 1, retain: false },
  cmd:     { qos: 1, retain: false },
  ack:     { qos: 1, retain: false },
  runs:    { qos: 1, retain: false },
  events:  { qos: 0, retain: false },
  history: { qos: 0, retain: false },
} as const;

/** Parse a topic back into its parts (app uses this on every incoming message) */
export function parseTopic(topic: string):
  | { kind: "status" | "cmd" | "ack" | "events" | "pairing" | "runs"; tenantId: string; hubId: string }
  | { kind: "state" | "set" | "history"; tenantId: string; hubId: string; deviceId: string }
  | null {
  const p = topic.split("/");
  if (p[0] !== "t" || p[2] !== "h") return null;
  const tenantId = p[1], hubId = p[3];
  if (p[4] === "d" && p.length === 7) {
    const kind = p[6];
    if (kind === "state" || kind === "set" || kind === "history") return { kind, tenantId, hubId, deviceId: p[5] };
    return null;
  }
  if (p.length === 5 && ["status", "cmd", "events", "pairing", "runs"].includes(p[4]))
    return { kind: p[4] as "status" | "cmd" | "events" | "pairing" | "runs", tenantId, hubId };
  if (p.length === 6 && p[4] === "cmd" && p[5] === "ack") return { kind: "ack", tenantId, hubId };
  return null;
}

// ---------- Common envelope fields ----------
const Envelope = z.object({
  v: z.literal(MQTT_CONTRACT_VERSION).default(MQTT_CONTRACT_VERSION),
  ts: EpochMs,
  seq: z.number().int().nonnegative(),
});

// ---------- status (retained, LWT) ----------

export const HubStatus = Envelope.extend({
  online: z.boolean(),
  agentVersion: z.string(),
  z2m: z.enum(["online", "offline", "starting"]),
  z2mVersion: z.string().optional(),
  /** LAN URL the hub serves the PWA on, e.g. "http://192.168.1.20:8080" */
  lanUrl: z.string().url().optional(),
  ip: z.string().optional(),
  platform: z.enum(["windows", "linux"]).optional(),
  deviceCount: z.number().int().nonnegative().optional(),
  /** Hub clock offset vs NTP in ms (diagnostics) */
  clockSkewMs: z.number().int().optional(),
});
export type HubStatus = z.infer<typeof HubStatus>;

/** The LWT message EMQX publishes when the hub dies — registered at connect time */
export const hubLwt = (): HubStatus => ({ v: 1, ts: 0, seq: 0, online: false, agentVersion: "", z2m: "offline" });

// ---------- state (retained, one per device) ----------

/**
 * Full snapshot of all property values. `ts` on the envelope = time of this publish.
 * `at[key]` = per-property last-change time, so the UI can show "cập nhật 12 giây trước"
 * for power while energy says "14 phút trước". Only keys present in `values` appear in `at`.
 */
export const DeviceState = Envelope.extend({
  deviceId: DeviceId,
  online: z.boolean(),
  lastSeen: EpochMs,
  values: z.record(PropertyKey, PropertyValue),
  at: z.record(PropertyKey, EpochMs),
  /** Z2M link quality 0..255 (also exposed as diag property `linkquality`) */
  lqi: z.number().int().min(0).max(255).optional(),
});
export type DeviceState = z.infer<typeof DeviceState>;

// ---------- set (app → hub) ----------

/**
 * No ack topic for `set`: the confirmation is the next `state` whose `values` reflect the write.
 * App keeps `pending` until (a) a `state` arrives whose values for the written keys equal the requested
 * values (compare after type normalisation), or (b) SET_CONFIRM_TIMEOUT_MS elapse → rollback + toast.
 * Validation failures are reported on `events` as type "set.rejected" (no per-set ack in v1).
 */
export const SetCommand = z.object({
  v: z.literal(MQTT_CONTRACT_VERSION).default(MQTT_CONTRACT_VERSION),
  /** at least one key; hub validates each against Property (writable + type) and rejects whole message on any failure via `events` type "set.rejected" */
  values: z.record(PropertyKey, PropertyValue).refine((o) => Object.keys(o).length > 0, "empty set"),
  /** Who sent it (uid or "lan"); for event log only */
  by: z.string().max(128).optional(),
});
export type SetCommand = z.infer<typeof SetCommand>;

// ---------- cmd / ack ----------

export const Command = z.discriminatedUnion("type", [
  /** Open Zigbee permit-join. Hub publishes `pairing` retained with expiresAt. */
  z.object({ type: z.literal("pairing.start"), seconds: z.number().int().min(10).max(254).default(120) }),
  z.object({ type: z.literal("pairing.stop") }),
  /** Remove from Zigbee network. force=true when device is offline (Z2M `force`). Hub marks Firestore device `removed`. */
  z.object({ type: z.literal("device.remove"), deviceId: DeviceId, force: z.boolean().default(false) }),
  /** App renamed device; hub updates Z2M friendly_name for debuggability (never required for function). */
  z.object({ type: z.literal("device.rename"), deviceId: DeviceId, name: z.string().min(1).max(60) }),
  /** S-20 offline "Tìm lại thiết bị": ask Z2M to ping / re-check availability and read state. */
  z.object({ type: z.literal("device.ping"), deviceId: DeviceId }),
  /** Tap-to-run. Hub answers ack immediately, then streams `runs` progress with runId. */
  z.object({ type: z.literal("scene.run"), sceneId: SceneId }),
  /** S-30 "Chạy thử": run the given actions inline without saving. Same `runs` progress. */
  z.object({ type: z.literal("actions.test"), actions: z.array(z.unknown()).min(1).max(20) /* validated with Action[] from rule.ts */ }),
  /**
   * Numeric history for PropertyChart (US-13) when the app is REMOTE (cloud build cannot fetch http://hub LAN).
   * Ack `result` = { points: [ts, value][] } bucketed by `step` seconds. ≤ 300 points → ack ≤ 16 KB (allowed exception to the 4 KB rule).
   */
  z.object({
    type: z.literal("history.get"),
    deviceId: DeviceId,
    property: PropertyKey,
    from: EpochMs,
    to: EpochMs,
    step: z.number().int().min(60).max(3600).default(300),
  }),
  /** Force the hub to re-read config from Firestore now (rarely needed; listener does it). */
  z.object({ type: z.literal("config.resync") }),
  /** Ask hub to republish all retained state + status (app reconnect fallback). */
  z.object({ type: z.literal("state.republish") }),
]);
export type Command = z.infer<typeof Command>;

export const CommandEnvelope = z.object({
  v: z.literal(MQTT_CONTRACT_VERSION).default(MQTT_CONTRACT_VERSION),
  id: CommandId,
  /** app's own clock, for latency metrics only */
  sentAt: EpochMs,
  by: z.string().max(128).optional(),
  cmd: Command,
});
export type CommandEnvelope = z.infer<typeof CommandEnvelope>;

export const AckError = z.enum([
  "invalid",          // schema/validation failed
  "not_found",        // deviceId / sceneId unknown
  "driver_unavailable", // Z2M offline
  "busy",             // pairing already in progress etc.
  "timeout",          // driver did not answer in time
  "internal",
]);

export const CommandAck = Envelope.extend({
  id: CommandId,
  ok: z.boolean(),
  error: AckError.optional(),
  message: z.string().max(300).optional(),
  /** Command-specific result: scene.run / actions.test → { runId }, pairing.start → { expiresAt } */
  result: z.record(z.string(), z.unknown()).optional(),
});
export type CommandAck = z.infer<typeof CommandAck>;

/** App-side rule: if no ack within this time, show error and treat as failed. */
export const CMD_ACK_TIMEOUT_MS = 5_000;
export const SET_CONFIRM_TIMEOUT_MS = 3_000;

// ---------- pairing (retained) ----------

export const PairingState = Envelope.extend({
  active: z.boolean(),
  /** Hub time when permit-join closes. App countdown = expiresAt - (now + clockOffset). */
  expiresAt: EpochMs.optional(),
  startedAt: EpochMs.optional(),
  /** Devices found in THIS pairing session (ids already created in Firestore with status "new") */
  found: z.array(DeviceId).default([]),
});
export type PairingState = z.infer<typeof PairingState>;

// ---------- runs (scene / rule execution progress) ----------

export const RunStep = z.object({
  index: z.number().int().nonnegative(),
  status: z.enum(["pending", "running", "ok", "failed", "skipped"]),
  error: z.string().max(200).optional(),
});

export const RunProgress = Envelope.extend({
  runId: RunId,
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("scene"), sceneId: SceneId }),
    z.object({ kind: z.literal("rule"), ruleId: RuleId }),
    z.object({ kind: z.literal("test") }),
  ]),
  status: z.enum(["running", "ok", "partial", "failed", "cancelled"]),
  total: z.number().int().positive(),
  steps: z.array(RunStep),
});
export type RunProgress = z.infer<typeof RunProgress>;

// ---------- events (fire-and-forget; also uploaded to Firestore `events` by hub, idempotent by id) ----------

export const HubEvent = Envelope.extend({
  id: EventId,
  hubId: HubId,
}).and(
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("device.found"), deviceId: DeviceId, model: z.string(), vendor: z.string().optional() }),
    z.object({ type: z.literal("device.removed"), deviceId: DeviceId }),
    z.object({ type: z.literal("device.online"), deviceId: DeviceId }),
    z.object({ type: z.literal("device.offline"), deviceId: DeviceId }),
    z.object({ type: z.literal("rule.fired"), ruleId: RuleId, runId: RunId, result: z.enum(["ok", "partial", "failed"]) }),
    z.object({ type: z.literal("rule.broken"), ruleId: RuleId, reason: z.string() }),
    z.object({ type: z.literal("scene.run"), sceneId: SceneId, runId: RunId, result: z.enum(["ok", "partial", "failed"]) }),
    z.object({ type: z.literal("notify"), title: z.string(), body: z.string().optional(), level: z.enum(["info", "warning", "critical"]), ruleId: RuleId.optional() }),
    z.object({ type: z.literal("set.rejected"), deviceId: DeviceId, reason: z.string() }),
    z.object({ type: z.literal("config.applied"), ruleIds: z.array(RuleId), sceneIds: z.array(SceneId), rev: Rev.optional() }),
    z.object({ type: z.literal("hub.warning"), code: z.string(), message: z.string() }),
  ]),
);
export type HubEvent = z.infer<typeof HubEvent>;
