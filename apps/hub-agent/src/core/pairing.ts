import type { Device, PropertyMap } from '@devicenet/shared';
import type { DiscoveredDevice, Driver } from '../drivers/Driver.js';
import type { ConfigStore } from '../sync/ConfigStore.js';
import type { Clock, TimerHandle, TimerHost } from './clock.js';
import { realClock, realTimers } from './clock.js';
import type { HubEvents } from './events.js';
import { newId } from './ids.js';
import type { Publisher } from './publisher.js';
import type { Registry } from './registry.js';
import type { CommandResult } from './handlers/types.js';
import { errorToAck } from './handlers/types.js';

/** Driver plus the Z2M-specific friendly_name assignment (optional for other drivers). */
export type PairingDriver = Pick<Driver, 'startPairing' | 'stopPairing' | 'ping' | 'buildProperties'> & {
  assignFriendlyName?(externalId: string, devId: string): Promise<void>;
};

export interface PairingOptions {
  driver: PairingDriver;
  registry: Registry;
  publisher: Publisher;
  events: Pick<HubEvents, 'emit'>;
  /** null/undefined → no cloud → pairing refused (D-12) */
  configStore: () => ConfigStore | null | undefined;
  clock?: Clock;
  timers?: TimerHost;
  log?: { warn(obj: object, msg?: string): void; info?(obj: object, msg?: string): void };
}

const PRIMARY_PRIORITY = ['power', 'temperature', 'humidity', 'illuminance', 'energy'];

export function pickPrimaryProperty(props: PropertyMap): string | undefined {
  for (const k of PRIMARY_PRIORITY) {
    const p = props[k];
    if (p && p.type === 'numeric' && p.category === 'sensor') return k;
  }
  return undefined;
}

export function pickToggleProperty(props: PropertyMap): string | undefined {
  for (const [k, p] of Object.entries(props)) {
    if (p.type === 'binary' && (p.access === 'rw' || p.access === 'w') && p.category === 'control') return k;
  }
  for (const [k, p] of Object.entries(props)) {
    if (p.type === 'binary' && (p.access === 'rw' || p.access === 'w')) return k;
  }
  return undefined;
}

function deviceName(d: DiscoveredDevice): string {
  const n = (d.description || d.model || 'Thiết bị').trim() || 'Thiết bị';
  return n.slice(0, 60);
}

/**
 * Pairing (FR-H06): permit_join window with retained `PairingState`, and device creation on
 * interview / recovery (Z2M device unknown to the registry). Creation works without cloud
 * (registry first; Firestore write best effort, reconciled later via `synced=0`).
 */
export class PairingManager {
  private active = false;
  private startedAt = 0;
  private expiresAt = 0;
  private found: string[] = [];
  private timer?: TimerHandle;
  private creating = new Set<string>();
  private readonly o: PairingOptions;
  private readonly clock: Clock;
  private readonly timers: TimerHost;

  constructor(opts: PairingOptions) {
    this.o = opts;
    this.clock = opts.clock ?? realClock;
    this.timers = opts.timers ?? realTimers;
  }

  get isActive(): boolean {
    return this.active;
  }

  state(): { active: boolean; startedAt?: number; expiresAt?: number; found: string[] } {
    return this.active
      ? { active: true, startedAt: this.startedAt, expiresAt: this.expiresAt, found: [...this.found] }
      : { active: false, found: [...this.found] };
  }

  private publish(): void {
    this.o.publisher.publishPairing(this.state());
  }

  async start(seconds: number): Promise<CommandResult> {
    if (!this.o.publisher.getIdentity() || !this.o.configStore()) {
      return { ok: false, error: 'internal', message: 'no_cloud' }; // D-12, TODO-OQ-13
    }
    if (this.active) return { ok: false, error: 'busy', result: { expiresAt: this.expiresAt } };
    try {
      await this.o.driver.startPairing(seconds);
    } catch (e) {
      return errorToAck(e);
    }
    const now = this.clock.now();
    this.active = true;
    this.startedAt = now;
    this.expiresAt = now + seconds * 1000;
    this.found = [];
    this.timer?.cancel();
    this.timer = this.timers.setTimeout(() => void this.finish(), seconds * 1000);
    this.publish();
    return { ok: true, result: { expiresAt: this.expiresAt } };
  }

