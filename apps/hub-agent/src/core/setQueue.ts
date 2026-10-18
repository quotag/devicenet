import { DeviceId, SET_CONFIRM_TIMEOUT_MS, SetCommand, isWritable, validateValue, type PropertyValue } from '@devicenet/shared';
import type { Driver } from '../drivers/Driver.js';
import type { TimerHost } from './clock.js';
import { realTimers } from './clock.js';
import type { HubEvents } from './events.js';
import type { Metrics } from './metrics.js';
import type { Registry, RegistryChange } from './registry.js';

export interface SetQueueOptions {
  registry: Registry;
  driver: Pick<Driver, 'setProperty'>;
  events: Pick<HubEvents, 'emit'>;
  timers?: TimerHost;
  metrics?: Pick<Metrics, 'observe'>;
  /** how long one set waits for the confirming Z2M state before the next set of that device runs */
  confirmTimeoutMs?: number;
  /** Z2M bridge offline → reject with driver_unavailable */
  isDriverOnline?: () => boolean;
  log?: { warn(obj: object, msg?: string): void; debug?(obj: object, msg?: string): void };
}

export type SetOutcome =
  | { ok: true; confirmed: boolean }
  | { ok: false; reason: string };

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * `set` handling (FR-H05, realtime §2.2): validate every key, any failure rejects the whole message
 * via `events set.rejected`; valid sets run sequentially per device (LAN + cloud never interleave),
 * each waits for the confirming state from the driver. The hub never publishes a synthetic state.
 */
export class SetQueue {
  private chains = new Map<string, Promise<unknown>>();
  private readonly o: SetQueueOptions;
  private readonly timers: TimerHost;
  private readonly confirmMs: number;

  constructor(opts: SetQueueOptions) {
    this.o = opts;
    this.timers = opts.timers ?? realTimers;
    this.confirmMs = opts.confirmTimeoutMs ?? SET_CONFIRM_TIMEOUT_MS;
  }

  private reject(deviceId: string, reason: string): SetOutcome {
    if (DeviceId.safeParse(deviceId).success) this.o.events.emit({ type: 'set.rejected', deviceId, reason });
    this.o.log?.warn({ deviceId, reason }, 'set rejected');
    return { ok: false, reason };
  }

  /** Handle one `set` message (payload = parsed JSON or raw buffer/string). Resolves when done (confirmed, timed out or rejected). */
  handle(deviceId: string, payload: unknown): Promise<SetOutcome> {
    let body = payload;
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      try {
        body = JSON.parse(body.toString());
      } catch {
        return Promise.resolve(this.reject(deviceId, 'invalid_json'));
      }
    }
    const parsed = SetCommand.safeParse(body);
    if (!parsed.success) return Promise.resolve(this.reject(deviceId, 'invalid_payload'));
    const entry = this.o.registry.get(deviceId);
    if (!entry) return Promise.resolve(this.reject(deviceId, 'not_found'));
    for (const [key, value] of Object.entries(parsed.data.values)) {
      const prop = entry.device.properties[key];
      if (!prop) return Promise.resolve(this.reject(deviceId, `unknown_property:${key}`));
      if (!isWritable(prop)) return Promise.resolve(this.reject(deviceId, `not_writable:${key}`));
      const v = validateValue(prop, value);
      if (!v.ok) return Promise.resolve(this.reject(deviceId, `invalid_value:${key}:${v.error}`));
    }
    if (!entry.online) return Promise.resolve(this.reject(deviceId, 'device_offline'));

    const values = parsed.data.values;
    const prev = this.chains.get(deviceId) ?? Promise.resolve();
    const run = prev.then(() => this.execute(deviceId, values));
    const tail = run.catch(() => undefined);
    this.chains.set(deviceId, tail);
    void tail.then(() => {
      if (this.chains.get(deviceId) === tail) this.chains.delete(deviceId);
    });
    return run;
  }

  private async execute(deviceId: string, values: Record<string, PropertyValue>): Promise<SetOutcome> {
    const entry = this.o.registry.get(deviceId);
    if (!entry) return this.reject(deviceId, 'not_found');
    // re-check at execution time: the device may have dropped while queued
    if (!entry.online) return this.reject(deviceId, 'device_offline');
    if (this.o.isDriverOnline && !this.o.isDriverOnline()) return this.reject(deviceId, 'driver_unavailable');

    const keys = Object.keys(values);
    const t0 = Date.now();
    const confirmed = this.waitConfirm(deviceId, values);
    try {
      for (const key of keys) {
        const prop = entry.device.properties[key]!;
        await this.o.driver.setProperty(entry.device.externalId, key, values[key]!, prop);
      }
    } catch (e) {
      confirmed.cancel();
      return this.reject(deviceId, `driver_error:${(e as Error).message ?? 'unknown'}`.slice(0, 200));
    }
    const ok = await confirmed.promise;
    if (ok) this.o.metrics?.observe('setState', Date.now() - t0);
    else this.o.log?.warn({ deviceId, keys }, 'set not confirmed by device state in time');
    return { ok: true, confirmed: ok };
  }

  /** Resolve true once registry values equal the requested values (or false on timeout / device offline). */
  private waitConfirm(deviceId: string, values: Record<string, PropertyValue>): { promise: Promise<boolean>; cancel(): void } {
    let done = false;
    let resolveFn!: (v: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolveFn = r));
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      off();
      timer.cancel();
      resolveFn(v);
    };
    const off = this.o.registry.onChange((c: RegistryChange) => {
      if (c.entry.device.id !== deviceId) return;
      if (!c.entry.online) return finish(false);
      if (Object.entries(values).every(([k, v]) => same(c.entry.values[k], v))) finish(true);
    });
    const timer = this.timers.setTimeout(() => finish(false), this.confirmMs);
    return { promise, cancel: () => finish(false) };
  }
}
