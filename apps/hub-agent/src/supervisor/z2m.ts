import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import mqtt, { type MqttClient } from 'mqtt';
import type { Logger } from 'pino';
import { parse, stringify } from 'yaml';
import { ManagedChild, type ChildWarning } from './child.js';
import { resolveSerialPort, SerialNotFoundError, type ListPorts } from './serial.js';

export const Z2M_READY_TIMEOUT_MS = 60_000;
export const BRIDGE_STATE_TOPIC = 'zigbee2mqtt/bridge/state';

export interface Z2mHealth {
  z2m: 'online' | 'offline';
  lastError?: string;
}

export interface Z2mConfigInput {
  serialPort: string;
  mqttPort: number;
  mqttUser: string;
  mqttPassword: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Merge hub-managed keys into an existing Z2M configuration. `devices:`, `groups:` and every
 * other key Z2M owns (e.g. advanced.network_key) are preserved.
 */
export function mergeZ2mConfig(existing: unknown, i: Z2mConfigInput): Obj {
  const cur: Obj = isObj(existing) ? { ...existing } : {};
  const advanced: Obj = isObj(cur.advanced) ? { ...cur.advanced } : {};
  advanced.log_output = ['console'];
  const mqttCur: Obj = isObj(cur.mqtt) ? cur.mqtt : {};
  const { permit_join: _pj, ...rest } = cur as Obj & { permit_join?: unknown };
  void _pj; // permit_join is absent in 2.x
  return {
    ...rest,
    homeassistant: { enabled: false },
    frontend: { enabled: false },
    availability: { enabled: true, active: { timeout: 10 }, passive: { timeout: 1500 } },
    mqtt: {
      ...mqttCur,
      base_topic: 'zigbee2mqtt',
      server: `mqtt://127.0.0.1:${i.mqttPort}`,
      user: i.mqttUser,
      password: i.mqttPassword,
    },
    serial: { port: i.serialPort, adapter: 'ember' },
    advanced,
    devices: isObj(cur.devices) ? cur.devices : {},
    groups: isObj(cur.groups) ? cur.groups : {},
  };
}

export function writeZ2mConfig(z2mDir: string, i: Z2mConfigInput): string {
  mkdirSync(z2mDir, { recursive: true });
  const file = join(z2mDir, 'configuration.yaml');
  let existing: unknown;
  if (existsSync(file)) {
    try {
      existing = parse(readFileSync(file, 'utf8'));
    } catch {
      existing = undefined;
    }
  }
  writeFileSync(file, stringify(mergeZ2mConfig(existing, i)));
  return file;
}

/** `bridge/state` payload: `{"state":"online"}` (2.x) or legacy string `online`. */
export function parseBridgeState(payload: string): 'online' | 'offline' | undefined {
  const t = payload.trim();
  if (t === 'online' || t === 'offline') return t;
  try {
    const j = JSON.parse(t) as { state?: unknown };
    if (j.state === 'online' || j.state === 'offline') return j.state;
  } catch {
    /* not json */
  }
  return undefined;
}

export interface Z2mOptions {
  toolsDir: string;
  z2mDir: string;
  runDir: string;
  /** `config.yaml serialPort` */
  serialPort: string;
  mqttPort: number;
  /** passwords from secrets.json */
  z2mPassword: string;
  hubPassword: string;
  log: Logger;
  onHealth?: (h: Z2mHealth) => void;
  onWarning?: (w: ChildWarning) => void;
  readyTimeoutMs?: number;
  listPorts?: ListPorts;
  /** real node binary (config nodePath / DN_NODE_PATH); required when the hub runs as a SEA exe */
  nodePath?: string;
  /** SEA detection override (tests) */
  isSea?: boolean;
  /** override the Z2M entrypoint / command (tests) */
  command?: string;
  args?: string[];
}

export interface Z2mHandle {
  /** true when bridge/state=online arrived within the timeout */
  ready: boolean;
  health: Z2mHealth;
  child?: ManagedChild;
  stop(): Promise<void>;
}

/** true when running inside a Node single-executable app (process.execPath is then the hub itself). */
export function detectSea(): boolean {
  try {
    const sea = createRequire(import.meta.url)('node:sea') as { isSea?: () => boolean };
    return !!sea.isSea?.();
  } catch {
    return false;
  }
}

/**
 * Binary used to run Z2M. Never `process.execPath` inside a SEA exe (that is the hub, not node):
 * explicit nodePath, else `<toolsDir>/../node/node.exe` (installer layout), else error.
 */
export function resolveNodeCommand(nodePath: string | undefined, toolsDir: string, sea: boolean): string {
  if (nodePath) return nodePath;
  if (!sea) return process.execPath;
  const bundled = resolve(toolsDir, '..', 'node', process.platform === 'win32' ? 'node.exe' : 'node');
  if (existsSync(bundled)) return bundled;
  throw new Error('Hub chạy dạng SEA nhưng không tìm thấy node (đặt DN_NODE_PATH hoặc nodePath)');
}

/**
 * Resolve serial, write config, spawn Z2M under the watchdog, wait for `bridge/state online` (60 s).
 * Never throws for Z2M problems: failures are logged and reported through `health`/`onHealth`.
 */
export async function startZ2m(o: Z2mOptions): Promise<Z2mHandle> {
  const timeoutMs = o.readyTimeoutMs ?? Z2M_READY_TIMEOUT_MS;
  const handle: Z2mHandle = { ready: false, health: { z2m: 'offline' }, stop: async () => {} };
  const setHealth = (h: Z2mHealth) => {
    handle.health = h;
    o.onHealth?.(h);
  };

  let port: string;
  try {
    port = await resolveSerialPort(o.serialPort, o.listPorts);
  } catch (e) {
    const msg = e instanceof SerialNotFoundError ? e.message : `Lỗi dò cổng serial: ${(e as Error).message}`;
    o.log.error({ serialPort: o.serialPort }, msg);
    setHealth({ z2m: 'offline', lastError: msg });
    return handle;
  }

  writeZ2mConfig(o.z2mDir, { serialPort: port, mqttPort: o.mqttPort, mqttUser: 'z2m', mqttPassword: o.z2mPassword });
  const entry = join(o.toolsDir, 'zigbee2mqtt', 'index.js');
  let command: string;
  try {
    command = o.command ?? resolveNodeCommand(o.nodePath, o.toolsDir, o.isSea ?? detectSea());
  } catch (e) {
    o.log.error((e as Error).message);
    setHealth({ z2m: 'offline', lastError: (e as Error).message });
    return handle;
  }
  const args = o.args ?? [entry];
  if (!o.command && !existsSync(entry)) {
    const msg = `Không tìm thấy Zigbee2MQTT tại ${entry}`;
    o.log.error(msg);
    setHealth({ z2m: 'offline', lastError: msg });
    return handle;
  }

  // Monitor bridge/state with the hub user for the lifetime of the handle.
  let client: MqttClient | undefined;
  let timer: NodeJS.Timeout | undefined;
  let settled = false;
  const child = new ManagedChild({
    name: 'zigbee2mqtt',
    command,
    args,
    env: { ZIGBEE2MQTT_DATA: o.z2mDir },
    runDir: o.runDir,
    log: o.log,
    onWarning: o.onWarning,
    onExit: (code) => {
      if (settled || handle.ready) setHealth({ z2m: 'offline', lastError: `Zigbee2MQTT thoát (code ${String(code)})` });
    },
  });
  handle.child = child;

  const ready = new Promise<boolean>((resolve) => {
    client = mqtt.connect(`mqtt://127.0.0.1:${o.mqttPort}`, {
      username: 'hub',
      password: o.hubPassword,
      clientId: `hub-supervisor-${process.pid}`,
      reconnectPeriod: 2000,
    });
    client.on('error', (err) => o.log.debug({ err: err.message }, 'z2m monitor mqtt error'));
    client.on('connect', () => client?.subscribe(BRIDGE_STATE_TOPIC));
    client.on('message', (_t, buf) => {
      const st = parseBridgeState(buf.toString('utf8'));
      if (st === 'online') {
        handle.ready = true;
        setHealth({ z2m: 'online' });
        if (!settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(true);
        }
      } else if (st === 'offline') {
        setHealth({ z2m: 'offline', lastError: 'Zigbee2MQTT bridge offline' });
      }
    });
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const msg = `Zigbee2MQTT không online sau ${Math.round(timeoutMs / 1000)} s (kiểm tra USB Zigbee / cổng ${port})`;
      o.log.error({ serialPort: port, timeoutMs }, msg);
      setHealth({ z2m: 'offline', lastError: msg });
      resolve(false);
    }, timeoutMs);
  });

  handle.stop = async () => {
    if (timer) clearTimeout(timer);
    settled = true;
    await child.stop();
    await new Promise<void>((res) => (client ? client.end(true, {}, () => res()) : res()));
  };

  await child.start();
  await ready;
  return handle;
}
