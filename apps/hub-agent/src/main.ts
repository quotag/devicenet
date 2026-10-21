import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { Bridge } from './bridge/bridge.js';
import { buildStatus, primaryIpv4 } from './bridge/heartbeat.js';
import { ClaimClient } from './claim/claimClient.js';
import type { HubCredential } from './claim/credentials.js';
import { evaluateSignInError } from './claim/tokenRefresh.js';
import { runCli } from './cli.js';
import { loadConfig } from './config/load.js';
import { findRepoRoot, resolvePaths } from './config/paths.js';
import type { HubConfig } from './config/schema.js';
import { createHubCore, type HubCore } from './core/hubCore.js';
import { Zigbee2mqttDriver } from './drivers/zigbee2mqtt/driver.js';
import { version } from './index.js';
import { startLanServer } from './lan/server.js';
import { createLogger, type Logger } from './log/index.js';
import { openStore, type Store } from './store/index.js';
import { attachHistoryWriter } from './store/history.js';
import { startRetention } from './store/retention.js';
import { Metrics } from './core/metrics.js';
import { startSupervisor, type Supervisor, type SupervisorHealth } from './supervisor/index.js';
import { clearProxyEnv, FirestoreConfigStore } from './sync/firestoreStore.js';
import { Reconciler } from './sync/reconciler.js';

export interface Agent {
  core: HubCore;
  config: HubConfig;
  stop(): Promise<void>;
}

function getMeta(store: Store, key: string): string | undefined {
  const r = store.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return r ? String(r.value) : undefined;
}

