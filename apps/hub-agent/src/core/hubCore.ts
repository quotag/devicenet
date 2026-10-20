import { parseTopic, topics } from '@devicenet/shared';
import { ConfigApply } from '../automation/configApply.js';
import type { SiteInfo } from '../automation/conditions.js';
import { AutomationEngine } from '../automation/engine.js';
import { ActionRunner } from '../automation/runner.js';
import { Scheduler } from '../automation/scheduler.js';
import { RuleSync } from '../sync/ruleSync.js';
import type { Driver } from '../drivers/Driver.js';
import type { Store } from '../store/index.js';
import type { ConfigStore } from '../sync/ConfigStore.js';
import type { Clock, TimerHost } from './clock.js';
import { realClock, realTimers } from './clock.js';
import { CommandProcessor } from './commands.js';
import { HubEvents } from './events.js';
import { DeviceLifecycle } from './lifecycle.js';
import type { CommandContext, HandlerMap } from './handlers/index.js';
import { PairingManager, type PairingDriver } from './pairing.js';
import type { Metrics } from './metrics.js';
import { Publisher, type HubIdentity } from './publisher.js';
import { Registry } from './registry.js';
import { SetQueue } from './setQueue.js';

type Log = { warn(obj: object, msg?: string): void; info?(obj: object, msg?: string): void; debug?(obj: object, msg?: string): void };

export interface HubCoreOptions {
  driver: Driver & Partial<Pick<PairingDriver, 'assignFriendlyName'>> & { readonly isBridgeOnline?: boolean };
  store?: Store;
  configStore?: () => ConfigStore | null | undefined;
  clock?: Clock;
  timers?: TimerHost;
  metrics?: Metrics;
  log?: Log;
  handlers?: Partial<HandlerMap>;
  coalesceMs?: number;
  minIntervalMs?: number;
  heartbeatMs?: number;
  confirmTimeoutMs?: number;
  guardMs?: number;
  /** OQ-6: meta.lastHeartbeatAt from the previous run (scheduler missed-run check) */
  lastAliveAt?: number;
}

/** B15/B16 automation stack. `sync.attach(configStore)` once claimed. */
export interface Automation {
  engine: AutomationEngine;
  scheduler: Scheduler;
  runner: ActionRunner;
  apply: ConfigApply;
  sync: RuleSync;
}

export interface HubCore {
  registry: Registry;
  publisher: Publisher;
  events: HubEvents;
  setQueue: SetQueue;
  pairing: PairingManager;
  commands: CommandProcessor;
  automation: Automation;
  /** claimed → tenant/hub/site known; null → unclaimed */
  setIdentity(id: HubIdentity | null): void;
  /** MQTT topic patterns the bridge/LAN broker client must subscribe to */
  subscriptions(): string[];
  /** route an inbound `set`/`cmd` message (any broker). Resolves when processed. */
  handleMessage(topic: string, payload: Buffer | string, source: string): Promise<void>;
  /** hook B09 sync */
  setConfigResync(fn: (() => Promise<void>) | undefined): void;
  stop(): void;
}

