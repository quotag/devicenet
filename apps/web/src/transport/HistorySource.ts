/**
 * Numeric history for PropertyChart (US-13, FR-F06).
 * LAN: `GET /api/history/{dev}/{prop}?from&to&step` on the hub. Cloud: `history.get` command, `result.points`.
 */
import type { CommandAck, DeviceId, HubId } from "@devicenet/shared";
import type { CommandInput } from "./HubCommands";

export type HistoryPoint = [ts: number, value: number];

export interface HistoryQuery {
  hubId: HubId;
  deviceId: DeviceId;
  property: string;
  from: number;
  to: number;
  /** Bucket size in seconds (60..3600). */
  step: number;
}

export interface HistorySource {
  get(q: HistoryQuery): Promise<HistoryPoint[]>;
}

/** 24 h at 5 min buckets = 288 points (≤ 300 per contract). */
export const HISTORY_WINDOW_MS = 24 * 3600 * 1000;
export const HISTORY_STEP_S = 300;

export function parsePoints(raw: unknown): HistoryPoint[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: HistoryPoint[] = [];
  for (const p of list) {
    if (Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number" && Number.isFinite(p[1])) {
      out.push([p[0], p[1]]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export class LanHistorySource implements HistorySource {
  constructor(
    private baseUrl = "",
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  async get(q: HistoryQuery): Promise<HistoryPoint[]> {
    const qs = new URLSearchParams({ from: String(q.from), to: String(q.to), step: String(q.step) });
    const url = `${this.baseUrl}/api/history/${encodeURIComponent(q.deviceId)}/${encodeURIComponent(q.property)}?${qs}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`history ${res.status}`);
    const body = (await res.json()) as unknown;
    return parsePoints(Array.isArray(body) ? body : (body as { points?: unknown })?.points);
  }
}

export class CloudHistorySource implements HistorySource {
  constructor(private sendCommand: (hubId: HubId, cmd: CommandInput) => Promise<CommandAck>) {}

  async get(q: HistoryQuery): Promise<HistoryPoint[]> {
    const ack = await this.sendCommand(q.hubId, {
      type: "history.get",
      deviceId: q.deviceId,
      property: q.property,
      from: q.from,
      to: q.to,
      step: q.step,
    });
    if (!ack.ok) throw new Error(ack.message ?? ack.error ?? "history failed");
    return parsePoints(ack.result?.points);
  }
}

export function createHistorySource(
  mode: "cloud" | "lan",
  deps: { sendCommand: (hubId: HubId, cmd: CommandInput) => Promise<CommandAck>; fetchImpl?: typeof fetch; baseUrl?: string },
): HistorySource {
  return mode === "lan"
    ? new LanHistorySource(deps.baseUrl ?? "", deps.fetchImpl)
    : new CloudHistorySource(deps.sendCommand);
}
