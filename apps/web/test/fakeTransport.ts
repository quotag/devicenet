/**
 * In-memory Transport for screen tests (same API as `createTransport`).
 * Seeds the real stores (hooks read them), records `setValues` / `sendCommand` calls, and lets a test
 * resolve a command with an ack or fail it with `HubTimeoutError`.
 *
 *   const t = createFakeTransport({ devices: [dev], states: [st] });
 *   render(<TransportProvider transport={t}>…</TransportProvider>);
 *   t.ack(t.commands.sent[0].id);  // or t.timeout(id)
 */
import type { z } from "zod";
import type {
  CommandAck,
  Device,
  DeviceId,
  DeviceState,
  Hub,
  HubId,
  HubStatus,
  Layout,
  PairingState,
  Room,
  Rule,
  Scene,
  Site,
  SiteId,
  TenantId,
} from "@devicenet/shared";
import { configStore } from "@/stores/config";
import { connectionStore, type MqttStatus } from "@/stores/connection";
import { deviceStateStore } from "@/stores/deviceState";
import { HubOfflineError, HubTimeoutError, CommandFailedError } from "@/transport/errors";
import type { CommandInput, ConfigWrites, Transport, TransportMode } from "@/transport/index";
import type { DevicePresentation } from "@/transport/writes";

type HubDoc = z.infer<typeof Hub>;
type SiteDoc = z.infer<typeof Site>;
type RoomDoc = z.infer<typeof Room>;

export interface FakeSeed {
  sites?: SiteDoc[];
  rooms?: Record<string, RoomDoc[]>;
  hubs?: HubDoc[];
  devices?: Device[];
  layouts?: Layout[];
  rules?: Rule[];
  scenes?: Scene[];
  states?: DeviceState[];
  hubStatus?: Record<string, HubStatus>;
  pairing?: Record<string, PairingState>;
  clockOffset?: Record<string, number>;
  mqtt?: MqttStatus;
}

export interface SentCommand {
  id: string;
  hubId: HubId;
  cmd: CommandInput;
}

export interface FakeSet {
  deviceId: DeviceId;
  values: Record<string, unknown>;
}

export type WriteCall =
  | { op: "updateDevicePresentation"; deviceId: DeviceId; p: DevicePresentation }
  | { op: "createRoom"; siteId: string; name: string; order?: number; id: string }
  | { op: "createSite"; name: string; timezone: string; order?: number; id: string }
  | { op: "renameHub"; hubId: HubId; name: string; siteId?: string }
  | { op: "setRuleEnabled"; ruleId: string; enabled: boolean; rev: number }
  | { op: "renameRoom"; siteId: string; roomId: string; name: string }
  | { op: "deleteRoom"; siteId: string; roomId: string; deviceIds: string[]; layout?: unknown }
  | { op: "deleteRule"; ruleId: string }
  | { op: "deleteScene"; sceneId: string };

export interface FakeTransportOptions extends FakeSeed {
  mode?: TransportMode;
  tenantId?: TenantId;
  /** Auto-answer commands: `"ok"` acks immediately, `"timeout"` rejects, `"manual"` (default) waits for `ack()`/`timeout()`. */
  commandMode?: "manual" | "ok" | "timeout";
  /** Reject `setValues` when the hub/device is offline (like HubCommands). Default true. */
  checkOnline?: boolean;
  /** Apply sets as pending in deviceState store (default true). */
  pendingOnSet?: boolean;
}

export interface FakeTransport extends Transport {
  readonly sent: SentCommand[];
  readonly sets: FakeSet[];
  readonly writeCalls: WriteCall[];
  readonly passwords: string[];
  disposed: boolean;
  /** Resolve a pending command (default `ok:true`). */
  ack(id: string, ack?: Partial<CommandAck>): void;
  /** Reject a pending command with `HubTimeoutError`. */
  timeout(id: string): void;
  /** Confirm pending set(s) of a device by publishing a new state with merged values. */
  confirm(deviceId: DeviceId, values?: Record<string, unknown>): void;
  /** Re-seed stores. */
  seed(s: FakeSeed): void;
}

let n = 0;

export function seedStores(s: FakeSeed): void {
  const cfg = configStore.getState();
  if (s.sites) cfg.setSites(s.sites);
  if (s.rooms) for (const [site, rooms] of Object.entries(s.rooms)) cfg.setRooms(site as SiteId, rooms);
  if (s.hubs) cfg.setHubs(Object.fromEntries(s.hubs.map((h) => [h.id, h])) as Record<HubId, HubDoc>);
  if (s.devices) cfg.setDevices(Object.fromEntries(s.devices.map((d) => [d.id, d])) as Record<DeviceId, Device>);
  if (s.layouts) cfg.setLayouts(Object.fromEntries(s.layouts.map((l) => [l.siteId, l])) as Record<SiteId, Layout>);
  if (s.rules) cfg.setRules(Object.fromEntries(s.rules.map((r) => [r.id, r])));
  if (s.scenes) cfg.setScenes(Object.fromEntries(s.scenes.map((r) => [r.id, r])));
  for (const k of ["sites", "rooms", "hubs", "devices", "layouts", "rules", "scenes"] as const) cfg.setLoaded(k);
  const ds = deviceStateStore.getState();
  for (const st of s.states ?? []) ds.setState(st.deviceId, st);
  const conn = connectionStore.getState();
  for (const [h, st] of Object.entries(s.hubStatus ?? {})) conn.setHubStatus(h as HubId, st);
  for (const [h, p] of Object.entries(s.pairing ?? {})) conn.setPairing(h as HubId, p);
  for (const [h, o] of Object.entries(s.clockOffset ?? {})) conn.setClockOffset(h as HubId, o);
  if (s.mqtt) conn.setMqtt(s.mqtt);
}

