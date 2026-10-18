import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mqtt, { type MqttClient } from 'mqtt';

const fixtureDir = fileURLToPath(new URL('../fixtures/', import.meta.url));
const loadJson = (n: string): Record<string, unknown> => JSON.parse(readFileSync(fixtureDir + n, 'utf8'));

export interface MockZ2mOptions {
  url: string;
  baseTopic?: string;
  /** echo latency for `<fn>/set`, ms */
  latencyMs?: number;
  /** start with the fixture device already paired (default true) */
  withDevice?: boolean;
  /** dev mode: emit a TS011F interview this long after a permit_join with time > 0 (off when unset) */
  autoInterviewMs?: number;
}

interface MockDevice {
  info: Record<string, unknown>;
  state: Record<string, unknown>;
  online: boolean;
}

/** MQTT-level impersonation of Zigbee2MQTT (research R3). */
export class MockZ2m {
  /** set false to ignore `<fn>/set` (no echo) */
  echo = true;
  latencyMs: number;
  readonly requests: Array<{ path: string; payload: Record<string, any> }> = [];
  readonly devices = new Map<string, MockDevice>(); // by ieee
  permitJoinTime = 0;
  private client?: MqttClient;
  private readonly base: string;
  private timers = new Set<NodeJS.Timeout>();

  constructor(private readonly opts: MockZ2mOptions) {
    this.base = opts.baseTopic ?? 'zigbee2mqtt';
    this.latencyMs = opts.latencyMs ?? 0;
    if (opts.withDevice !== false) this.addDevice();
  }

  /** Add a (paired) TS011F; call before start() or follow with a bridge/devices republish. */
  addDevice(ieee?: string, friendlyName?: string): MockDevice {
    const info = structuredClone(loadJson('ts011f.device.json'));
    if (ieee) info.ieee_address = ieee;
    info.friendly_name = friendlyName ?? ieee ?? info.ieee_address;
    const dev: MockDevice = { info, state: structuredClone(loadJson('ts011f.state.json')), online: true };
    this.devices.set(info.ieee_address as string, dev);
    return dev;
  }

  private find(idOrName: string): MockDevice | undefined {
    for (const d of this.devices.values()) {
      if (d.info.ieee_address === idOrName || d.info.friendly_name === idOrName) return d;
    }
    return undefined;
  }

  private pub(topic: string, payload: unknown, retain = false): void {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.client?.publish(`${this.base}/${topic}`, body, { qos: 0, retain });
  }

  async start(): Promise<void> {
    const c = await mqtt.connectAsync(this.opts.url, { clientId: `mock-z2m-${Math.random().toString(16).slice(2, 8)}`, reconnectPeriod: 0 });
    this.client = c;
    c.on('message', (t, p) => this.onMessage(t, p));
    await c.subscribeAsync(`${this.base}/#`, { qos: 0 });
    this.pub('bridge/state', { state: 'online' }, true);
    this.publishDevices();
    for (const d of this.devices.values()) {
      this.pub(`${d.info.friendly_name}/availability`, { state: d.online ? 'online' : 'offline' }, true);
      this.pub(String(d.info.friendly_name), d.state);
    }
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    const c = this.client;
    this.client = undefined;
    if (c) {
      c.publish(`${this.base}/bridge/state`, JSON.stringify({ state: 'offline' }), { qos: 0, retain: true });
      await c.endAsync();
    }
  }

  private publishDevices(): void {
    const coordinator = { ieee_address: '0x00124b0000000001', type: 'Coordinator', friendly_name: 'Coordinator', supported: true, disabled: false, interview_completed: true };
    this.pub('bridge/devices', [coordinator, ...[...this.devices.values()].map((d) => d.info)], true);
  }

  /** Flip a device offline/online (publishes availability). */
  setOffline(idOrName: string, offline: boolean): void {
    const d = this.find(idOrName);
    if (!d) return;
    d.online = !offline;
    this.pub(`${d.info.friendly_name}/availability`, { state: offline ? 'offline' : 'online' }, true);
  }

  /** Publish a state update as if the device reported it. */
  reportState(idOrName: string, patch: Record<string, unknown>): void {
    const d = this.find(idOrName);
    if (!d) return;
    Object.assign(d.state, patch);
    this.pub(String(d.info.friendly_name), d.state);
  }