  async stop(): Promise<CommandResult> {
    await this.finish();
    return { ok: true };
  }

  /** close the window: publish `{active:false}` and send permit_join 0 defensively */
  private async finish(): Promise<void> {
    const wasActive = this.active;
    this.timer?.cancel();
    this.timer = undefined;
    this.active = false;
    if (wasActive) this.publish();
    try {
      await this.o.driver.stopPairing();
    } catch (e) {
      this.o.log?.warn({ err: (e as Error).message }, 'permit_join 0 failed');
    }
  }

  /** Wire to `driver.onDeviceDiscovered`. Creates devices unknown to the registry (interview + FR-H06 recovery). */
  async onDiscovered(d: DiscoveredDevice): Promise<string | null> {
    const known = this.o.registry.getByExternalId(d.externalId);
    if (known) {
      this.o.registry.setFriendlyName(known.device.id, d.friendlyName);
      return null;
    }
    if (!d.interviewed || this.creating.has(d.externalId)) return null;
    const id = this.o.publisher.getIdentity();
    if (!id) return null; // unclaimed: no siteId/hubId → created after claim (recovery path)
    this.creating.add(d.externalId);
    try {
      return await this.create(d, id.hubId, id.siteId);
    } finally {
      this.creating.delete(d.externalId);
    }
  }

  private async create(d: DiscoveredDevice, hubId: string, siteId: string): Promise<string> {
    const properties = this.o.driver.buildProperties(d.exposes);
    const devId = newId('dev');
    const now = this.clock.now();
    let friendlyName = d.friendlyName;
    if (this.o.driver.assignFriendlyName) {
      try {
        await this.o.driver.assignFriendlyName(d.externalId, devId);
        friendlyName = devId;
      } catch (e) {
        this.o.log?.warn({ externalId: d.externalId, err: (e as Error).message }, 'friendly_name assignment failed');
      }
    }
    const primaryProperty = pickPrimaryProperty(properties);
    const toggleProperty = pickToggleProperty(properties);
    const device: Device = {
      id: devId,
      hubId,
      siteId,
      roomId: null,
      driver: 'zigbee2mqtt',
      externalId: d.externalId,
      ...(d.model ? { model: d.model } : {}),
      ...(d.vendor ? { vendor: d.vendor } : {}),
      ...(d.description ? { description: d.description } : {}),
      ...(d.firmware ? { firmware: d.firmware } : {}),
      name: deviceName(d),
      icon: 'plug',
      ...(primaryProperty ? { primaryProperty } : {}),
      ...(toggleProperty ? { toggleProperty } : {}),
      properties,
      status: 'new',
      createdAt: now,
      updatedAt: now,
    };
    // registry first: works even when Firestore is unreachable (spec §8)
    this.o.registry.insert(device, { friendlyName, synced: false, online: true });
    this.o.publisher.stateChanged(devId);
    const store = this.o.configStore();
    if (store) {
      try {
        await store.createDevice(device);
        this.o.registry.markSynced(devId, true);
      } catch (e) {
        this.o.log?.warn({ deviceId: devId, err: (e as Error).message }, 'Firestore createDevice failed; will reconcile');
      }
    }
    this.o.events.emit({ type: 'device.found', deviceId: devId, model: d.model ?? 'unknown', ...(d.vendor ? { vendor: d.vendor } : {}) });
    if (this.active) {
      this.found.push(devId);
      this.publish();
    }
    const entry = this.o.registry.get(devId);
    if (entry && Object.keys(entry.values).length === 0) {
      try {
        await this.o.driver.ping(d.externalId);
      } catch {
        /* initial state arrives with the next report */
      }
    }
    this.o.log?.info?.({ deviceId: devId, externalId: d.externalId }, 'device created');
    return devId;
  }

  dispose(): void {
    this.timer?.cancel();
    this.timer = undefined;
  }
}
