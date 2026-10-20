import type { Clock } from '../core/clock.js';
import { realClock } from '../core/clock.js';
import type { Registry } from '../core/registry.js';
import type { Store } from '../store/index.js';
import type { ConfigStore } from './ConfigStore.js';
import { DeviceSync } from './deviceSync.js';
import { EventUploader } from './eventUploader.js';
import { SnapshotWriter } from './snapshot.js';

type Log = { warn(obj: object, msg?: string): void; info?(obj: object, msg?: string): void };

export interface ReconcilerOptions {
  store: ConfigStore;
  registry: Registry;
  db: Store;
  log?: Log;
  clock?: Clock;
  /** wait for the first devices snapshot at most this long before reconciling anyway */
  firstSnapshotTimeoutMs?: number;
}

/**
 * Wires listeners to registry/config_snapshot, and on (re)connect rewrites unsynced devices and uploads pending events.
 * Call start() once; reconcile() runs on every sign-in and on config.resync.
 */
export class Reconciler {
  readonly deviceSync: DeviceSync;
  readonly uploader: EventUploader;
  private readonly snapshot: SnapshotWriter;
  private unsubs: Array<() => void> = [];
  private started = false;

  constructor(private readonly o: ReconcilerOptions) {
    this.snapshot = new SnapshotWriter(o.db.snapshot, o.clock ?? realClock);
    this.deviceSync = new DeviceSync({
      store: o.store,
      registry: o.registry,
      log: o.log,
      onRemoteDevices: (devs) => this.snapshot.write('devices', devs),
      onSite: (site, rooms) => {
        if (site) this.snapshot.write('site', site);
        this.snapshot.write('rooms', rooms);
      },
    });
    this.uploader = new EventUploader({ store: () => o.store, repo: o.db.events, log: o.log });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.deviceSync.start();
    this.unsubs.push(
      this.o.store.onRules((r) => this.snapshot.write('rules', r)),
      this.o.store.onScenes((s) => this.snapshot.write('scenes', s)),
      this.o.store.onSignInState((s) => {
        if (s === 'signed-in') void this.reconcile().catch((e) => this.o.log?.warn({ err: (e as Error).message }, 'reconcile failed'));
      }),
    );
  }

  stop(): void {
    this.deviceSync.stop();
    for (const u of this.unsubs.splice(0)) u();
    this.started = false;
  }

  async reconcile(): Promise<{ devices: number; events: number }> {
    await Promise.race([this.deviceSync.firstDevices, new Promise((r) => setTimeout(r, this.o.firstSnapshotTimeoutMs ?? 10_000))]);
    let devices = 0;
    for (const e of this.o.registry.all()) {
      if (e.device.status === 'removed') continue;
      if (!this.deviceSync.remote.has(e.device.id)) {
        try {
          await this.deviceSync.push(e.device);
          this.o.registry.markSynced(e.device.id, true);
          devices++;
        } catch (err) {
          this.o.log?.warn({ deviceId: e.device.id, err: (err as Error).message }, 'device reconcile push failed');
        }
      }
    }
    for (const row of this.o.db.devices.unsynced()) {
      if (this.deviceSync.remote.has(row.id)) {
        try {
          await this.deviceSync.push(row.doc);
          if (this.o.registry.get(row.id)) this.o.registry.markSynced(row.id, true);
          else this.o.db.devices.setSynced(row.id, true);
          devices++;
        } catch (e) {
          this.o.log?.warn({ deviceId: row.id, err: (e as Error).message }, 'device reconcile failed');
        }
      }
    }
    const events = await this.uploader.flush();
    return { devices, events };
  }
}