  /** Simulate a new device finishing interview (pairing). */
  emitInterview(ieee = `0xa4c138${Math.random().toString(16).slice(2, 12).padEnd(10, '0')}`): string {
    const d = this.addDevice(ieee);
    this.publishDevices();
    this.pub('bridge/event', {
      type: 'device_interview',
      data: {
        friendly_name: d.info.friendly_name,
        ieee_address: ieee,
        status: 'successful',
        supported: true,
        definition: d.info.definition,
      },
    });
    this.pub(`${d.info.friendly_name}/availability`, { state: 'online' }, true);
    return ieee;
  }

  private respond(path: string, req: Record<string, any>, ok: boolean, data: unknown, error?: string): void {
    this.pub(`bridge/response/${path}`, {
      data,
      status: ok ? 'ok' : 'error',
      ...(error ? { error } : {}),
      ...(req.transaction ? { transaction: req.transaction } : {}),
    });
  }

  private onMessage(topic: string, buf: Buffer): void {
    if (!topic.startsWith(`${this.base}/`)) return;
    const rest = topic.slice(this.base.length + 1);
    let payload: any;
    try {
      payload = JSON.parse(buf.toString('utf8'));
    } catch {
      payload = undefined;
    }

    if (rest.startsWith('bridge/request/')) {
      const path = rest.slice('bridge/request/'.length);
      const req = (payload ?? {}) as Record<string, any>;
      this.requests.push({ path, payload: req });
      this.handleRequest(path, req);
      return;
    }
    if (rest.startsWith('bridge/') || !rest.includes('/')) return;

    const slash = rest.lastIndexOf('/');
    const fn = rest.slice(0, slash);
    const verb = rest.slice(slash + 1);
    const dev = this.find(fn);
    if (!dev || !payload || typeof payload !== 'object') return;
    if (verb === 'set') {
      if (!this.echo || !dev.online) return;
      const patch = payload as Record<string, unknown>;
      const t = setTimeout(() => {
        this.timers.delete(t);
        Object.assign(dev.state, patch);
        this.pub(String(dev.info.friendly_name), dev.state);
      }, this.latencyMs);
      this.timers.add(t);
    } else if (verb === 'get' && dev.online) {
      this.pub(String(dev.info.friendly_name), dev.state);
    }
  }

  private handleRequest(path: string, req: Record<string, any>): void {
    switch (path) {
      case 'permit_join':
        this.permitJoinTime = Number(req.time ?? 0);
        this.respond(path, req, true, { time: this.permitJoinTime });
        if (this.permitJoinTime > 0 && this.opts.autoInterviewMs !== undefined) {
          const t = setTimeout(() => {
            this.timers.delete(t);
            if (this.permitJoinTime > 0) this.emitInterview();
          }, this.opts.autoInterviewMs);
          this.timers.add(t);
        }
        return;
      case 'device/rename': {
        const d = this.find(String(req.from));
        if (!d) return this.respond(path, req, false, {}, `Device '${req.from}' does not exist`);
        d.info.friendly_name = req.to;
        this.publishDevices();
        this.pub(String(req.to), d.state);
        this.pub(`${req.to}/availability`, { state: d.online ? 'online' : 'offline' }, true);
        return this.respond(path, req, true, { from: req.from, to: req.to });
      }
      case 'device/options': {
        const d = this.find(String(req.id));
        if (!d) return this.respond(path, req, false, {}, `Device '${req.id}' does not exist`);
        if (req.options && typeof req.options.description === 'string') d.info.description = req.options.description;
        this.publishDevices();
        return this.respond(path, req, true, { id: req.id, from: {}, to: req.options, restart_required: false });
      }
      case 'device/remove': {
        const d = this.find(String(req.id));
        if (!d) return this.respond(path, req, false, {}, `Device '${req.id}' does not exist`);
        this.devices.delete(d.info.ieee_address as string);
        this.publishDevices();
        return this.respond(path, req, true, { id: req.id, block: false, force: !!req.force });
      }
      default:
        this.respond(path, req, false, {}, `Unknown request ${path}`);
    }
  }
}
