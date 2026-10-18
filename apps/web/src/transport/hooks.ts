/**
 * transport ⇄ features contract (contracts/README.md). Features read data only through these hooks;
 * selectors are per-id so a tile re-renders only when its own device/state changes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { z } from "zod";
import type {
  CommandAck,
  Device,
  DeviceId,
  Hub as HubSchema,
  HubId,
  HubStatus,
  PropertyValue,
  Room as RoomSchema,
  RoomId,
  Site as SiteSchema,
  SiteId,
} from "@devicenet/shared";
import { configStore } from "@/stores/config";
import { connectionStore, type MqttStatus } from "@/stores/connection";
import { deviceStateStore } from "@/stores/deviceState";
import { sessionStore } from "@/stores/session";
import { useTransport } from "./TransportProvider";
import type { CommandInput, ConfigWrites } from "./index";
import { HISTORY_STEP_S, HISTORY_WINDOW_MS, createHistorySource, type HistoryPoint } from "./HistorySource";

type Hub = z.infer<typeof HubSchema>;
type Room = z.infer<typeof RoomSchema>;
type Site = z.infer<typeof SiteSchema>;

const EMPTY_ROOMS: Room[] = [];
const EMPTY_PENDING: Record<string, { value: PropertyValue; sentAt: number }> = {};
const EMPTY_FOUND: DeviceId[] = [];

function noTransport(): Promise<never> {
  return Promise.reject(new Error("Transport not ready"));
}

/** Active devices of a site, optionally one room, ordered by layout (y, x) then `createdAt`. */
export function useDevices(siteId: SiteId | null | undefined, filter: "all" | RoomId = "all"): Device[] {
  const devices = useStore(configStore, (s) => s.devices);
  const layout = useStore(configStore, (s) => (siteId ? s.layouts[siteId] : undefined));
  return useMemo(() => {
    if (!siteId) return [];
    const list = Object.values(devices).filter(
      (d) => d.siteId === siteId && d.status === "active" && (filter === "all" || d.roomId === filter),
    );
    const tiles = layout?.filters[filter]?.tiles ?? {};
    return list.sort((a, b) => {
      const ta = tiles[a.id];
      const tb = tiles[b.id];
      if (ta && tb) return ta.y - tb.y || ta.x - tb.x;
      if (ta) return -1;
      if (tb) return 1;
      return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    });
  }, [devices, layout, siteId, filter]);
}

export function useDevice(id: DeviceId | null | undefined): Device | undefined {
  return useStore(configStore, (s) => (id ? s.devices[id] : undefined));
}

export interface DeviceStateView {
  /** Confirmed values with pending (optimistic) values merged on top. */
  values: Record<string, PropertyValue>;
  at: Record<string, number>;
  online: boolean;
  lastSeen: number;
  lqi?: number;
  pending: ReadonlySet<string>;
}

export function useDeviceState(id: DeviceId | null | undefined): DeviceStateView | undefined {
  const state = useStore(deviceStateStore, (s) => (id ? s.byId[id] : undefined));
  // PendingTracker keeps unchanged `{value, sentAt}` entries by identity → shallow compare per id.
  const pending = useStore(
    deviceStateStore,
    useShallow((s) => (id ? (s.pending[id] ?? EMPTY_PENDING) : EMPTY_PENDING)),
  );
  return useMemo(() => {
    const keys = Object.keys(pending);
    if (!state && keys.length === 0) return undefined;
    const values: Record<string, PropertyValue> = { ...(state?.values ?? {}) };
    for (const k of keys) values[k] = pending[k]!.value;
    return {
      values,
      at: state?.at ?? {},
      online: state?.online ?? true,
      lastSeen: state?.lastSeen ?? 0,
      lqi: state?.lqi,
      pending: new Set(keys),
    };
  }, [state, pending]);
}

/** `(deviceId, values)` → registers pending and publishes; rejects (`HubOfflineError`, validation) without sending. */
export function useSetValues(): (deviceId: DeviceId, values: Record<string, unknown>) => Promise<void> {
  const t = useTransport();
  return useCallback((deviceId, values) => (t ? t.commands.setValues(deviceId, values) : noTransport()), [t]);
}

/** `(hubId, cmd)` → resolves with the ack; rejects `HubTimeoutError` after CMD_ACK_TIMEOUT_MS. */
export function useSendCommand(): (hubId: HubId, cmd: CommandInput) => Promise<CommandAck> {
  const t = useTransport();
  return useCallback((hubId, cmd) => (t ? t.commands.sendCommand(hubId, cmd) : noTransport()), [t]);
}

