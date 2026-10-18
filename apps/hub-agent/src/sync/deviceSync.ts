import type { Device } from '@devicenet/shared';
import type { Registry } from '../core/registry.js';
import type { ConfigStore, DeviceHubFields, Room, Site, Unsubscribe } from './ConfigStore.js';

type Log = { warn(obj: object, msg?: string): void };

const HUB_FIELDS = ['properties', 'model', 'vendor', 'description', 'firmware', 'status', 'removedAt', 'updatedAt', 'externalId'] as const;

/** Hub-owned fields of a local device doc (firestore.rules hub column). `status` is pushed only for removal: the user may move new -> active. */
export function hubFieldsOf(d: Device, opts: { includeStatus: boolean }): DeviceHubFields {
  const out: Record<string, unknown> = {};
  for (const k of HUB_FIELDS) {
    if (k === 'status' && !opts.includeStatus) continue;
    if (d[k] !== undefined) out[k] = d[k];
  }
  return out as DeviceHubFields;
}

export interface DeviceSyncOptions {
  store: ConfigStore;
  registry: Registry;
  log?: Log;
  onRemoteDevices?: (devices: Device[]) => void;
  onSite?: (site: Site | null, rooms: Room[]) => void;
}

/** Device sync (US3): hub to Firestore (create / hub fields), Firestore to registry (presentation fields), site cache. */
export class DeviceSync {
  readonly remote = new Map<string, Device>();
  site: Site | null = null;
  rooms: Room[] = [];
  private unsubs: Unsubscribe[] = [];
  private firstSnapshot!: () => void;
  readonly firstDevices = new Promise<void>((r) => (this.firstSnapshot = r));

  constructor(private readonly o: DeviceSyncOptions) {}

  start(): void {
    this.unsubs.push(
      this.o.store.onDevices((devs) => {
        this.remote.clear();
        for (const d of devs) this.remote.set(d.id, d);
        this.applyRemote(devs);
        this.o.onRemoteDevices?.(devs);
        this.firstSnapshot();
      }),
      this.o.store.onSite((site, rooms) => {
        this.site = site;
        this.rooms = rooms;
        this.o.onSite?.(site, rooms);
      }),
    );
  }

  stop(): void {
    for (const u of this.unsubs.splice(0)) u();
  }

  /** user-owned presentation fields to registry */
  private applyRemote(devs: Device[]): void {
    for (const r of devs) {
      const e = this.o.registry.get(r.id);
      if (!e) continue;
      const cur = e.device;
      const patch: Partial<Device> = {};
      if (r.name !== cur.name) patch.name = r.name;
      if (r.roomId !== cur.roomId) patch.roomId = r.roomId;
      if (r.icon !== cur.icon) patch.icon = r.icon;
      if (r.primaryProperty !== cur.primaryProperty) patch.primaryProperty = r.primaryProperty;
      if (r.toggleProperty !== cur.toggleProperty) patch.toggleProperty = r.toggleProperty;
      if (r.status === 'active' && cur.status === 'new') patch.status = 'active';
      // the user may edit property labels only
      let props: Device['properties'] | undefined;
      for (const [k, p] of Object.entries(r.properties)) {
        const lp = cur.properties[k];
        if (lp && lp.label !== p.label) (props ??= { ...cur.properties })[k] = { ...lp, label: p.label };
      }
      if (props) patch.properties = props;
      if (Object.keys(patch).length) this.o.registry.updateDevice(r.id, patch);
    }
  }

  /** Push one local device: create when the cloud does not know it, otherwise a hub-field update. */
  async push(device: Device): Promise<void> {
    if (this.remote.has(device.id)) {
      await this.o.store.updateDeviceHubFields(device.id, hubFieldsOf(device, { includeStatus: device.status === 'removed' }));
    } else {
      await this.o.store.createDevice(device.status === 'removed' ? device : { ...device, status: 'new' });
    }
  }

  /** hub-field update after a local change (properties, firmware, removal...) */
  async pushFields(id: string, patch: DeviceHubFields): Promise<void> {
    await this.o.store.updateDeviceHubFields(id, patch);
  }
}
