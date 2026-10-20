import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import type { Property, PropertyKey, PropertyMap, PropertyValue } from '@devicenet/shared';
import type { DiscoveredDevice, Driver } from '../Driver.js';
import { buildProperties } from './exposes.js';
import { fromDriverValue, toDriverValue } from './values.js';

export interface Zigbee2mqttDriverOptions {
  /** local broker url, e.g. mqtt://127.0.0.1:1883 */
  url: string;
  baseTopic?: string;
  /** timeout for bridge/request -> bridge/response correlation */
  requestTimeoutMs?: number;
  mqttOptions?: IClientOptions;
}

interface Pending {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

function parseJson(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return undefined;
  }
}

/** Parse `{state:"online"}` or legacy `online` string. */
function parseOnline(buf: Buffer): boolean | undefined {
  const j = parseJson(buf);
  let s: unknown = j;
  if (j && typeof j === 'object') s = (j as { state?: unknown }).state;
  if (s === undefined) s = buf.toString('utf8');
  if (s === 'online') return true;
  if (s === 'offline') return false;
  return undefined;
}

export class Zigbee2mqttDriver implements Driver {
  readonly id = 'zigbee2mqtt' as const;
  private client?: MqttClient;
  private readonly base: string;
  private readonly timeoutMs: number;
  private txn = 0;
  private pending = new Map<string, Pending>();
  private byIeee = new Map<string, string>(); // ieee -> friendly_name
  private byName = new Map<string, string>(); // friendly_name -> ieee
  private known = new Map<string, DiscoveredDevice>(); // ieee -> device
  private deviceCbs: Array<(d: DiscoveredDevice) => void> = [];
  private stateCbs: Array<(id: string, raw: Record<string, unknown>) => void> = [];
  private availCbs: Array<(id: string, online: boolean) => void> = [];
  private bridgeOnline = false;

  constructor(private readonly opts: Zigbee2mqttDriverOptions) {
    this.base = opts.baseTopic ?? 'zigbee2mqtt';
    this.timeoutMs = opts.requestTimeoutMs ?? 5000;
  }

  /** devices seen in the last bridge/devices (startup recovery after claim, FR-H06) */
  knownDevices(): DiscoveredDevice[] {
    return [...this.known.values()];
  }

  get isBridgeOnline(): boolean {
    return this.bridgeOnline;
  }

  async start(): Promise<void> {
    const client = await mqtt.connectAsync(this.opts.url, {
      clientId: `devicenet-z2m-driver-${Math.random().toString(16).slice(2, 8)}`,
      reconnectPeriod: 2000,
      ...this.opts.mqttOptions,
    });
    this.client = client;
    client.on('message', (topic, payload) => {
      try {
        this.onMessage(topic, payload);
      } catch {
        /* a malformed message must never kill the driver */
      }
    });
    // (re)subscribe on every connect
    const subscribe = () => client.subscribe(`${this.base}/#`, { qos: 0 });
    client.on('connect', subscribe);
    await client.subscribeAsync(`${this.base}/#`, { qos: 0 });
  }

