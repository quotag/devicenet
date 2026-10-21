import type { Device, Property, PropertyValue } from '@devicenet/shared';
import type { DevicesRepo } from '../store/devices.js';
import type { Clock } from './clock.js';
import { realClock } from './clock.js';

/** In-memory registry entry (data-model §3). */
export interface RegistryEntry {
  device: Device;
  values: Record<string, PropertyValue>;
  /** per-property last-change time (only keys present in `values`) */
  at: Record<string, number>;
  online: boolean;
  lastSeen: number;
  lqi?: number;
  /** current driver-side name (Z2M friendly_name); not persisted */
  friendlyName: string;
  /** Firestore copy is up to date */
  synced: boolean;
}

export interface RegistryChange {
  entry: RegistryEntry;
  /** property keys whose value changed */
  changed: string[];
  /** online flag flipped */
  onlineChanged: boolean;
}

export type RawConverter = (prop: Property, raw: unknown) => PropertyValue;

export interface RegistryOptions {
  repo?: DevicesRepo;
  clock?: Clock;
}

const same = (a: unknown, b: unknown): boolean =>
  a === b || (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && JSON.stringify(a) === JSON.stringify(b));

/**
 * Local source of truth for devices (FR-H04): deviceId ↔ externalId ↔ friendlyName,
 * values merged only for keys in `device.properties`, persisted to SQLite `devices` on change.
 */
export class Registry {
  private byId = new Map<string, RegistryEntry>();
  private byExt = new Map<string, string>();
  private byFn = new Map<string, string>();
  private listeners = new Set<(c: RegistryChange) => void>();
  private readonly repo?: DevicesRepo;
  private readonly clock: Clock;

  constructor(opts: RegistryOptions = {}) {
    this.repo = opts.repo;
    this.clock = opts.clock ?? realClock;
  }

  /** Cold start from SQLite. Devices stay offline until the driver reports availability. */
  load(): number {
    if (!this.repo) return 0;
    let n = 0;
    for (const row of this.repo.all()) {
      if (row.doc.status === 'removed') continue;
      const lqi = typeof row.values.linkquality === 'number' ? row.values.linkquality : undefined;
      this.index({
        device: row.doc,
        values: row.values as Record<string, PropertyValue>,
        at: row.at,
        online: false,
        lastSeen: row.lastSeen,
        friendlyName: row.id, // friendly_name is assigned = deviceId (FR-H03)
        synced: row.synced,
        ...(lqi !== undefined ? { lqi } : {}),
      });
      n++;
    }
    return n;
  }

