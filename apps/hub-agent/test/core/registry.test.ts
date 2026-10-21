import { describe, expect, it } from 'vitest';
import { FakeTime } from '../../src/core/clock.js';
import { Registry } from '../../src/core/registry.js';
import { fromDriverValue } from '../../src/drivers/zigbee2mqtt/values.js';
import { openStore } from '../../src/store/index.js';
import { IEEE, fixtureState, makeDevice } from './helpers.js';

describe('Registry', () => {
  it('maps deviceId ↔ externalId ↔ friendlyName', () => {
    const r = new Registry();
    const d = makeDevice();
    r.insert(d, { friendlyName: IEEE });
    expect(r.get(d.id)?.device.id).toBe(d.id);
    expect(r.getByExternalId(IEEE)?.device.id).toBe(d.id);
    expect(r.getByFriendlyName(IEEE)?.device.id).toBe(d.id);
    r.setFriendlyName(d.id, d.id);
    expect(r.getByFriendlyName(IEEE)).toBeUndefined();
    expect(r.getByFriendlyName(d.id)?.device.id).toBe(d.id);
  });

  it('merges only keys in properties, converts values, stamps at[key] only on change', () => {
    const t = new FakeTime(1000);
    const r = new Registry({ clock: t });
    const d = makeDevice();
    r.insert(d);
    const c1 = r.applyState(d.id, { ...fixtureState, bogus_key: 5 }, fromDriverValue)!;
    expect(c1.changed.sort()).toEqual(Object.keys(fixtureState).sort());
    const e = r.get(d.id)!;
    expect(e.values.state).toBe(true);
    expect(e.values.child_lock).toBe(false);
    expect(e.values).not.toHaveProperty('bogus_key');
    expect(e.lqi).toBe(120);
    expect(e.at.power).toBe(1000);

    t.advance(5000);
    const c2 = r.applyState(d.id, { ...fixtureState, power: 20 }, fromDriverValue)!;
    expect(c2.changed).toEqual(['power']);
    expect(e.at.power).toBe(6000);
    expect(e.at.voltage).toBe(1000);
    expect(e.lastSeen).toBe(6000);
  });

  it('tracks online and notifies listeners', () => {
    const r = new Registry();
    const d = makeDevice();
    r.insert(d);
    const seen: boolean[] = [];
    r.onChange((c) => seen.push(c.entry.online));
    expect(r.setOnline(d.id, false)?.onlineChanged).toBe(true);
    expect(r.setOnline(d.id, false)).toBeUndefined();
    r.applyState(d.id, { power: 1 }, fromDriverValue);
    expect(seen).toEqual([false, true]);
  });

  it('persists to SQLite and reloads on cold start (offline until availability)', () => {
    const store = openStore(':memory:');
    const r = new Registry({ repo: store.devices });
    const d = makeDevice();
    r.insert(d, { synced: false });
    r.applyState(d.id, fixtureState, fromDriverValue);
    r.markSynced(d.id, true);
    const r2 = new Registry({ repo: store.devices });
    expect(r2.load()).toBe(1);
    const e = r2.getByExternalId(IEEE)!;
    expect(e.values.power).toBe(12.4);
    expect(e.synced).toBe(true);
    expect(e.online).toBe(false);
    expect(r2.getByFriendlyName(d.id)).toBeDefined();
    store.close();
  });

  it('remove drops the entry and keeps the removed doc in SQLite', () => {
    const store = openStore(':memory:');
    const r = new Registry({ repo: store.devices });
    const d = makeDevice();
    r.insert(d);
    r.remove(d.id, { ...d, status: 'removed', removedAt: 5 });
    expect(r.get(d.id)).toBeUndefined();
    expect(store.devices.get(d.id)?.doc.status).toBe('removed');
    expect(new Registry({ repo: store.devices }).load()).toBe(0);
    store.close();
  });

  it('restart with existing devices preserves friendlyName matching deviceId (C7)', () => {
    const store = openStore(':memory:');
    const r1 = new Registry({ repo: store.devices });
    const d = makeDevice();
    r1.insert(d);
    expect(r1.getByFriendlyName(d.id)?.device.id).toBe(d.id);

    // Simulate restart
    const r2 = new Registry({ repo: store.devices });
    expect(r2.load()).toBe(1);
    const loaded = r2.get(d.id);
    expect(loaded?.friendlyName).toBe(d.id);
    expect(r2.getByFriendlyName(d.id)?.device.id).toBe(d.id);
    store.close();
  });
});
