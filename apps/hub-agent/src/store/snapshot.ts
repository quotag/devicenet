import type { Db } from './db.js';

export type SnapshotKind = 'site' | 'rooms' | 'devices' | 'rules' | 'scenes' | 'layout';

export interface SnapshotRow<T = unknown> {
  kind: SnapshotKind;
  json: T;
  etag: string | null;
  cachedAt: number;
}

export class SnapshotRepo {
  constructor(private readonly db: Db) {}

  put(kind: SnapshotKind, json: unknown, cachedAt: number, etag: string | null = null): void {
    this.db
      .prepare(
        `INSERT INTO config_snapshot (kind, json, etag, cached_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET json = excluded.json, etag = excluded.etag, cached_at = excluded.cached_at`,
      )
      .run(kind, JSON.stringify(json), etag, cachedAt);
  }

  get<T = unknown>(kind: SnapshotKind): SnapshotRow<T> | undefined {
    const r = this.db.prepare('SELECT * FROM config_snapshot WHERE kind = ?').get(kind);
    if (!r) return undefined;
    return { kind, json: JSON.parse(r.json as string) as T, etag: (r.etag as string | null) ?? null, cachedAt: Number(r.cached_at) };
  }

  all(): SnapshotRow[] {
    return this.db
      .prepare('SELECT * FROM config_snapshot ORDER BY kind')
      .all()
      .map((r) => ({
        kind: r.kind as SnapshotKind,
        json: JSON.parse(r.json as string) as unknown,
        etag: (r.etag as string | null) ?? null,
        cachedAt: Number(r.cached_at),
      }));
  }
}