  async stop(): Promise<void> {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('driver stopped'));
    }
    this.pending.clear();
    const c = this.client;
    this.client = undefined;
    if (c) await c.endAsync(true);
  }

  onDeviceDiscovered(cb: (d: DiscoveredDevice) => void): void {
    this.deviceCbs.push(cb);
  }
  onState(cb: (externalId: string, raw: Record<string, unknown>) => void): void {
    this.stateCbs.push(cb);
  }
  onAvailability(cb: (externalId: string, online: boolean) => void): void {
    this.availCbs.push(cb);
  }

  private onMessage(topic: string, payload: Buffer): void {
    if (!topic.startsWith(`${this.base}/`)) return;
    const rest = topic.slice(this.base.length + 1);

    if (rest === 'bridge/state') {
      const online = parseOnline(payload);
      if (online !== undefined) this.bridgeOnline = online;
      return;
    }
    if (rest === 'bridge/devices') {
      const list = parseJson(payload);
      if (Array.isArray(list)) this.onBridgeDevices(list as Array<Record<string, unknown>>);
      return;
    }
    if (rest === 'bridge/event') {
      const ev = parseJson(payload) as { type?: string; data?: Record<string, unknown> } | undefined;
      if (ev?.type === 'device_interview' && ev.data?.status === 'successful') this.onInterview(ev.data);
      return;
    }
    if (rest.startsWith('bridge/response/')) {
      const res = parseJson(payload) as Record<string, unknown> | undefined;
      const t = res?.transaction;
      if (res && typeof t === 'string') {
        const p = this.pending.get(t);
        if (p) {
          this.pending.delete(t);
          clearTimeout(p.timer);
          if (res.status === 'ok') p.resolve(res);
          else p.reject(new Error(`z2m ${rest}: ${String(res.error ?? 'error')}`));
        }
      }
      return;
    }
    if (rest.startsWith('bridge/')) return;

    if (rest.endsWith('/availability')) {
      const fn = rest.slice(0, -'/availability'.length);
      const ieee = this.byName.get(fn);
      const online = parseOnline(payload);
      if (ieee && online !== undefined) for (const cb of this.availCbs) cb(ieee, online);
      return;
    }
    if (rest.includes('/')) return; // <fn>/set, <fn>/get, endpoints...
    const ieee = this.byName.get(rest);
    const state = parseJson(payload);
    if (ieee && state && typeof state === 'object' && !Array.isArray(state)) {
      for (const cb of this.stateCbs) cb(ieee, state as Record<string, unknown>);
    }
  }

  private toDiscovered(d: Record<string, unknown>): DiscoveredDevice | null {
    const ieee = d.ieee_address;
    const fn = d.friendly_name;
    if (typeof ieee !== 'string' || typeof fn !== 'string') return null;
    if (d.type === 'Coordinator') return null;
    if (d.supported === false || d.disabled === true) return null;
    const def = (d.definition ?? null) as Record<string, unknown> | null;
    const out: DiscoveredDevice = {
      externalId: ieee,
      friendlyName: fn,
      exposes: Array.isArray(def?.exposes) ? (def!.exposes as unknown[]) : [],
      interviewed: d.interview_completed === true || d.status === 'successful',
    };
    if (typeof def?.model === 'string') out.model = def.model;
    if (typeof def?.vendor === 'string') out.vendor = def.vendor;
    const desc = (typeof d.description === 'string' && d.description) || (typeof def?.description === 'string' ? def.description : '');
    if (desc) out.description = desc;
    if (typeof d.software_build_id === 'string') out.firmware = d.software_build_id;
    return out;
  }

  private onBridgeDevices(list: Array<Record<string, unknown>>): void {
    this.byIeee.clear();
    this.byName.clear();
    const seen = new Set<string>();
    for (const raw of list) {
      const d = this.toDiscovered(raw);
      if (!d) continue;
      this.byIeee.set(d.externalId, d.friendlyName);
      this.byName.set(d.friendlyName, d.externalId);
      this.known.set(d.externalId, d);
      seen.add(d.externalId);
      for (const cb of this.deviceCbs) cb(d);
    }
    for (const k of [...this.known.keys()]) if (!seen.has(k)) this.known.delete(k);
  }

  private onInterview(data: Record<string, unknown>): void {
    const ieee = data.ieee_address;
    if (typeof ieee !== 'string') return;
    const prev = this.known.get(ieee);
    const merged = this.toDiscovered({
      ...(prev ? { friendly_name: prev.friendlyName } : {}),
      ...data,
      interview_completed: true,
    });
    if (!merged) return;
    if (merged.exposes.length === 0 && prev) merged.exposes = prev.exposes;
    this.byIeee.set(ieee, merged.friendlyName);
    this.byName.set(merged.friendlyName, ieee);
    this.known.set(ieee, merged);
    for (const cb of this.deviceCbs) cb(merged);
  }

  private fn(externalId: string): string {
    return this.byIeee.get(externalId) ?? externalId;
  }

  private publish(topic: string, payload: unknown): Promise<void> {
    if (!this.client) return Promise.reject(new Error('driver not started'));
    return this.client.publishAsync(`${this.base}/${topic}`, JSON.stringify(payload), { qos: 0 }).then(() => undefined);
  }

  private request(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const transaction = `dn-${++this.txn}-${Math.random().toString(36).slice(2, 7)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(transaction);
        reject(new Error(`z2m request ${path} timed out`));
      }, this.timeoutMs);
      this.pending.set(transaction, { resolve, reject, timer });
      this.publish(`bridge/request/${path}`, { ...payload, transaction }).catch((e: Error) => {
        this.pending.delete(transaction);
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  async setProperty(externalId: string, key: PropertyKey, value: PropertyValue, prop: Property): Promise<void> {
    await this.publish(`${this.fn(externalId)}/set`, { [key]: toDriverValue(prop, value) });
  }

  async startPairing(seconds: number): Promise<void> {
    await this.request('permit_join', { time: seconds });
  }
  async stopPairing(): Promise<void> {
    await this.request('permit_join', { time: 0 });
  }

  async removeDevice(externalId: string, force: boolean): Promise<void> {
    const id = this.fn(externalId);
    try {
      await this.request('device/remove', { id, force });
    } catch (e) {
      if (id !== externalId) {
        try {
          await this.request('device/remove', { id: externalId, force });
          return;
        } catch {
          // ignore fallback error, throw original
        }
      }
      throw e;
    }
  }

  /** Stores the user-visible name in the Z2M `description` option (OQ-1); friendly_name stays the `dev_…` id. */
  async rename(externalId: string, friendlyName: string): Promise<void> {
    await this.request('device/options', { id: this.fn(externalId), options: { description: friendlyName } });
  }

  /** Rename the Z2M friendly_name (ieee -> `dev_…`). */
  async assignFriendlyName(ieee: string, devId: string): Promise<void> {
    const from = this.fn(ieee);
    await this.request('device/rename', { from, to: devId });
    this.byName.delete(from);
    this.byIeee.set(ieee, devId);
    this.byName.set(devId, ieee);
  }

  async ping(externalId: string): Promise<void> {
    await this.publish(`${this.fn(externalId)}/get`, { state: '' });
  }

  buildProperties(exposes: unknown[]): PropertyMap {
    return buildProperties(exposes);
  }
  toDriverValue(prop: Property, v: PropertyValue): unknown {
    return toDriverValue(prop, v);
  }
  fromDriverValue(prop: Property, raw: unknown): PropertyValue {
    return fromDriverValue(prop, raw);
  }
}
