/**
 * Inbound MQTT pipeline (docs/realtime-and-events.md §2.1–§2.4, spec 002 §3).
 *
 * topic → `parseTopic` → JSON → shared Zod schema per kind → `SeqGate` → dispatch:
 *   status   → connection.hubStatus + per-hub ClockOffset
 *   state    → deviceState.byId + PendingTracker (empty retained payload → remove device state)
 *   pairing  → connection.pairing (empty retained payload → clear)
 *   runs     → connection.runs
 *   events   → `set.rejected` drops the device's pending keys + error toast; all events → `onEvent`
 *   ack      → HubCommands
 * `set`/`cmd`/`history` and foreign tenants are ignored. Invalid payloads → `console.warn` + drop.
 */
import {
  CommandAck,
  DeviceState,
  HubEvent,
  HubStatus,
  PairingState,
  RunProgress,
  parseTopic,
  type DeviceId,
  type HubId,
  type RunId,
  type TenantId,
} from "@devicenet/shared";
import type { ZodTypeAny } from "zod";
import { configStore } from "@/stores/config";
import { connectionStore } from "@/stores/connection";
import { deviceStateStore } from "@/stores/deviceState";
import { toastStore } from "@/stores/toast";
import { vi as strings } from "@/i18n/vi";
import { ClockOffset } from "./clockOffset";
import { SeqGate } from "./SeqGate";
import type { HubCommands } from "./HubCommands";

export interface InboundOptions {
  tenantId: TenantId;
  commands: Pick<HubCommands, "onAck" | "pending">;
  seqGate?: SeqGate;
  now?: () => number;
  /** Every accepted hub event (after built-in handling). */
  onEvent?: (e: HubEvent) => void;
}

export interface Inbound {
  handle(topic: string, payload: Uint8Array | string, retained: boolean): void;
  clockOffset(hubId: HubId): ClockOffset;
  /** Sign-out / tenant switch. */
  reset(): void;
}

const schemas = {
  status: HubStatus,
  state: DeviceState,
  pairing: PairingState,
  runs: RunProgress,
  events: HubEvent,
  ack: CommandAck,
} satisfies Record<string, ZodTypeAny>;

const decoder = new TextDecoder();

export function createInbound(opts: InboundOptions): Inbound {
  const gate = opts.seqGate ?? new SeqGate();
  const now = opts.now ?? Date.now;
  const clocks = new Map<string, ClockOffset>();
  const clock = (hubId: string) => {
    let c = clocks.get(hubId);
    if (!c) clocks.set(hubId, (c = new ClockOffset()));
    return c;
  };

  function handle(topic: string, payload: Uint8Array | string, retained: boolean): void {
    const t = parseTopic(topic);
    if (!t || t.tenantId !== opts.tenantId) return;
    if (t.kind === "set" || t.kind === "cmd" || t.kind === "history") return;

    const text = typeof payload === "string" ? payload : decoder.decode(payload);
    if (text.length === 0) {
      // Retained clear (docs §2.1): device removed / pairing cleared.
      if (t.kind === "state") {
        gate.forget(topic);
        deviceStateStore.getState().removeState(t.deviceId as DeviceId);
      } else if (t.kind === "pairing") {
        gate.forget(topic);
        connectionStore.getState().setPairing(t.hubId as HubId, null);
      }
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      console.warn(`[mqtt] dropped non-JSON payload on ${topic}`);
      return;
    }
    const parsed = schemas[t.kind].safeParse(json);
    if (!parsed.success) {
      console.warn(`[mqtt] dropped invalid ${t.kind} on ${topic}`, parsed.error.issues);
      return;
    }
    const msg = parsed.data as { seq: number; ts: number };

    if (t.kind === "status" && (msg as HubStatus).ts === 0 && !(msg as HubStatus).online) {
      // LWT (`hubLwt()`: ts 0, seq 0) would never pass the gate; always accept and restart history.
      gate.forget(topic);
    } else if (t.kind !== "ack" && !gate.accept(topic, msg.seq, msg.ts)) {
      return;
    }

    const hubId = t.hubId as HubId;
    switch (t.kind) {
      case "status": {
        const s = parsed.data as HubStatus;
        const conn = connectionStore.getState();
        conn.setHubStatus(hubId, s);
        const c = clock(hubId);
        c.addSample(s.ts, now(), retained);
        if (c.hasSample) conn.setClockOffset(hubId, c.offset);
        return;
      }
      case "state": {
        const s = parsed.data as DeviceState;
        if (s.deviceId !== t.deviceId) {
          console.warn(`[mqtt] state deviceId ${s.deviceId} does not match topic ${topic}`);
          return;
        }
        deviceStateStore.getState().setState(s.deviceId, s);
        opts.commands.pending.onState(s);
        return;
      }
      case "pairing":
        connectionStore.getState().setPairing(hubId, parsed.data as PairingState);
        return;
      case "runs": {
        const r = parsed.data as RunProgress;
        connectionStore.getState().setRun(r.runId as RunId, r);
        return;
      }
      case "events": {
        const e = parsed.data as HubEvent;
        if (e.type === "set.rejected") {
          const keys = opts.commands.pending.onRejected(e.deviceId);
          if (keys.length > 0) {
            const name = configStore.getState().devices[e.deviceId]?.name ?? e.deviceId;
            // TODO-OQ OQ-B06-1: no artboard string for set.rejected; reuse the S01-Toast timeout text.
            toastStore.getState().show({ kind: "error", text: strings.toast.timeout(name) });
          }
        }
        opts.onEvent?.(e);
        return;
      }
      case "ack":
        opts.commands.onAck(parsed.data as CommandAck);
        return;
    }
  }

  return {
    handle,
    clockOffset: clock,
    reset() {
      gate.reset();
      clocks.clear();
    },
  };
}