export function createFakeTransport(opts: FakeTransportOptions = {}): FakeTransport {
  const mode = opts.mode ?? "cloud";
  const tenantId = (opts.tenantId ?? "tenant_01HZZZZZZZZZZZZZZZZZZZZZZZ") as TenantId;
  const commandMode = opts.commandMode ?? "manual";
  const waiters = new Map<string, { hubId: HubId; resolve: (a: CommandAck) => void; reject: (e: Error) => void }>();
  const sent: SentCommand[] = [];
  const sets: FakeSet[] = [];
  const writeCalls: WriteCall[] = [];
  const passwords: string[] = [];
  seedStores({ mqtt: "online", ...opts });

  const writes: ConfigWrites | null =
    mode === "lan"
      ? null
      : {
          async updateDevicePresentation(deviceId, p) {
            writeCalls.push({ op: "updateDevicePresentation", deviceId, p });
          },
          async createRoom(siteId, name, order) {
            const id = `room_FAKE${++n}`;
            writeCalls.push({ op: "createRoom", siteId, name, order, id });
            return id;
          },
          async createSite(name, timezone, order) {
            const id = `site_FAKE${++n}`;
            writeCalls.push({ op: "createSite", name, timezone, order, id });
            return id;
          },
          async renameHub(hubId, name, siteId) {
            writeCalls.push({ op: "renameHub", hubId, name, siteId });
          },
          async setRuleEnabled(ruleId, enabled, rev) {
            writeCalls.push({ op: "setRuleEnabled", ruleId, enabled, rev });
          },
          async renameRoom(siteId, roomId, name) {
            writeCalls.push({ op: "renameRoom", siteId, roomId, name });
          },
          async deleteRoom(siteId, roomId, deviceIds, layout) {
            writeCalls.push({ op: "deleteRoom", siteId, roomId, deviceIds: [...deviceIds], layout });
          },
          async deleteRule(ruleId) {
            writeCalls.push({ op: "deleteRule", ruleId });
          },
          async deleteScene(sceneId) {
            writeCalls.push({ op: "deleteScene", sceneId });
          },
        };

  const fake: FakeTransport = {
    mode,
    tenantId,
    sent,
    sets,
    writeCalls,
    passwords,
    disposed: false,
    mqtt: {
      start() {},
      async end() {},
      setPassword: (t) => void passwords.push(t),
      async publish() {},
    },
    config: { start() {}, stop() {}, ready: Promise.resolve() },
    writes,
    commands: {
      sendCommand(hubId, cmd) {
        const id = `cmd_FAKE${++n}`;
        sent.push({ id, hubId, cmd });
        if (commandMode === "ok") return Promise.resolve({ v: 1, id, ts: Date.now(), seq: 0, ok: true } as CommandAck);
        if (commandMode === "timeout") return Promise.reject(new HubTimeoutError(hubId, id));
        return new Promise((resolve, reject) => waiters.set(id, { hubId, resolve, reject }));
      },
      async setValues(deviceId, values) {
        const device = configStore.getState().devices[deviceId];
        if (opts.checkOnline !== false && device) {
          const hubOn =
            connectionStore.getState().hubStatus[device.hubId]?.online ??
            configStore.getState().hubs[device.hubId]?.online ??
            false;
          if (!hubOn) throw new HubOfflineError(device.hubId);
          if (deviceStateStore.getState().byId[deviceId]?.online === false)
            throw new HubOfflineError(device.hubId, deviceId);
        }
        sets.push({ deviceId, values });
        if (opts.pendingOnSet !== false) {
          const st = deviceStateStore.getState();
          const cur = { ...(st.pending[deviceId] ?? {}) };
          for (const [k, v] of Object.entries(values)) cur[k] = { value: v as never, sentAt: Date.now() };
          st.setPending({ ...st.pending, [deviceId]: cur });
        }
      },
    },
    hubNow: (hubId) => Date.now() + (connectionStore.getState().clockOffset[hubId] ?? 0),
    setPassword: (t) => void passwords.push(t),
    async dispose() {
      fake.disposed = true;
      for (const [id, w] of waiters) w.reject(new HubTimeoutError(w.hubId, id));
      waiters.clear();
    },
    ack(id, a = {}) {
      const w = waiters.get(id);
      if (!w) throw new Error(`no pending command ${id}`);
      waiters.delete(id);
      const full = { v: 1, id, ts: Date.now(), seq: 0, ok: true, ...a } as CommandAck;
      if (full.ok) w.resolve(full);
      else w.reject(new CommandFailedError(full));
    },
    timeout(id) {
      const w = waiters.get(id);
      if (!w) throw new Error(`no pending command ${id}`);
      waiters.delete(id);
      w.reject(new HubTimeoutError(w.hubId, id));
    },
    confirm(deviceId, values) {
      const st = deviceStateStore.getState();
      const pend = st.pending[deviceId] ?? {};
      const merged = values ?? Object.fromEntries(Object.entries(pend).map(([k, p]) => [k, p.value]));
      const prev = st.byId[deviceId];
      const now = Date.now();
      st.setState(deviceId, {
        v: 1,
        ts: now,
        seq: (prev?.seq ?? 0) + 1,
        deviceId,
        online: true,
        lastSeen: now,
        values: { ...(prev?.values ?? {}), ...merged } as DeviceState["values"],
        at: { ...(prev?.at ?? {}), ...Object.fromEntries(Object.keys(merged).map((k) => [k, now])) },
        lqi: prev?.lqi,
      } as DeviceState);
      const rest = { ...st.pending };
      delete rest[deviceId];
      st.setPending(rest);
    },
    seed: seedStores,
  };
  return fake;
}