function setMeta(store: Store, key: string, value: string): void {
  store.db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** config.yaml: DN_CONFIG, else `<dataDir>/config.yaml` (dataDir from env/defaults). */
function loadAgentConfig(env: NodeJS.ProcessEnv): HubConfig {
  if (env.DN_CONFIG) return loadConfig({ file: env.DN_CONFIG, env });
  const base = loadConfig({ env });
  const file = join(resolve(base.dataDir), 'config.yaml');
  return existsSync(file) ? loadConfig({ file, env }) : base;
}

/**
 * Boot order (plan §Architecture): config → log → SQLite → supervisor (broker, then Z2M/mock)
 * → local link → driver → registry → LAN → claim client | sync + cloud link.
 * Claim completion switches to the claimed path live (no restart).
 */
export async function startAgent(env: NodeJS.ProcessEnv = process.env): Promise<Agent> {
  const cfg = loadAgentConfig(env);
  if (cfg.emulator) clearProxyEnv();
  const paths = resolvePaths(cfg);
  const log: Logger = createLogger({ level: cfg.log.level, logsDir: paths.logsDir });
  log.info({ version, dataDir: paths.dataDir, toolsDir: paths.toolsDir, emulator: cfg.emulator, mockZ2m: cfg.mockZ2m }, 'DeviceNet hub-agent starting');

  const store = openStore(paths.db);
  let supHealth: SupervisorHealth = { z2m: 'starting', broker: 'none' };

  // paired devices from SQLite: re-seeded into the mock so they keep reporting across restarts
  const seed = store.devices
    .all()
    .filter((r) => r.doc.driver === 'zigbee2mqtt' && r.doc.status !== 'removed')
    .map((r) => ({ ieee: r.doc.externalId, friendlyName: r.doc.id }));

  const sup: Supervisor = await startSupervisor({
    cfg,
    paths,
    log,
    mockDevices: () => seed,
    onHealth: (h) => (supHealth = h),
    onWarning: (w) => log.warn(w, 'child crash loop'),
  });
  supHealth = sup.health();

  const localAuth = { username: sup.localUsername, ...(sup.localPassword ? { password: sup.localPassword } : {}) };
  const driver = new Zigbee2mqttDriver({ url: sup.localUrl, mqttOptions: localAuth });

  let configStore: FirestoreConfigStore | null = null;
  let reconciler: Reconciler | null = null;
  // OQ-6: last time the previous run was alive (persisted every 30 s + at shutdown)
  const lastAliveRaw = Number(getMeta(store, 'lastHeartbeatAt'));
  const lastAliveAt = Number.isFinite(lastAliveRaw) && lastAliveRaw > 0 ? lastAliveRaw : undefined;
  const metrics = new Metrics();
  metrics.startLogging(log);
  const core = createHubCore({ driver, metrics, store, configStore: () => configStore, log, ...(lastAliveAt !== undefined ? { lastAliveAt } : {}) });
  const aliveTimer = setInterval(() => {
    try {
      setMeta(store, 'lastHeartbeatAt', String(Date.now()));
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'lastHeartbeatAt write failed');
    }
  }, 30_000);
  aliveTimer.unref();
  const detachHistory = attachHistoryWriter(core.registry, store.history, { onError: (e) => log.warn({ err: (e as Error).message }, 'history write failed') });
  const stopRetention = startRetention(store, (e) => log.warn({ err: (e as Error).message }, 'retention failed'));

  const lanUrl = () => {
    const ip = primaryIpv4();
    return cfg.lan.enabled && ip ? `http://${ip}:${cfg.lan.port}` : undefined;
  };
  const z2mState = (): SupervisorHealth['z2m'] => (driver.isBridgeOnline ? 'online' : supHealth.z2m === 'online' ? 'offline' : supHealth.z2m);
  const bridge = new Bridge({
    core,
    config: cfg,
    local: { url: sup.localUrl, ...localAuth },
    status: () => buildStatus({ agentVersion: version, z2m: z2mState, lanUrl, deviceCount: () => core.registry.size }),
    log,
  });
  bridge.start();
  await driver.start();
  log.info({ url: sup.localUrl, broker: supHealth.broker }, 'driver connected to local broker');

  const claim = new ClaimClient({
    apiBaseUrl: cfg.apiBaseUrl,
    hubKeyPath: paths.hubKey,
    credentialsPath: paths.credentials,
    agentVersion: version,
    platform: process.platform === 'win32' ? 'windows' : 'linux',
    log,
  });

  let stopping = false;
  let signInTimer: NodeJS.Timeout | undefined;

  const goUnclaimed = async () => {
    log.info('Hub unclaiming / resetting credentials');
    if (signInTimer) {
      clearTimeout(signInTimer);
      signInTimer = undefined;
    }
    core.automation.sync.detach();
    reconciler?.stop();
    reconciler = null;
    await configStore?.close().catch(() => {});
    configStore = null;
    await bridge.disconnectCloud().catch(() => {});

    // Clear retained state on local broker, clean registry and local database tables
    for (const entry of core.registry.all()) {
      core.publisher.clearState(entry.device.id);
    }
    core.registry.clear();
    store.resetForUnclaim();

    core.setIdentity(null);
    bridge.identityChanged();
    await claim.reset();
  };

  let lan: Awaited<ReturnType<typeof startLanServer>> | null = null;
  if (cfg.lan.enabled) {
    const webDir = isAbsolute(cfg.lan.webDir) ? cfg.lan.webDir : resolve(findRepoRoot(), cfg.lan.webDir);
    try {
      lan = await startLanServer(
        {
          getHealth: () => ({
            ok: true,
            agentVersion: version,
            z2m: z2mState(),
            mqttLocal: bridge.localConnected,
            mqttCloud: bridge.cloudConnected,
            firestore: configStore?.signInState === 'signed-in',
            claimed: claim.state === 'claimed',
            ...(supHealth.lastError ? { lastError: supHealth.lastError } : {}),
          }),
          getClaim: () => claim.current(),
          resetClaim: async () => {
            const cred = claim.getCredential();
            let cloudOk = true;
            if (cred) {
              cloudOk = await claim.unclaimCloud(cred);
            }
            await goUnclaimed();
            return cloudOk;
          },
          getIdentity: () => core.publisher.getIdentity(),
          snapshot: store.snapshot,
          history: store.history,
          events: store.events,
          webDir,
        },
        { bind: cfg.lan.bind, port: cfg.lan.port },
      );
      log.info({ url: `http://127.0.0.1:${cfg.lan.port}`, lanUrl: lanUrl(), webDir }, 'LAN server listening (/setup, /api/health)');
    } catch (e) {
      log.error({ err: (e as Error).message, port: cfg.lan.port }, 'LAN server failed to start');
    }
  }

  let unauthFailCount = 0;

  const signIn = (s: FirestoreConfigStore, delay = 5_000) => {
    s.connect().then(
      () => {
        unauthFailCount = 0;
        log.info('Firestore signed in');
      },
      (e) => {
        if (stopping || configStore !== s) return;
        const msg = (e as Error)?.message ?? '';
        const decision = evaluateSignInError(e, unauthFailCount, delay);
        unauthFailCount = decision.consecutiveFailures;

        if (decision.isUnauthenticated) {
          log.warn({ unauthFailCount, status: (e as { status?: number })?.status, code: (e as { code?: string })?.code, err: msg }, 'Hub authentication rejected by cloud');
          if (decision.shouldUnclaim) {
            log.warn('Hub credentials invalid/revoked on cloud (3 consecutive unauthenticated rejections); unclaiming');
            unauthFailCount = 0;
            void goUnclaimed();
            return;
          }
        } else {
          log.warn({ err: msg, retryInMs: decision.retryDelayMs }, 'Firestore sign-in failed');
        }

        signInTimer = setTimeout(() => signIn(s, decision.retryDelayMs), decision.retryDelayMs);
      },
    );
  };

  const goClaimed = async (cred: HubCredential) => {
    core.setIdentity({ tenantId: cred.tenantId, hubId: cred.hubId, siteId: cred.siteId });
    bridge.identityChanged();
    const s = new FirestoreConfigStore({ credentialsPath: paths.credentials, credential: cred, emulator: cfg.emulator, log });
    configStore = s;
    s.onHubDeleted(() => {
      if (stopping || configStore !== s) return;
      log.warn('Hub was deleted on cloud; unclaiming local agent');
      void goUnclaimed();
    });
    const r = new Reconciler({ store: s, registry: core.registry, db: store, log });
    reconciler = r;
    r.start();
    core.automation.sync.attach(s); // rules/scenes/site listeners → engine + scheduler, appliedRev
    core.events.setUploader(r.uploader.enqueue);
    core.setConfigResync(async () => void (await r.reconcile()));
    signIn(s);
    try {
      await bridge.connectCloud(cred.mqtt);
    } catch (e) {
      log.error({ err: (e as Error).message }, 'cloud link failed');
    }
    // FR-H06 recovery: devices Z2M knows but the registry does not (e.g. paired before the claim)
    for (const d of driver.knownDevices()) {
      core.pairing.onDiscovered(d).catch((err) => log.warn({ err: (err as Error).message }, 'recovery create failed'));
    }
    log.info({ tenantId: cred.tenantId, hubId: cred.hubId, cloud: `${cred.mqtt.host}:${cred.mqtt.port}` }, 'hub running claimed');
  };

  claim.on('code', ({ code }) => {
    const ip = primaryIpv4();
    const lanMsg = ip ? ` hoặc http://${ip}:${cfg.lan.port}/setup` : '';
    if (lan) log.info(`Mở http://localhost:${cfg.lan.port}/setup${lanMsg} để xem mã claim ${code}`);
  });
  claim.on('claimed', (cred) => void goClaimed(cred).catch((e) => log.error({ err: (e as Error).message }, 'claimed transition failed')));
  const existing = await claim.start();
  if (existing) await goClaimed(existing);

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log.info('hub-agent stopping');
    if (signInTimer) clearTimeout(signInTimer);
    clearInterval(aliveTimer);
    metrics.stopLogging();
    core.automation.sync.detach();
    // pending lastRunAt/lastResult stay in rule_state if Firestore does not answer quickly
    await Promise.race([core.automation.apply.flushAll().catch(() => {}), new Promise((r) => setTimeout(r, 2_000).unref())]);
    detachHistory();
    stopRetention();
    claim.stop();
    await bridge.stop().catch(() => {}); // retained status online:false on both links
    reconciler?.stop();
    await configStore?.close().catch(() => {});
    await lan?.close().catch(() => {});
    await driver.stop().catch(() => {});
    core.stop();
    await sup.stop();
    try {
      setMeta(store, 'lastHeartbeatAt', String(Date.now()));
      store.close();
    } catch {
      /* closing anyway */
    }
    log.info('hub-agent stopped');
  };

  return { core, config: cfg, stop };
}

async function main(): Promise<void> {
  const code = runCli(process.argv.slice(2));
  if (code !== null) {
    process.exitCode = code;
    return;
  }
  const agent = await startAgent();
  let exiting = false;
  const onSignal = (sig: string) => {
    if (exiting) return;
    exiting = true;
    const hard = setTimeout(() => process.exit(1), 8_000);
    hard.unref();
    agent.stop().then(
      // give the pino transport a moment to flush
      () => setTimeout(() => process.exit(0), 200),
      (e) => {
        console.error(`shutdown (${sig}) failed: ${(e as Error).message}`);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGBREAK', () => onSignal('SIGBREAK'));
}

main().catch((e) => {
  console.error('hub-agent failed to start:', e);
  process.exit(1);
});
