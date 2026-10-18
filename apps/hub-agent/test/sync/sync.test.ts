import { describe, expect, it } from 'vitest';
import type { HubEvent } from '@devicenet/shared';
import { Registry } from '../../src/core/registry.js';
import { openStore } from '../../src/store/index.js';
import { EventUploader, toEventDoc } from '../../src/sync/eventUploader.js';
import { Reconciler } from '../../src/sync/reconciler.js';
import { etagOf } from '../../src/sync/snapshot.js';
import { FakeConfigStore } from '../helpers/fakeConfigStore.js';
import { IDENTITY, makeDevice } from '../core/helpers.js';

const evt = (id: string, ts = 1_000): HubEvent =>
  ({ v: 1, ts, seq: 1, id, hubId: IDENTITY.hubId, type: 'device.found', deviceId: 'dev_x', model: 'm' }) as unknown as HubEvent;

describe('toEventDoc', () => {
  it('maps envelope away and sets expireAt = ts + 30d', () => {
    const d = toEventDoc(evt('evt_1', 5));
    expect(d).toMatchObject({ id: 'evt_1', hubId: IDENTITY.hubId, ts: 5, type: 'device.found', deviceId: 'dev_x', expireAt: 5 + 30 * 86400_000 });
    expect(d.detail).toEqual({ model: 'm' });
    expect('seq' in d).toBe(false);
  });
});

describe('EventUploader', () => {
  it('uploads pending, marks uploaded, tolerates permission-denied (OQ-9), keeps pending on other errors', async () => {
    const db = openStore(':memory:');
    for (const id of ['evt_a', 'evt_b', 'evt_c']) db.events.insert(evt(id, Number(id.charCodeAt(4))));
    const store = new FakeConfigStore();
    const up = new EventUploader({ store: () => store, repo: db.events });
    store.failNext = Object.assign(new Error('denied'), { code: 'permission-denied' });
    expect(await up.flush()).toBe(3);
    expect(db.events.pendingUpload()).toHaveLength(0);

    db.events.insert(evt('evt_d', 99));
    store.failNext = new Error('network');
    expect(await up.flush()).toBe(0);
    expect(db.events.pendingUpload()).toHaveLength(1);
    expect(await up.flush()).toBe(1);
    expect(store.events.has('evt_d')).toBe(true);
  });

  it('does nothing when signed out', async () => {
    const db = openStore(':memory:');
    db.events.insert(evt('evt_a'));
    const store = new FakeConfigStore();
    store.signInState = 'signed-out';
    expect(await new EventUploader({ store: () => store, repo: db.events }).flush()).toBe(0);
  });
});

describe('Reconciler', () => {
  it('creates unsynced devices, updates hub fields when remote exists, applies user fields, writes snapshots', async () => {
    const db = openStore(':memory:');
    const registry = new Registry({ repo: db.devices });
    const store = new FakeConfigStore();
    const a = makeDevice({ id: 'dev_a', status: 'new', externalId: '0xa' });
    const b = makeDevice({ id: 'dev_b', status: 'new', externalId: '0xb', firmware: '1' });
    registry.insert(a, { synced: false });
    registry.insert(b, { synced: false });
    store.setRemoteDevice({ ...b, firmware: '0', name: 'Phòng khách', status: 'active' });

    const rec = new Reconciler({ store, registry, db, firstSnapshotTimeoutMs: 50 });
    rec.start();
    const r = await rec.reconcile();
    expect(r.devices).toBe(2);
    expect(store.writes.map((w) => w[0] + ':' + w[1])).toEqual(['createDevice:dev_a', 'updateDeviceHubFields:dev_b']);
    const upd = store.writes[1]![2] as Record<string, unknown>;
    expect(upd.firmware).toBe('1');
    expect('status' in upd).toBe(false);
    expect('name' in upd).toBe(false);
    expect(db.devices.unsynced()).toHaveLength(0);

    // user-owned field arrives from the cloud
    expect(registry.get('dev_b')!.device.name).toBe('Phòng khách');
    expect(registry.get('dev_b')!.device.status).toBe('active');
    expect(db.snapshot.get('devices')).toBeTruthy();

    const e1 = db.snapshot.get('devices')!.etag;
    store.setRemoteDevice({ ...store.devices.get('dev_b')!, icon: 'lamp' });
    expect(db.snapshot.get('devices')!.etag).not.toBe(e1);
    rec.stop();
  });

  it('etagOf is key-order independent', () => {
    expect(etagOf({ a: 1, b: 2 })).toBe(etagOf({ b: 2, a: 1 }));
  });
});
