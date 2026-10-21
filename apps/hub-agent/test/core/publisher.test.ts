import { DeviceState, PairingState, topics } from '@devicenet/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeTime } from '../../src/core/clock.js';
import { Publisher } from '../../src/core/publisher.js';
import { Registry } from '../../src/core/registry.js';
import { fromDriverValue } from '../../src/drivers/zigbee2mqtt/values.js';
import { IDENTITY, fixtureState, makeDevice, recordingLink, type Sent } from './helpers.js';

describe('Publisher', () => {
  let t: FakeTime;
  let reg: Registry;
  let pub: Publisher;
  let sent: Sent[];
  const dev = makeDevice();
  const stateTopic = topics.state(IDENTITY.tenantId, IDENTITY.hubId, dev.id);
  const states = () => sent.filter((s) => s.link === 'local' && s.topic === stateTopic);

  beforeEach(() => {
    t = new FakeTime(1_000_000);
    reg = new Registry({ clock: t });
    reg.insert(dev);
    sent = [];
    pub = new Publisher({ registry: reg, clock: t, timers: t });
    pub.addLink('local', recordingLink('local', sent));
    pub.addLink('cloud', recordingLink('cloud', sent));
    pub.setIdentity(IDENTITY);
  });

  const change = (raw: Record<string, unknown>) => {
    reg.applyState(dev.id, raw, fromDriverValue);
    pub.stateChanged(dev.id);
  };

  it('publishes nothing while unclaimed', () => {
    pub.setIdentity(null);
    change(fixtureState);
    t.advance(1000);
    expect(pub.publishHub('events', { x: 1 })).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('fans out identical bytes to every link with topicPolicy QoS/retain; payload parses as DeviceState', () => {
    change(fixtureState);
    t.advance(200);
    const local = sent.filter((s) => s.link === 'local');
    const cloud = sent.filter((s) => s.link === 'cloud');
    expect(local).toHaveLength(1);
    expect(cloud).toHaveLength(1);
    expect(local[0]!.payload.equals(cloud[0]!.payload)).toBe(true);
    expect(local[0]!.opts).toEqual({ qos: 1, retain: true });
    const st = DeviceState.parse(local[0]!.json);
    expect(st).toMatchObject({ v: 1, deviceId: dev.id, online: true, lqi: 120, values: { state: true, power: 12.4 } });
    expect(st.ts).toBe(1_000_200);
  });

  it('coalesces changes within 200 ms into one snapshot and throttles to ≤ 1 msg/s/device', () => {
    change({ power: 1 });
    t.advance(50);
    change({ power: 2 });
    t.advance(100);
    change({ power: 3 });
    t.advance(50); // 200 ms after first change
    expect(states()).toHaveLength(1);
    expect(states()[0]!.json.values.power).toBe(3);
    change({ power: 4 });
    t.advance(200);
    expect(states()).toHaveLength(1); // throttled until 1 s after last publish
    t.advance(800);
    expect(states()).toHaveLength(2);
    expect(states()[1]!.json.values.power).toBe(4);
    expect(states()[1]!.json.seq).toBeGreaterThan(states()[0]!.json.seq);
  });

  it('forces a republish 60 s after the last publish', () => {
    change({ power: 1 });
    t.advance(200);
    expect(states()).toHaveLength(1);
    t.advance(59_999);
    expect(states()).toHaveLength(1);
    t.advance(1);
    expect(states()).toHaveLength(2);
    t.advance(60_000);
    expect(states()).toHaveLength(3);
  });

  it('single seq counter across topics, strictly increasing', () => {
    change({ power: 1 });
    t.advance(200);
    pub.publishPairing({ active: false, found: [] });
    pub.publishHub('ack', { id: 'cmd_01HZZZZZZZZZZZZZZZZZZZZZZZ', ok: true });
    const seqs = sent.filter((s) => s.link === 'local').map((s) => s.json.seq);
    expect(seqs).toEqual([1_000_001, 1_000_002, 1_000_003]);
    const pairing = sent.find((s) => s.topic === topics.pairing(IDENTITY.tenantId, IDENTITY.hubId))!;
    expect(pairing.opts).toEqual({ qos: 1, retain: true });
    PairingState.parse(pairing.json);
    const ack = sent.find((s) => s.topic === topics.ack(IDENTITY.tenantId, IDENTITY.hubId))!;
    expect(ack.opts).toEqual({ qos: 1, retain: false });
  });

  it('restart after 5ms: new publisher instance seq > last seq of previous instance', () => {
    const t0 = new FakeTime(1_700_000_000_000);
    const pub1 = new Publisher({ registry: reg, clock: t0, timers: t0 });
    pub1.setIdentity(IDENTITY);
    const m1 = pub1.publishHub('events', { ev: 1 })!;
    const m2 = pub1.publishHub('events', { ev: 2 })!;
    expect(m2.seq).toBeGreaterThan(m1.seq);
    const lastSeq1 = pub1.lastSeq;

    // 5ms later, hub restarts -> Instance 2
    t0.advance(5);
    const pub2 = new Publisher({ registry: reg, clock: t0, timers: t0 });
    pub2.setIdentity(IDENTITY);
    const m3 = pub2.publishHub('events', { ev: 3 })!;
    expect(m3.seq).toBeGreaterThan(lastSeq1);
  });

  it('clearState publishes an empty retained payload and stops timers', () => {
    change({ power: 1 });
    t.advance(200);
    pub.clearState(dev.id);
    const last = states().at(-1)!;
    expect(last.payload.length).toBe(0);
    expect(last.opts.retain).toBe(true);
    t.advance(120_000);
    expect(states().at(-1)).toBe(last);
  });

  it('republishAll replays status, pairing and every device state', () => {
    pub.setStatusProvider(() => ({ online: true, agentVersion: '0.0.1', z2m: 'online' }));
    pub.publishPairing({ active: false, found: [] });
    sent.length = 0;
    pub.republishAll();
    const topicsSent = sent.filter((s) => s.link === 'local').map((s) => s.topic);
    expect(topicsSent).toEqual([
      topics.status(IDENTITY.tenantId, IDENTITY.hubId),
      topics.pairing(IDENTITY.tenantId, IDENTITY.hubId),
      stateTopic,
    ]);
  });

  it('a failing link does not block the others', () => {
    pub.addLink('broken', {
      publish: () => {
        throw new Error('down');
      },
    });
    change({ power: 1 });
    t.advance(200);
    expect(states()).toHaveLength(1);
    expect(sent.filter((s) => s.link === 'cloud')).toHaveLength(1);
  });
});
