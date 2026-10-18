import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Device, HubEvent } from '@devicenet/shared';
import { describe, expect, it } from 'vitest';
import { openStore } from '../src/store/index.js';
import { newId } from '../src/core/ids.js';

const HUB = newId('hub');

function makeDevice(ext = '0xabc'): Device {
  return Device.parse({
    id: newId('dev'),
    hubId: HUB,
    siteId: newId('site'),
    roomId: null,
    driver: 'zigbee2mqtt',
    externalId: ext,
    name: 'Plug',
    properties: { state: { key: 'state', type: 'binary', label: 'Bật/Tắt', access: 'rw', category: 'control' } },
    status: 'new',
    createdAt: 1,
    updatedAt: 1,
  });
}

function makeEvent(ts: number, type = 'device.online'): HubEvent {
  return HubEvent.parse({ v: 1, ts, seq: 0, id: newId('evt'), hubId: HUB, type, deviceId: newId('dev') });
}

describe('store', () => {
  it('migrates to a fresh db with all tables and schemaVersion', () => {
    const s = openStore(':memory:');
    const tables = s.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['meta', 'devices', 'config_snapshot', 'history', 'events', 'rule_state']));
    expect(s.db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get()?.value).toBe('1');
    s.close();
  });

  it('is idempotent across reopen, uses WAL on disk, and persists data', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'db-')), 'sub', 'hub.db');
    const a = openStore(file);
    expect(String(a.db.prepare('PRAGMA journal_mode').get()?.journal_mode).toLowerCase()).toBe('wal');
    const d = makeDevice();
    a.devices.upsert({ id: d.id, externalId: d.externalId, doc: d, values: {}, at: {}, online: false, lastSeen: 0, synced: false });
    a.close();
    const b = openStore(file);
    expect(b.devices.get(d.id)?.doc).toEqual(d);
    b.close();
  });

  it('devices repo: upsert/get/unsynced/unique external id', () => {
    const s = openStore(':memory:');
    const d = makeDevice('0x1');
    s.devices.upsert({ id: d.id, externalId: '0x1', doc: d, values: { state: true }, at: { state: 5 }, online: true, lastSeen: 9, synced: false });
    expect(s.devices.getByExternalId('0x1')).toMatchObject({ id: d.id, values: { state: true }, at: { state: 5 }, online: true, lastSeen: 9, synced: false });
    expect(s.devices.unsynced()).toHaveLength(1);
    s.devices.setSynced(d.id, true);
    expect(s.devices.unsynced()).toHaveLength(0);
    // update in place
    s.devices.upsert({ ...s.devices.get(d.id)!, online: false });
    expect(s.devices.all()).toHaveLength(1);
    // another id with the same external id violates UNIQUE
    const d2 = makeDevice('0x1');
    expect(() => s.devices.upsert({ id: d2.id, externalId: '0x1', doc: d2, values: {}, at: {}, online: false, lastSeen: 0, synced: false })).toThrow();
    s.devices.delete(d.id);
    expect(s.devices.get(d.id)).toBeUndefined();
    s.close();
  });

  it('snapshot repo: put/get/overwrite/all, rejects unknown kind', () => {
    const s = openStore(':memory:');
    s.snapshot.put('site', { a: 1 }, 100, 'e1');
    s.snapshot.put('site', { a: 2 }, 200);
    expect(s.snapshot.get('site')).toEqual({ kind: 'site', json: { a: 2 }, etag: null, cachedAt: 200 });
    s.snapshot.put('rules', [], 1);
    expect(s.snapshot.all().map((r) => r.kind)).toEqual(['rules', 'site']);
    expect(s.snapshot.get('layout')).toBeUndefined();
    expect(() => s.snapshot.put('bogus' as never, {}, 1)).toThrow();
    s.close();
  });

  it('events repo: idempotent insert, ordered query, upload queue', () => {
    const s = openStore(':memory:');
    const e1 = makeEvent(10);
    const e2 = makeEvent(20, 'device.offline');
    expect(s.events.insert(e1)).toBe(true);
    expect(s.events.insert(e1)).toBe(false);
    s.events.insert(e2);
    expect(s.events.query().map((r) => r.id)).toEqual([e2.id, e1.id]);
    expect(s.events.query({ before: 20 }).map((r) => r.id)).toEqual([e1.id]);
    expect(s.events.query({ type: 'device.offline' })).toHaveLength(1);
    expect(s.events.pendingUpload().map((r) => r.id)).toEqual([e1.id, e2.id]);
    s.events.markUploaded(e1.id);
    expect(s.events.pendingUpload().map((r) => r.id)).toEqual([e2.id]);
    expect(s.events.get(e1.id)?.event).toEqual(e1);
    s.close();
  });

  it('history repo: insert and range query', () => {
    const s = openStore(':memory:');
    s.history.insert('dev_a', 'power', 10, 1.5);
    s.history.insert('dev_a', 'power', 30, 2.5);
    s.history.insert('dev_a', 'voltage', 20, 230);
    expect(s.history.query('dev_a', 'power', 0, 100)).toEqual([
      { ts: 10, value: 1.5 },
      { ts: 30, value: 2.5 },
    ]);
    expect(s.history.query('dev_a', 'power', 11, 100)).toEqual([{ ts: 30, value: 2.5 }]);
    expect(s.history.lastTs('dev_a', 'power')).toBe(30);
    expect(s.history.lastTs('dev_a', 'none')).toBeUndefined();
    s.close();
  });

  it('tx rolls back on throw', () => {
    const s = openStore(':memory:');
    expect(() =>
      s.db.tx(() => {
        s.history.insert('d', 'p', 1, 1);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(s.history.query('d', 'p', 0, 10)).toEqual([]);
    s.close();
  });
});
