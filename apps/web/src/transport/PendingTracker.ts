/**
 * Optimistic `set` tracking per device/key (docs/realtime-and-events.md §2.2, research R6, D-05).
 *
 * `set` has no ack: a key is confirmed when a `DeviceState` arrives whose `values[key]` matches
 * the requested value. Each `register` call starts one timer for its keys; re-registering a key
 * moves it to the newer call (the older timer no longer owns it). On timeout the still-pending
 * keys of that call are removed and reported via `onTimeout` (UI rolls back + toast).
 *
 * Pure: no store imports. The owner subscribes via `onChange(snapshot)`.
 */
import {
  SET_CONFIRM_TIMEOUT_MS,
  type DeviceState,
  type Property,
  type PropertyMap,
  type PropertyValue,
} from "@devicenet/shared";

/** deviceId → key → requested value. A new object on every change. */
export type PendingSnapshot = Readonly<Record<string, Readonly<Record<string, PropertyValue>>>>;

export interface PendingTrackerOptions {
  /** Defaults to SET_CONFIRM_TIMEOUT_MS. */
  timeoutMs?: number;
  onTimeout?: (deviceId: string, keys: string[]) => void;
  onChange?: (snapshot: PendingSnapshot) => void;
}

interface Entry {
  value: PropertyValue;
  prop: Property | undefined;
  batch: number;
}

interface Batch {
  deviceId: string;
  timer: ReturnType<typeof setTimeout>;
}

/** Display precision per property.ts default: 0 for integers, 1 otherwise. */
function precisionOf(prop: Property | undefined, value: number): number {
  if (prop?.type === "numeric" && prop.precision !== undefined) return prop.precision;
  return Number.isInteger(value) ? 0 : 1;
}

/** Compare a reported value with the requested one after type normalisation. */
export function valueMatches(prop: Property | undefined, requested: PropertyValue, reported: unknown): boolean {
  if (typeof requested === "number") {
    if (typeof reported !== "number" || Number.isNaN(reported)) return false;
    return Math.abs(reported - requested) < 10 ** -precisionOf(prop, requested);
  }
  if (typeof requested === "boolean" || typeof requested === "string") return reported === requested;
  // composite: structural equality
  return typeof reported === "object" && reported !== null && JSON.stringify(reported) === JSON.stringify(requested);
}

export class PendingTracker {
  private readonly timeoutMs: number;
  private readonly entries = new Map<string, Map<string, Entry>>();
  private readonly batches = new Map<number, Batch>();
  private nextBatch = 1;
  private snap: PendingSnapshot = {};

  constructor(private readonly opts: PendingTrackerOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? SET_CONFIRM_TIMEOUT_MS;
  }

  register(deviceId: string, values: Record<string, PropertyValue>, props: PropertyMap = {}): void {
    const keys = Object.keys(values);
    if (keys.length === 0) return;
    const batch = this.nextBatch++;
    let dev = this.entries.get(deviceId);
    if (!dev) this.entries.set(deviceId, (dev = new Map()));
    for (const k of keys) dev.set(k, { value: values[k], prop: props[k], batch });
    this.batches.set(batch, { deviceId, timer: setTimeout(() => this.expire(batch), this.timeoutMs) });
    this.gcBatches(deviceId);
    this.emit();
  }

  /** Clear keys confirmed by an incoming state snapshot. */
  onState(state: Pick<DeviceState, "deviceId" | "values">): void {
    const dev = this.entries.get(state.deviceId);
    if (!dev) return;
    let changed = false;
    for (const [k, e] of dev) {
      if (Object.prototype.hasOwnProperty.call(state.values, k) && valueMatches(e.prop, e.value, state.values[k])) {
        dev.delete(k);
        changed = true;
      }
    }
    if (!changed) return;
    if (dev.size === 0) this.entries.delete(state.deviceId);
    this.gcBatches(state.deviceId);
    this.emit();
  }

  /** Hub event `set.rejected`: drop every pending key of the device (no onTimeout). Returns dropped keys. */
  onRejected(deviceId: string): string[] {
    const dev = this.entries.get(deviceId);
    if (!dev) return [];
    const keys = [...dev.keys()];
    this.entries.delete(deviceId);
    this.gcBatches(deviceId);
    this.emit();
    return keys;
  }

  isPending(deviceId: string, key: string): boolean {
    return this.entries.get(deviceId)?.has(key) ?? false;
  }

  get(deviceId: string): Readonly<Record<string, PropertyValue>> | undefined {
    return this.snap[deviceId];
  }

  snapshot(): PendingSnapshot {
    return this.snap;
  }

  /** Sign-out / teardown: cancel all timers without onTimeout. */
  clear(): void {
    for (const b of this.batches.values()) clearTimeout(b.timer);
    this.batches.clear();
    const had = this.entries.size > 0;
    this.entries.clear();
    if (had) this.emit();
  }

  private expire(batch: number): void {
    const b = this.batches.get(batch);
    if (!b) return;
    this.batches.delete(batch);
    const dev = this.entries.get(b.deviceId);
    if (!dev) return;
    const keys: string[] = [];
    for (const [k, e] of dev) if (e.batch === batch) keys.push(k);
    if (keys.length === 0) return;
    for (const k of keys) dev.delete(k);
    if (dev.size === 0) this.entries.delete(b.deviceId);
    this.emit();
    this.opts.onTimeout?.(b.deviceId, keys);
  }

  /** Cancel timers of batches that no longer own any key of this device. */
  private gcBatches(deviceId: string): void {
    const dev = this.entries.get(deviceId);
    const owned = new Set<number>();
    if (dev) for (const e of dev.values()) owned.add(e.batch);
    for (const [id, b] of this.batches) {
      if (b.deviceId === deviceId && !owned.has(id)) {
        clearTimeout(b.timer);
        this.batches.delete(id);
      }
    }
  }

  private emit(): void {
    const next: Record<string, Record<string, PropertyValue>> = {};
    for (const [d, dev] of this.entries) {
      const o: Record<string, PropertyValue> = {};
      for (const [k, e] of dev) o[k] = e.value;
      next[d] = o;
    }
    this.snap = next;
    this.opts.onChange?.(next);
  }
}
