import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { applyEnv } from '../../src/config/load.js';
import { HubConfig } from '../../src/config/schema.js';
import { detectSea, resolveNodeCommand, startZ2m } from '../../src/supervisor/z2m.js';
import { startSupervisor } from '../../src/supervisor/index.js';

const log = pino({ level: 'silent' });

describe('Z2M node binary (OQ-B21-1)', () => {
  it('not SEA: falls back to process.execPath; SEA: never process.execPath', () => {
    expect(detectSea()).toBe(false);
    expect(resolveNodeCommand(undefined, '/x/.tools', false)).toBe(process.execPath);
    expect(() => resolveNodeCommand(undefined, join(tmpdir(), 'nope', '.tools'), true)).toThrow(/DN_NODE_PATH/);
  });

  it('explicit nodePath wins, also in SEA', () => {
    expect(resolveNodeCommand('C:\app\node\node.exe', '/x', true)).toBe('C:\app\node\node.exe');
  });

  it('SEA: uses <toolsDir>/../node/node(.exe) when present', () => {
    const base = mkdtempSync(join(tmpdir(), 'dn-sea-'));
    const exe = process.platform === 'win32' ? 'node.exe' : 'node';
    mkdirSync(join(base, 'node'));
    writeFileSync(join(base, 'node', exe), '');
    expect(resolveNodeCommand(undefined, join(base, '.tools'), true)).toBe(join(base, 'node', exe));
  });

  it('env DN_NODE_PATH (alias DN_NODE_EXE) reaches config', () => {
    expect(HubConfig.parse(applyEnv({}, { DN_NODE_PATH: '/n/node' })).nodePath).toBe('/n/node');
    expect(HubConfig.parse(applyEnv({}, { DN_NODE_EXE: '/e/node' })).nodePath).toBe('/e/node');
  });

  it('startZ2m in SEA without a node binary reports offline instead of spawning the hub exe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dn-z2m-'));
    mkdirSync(join(dir, 'tools', 'zigbee2mqtt'), { recursive: true });
    writeFileSync(join(dir, 'tools', 'zigbee2mqtt', 'index.js'), '');
    const h = await startZ2m({
      toolsDir: join(dir, 'tools'), z2mDir: join(dir, 'z2m'), runDir: join(dir, 'run'), serialPort: 'COM9', mqttPort: 1,
      z2mPassword: 'a', hubPassword: 'b', log, isSea: true, listPorts: async () => [],
    });
    expect(h.ready).toBe(false);
    expect(h.child).toBeUndefined();
  });
});

describe('externally managed services (OQ-B21-2)', () => {
  it('DN_EXTERNAL_SERVICES=1 / DN_MQTT_HOST map to supervisor config', () => {
    const c = HubConfig.parse(applyEnv({}, { DN_EXTERNAL_SERVICES: '1', DN_MQTT_HOST: 'mosquitto' }));
    expect(c.supervisor).toEqual({ manage: false, mqttHost: 'mosquitto' });
    expect(HubConfig.parse({}).supervisor.manage).toBe(true);
  });

  it('supervisor does not spawn anything and points at the external broker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dn-ext-'));
    const cfg = HubConfig.parse(applyEnv({}, { DN_EXTERNAL_SERVICES: '1', DN_MQTT_HOST: 'mosquitto' }));
    const sup = await startSupervisor({
      cfg,
      paths: { toolsDir: join(dir, 't'), mosquittoDir: join(dir, 'm'), secrets: join(dir, 's.json'), runDir: join(dir, 'run'), z2mDir: join(dir, 'z') },
      log,
    });
    expect(sup.localUrl).toBe('mqtt://mosquitto:1883');
    expect(sup.health().broker).toBe('external');
    expect(sup.localPassword).toBeUndefined();
    await sup.stop();
  });
});