export function useHub(siteId: SiteId | null | undefined): Hub | undefined {
  return useStore(configStore, (s) =>
    siteId ? Object.values(s.hubs).find((h) => h.siteId === siteId) : undefined,
  );
}

export interface HubStatusView {
  online: boolean;
  /** Live MQTT status, if received. */
  status?: HubStatus;
  lanUrl?: string;
  agentVersion?: string;
  z2m?: HubStatus["z2m"];
  lastSeen?: number;
}

/** MQTT `status` first, Firestore mirror fallback. */
export function useHubStatus(hubId: HubId | null | undefined): HubStatusView {
  const status = useStore(connectionStore, (s) => (hubId ? s.hubStatus[hubId] : undefined));
  const hub = useStore(configStore, (s) => (hubId ? s.hubs[hubId] : undefined));
  return useMemo(
    () => ({
      online: status?.online ?? hub?.online ?? false,
      status,
      lanUrl: status?.lanUrl ?? hub?.lanUrl,
      agentVersion: status?.agentVersion || hub?.agentVersion,
      z2m: status?.z2m,
      lastSeen: status && status.ts > 0 ? status.ts : hub?.lastSeen,
    }),
    [status, hub],
  );
}

/** `() => hub-clock now` (local time + learned clock offset). */
export function useHubNow(hubId: HubId | null | undefined): () => number {
  const offset = useStore(connectionStore, (s) => (hubId ? (s.clockOffset[hubId] ?? 0) : 0));
  return useCallback(() => Date.now() + offset, [offset]);
}

export interface PairingView {
  active: boolean;
  /** ms left on the hub clock (0 when inactive/expired). */
  remainingMs: number;
  found: DeviceId[];
}

/** Retained `pairing` + clock offset → countdown; re-renders about once per second while active. */
export function usePairing(hubId: HubId | null | undefined): PairingView {
  const p = useStore(connectionStore, (s) => (hubId ? s.pairing[hubId] : undefined));
  const hubNow = useHubNow(hubId);
  const [, setTick] = useState(0);
  const remainingMs = p?.active && p.expiresAt ? Math.max(0, p.expiresAt - hubNow()) : 0;
  const active = Boolean(p?.active) && (p?.expiresAt === undefined || remainingMs > 0);

  useEffect(() => {
    if (!active || remainingMs <= 0) return;
    const delay = remainingMs % 1000 || 1000;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(delay, remainingMs));
    return () => clearTimeout(timer);
  });

  return { active, remainingMs, found: p?.found ?? EMPTY_FOUND };
}

export function useConnection(): { mqtt: MqttStatus; mode: "cloud" | "lan" } {
  const mqtt = useStore(connectionStore, (s) => s.mqtt);
  const mode = useStore(sessionStore, (s) => s.mode);
  return useMemo(() => ({ mqtt, mode }), [mqtt, mode]);
}

export function useSites(): Site[] {
  return useStore(configStore, (s) => s.sites);
}

export function useRooms(siteId: SiteId | null | undefined): Room[] {
  return useStore(configStore, (s) => (siteId ? (s.roomsBySite[siteId] ?? EMPTY_ROOMS) : EMPTY_ROOMS));
}

/** `null` in LAN (edit UI disabled) or before the transport is ready. */
export function useConfigWrites(): ConfigWrites | null {
  return useTransport()?.writes ?? null;
}

export interface HistoryView {
  points: HistoryPoint[];
  from: number;
  to: number;
  status: "loading" | "ready" | "error";
}

/** Last 24 h of a numeric property: LAN `/api/history`, cloud `history.get`. Fetched once per mount while `enabled`. */
export function useHistory(
  hubId: HubId | null | undefined,
  deviceId: DeviceId | null | undefined,
  property: string,
  enabled = true,
): HistoryView {
  const t = useTransport();
  const mode = useStore(sessionStore, (s) => s.mode);
  const [view, setView] = useState<HistoryView>({ points: [], from: 0, to: 0, status: "loading" });
  useEffect(() => {
    if (!enabled || !t || !hubId || !deviceId) return;
    let cancelled = false;
    const to = Date.now();
    const from = to - HISTORY_WINDOW_MS;
    setView({ points: [], from, to, status: "loading" });
    const src = createHistorySource(mode, { sendCommand: (h, c) => t.commands.sendCommand(h, c) });
    src
      .get({ hubId, deviceId, property, from, to, step: HISTORY_STEP_S })
      .then((points) => !cancelled && setView({ points, from, to, status: "ready" }))
      .catch(() => !cancelled && setView({ points: [], from, to, status: "error" }));
    return () => {
      cancelled = true;
    };
  }, [t, mode, hubId, deviceId, property, enabled]);
  return view;
}
