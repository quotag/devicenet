import { createHash } from 'node:crypto';
import type { SnapshotKind, SnapshotRepo } from '../store/snapshot.js';
import type { Clock } from '../core/clock.js';
import { realClock } from '../core/clock.js';

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => (a < b ? -1 : 1))) : x,
  );

export const etagOf = (json: unknown): string => `"${createHash('sha1').update(stable(json)).digest('hex').slice(0, 16)}"`;

/** Writes config_snapshot rows after each listener change; the etag changes only when content changes. */
export class SnapshotWriter {
  constructor(
    private readonly repo: SnapshotRepo,
    private readonly clock: Clock = realClock,
  ) {}

  write(kind: SnapshotKind, json: unknown): boolean {
    const etag = etagOf(json);
    const cur = this.repo.get(kind);
    if (cur?.etag === etag) return false;
    this.repo.put(kind, json, this.clock.now(), etag);
    return true;
  }
}
