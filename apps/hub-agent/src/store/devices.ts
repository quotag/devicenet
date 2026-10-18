import type { Device } from '@devicenet/shared';
import type { Db } from './db.js';

export interface DeviceRow {
  id: string;
  externalId: string;
  doc: Device;
  values: Record<string, unknown>;
  at: Record<string, number>;
  online: boolean;
  lastSeen: number;
  synced: boolean;
}

const fromRow = (r: Record<string, unknown>): DeviceRow => ({
  id: r.id as string,
  externalId: r.external_id as string,
  doc: JSON.parse(r.doc as string) as Device,
  values: JSON.parse(r.values as string) as Record<string, unknown>,
  at: JSON.parse(r.at as string) as Record<string, number>,
  online: Number(r.online) === 1,
  lastSeen: Number(r.last_seen),
  synced: Number(r.synced) === 1,
});

export class DevicesRepo {
  constructor(private readonly db: Db) {}

  /** insert or replace by id */
  upsert(row: DeviceRow): void {
    this.db
      .prepare(
        `INSERT INTO devices (id, external_id, doc, "values", at, online, last_seen, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET external_id = excluded.external_id, doc = excluded.doc, "values" = excluded."values",
           at = excluded.at, online = excluded.online, last_seen = excluded.last_seen, synced = excluded.synced`,
      )
      .run(
        row.id,
        row.externalId,
        JSON.stringify(row.doc),
        JSON.stringify(row.values),
        JSON.stringify(row.at),
        row.online ? 1 : 0,
        row.lastSeen,
        row.synced ? 1 : 0,
      );
  }

  get(id: string): DeviceRow | undefined {
    const r = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
    return r ? fromRow(r) : undefined;
  }

  getByExternalId(externalId: string): DeviceRow | undefined {
    const r = this.db.prepare('SELECT * FROM devices WHERE external_id = ?').get(externalId);
    return r ? fromRow(r) : undefined;
  }

  all(): DeviceRow[] {
    return this.db.prepare('SELECT * FROM devices ORDER BY id').all().map(fromRow);
  }

  unsynced(): DeviceRow[] {
    return this.db.prepare('SELECT * FROM devices WHERE synced = 0 ORDER BY id').all().map(fromRow);
  }

  setSynced(id: string, synced: boolean): void {
    this.db.prepare('UPDATE devices SET synced = ? WHERE id = ?').run(synced ? 1 : 0, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  }
}
