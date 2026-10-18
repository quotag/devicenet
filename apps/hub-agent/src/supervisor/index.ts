import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Logger } from 'pino';
import type { HubConfig } from '../config/schema.js';
import type { HubPaths } from '../config/paths.js';
import type { ChildWarning } from './child.js';
import { killStalePids } from './child.js';
import { startEmbeddedBroker, type EmbeddedBroker } from './embeddedBroker.js';
import { loadOrCreateSecrets, mosquittoAvailable, startMosquitto, type MosquittoHandle } from './mosquitto.js';
import { startZ2m, type Z2mHandle } from './z2m.js';

export type Z2mState = 'online' | 'offline' | 'starting';

export interface SupervisorHealth {
  z2m: Z2mState;
  broker: 'mosquitto' | 'embedded' | 'external' | 'none';
  lastError?: string;
}

/** Minimal surface of the in-process mock Z2M (test/mock-z2m, B03). */
export interface MockZ2mLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  addDevice(ieee?: string, friendlyName?: string): unknown;
}

export interface SupervisorOptions {
  cfg: Pick<HubConfig, 'mockZ2m' | 'serialPort' | 'mqttLocal'> & Partial<Pick<HubConfig, 'supervisor' | 'nodePath'>>;
  paths: Pick<HubPaths, 'toolsDir' | 'mosquittoDir' | 'secrets' | 'runDir' | 'z2mDir'>;
  log: Logger;
  onHealth?: (h: SupervisorHealth) => void;
  onWarning?: (w: ChildWarning) => void;
  /** mock mode: devices to pre-seed in the mock (ieee + friendly_name from the registry) */
  mockDevices?: () => Array<{ ieee: string; friendlyName: string }>;
  /** mock mode: auto interview delay after permit_join (default 1500 ms) */
  mockAutoInterviewMs?: number;
  /** force the embedded aedes broker even when Mosquitto is installed */
  embeddedBroker?: boolean;
}

export interface Supervisor {
  /** local broker url for the hub user (credentials NOT embedded) */
  localUrl: string;
  localUsername: string;
  localPassword?: string;
  health(): SupervisorHealth;
  mock?: MockZ2mLike;
  stop(): Promise<void>;
}

/** Load the mock Z2M from the source tree (dev only; needs tsx). Kept out of `src` typecheck on purpose. */
async function loadMock(): Promise<new (o: { url: string; latencyMs?: number; withDevice?: boolean; autoInterviewMs?: number }) => MockZ2mLike> {
  const file = fileURLToPath(new URL('../../test/mock-z2m/index.ts', import.meta.url));
  if (!existsSync(file)) throw new Error(`DN_MOCK_Z2M=1 needs the source tree (missing ${file})`);
  const mod = (await import(pathToFileURL(file).href)) as { MockZ2m: never };
  return mod.MockZ2m;
}

/**
 * Boot the local broker (Mosquitto, or embedded aedes when Mosquitto is not installed) and then
 * Zigbee2MQTT (real, waits for bridge/state ≤ 60 s) or the in-process mock when DN_MOCK_Z2M=1.
 * Z2M problems never throw: they are reported through health().
 */
