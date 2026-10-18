import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mqtt from 'mqtt';
import { pino } from 'pino';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { mergeZ2mConfig, parseBridgeState, startZ2m, writeZ2mConfig } from '../../src/supervisor/z2m.js';
import { startBroker } from '../helpers/brokers.js';

const input = { serialPort: 'COM5', mqttPort: 1883, mqttUser: 'z2m', mqttPassword: 'pw' };
const log = pino({ level: 'silent' });
const tmp = () => mkdtempSync(join(tmpdir(), 'dn-z2m-'));

describe('z2m config', () => {
  it('generates managed keys', () => {
    const c = mergeZ2mConfig(undefined, input) as any;
    expect(c.serial).toEqual({ port: 'COM5', adapter: 'ember' });
    expect(c.frontend).toEqual({ enabled: false });
    expect(c.homeassistant).toEqual({ enabled: false });
    expect(c.availability).toEqual({ enabled: true, active: { timeout: 10 }, passive: { timeout: 1500 } });
    expect(c.mqtt).toMatchObject({ server: 'mqtt://127.0.0.1:1883', user: 'z2m', password: 'pw', base_topic: 'zigbee2mqtt' });
    expect(c.advanced.log_output).toEqual(['console']);
    expect(c.permit_join).toBeUndefined();
  });

  it('preserves devices/groups/network key and forces frontend off', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'configuration.yaml'),
      'frontend:\n  enabled: true\npermit_join: true\ndevices:\n  "0x1":\n    friendly_name: dev_01ABC\ngroups:\n  "1":\n    friendly_name: g\nadvanced:\n  network_key: [1,2,3]\n',
    );
    const c = parse(readFileSync(writeZ2mConfig(dir, input), 'utf8'));
    expect(c.devices['0x1'].friendly_name).toBe('dev_01ABC');
    expect(c.groups['1'].friendly_name).toBe('g');
    expect(c.advanced.network_key).toEqual([1, 2, 3]);
    expect(c.frontend.enabled).toBe(false);
    expect(c.permit_join).toBeUndefined();
  });

  it('parses bridge state in both formats', () => {
    expect(parseBridgeState('{"state":"online"}')).toBe('online');
    expect(parseBridgeState('online')).toBe('online');
    expect(parseBridgeState('{"state":"offline"}')).toBe('offline');
    expect(parseBridgeState('garbage')).toBeUndefined();
  });

  it('missing dongle: health error, no spawn', async () => {
    const health: any[] = [];
    const dir = tmp();
    const h = await startZ2m({
      toolsDir: dir, z2mDir: join(dir, 'z2m'), runDir: join(dir, 'run'), serialPort: 'auto', mqttPort: 1,
      z2mPassword: 'a', hubPassword: 'b', log, onHealth: (x) => health.push(x), listPorts: async () => [],
    });
    expect(h.ready).toBe(false);
    expect(h.child).toBeUndefined();
    expect(health[0].z2m).toBe('offline');
    expect(health[0].lastError).toMatch(/Không tìm thấy USB Zigbee/);
  });

  it('hang (no bridge/state) -> timeout surfaces lastError', async () => {
    const broker = await startBroker();
    const health: any[] = [];
    const dir = tmp();
    const h = await startZ2m({
      toolsDir: dir, z2mDir: join(dir, 'z2m'), runDir: join(dir, 'run'), serialPort: 'COM99', mqttPort: broker.port,
      z2mPassword: 'a', hubPassword: 'b', log, onHealth: (x) => health.push(x), readyTimeoutMs: 700,
      command: process.execPath, args: ['-e', 'setTimeout(()=>{},30000)'],
    });
    expect(h.ready).toBe(false);
    expect(h.health.lastError).toMatch(/không online sau/);
    expect(health.at(-1).z2m).toBe('offline');
    await h.stop();
    await broker.close();
  }, 15000);

  it('bridge/state online -> ready', async () => {
    const broker = await startBroker();
    const pub = mqtt.connect(broker.url);
    await new Promise((r) => pub.once('connect', r));
    pub.publish('zigbee2mqtt/bridge/state', '{"state":"online"}', { retain: true });
    const dir = tmp();
    const h = await startZ2m({
      toolsDir: dir, z2mDir: join(dir, 'z2m'), runDir: join(dir, 'run'), serialPort: 'COM99', mqttPort: broker.port,
      z2mPassword: 'a', hubPassword: 'b', log, readyTimeoutMs: 5000,
      command: process.execPath, args: ['-e', 'setTimeout(()=>{},30000)'],
    });
    expect(h.ready).toBe(true);
    expect(h.health.z2m).toBe('online');
    await h.stop();
    pub.end(true);
    await broker.close();
  }, 15000);
});