/** Compose registry → publisher → set queue / commands / pairing and subscribe to the driver. */
export function createHubCore(o: HubCoreOptions): HubCore {
  const clock = o.clock ?? realClock;
  const timers = o.timers ?? realTimers;
  const registry = new Registry({ repo: o.store?.devices, clock });
  registry.load();
  const publisher = new Publisher({
    registry,
    clock,
    timers,
    coalesceMs: o.coalesceMs,
    minIntervalMs: o.minIntervalMs,
    heartbeatMs: o.heartbeatMs,
    onError: (err, topic) => o.log?.warn({ err: (err as Error)?.message, topic }, 'publish failed'),
  });
  const events = new HubEvents({ publisher, repo: o.store?.events, onError: (err) => o.log?.warn({ err: (err as Error)?.message }, 'event') });
  const setQueue = new SetQueue({
    registry,
    driver: o.driver,
    events,
    timers,
    confirmTimeoutMs: o.confirmTimeoutMs,
    metrics: o.metrics,
    isDriverOnline: o.driver.isBridgeOnline === undefined ? undefined : () => o.driver.isBridgeOnline !== false,
    log: o.log,
  });
  const configStore = o.configStore ?? (() => null);
  const pairing = new PairingManager({
    driver: o.driver,
    registry,
    publisher,
    events,
    configStore,
    clock,
    timers,
    log: o.log,
  });
  const ctx: CommandContext = {
    registry,
    driver: o.driver,
    publisher,
    events,
    pairing,
    ...(o.store ? { history: o.store.history } : {}),
  };
  const lifecycle = new DeviceLifecycle({ registry, driver: o.driver, publisher, events, pairing, configStore, clock, log: o.log });
  ctx.lifecycle = lifecycle;
  // ---- automation (FR-H08): engine (property) + scheduler (schedule/sun) → runner ----
  const engine = new AutomationEngine({ registry, clock, timers, events, configStore, log: o.log });
  const scheduler = new Scheduler({
    clock,
    timers,
    events,
    getValue: (d, p) => registry.get(d)?.values[p],
    ...(o.lastAliveAt !== undefined ? { lastAliveAt: o.lastAliveAt } : {}),
    log: o.log,
  });
  const apply = new ConfigApply({ configStore, events, ...(o.store ? { db: o.store.db } : {}), clock, timers, log: o.log });
  let sync!: RuleSync;
  const runner = new ActionRunner({
    publisher,
    events,
    setQueue,
    getScene: (id) => sync.getScene(id),
    getRule: (id) => sync.getRule(id),
    onResult: (src, result, at) => apply.recordResult(src, result, at),
    clock,
    timers,
    log: o.log,
  });
  const engineView = {
    load(rules: Parameters<AutomationEngine['load']>[0]) {
      engine.load(rules);
      scheduler.sync(engine);
    },
    setSite(site: SiteInfo | null) {
      engine.setSite(site);
      scheduler.setSite(site);
      scheduler.sync(engine);
    },
  };
  sync = new RuleSync({ engine: engineView, runner, apply, lifecycle, lookup: (id) => registry.get(id), log: o.log });
  engine.setOnFire((f) => void runner.runRule(f.rule));
  scheduler.setOnFire((f) => void runner.runRule(f.rule));
  engine.attach();
  // device removed / added → re-run broken checks (B18 marks Firestore; engine drops the rule)
  events.on((e) => {
    if (e.type === 'device.removed' || e.type === 'device.found') {
      engine.refresh();
      scheduler.sync(engine);
    }
  });
  if (o.store) sync.loadSnapshot(o.store.snapshot);
  ctx.runner = runner;
  const automation: Automation = { engine, scheduler, runner, apply, sync };

  const commands = new CommandProcessor({ ctx, publisher, handlers: o.handlers, clock, timers, guardMs: o.guardMs, log: o.log, metrics: o.metrics });

  // ---- driver → registry → publisher ----
  o.driver.onState((externalId, raw) => {
    const e = registry.getByExternalId(externalId);
    if (!e) return;
    const c = registry.applyState(e.device.id, raw, (p, r) => o.driver.fromDriverValue(p, r));
    if (c && (c.changed.length > 0 || c.onlineChanged)) publisher.stateChanged(e.device.id);
    // B14 engine evaluates rules; B17 history writer is attached in main.ts (attachHistoryWriter)
  });
  o.driver.onAvailability((externalId, online) => lifecycle.handleAvailability(externalId, online));
  o.driver.onDeviceDiscovered((d) => {
    pairing.onDiscovered(d).catch((err) => o.log?.warn({ err: (err as Error)?.message }, 'device creation failed'));
  });

  return {
    registry,
    publisher,
    events,
    setQueue,
    pairing,
    commands,
    automation,
    setIdentity(id) {
      publisher.setIdentity(id);
      if (id) {
        for (const e of registry.all()) {
          if (e.device.hubId !== id.hubId || e.device.siteId !== id.siteId) {
            registry.updateDevice(e.device.id, { hubId: id.hubId, siteId: id.siteId, status: 'new' });
            registry.markSynced(e.device.id, false);
          }
        }
        lifecycle.recover().catch((err) => o.log?.warn({ err: (err as Error)?.message }, 'recovery'));
      }
    },
    subscriptions() {
      const id = publisher.getIdentity();
      return id ? [...topics.hubSubscriptions(id.tenantId, id.hubId)] : [];
    },
    async handleMessage(topic, payload, source) {
      const id = publisher.getIdentity();
      const t = parseTopic(topic);
      if (!id || !t || t.tenantId !== id.tenantId || t.hubId !== id.hubId) return;
      if (t.kind === 'set') {
        await setQueue.handle(t.deviceId, payload);
      } else if (t.kind === 'cmd') {
        await commands.handle(payload, source);
      }
    },
    setConfigResync(fn) {
      ctx.configResync = fn;
    },
    stop() {
      sync.detach();
      runner.stop();
      scheduler.stop();
      engine.stop();
      apply.stop();
      publisher.stop();
      pairing.dispose();
      lifecycle.dispose();
    },
  };
}