  onChange(cb: (c: RegistryChange) => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  private index(e: RegistryEntry): void {
    this.byId.set(e.device.id, e);
    this.byExt.set(e.device.externalId, e.device.id);
    this.byFn.set(e.friendlyName, e.device.id);
  }

  private save(e: RegistryEntry): void {
    this.repo?.upsert({
      id: e.device.id,
      externalId: e.device.externalId,
      doc: e.device,
      values: e.values,
      at: e.at,
      online: e.online,
      lastSeen: e.lastSeen,
      synced: e.synced,
    });
  }

  insert(device: Device, opts: { friendlyName?: string; synced?: boolean; online?: boolean } = {}): RegistryEntry {
    const prev = this.byId.get(device.id);
    if (prev) this.byFn.delete(prev.friendlyName);
    const e: RegistryEntry = {
      device,
      values: prev?.values ?? {},
      at: prev?.at ?? {},
      online: opts.online ?? prev?.online ?? true,
      lastSeen: prev?.lastSeen ?? this.clock.now(),
      friendlyName: opts.friendlyName ?? prev?.friendlyName ?? device.id,
      synced: opts.synced ?? false,
    };
    this.index(e);
    this.save(e);
    return e;
  }

  get(id: string): RegistryEntry | undefined {
    return this.byId.get(id);
  }
  getByExternalId(externalId: string): RegistryEntry | undefined {
    const id = this.byExt.get(externalId);
    return id ? this.byId.get(id) : undefined;
  }
  getByFriendlyName(fn: string): RegistryEntry | undefined {
    const id = this.byFn.get(fn);
    return id ? this.byId.get(id) : undefined;
  }
  all(): RegistryEntry[] {
    return [...this.byId.values()];
  }
  get size(): number {
    return this.byId.size;
  }

  setFriendlyName(id: string, fn: string): void {
    const e = this.byId.get(id);
    if (!e || e.friendlyName === fn) return;
    this.byFn.delete(e.friendlyName);
    e.friendlyName = fn;
    this.byFn.set(fn, id);
  }

  /** Replace device doc fields (presentation sync, rename). Values for keys no longer in properties are dropped. */
  updateDevice(id: string, patch: Partial<Device>): RegistryEntry | undefined {
    const e = this.byId.get(id);
    if (!e) return undefined;
    e.device = { ...e.device, ...patch, id: e.device.id };
    if (patch.properties) {
      for (const k of Object.keys(e.values)) {
        if (!(k in e.device.properties)) {
          delete e.values[k];
          delete e.at[k];
        }
      }
    }
    this.save(e);
    return e;
  }

  markSynced(id: string, synced: boolean): void {
    const e = this.byId.get(id);
    if (!e || e.synced === synced) return;
    e.synced = synced;
    this.repo?.setSynced(id, synced);
  }

  /**
   * Merge a raw driver report. Only keys in `device.properties` are kept; the raw key is
   * `driverMeta.z2m` (fallback: property key). Returns the changed keys (empty when nothing changed).
   */
  applyState(id: string, raw: Record<string, unknown>, convert: RawConverter): RegistryChange | undefined {
    const e = this.byId.get(id);
    if (!e) return undefined;
    const now = this.clock.now();
    const changed: string[] = [];
    for (const [key, prop] of Object.entries(e.device.properties)) {
      const rawKey = typeof prop.driverMeta?.z2m === 'string' ? (prop.driverMeta.z2m as string) : key;
      if (!(rawKey in raw)) continue;
      const rv = raw[rawKey];
      if (rv === null || rv === undefined) continue;
      const v = convert(prop, rv);
      if (!(key in e.values) || !same(e.values[key], v)) {
        e.values[key] = v;
        e.at[key] = now;
        changed.push(key);
      }
    }
    const lq = raw.linkquality;
    if (typeof lq === 'number' && Number.isInteger(lq) && lq >= 0 && lq <= 255) e.lqi = lq;
    e.lastSeen = now;
    // a report proves the device is reachable
    const onlineChanged = !e.online;
    e.online = true;
    this.save(e);
    const change: RegistryChange = { entry: e, changed, onlineChanged };
    this.emit(change);
    return change;
  }

  setOnline(id: string, online: boolean): RegistryChange | undefined {
    const e = this.byId.get(id);
    if (!e || e.online === online) return undefined;
    e.online = online;
    if (online) e.lastSeen = this.clock.now();
    this.save(e);
    const change: RegistryChange = { entry: e, changed: [], onlineChanged: true };
    this.emit(change);
    return change;
  }

  /** Drop from memory (device removed). The SQLite row is kept with the given doc (status "removed"). */
  remove(id: string, removedDoc?: Device): RegistryEntry | undefined {
    const e = this.byId.get(id);
    if (!e) return undefined;
    this.byId.delete(id);
    this.byExt.delete(e.device.externalId);
    this.byFn.delete(e.friendlyName);
    if (removedDoc) {
      e.device = removedDoc;
      this.save(e);
    }
    return e;
  }

  /** Completely purge a device from memory and from persistent storage (e.g. orphaned device re-creation). */
  delete(id: string): RegistryEntry | undefined {
    const e = this.byId.get(id);
    if (e) {
      this.byId.delete(id);
      this.byExt.delete(e.device.externalId);
      this.byFn.delete(e.friendlyName);
    }
    this.repo?.delete(id);
    return e;
  }

  /** Clear all in-memory devices (called on unclaim). */
  clear(): RegistryEntry[] {
    const list = Array.from(this.byId.values());
    this.byId.clear();
    this.byExt.clear();
    this.byFn.clear();
    return list;
  }

  private emit(c: RegistryChange): void {
    for (const l of this.listeners) {
      try {
        l(c);
      } catch {
        /* listener errors never break ingestion */
      }
    }
  }
}
