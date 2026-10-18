/**
 * App → hub writes (docs/realtime-and-events.md §2.2, research R6, R7).
 *
 * - `sendCommand(hubId, cmd)` publishes a `CommandEnvelope` (`cmd_<ULID>`) on `topics.cmd` and resolves
 *   with the matching `CommandAck`. No ack within `CMD_ACK_TIMEOUT_MS` → `HubTimeoutError`
 *   (never assume the command ran). `ok:false` → `CommandFailedError`.
 * - `setValues(deviceId, values)` validates against the device's `PropertyMap`, refuses when hub or
 *   device is offline (`HubOfflineError`), registers optimistic pending keys in `PendingTracker`, and
 *   publishes a `SetCommand`. Confirmation comes only from a later `DeviceState` (inbound pipeline).
 */
import { ulid } from "ulid";
import {
  CMD_ACK_TIMEOUT_MS,
  Command,
  CommandEnvelope,
  SetCommand,
  isWritable,
  topics,
  validateValue,
  type CommandAck,
  type DeviceId,
  type HubId,
  type PropertyValue,
  type TenantId,
} from "@devicenet/shared";
import type { z } from "zod";
import { configStore } from "@/stores/config";
import { hubOnline } from "@/stores/connection";
import { deviceStateStore, type PendingMap } from "@/stores/deviceState";
import { toastStore } from "@/stores/toast";
import { vi as strings } from "@/i18n/vi";
import { PendingTracker, type PendingSnapshot } from "./PendingTracker";
import { CommandFailedError, HubOfflineError, HubTimeoutError } from "./errors";
import type { TopicKind } from "./MqttClient";

export type CommandInput = z.input<typeof Command>;
export type Publish = (kind: TopicKind, topic: string, payload: unknown) => Promise<void>;

/** Local validation failure of a `setValues` call (nothing was sent). */
export class SetValidationError extends Error {
  override readonly name = "SetValidationError";
  constructor(
    readonly deviceId: string,
    readonly key: string,
    reason: string,
  ) {
    super(`Cannot set ${deviceId}.${key}: ${reason}`);
  }
}

export interface HubCommandsOptions {
  tenantId: TenantId;
  publish: Publish;
  /** uid (cloud) or "lan" — goes into `by`. */
  by?: string;
  ackTimeoutMs?: number;
  /** PendingTracker timeout (defaults to SET_CONFIRM_TIMEOUT_MS). Ignored when `pending` is given. */
  setTimeoutMs?: number;
  pending?: PendingTracker;
  now?: () => number;
}

interface Waiter {
  hubId: HubId;
  resolve: (a: CommandAck) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function deviceName(id: string): string {
  return configStore.getState().devices[id as DeviceId]?.name ?? id;
}

/** PendingTracker snapshot → store shape, keeping `sentAt` stable for unchanged entries. */
function toPendingMap(snap: PendingSnapshot, prev: PendingMap, now: number): PendingMap {
  const out: PendingMap = {};
  for (const [dev, keys] of Object.entries(snap)) {
    const o: PendingMap[string] = {};
    for (const [k, value] of Object.entries(keys)) {
      const old = prev[dev]?.[k];
      o[k] = old && old.value === value ? old : { value, sentAt: now };
    }
    out[dev] = o;
  }
  return out;
}

export class HubCommands {
  readonly pending: PendingTracker;
  private readonly waiters = new Map<string, Waiter>();
  private readonly ackTimeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: HubCommandsOptions) {
    this.ackTimeoutMs = opts.ackTimeoutMs ?? CMD_ACK_TIMEOUT_MS;
    this.now = opts.now ?? Date.now;
    this.pending =
      opts.pending ??
      new PendingTracker({
        timeoutMs: opts.setTimeoutMs,
        onChange: (snap) => {
          const st = deviceStateStore.getState();
          st.setPending(toPendingMap(snap, st.pending, this.now()));
        },
        onTimeout: (deviceId) => {
          toastStore.getState().show({ kind: "timeout", text: strings.toast.timeout(deviceName(deviceId)) });
        },
      });
  }

  sendCommand(hubId: HubId, cmd: CommandInput): Promise<CommandAck> {
    let env: CommandEnvelope;
    try {
      env = CommandEnvelope.parse({
        v: 1,
        id: `cmd_${ulid()}`,
        sentAt: this.now(),
        by: this.opts.by,
        cmd,
      });
    } catch (e) {
      return Promise.reject(e);
    }
    return new Promise<CommandAck>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(env.id);
        reject(new HubTimeoutError(hubId, env.id));
      }, this.ackTimeoutMs);
      this.waiters.set(env.id, { hubId, resolve, reject, timer });
      this.opts.publish("cmd", topics.cmd(this.opts.tenantId, hubId), env).catch((err: Error) => {
        const w = this.waiters.get(env.id);
        if (!w) return;
        clearTimeout(w.timer);
        this.waiters.delete(env.id);
        reject(err);
      });
    });
  }

  /** Inbound `ack` (already schema-validated). Returns true when it matched a waiting command. */
  onAck(ack: CommandAck): boolean {
    const w = this.waiters.get(ack.id);
    if (!w) return false;
    clearTimeout(w.timer);
    this.waiters.delete(ack.id);
    if (ack.ok) w.resolve(ack);
    else w.reject(new CommandFailedError(ack));
    return true;
  }

  async setValues(deviceId: DeviceId, values: Record<string, unknown>): Promise<void> {
    const device = configStore.getState().devices[deviceId];
    if (!device) throw new SetValidationError(deviceId, "*", "unknown device");
    const hubId = device.hubId;
    if (!hubOnline(hubId, configStore.getState().hubs[hubId]?.online)) throw new HubOfflineError(hubId);
    if (deviceStateStore.getState().byId[deviceId]?.online === false) throw new HubOfflineError(hubId, deviceId);

    const clean: Record<string, PropertyValue> = {};
    for (const [key, raw] of Object.entries(values)) {
      const prop = device.properties[key];
      if (!prop) throw new SetValidationError(deviceId, key, "unknown property");
      if (!isWritable(prop)) throw new SetValidationError(deviceId, key, "read-only");
      const r = validateValue(prop, raw);
      if (!r.ok) throw new SetValidationError(deviceId, key, r.error);
      clean[key] = r.value;
    }
    const msg = SetCommand.safeParse({ v: 1, values: clean, by: this.opts.by });
    if (!msg.success) throw new SetValidationError(deviceId, "*", msg.error.issues[0]?.message ?? "invalid");

    this.pending.register(deviceId, clean, device.properties);
    try {
      await this.opts.publish("set", topics.set(this.opts.tenantId, hubId, deviceId), msg.data);
    } catch (err) {
      this.pending.onRejected(deviceId);
      throw err;
    }
  }

  /** Teardown: reject waiting commands, drop pending keys silently. */
  dispose(): void {
    for (const [id, w] of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new HubTimeoutError(w.hubId, id));
    }
    this.waiters.clear();
    this.pending.clear();
  }
}