export async function startSupervisor(o: SupervisorOptions): Promise<Supervisor> {
  const health: SupervisorHealth = { z2m: 'starting', broker: 'none' };
  const set = (p: Partial<SupervisorHealth>) => {
    Object.assign(health, p);
    if (p.lastError === undefined && 'lastError' in p) delete health.lastError;
    o.onHealth?.({ ...health });
  };
  const external = o.cfg.supervisor?.manage === false;
  const killed = external ? [] : await killStalePids(o.paths.runDir, ['mosquitto', 'zigbee2mqtt']);
  if (killed.length) o.log.warn({ pids: killed }, 'killed stale child processes from a previous run');

  const { port, wsPort } = o.cfg.mqttLocal;
  let mosq: MosquittoHandle | undefined;
  let embedded: EmbeddedBroker | undefined;
  let hubPassword: string | undefined;
  let z2mPassword: string | undefined;

  if (external) {
    set({ broker: 'external' });
    o.log.info({ host: o.cfg.supervisor?.mqttHost, port }, 'external services mode: using existing Mosquitto/Z2M (not spawning)');
  } else if (!o.embeddedBroker && mosquittoAvailable(o.paths.toolsDir)) {
    try {
      mosq = await startMosquitto({
        toolsDir: o.paths.toolsDir,
        mosquittoDir: o.paths.mosquittoDir,
        secretsFile: o.paths.secrets,
        runDir: o.paths.runDir,
        port,
        wsPort,
        log: o.log,
        onWarning: o.onWarning,
      });
      hubPassword = mosq.secrets.hub;
      z2mPassword = mosq.secrets.z2m;
      set({ broker: 'mosquitto' });
    } catch (e) {
      o.log.error({ err: (e as Error).message }, 'Mosquitto failed to start — falling back to the embedded broker');
    }
  } else if (!o.embeddedBroker) {
    o.log.warn({ toolsDir: o.paths.toolsDir }, 'Mosquitto not found (run `pnpm tools:fetch` or set DN_TOOLS_DIR) — using the embedded broker');
  }
  if (!mosq && !external) {
    embedded = await startEmbeddedBroker({ port, wsPort });
    set({ broker: 'embedded' });
    o.log.info({ port: embedded.port, wsPort: embedded.wsPort }, 'embedded MQTT broker listening');
  }
  const brokerPort = embedded ? embedded.port : port;
  const brokerHost = external ? (o.cfg.supervisor?.mqttHost ?? '127.0.0.1') : '127.0.0.1';
  const localUrl = `mqtt://${brokerHost}:${brokerPort}`;

  let z2m: Z2mHandle | undefined;
  let mock: MockZ2mLike | undefined;
  if (o.cfg.mockZ2m) {
    const MockZ2m = await loadMock();
    const auth = z2mPassword ? `z2m:${encodeURIComponent(z2mPassword)}@` : 'z2m@';
    mock = new MockZ2m({
      url: `mqtt://${auth}${brokerHost}:${brokerPort}`,
      latencyMs: Number(process.env.DN_MOCK_Z2M_LATENCY_MS ?? 50),
      withDevice: false,
      autoInterviewMs: o.mockAutoInterviewMs ?? Number(process.env.DN_MOCK_AUTO_INTERVIEW_MS ?? 1500),
    });
    for (const d of o.mockDevices?.() ?? []) mock.addDevice(d.ieee, d.friendlyName);
    await mock.start();
    set({ z2m: 'online', lastError: undefined });
    o.log.info('mock Zigbee2MQTT started (DN_MOCK_Z2M=1)');
  } else if (external) {
    // Z2M is its own container: bridge/state is observed by the driver, health starts offline until then
    set({ z2m: 'offline' });
  } else {
    const secrets = z2mPassword ? { z2m: z2mPassword, hub: hubPassword! } : loadOrCreateSecrets(o.paths.secrets);
    z2m = await startZ2m({
      toolsDir: o.paths.toolsDir,
      ...(o.cfg.nodePath ? { nodePath: o.cfg.nodePath } : {}),
      z2mDir: o.paths.z2mDir,
      runDir: o.paths.runDir,
      serialPort: o.cfg.serialPort,
      mqttPort: brokerPort,
      z2mPassword: secrets.z2m,
      hubPassword: secrets.hub,
      log: o.log,
      onWarning: o.onWarning,
      onHealth: (h) => set({ z2m: h.z2m, lastError: h.lastError }),
    });
    if (!z2m.ready) set({ z2m: 'offline', lastError: z2m.health.lastError });
  }

  return {
    localUrl,
    localUsername: 'hub',
    localPassword: hubPassword,
    health: () => ({ ...health }),
    mock,
    async stop() {
      await mock?.stop().catch(() => {});
      await z2m?.stop().catch(() => {});
      await mosq?.stop().catch(() => {});
      await embedded?.close().catch(() => {});
    },
  };
}
