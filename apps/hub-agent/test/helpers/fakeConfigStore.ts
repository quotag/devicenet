import type { Device, Rule, Scene } from '@devicenet/shared';
import type {
  EventDoc,
  Room,
  Site,
  ConfigStore,
  DeviceHubFields,
  RuleHubFields,
  SceneHubFields,
  SignInState,
  Unsubscribe,
} from '../../src/sync/ConfigStore.js';

type Listener<T> = (v: T) => void;

/** In-memory ConfigStore for tests. Remote-side changes are driven via `set*` helpers; hub writes are recorded. */
export class FakeConfigStore implements ConfigStore {
  signInState: SignInState = 'signed-in';
  devices = new Map<string, Device>();
  events = new Map<string, EventDoc>();
  rules = new Map<string, Rule>();
  scenes = new Map<string, Scene>();
  site: Site | null = null;
  rooms: Room[] = [];
  /** when set, the next write rejects with this error (then clears) */
  failNext: Error | null = null;
  /** ordered log of hub writes: [method, id, payload] */
  writes: Array<[string, string, unknown]> = [];

  private signInListeners = new Set<Listener<SignInState>>();
  private deviceListeners = new Set<Listener<Device[]>>();
  private siteListeners = new Set<(s: Site | null, r: Room[]) => void>();
  private ruleListeners = new Set<Listener<Rule[]>>();
  private sceneListeners = new Set<Listener<Scene[]>>();

  private check(): void {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }

  setSignInState(s: SignInState): void {
    this.signInState = s;
    for (const l of this.signInListeners) l(s);
  }
  onSignInState(cb: Listener<SignInState>): Unsubscribe {
    this.signInListeners.add(cb);
    return () => void this.signInListeners.delete(cb);
  }

  async createDevice(device: Device): Promise<void> {
    this.check();
    this.writes.push(['createDevice', device.id, device]);
    this.devices.set(device.id, device);
    this.emitDevices();
  }
  async updateDeviceHubFields(id: string, patch: DeviceHubFields): Promise<void> {
    this.check();
    this.writes.push(['updateDeviceHubFields', id, patch]);
    const cur = this.devices.get(id);
    if (!cur) throw new Error(`device ${id} not found`);
    this.devices.set(id, { ...cur, ...patch });
    this.emitDevices();
  }
  async putEvent(event: EventDoc): Promise<void> {
    this.check();
    this.writes.push(['putEvent', event.id, event]);
    this.events.set(event.id, event);
  }
  async updateRuleHubFields(id: string, patch: RuleHubFields): Promise<void> {
    this.check();
    this.writes.push(['updateRuleHubFields', id, patch]);
    const cur = this.rules.get(id);
    if (!cur) throw new Error(`rule ${id} not found`);
    this.rules.set(id, { ...cur, ...patch });
    this.emitRules();
  }
  async updateSceneHubFields(id: string, patch: SceneHubFields): Promise<void> {
    this.check();
    this.writes.push(['updateSceneHubFields', id, patch]);
    const cur = this.scenes.get(id);
    if (!cur) throw new Error(`scene ${id} not found`);
    this.scenes.set(id, { ...cur, ...patch });
    this.emitScenes();
  }

  onDevices(cb: Listener<Device[]>): Unsubscribe {
    this.deviceListeners.add(cb);
    cb([...this.devices.values()]);
    return () => void this.deviceListeners.delete(cb);
  }
  onSite(cb: (s: Site | null, r: Room[]) => void): Unsubscribe {
    this.siteListeners.add(cb);
    cb(this.site, this.rooms);
    return () => void this.siteListeners.delete(cb);
  }
  onRules(cb: Listener<Rule[]>): Unsubscribe {
    this.ruleListeners.add(cb);
    cb([...this.rules.values()]);
    return () => void this.ruleListeners.delete(cb);
  }
  onScenes(cb: Listener<Scene[]>): Unsubscribe {
    this.sceneListeners.add(cb);
    cb([...this.scenes.values()]);
    return () => void this.sceneListeners.delete(cb);
  }

  // --- remote-side drivers for tests ---
  setSite(site: Site | null, rooms: Room[] = []): void {
    this.site = site;
    this.rooms = rooms;
    for (const l of this.siteListeners) l(site, rooms);
  }
  setRule(rule: Rule): void {
    this.rules.set(rule.id, rule);
    this.emitRules();
  }
  setScene(scene: Scene): void {
    this.scenes.set(scene.id, scene);
    this.emitScenes();
  }
  setRemoteDevice(device: Device): void {
    this.devices.set(device.id, device);
    this.emitDevices();
  }

  private emitDevices(): void {
    for (const l of this.deviceListeners) l([...this.devices.values()]);
  }
  private emitRules(): void {
    for (const l of this.ruleListeners) l([...this.rules.values()]);
  }
  private emitScenes(): void {
    for (const l of this.sceneListeners) l([...this.scenes.values()]);
  }
}
