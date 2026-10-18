import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { MqttClient } from 'mqtt';
import { FakeTime } from '../../src/core/clock.js';
import { MqttLink } from '../../src/bridge/mqttLink.js';
import { cloudUrl } from '../../src/bridge/bridge.js';
import { buildStatus } from '../../src/bridge/heartbeat.js';

class FakeClient extends EventEmitter {
  reconnect = vi.fn(() => this);
  subscribe = vi.fn();
  publish = vi.fn();
  end = vi.fn((_f: boolean, _o: object, cb: () => void) => cb());
}

function setup() {
  const time = new FakeTime();
  const fc = new FakeClient();
  const onConnect = vi.fn();
  let opts: any;
  const link = new MqttLink({
    name: 'x',
    url: 'mqtt://h:1',
    timers: time,
    subscriptions: () => ['a/b', 'c/#'],
    onConnect,
    allowPublish: (t) => t.startsWith('t/'),
    connect: (_u, o) => {
      opts = o;
      return fc as unknown as MqttClient;
    },
  });
  link.start();
  return { time, fc, link, onConnect, opts: () => opts };
}

describe('MqttLink', () => {
  it('disables mqtt.js auto-reconnect and backs off 1 → 60 s', () => {
    const { time, fc, link, opts } = setup();
    expect(opts().reconnectPeriod).toBe(0);
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      const d = link.nextBackoffMs;
      delays.push(d);
      fc.emit('close');
      time.advance(d - 1);
      expect(fc.reconnect).toHaveBeenCalledTimes(i);
      time.advance(1);
      expect(fc.reconnect).toHaveBeenCalledTimes(i + 1);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  });

  it('resets backoff, subscribes and calls onConnect on every connect', () => {
    const { fc, link, onConnect } = setup();
    fc.emit('close');
    fc.emit('close');
    fc.emit('connect');
    expect(link.connected).toBe(true);
    expect(link.nextBackoffMs).toBe(1000);
    expect(fc.subscribe).toHaveBeenCalledWith(['a/b', 'c/#'], { qos: 1 }, expect.any(Function));
    fc.emit('close');
    fc.emit('connect');
    expect(fc.subscribe).toHaveBeenCalledTimes(2);
    expect(onConnect).toHaveBeenCalledTimes(2);
  });

  it('publishes with the given policy only when connected and allowed', () => {
    const { fc, link } = setup();
    link.publish('t/x', Buffer.from('1'), { qos: 1, retain: true });
    expect(fc.publish).not.toHaveBeenCalled();
    fc.emit('connect');
    link.publish('zigbee2mqtt/bridge/state', Buffer.from('1'), { qos: 0, retain: false });
    link.publish('t/x', Buffer.from('1'), { qos: 1, retain: true });
    expect(fc.publish).toHaveBeenCalledTimes(1);
    expect(fc.publish.mock.calls[0]!.slice(0, 3)).toEqual(['t/x', Buffer.from('1'), { qos: 1, retain: true }]);
  });

  it('stop cancels pending reconnect', async () => {
    const { time, fc, link } = setup();
    fc.emit('close');
    await link.stop();
    time.advance(120_000);
    expect(fc.reconnect).not.toHaveBeenCalled();
  });
});

describe('cloudUrl (OQ-8)', () => {
  const c = { host: 'vm.example', port: 8883 };
  it('mqtts by default, mqtt in emulator or with TLS off', () => {
    expect(cloudUrl(c, { emulator: false, cloudMqttTls: true })).toBe('mqtts://vm.example:8883');
    expect(cloudUrl(c, { emulator: true, cloudMqttTls: true })).toBe('mqtt://vm.example:8883');
    expect(cloudUrl(c, { emulator: false, cloudMqttTls: false })).toBe('mqtt://vm.example:8883');
  });
});

describe('buildStatus', () => {
  it('fills HubStatus fields', () => {
    const s = buildStatus({ agentVersion: '0.0.1', z2m: () => 'online', z2mVersion: () => '2.14.2', lanUrl: () => 'http://192.168.1.2:8080', ip: () => '192.168.1.2', platform: 'windows', deviceCount: () => 3 });
    expect(s).toEqual({ online: true, agentVersion: '0.0.1', z2m: 'online', z2mVersion: '2.14.2', lanUrl: 'http://192.168.1.2:8080', ip: '192.168.1.2', platform: 'windows', deviceCount: 3 });
  });
});
