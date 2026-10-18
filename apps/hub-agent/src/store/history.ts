import type { Db } from './db.js';

export interface HistoryPoint {
  ts: number;
  value: number;
}

export class HistoryRepo {
  constructor(private readonly db: Db) {}

  insert(deviceId: string, property: string, ts: number, value: number): void {
    this.db.prepare('INSERT INTO history (device_id, property, ts, value) VALUES (?, ?, ?, ?)').run(deviceId, property, ts, value);
  }

  /** ascending by ts; `from`/`to` inclusive */
  query(deviceId: string, property: string, from: number, to: number): HistoryPoint[] {
    return this.db
      .prepare('SELECT ts, value FROM history WHERE device_id = ? AND property = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC')
      .all(deviceId, property, from, to)
      .map((r) => ({ ts: Number(r.ts), value: Number(r.value) }));
  }

  /** avg per bucket of stepMs; ts = bucket start (epoch ms) */
  buckets(deviceId: string, property: string, from: number, to: number, stepMs: number): [number, number][] {
    return this.db
      .prepare(
        'SELECT (CAST(ts AS INTEGER) / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS b, AVG(value) AS v FROM history WHERE device_id = ? AND property = ? AND ts >= ? AND ts <= ? GROUP BY b ORDER BY b ASC',
      )
      .all(stepMs, stepMs, deviceId, property, from, to)
      .map((r) => [Number(r.b), Number(r.v)] as [number, number]);
  }

  /** retention: delete rows older than cutoff */
  deleteBefore(cutoff: number): number {
    return Number(this.db.prepare('DELETE FROM history WHERE ts < ?').run(cutoff).changes);
  }

  lastTs(deviceId: string, property: string): number | undefined {
    const r = this.db.prepare('SELECT MAX(ts) AS ts FROM history WHERE device_id = ? AND property = ?').get(deviceId, property);
    return r && r.ts !== null ? Number(r.ts) : undefined;
  }
}

export const HISTORY_MIN_INTERVAL_MS = 10_000;
export const HISTORY_MAX_POINTS = 300;

export type BucketPoint = [ts: number, value: number];

/** Bucketed average: `[bucketStartMs, avg]` ascending, capped at `maxPoints` (newest kept). */
export function queryBuckets(
  repo: HistoryRepo,
  deviceId: string,
  property: string,
  from: number,
  to: number,
  stepSec: number,
  maxPoints = HISTORY_MAX_POINTS,
): BucketPoint[] {
  const stepMs = Math.max(1, Math.floor(stepSec)) * 1000;
  const rows = repo.buckets(deviceId, property, from, to, stepMs);
  return rows.length > maxPoints ? rows.slice(rows.length - maxPoints) : rows;
}

/**
 * Registry change hook: numeric values only, ≤1 row / 10 s / property (realtime §2.5).
 * Returns an unsubscribe function.
 */
export function attachHistoryWriter(
  registry: { onChange(cb: (c: { entry: { device: { id: string }; values: Record<string, unknown> }; changed: string[] }) => void): () => void },
  repo: HistoryRepo,
  opts: { now?: () => number; minIntervalMs?: number; onError?: (e: unknown) => void } = {},
): () => void {
  const now = opts.now ?? Date.now;
  const gap = opts.minIntervalMs ?? HISTORY_MIN_INTERVAL_MS;
  const last = new Map<string, number>();
  return registry.onChange((c) => {
    const t = now();
    for (const prop of c.changed) {
      const v = c.entry.values[prop];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const key = `${c.entry.device.id}\u0000${prop}`;
      const prev = last.get(key);
      if (prev !== undefined && t - prev < gap) continue;
      try {
        repo.insert(c.entry.device.id, prop, t, v);
        last.set(key, t);
      } catch (e) {
        opts.onError?.(e);
      }
    }
  });
}
