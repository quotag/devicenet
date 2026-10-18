import type { HubEvent } from '@devicenet/shared';
import type { Db } from './db.js';

export interface EventRow {
  id: string;
  ts: number;
  type: string;
  event: HubEvent;
  uploaded: boolean;
}

const fromRow = (r: Record<string, unknown>): EventRow => ({
  id: r.id as string,
  ts: Number(r.ts),
  type: r.type as string,
  event: JSON.parse(r.json as string) as HubEvent,
  uploaded: Number(r.uploaded) === 1,
});

export class EventsRepo {
  constructor(private readonly db: Db) {}

  /** idempotent by id (returns false when already present) */
  insert(event: HubEvent): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO events (id, ts, type, json, uploaded) VALUES (?, ?, ?, ?, 0)')
      .run(event.id, event.ts, event.type, JSON.stringify(event));
    return Number(res.changes) > 0;
  }

  get(id: string): EventRow | undefined {
    const r = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    return r ? fromRow(r) : undefined;
  }

  /** newest first; `before` = exclusive ts cursor */
  query(opts: { limit?: number; before?: number; type?: string } = {}): EventRow[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.before !== undefined) {
      where.push('ts < ?');
      params.push(opts.before);
    }
    if (opts.type) {
      where.push('type = ?');
      params.push(opts.type);
    }
    params.push(opts.limit ?? 100);
    const sql = `SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC, id DESC LIMIT ?`;
    return this.db.prepare(sql).all(...params).map(fromRow);
  }

  deleteBefore(cutoff: number): number {
    return Number(this.db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff).changes);
  }

  /** oldest first, for the Firestore uploader */
  pendingUpload(limit = 50): EventRow[] {
    return this.db.prepare('SELECT * FROM events WHERE uploaded = 0 ORDER BY ts ASC, id ASC LIMIT ?').all(limit).map(fromRow);
  }

  markUploaded(id: string): void {
    this.db.prepare('UPDATE events SET uploaded = 1 WHERE id = ?').run(id);
  }
}
