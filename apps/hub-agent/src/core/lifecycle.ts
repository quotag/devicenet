import { referencedIds, type Rule, type Scene } from '@devicenet/shared';
import type { DiscoveredDevice, Driver } from '../drivers/Driver.js';
import type { ConfigStore, Unsubscribe } from '../sync/ConfigStore.js';
import type { Clock } from './clock.js';
import { realClock } from './clock.js';
import type { HubEvents } from './events.js';
import type { PairingManager } from './pairing.js';
import type { Publisher } from './publisher.js';
import type { Registry } from './registry.js';

type Log = { warn(obj: object, msg?: string): void };

export interface LifecycleOptions {
  registry: Registry;
  driver: Driver & { knownDevices?: () => DiscoveredDevice[] };
  publisher: Publisher;
  events: HubEvents;
  pairing: Pick<PairingManager, 'onDiscovered'>;
  configStore: () => ConfigStore | null | undefined;
  clock?: Clock;
  log?: Log;
}

/** Device lifecycle (FR-H06): availability, removal (data-model 3.7), startup recovery. */
export class DeviceLifecycle {
  private rules: Rule[] = [];
  private scenes: Scene[] = [];
  private watching: ConfigStore | null = null;
  private unsubs: Unsubscribe[] = [];
  private readonly clock: Clock;

  constructor(private readonly o: LifecycleOptions) {
    this.clock = o.clock ?? realClock;
  }

  /** B14/B15 may feed the rule/scene docs directly instead of the store subscription. */
  setRulesAndScenes(rules: Rule[], scenes: Scene[]): void {
    this.rules = rules;
    this.scenes = scenes;
  }

  private ensureWatching(): void {
    const store = this.o.configStore();
    if (!store || store === this.watching) return;
    for (const u of this.unsubs) u();
    this.watching = store;
    this.unsubs = [store.onRules((r) => (this.rules = r)), store.onScenes((s) => (this.scenes = s))];
  }

  /** Z2M availability -> `state.online` + `device.online/offline` (only on change). */
  handleAvailability(externalId: string, online: boolean): void {
    const e = this.o.registry.getByExternalId(externalId);
    if (!e) return;
    const c = this.o.registry.setOnline(e.device.id, online);
    if (!c) return;
    this.o.publisher.stateChanged(e.device.id);
    this.o.events.emit({ type: online ? 'device.online' : 'device.offline', deviceId: e.device.id });
  }

  /** Remove from Z2M (throws on driver failure), mark `removed`, clear retained state, break referencing rules/scenes. */
  async removeDevice(deviceId: string, force: boolean): Promise<void> {
    const { registry, driver, publisher, events } = this.o;
    const entry = registry.get(deviceId);
    if (!entry) throw new Error('not_found');
    await driver.removeDevice(entry.device.externalId, force);
    const now = this.clock.now();
    const removedDoc = { ...entry.device, status: 'removed' as const, removedAt: now, updatedAt: now };
    registry.remove(deviceId, removedDoc);
    publisher.clearState(deviceId);
    events.emit({ type: 'device.removed', deviceId });
    const store = this.o.configStore();
    if (store) {
      try {
        await store.updateDeviceHubFields(deviceId, { status: 'removed', removedAt: now, updatedAt: now });
      } catch (e) {
        this.o.log?.warn({ deviceId, err: (e as Error).message }, 'Firestore device removed update failed');
      }
    }
    await this.breakReferencing(deviceId);
  }

  private async breakReferencing(deviceId: string): Promise<void> {
    this.ensureWatching();
    const store = this.o.configStore();
    if (!store) return;
    const reason = 'Thiết bị đã bị xóa';
    const brokenScenes = new Set<string>();
    for (const s of this.scenes) {
      if (!referencedIds(s).devices.has(deviceId)) continue;
      brokenScenes.add(s.id);
      await this.write(() => store.updateSceneHubFields(s.id, { brokenReason: reason, lastResult: 'broken' }), s.id);
    }
    for (const r of this.rules) {
      const ref = referencedIds(r);
      const viaScene = [...ref.scenes].some((id) => brokenScenes.has(id));
      if (!ref.devices.has(deviceId) && !viaScene) continue;
      await this.write(() => store.updateRuleHubFields(r.id, { brokenReason: reason, lastResult: 'broken' }), r.id);
      this.o.events.emit({ type: 'rule.broken', ruleId: r.id, reason });
    }
  }

  private async write(fn: () => Promise<void>, id: string): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.o.log?.warn({ id, err: (e as Error).message }, 'mark broken failed');
    }
  }

  /** FR-H06: Z2M devices without a registry entry -> create `status:"new"` (needs identity). */
  async recover(): Promise<number> {
    const id = this.o.publisher.getIdentity();
    if (!id) return 0;
    let n = 0;
    for (const d of this.o.driver.knownDevices?.() ?? []) {
      const known = this.o.registry.getByExternalId(d.externalId);
      if (known && known.device.hubId === id.hubId && known.device.siteId === id.siteId && known.synced) {
        continue;
      }
      try {
        if (await this.o.pairing.onDiscovered(d)) n++;
      } catch (e) {
        this.o.log?.warn({ externalId: d.externalId, err: (e as Error).message }, 'recovery create failed');
      }
    }
    return n;
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.watching = null;
  }
}
