import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load.js';
import { resolvePaths } from '../src/config/paths.js';

function yamlFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const file = join(dir, 'config.yaml');
  writeFileSync(file, content);
  return file;
}

describe('config', () => {
  it('defaults without file', () => {
    const c = loadConfig({ env: {} });
    expect(c.serialPort).toBe('auto');
    expect(c.dataDir).toBe('./.data/hub');
    expect(c.lan).toEqual({ enabled: true, bind: '0.0.0.0', port: 8080, webDir: 'apps/web/dist-lan' });
    expect(c.mqttLocal).toEqual({ port: 1883, wsPort: 9001 });
    expect(c.apiBaseUrl).toBe('http://127.0.0.1:3000');
    expect(c.emulator).toBe(false);
  });

  it('merges yaml and applies partial nested defaults', () => {
    const file = yamlFile('serialPort: COM3\nlan:\n  port: 9090\nlog:\n  level: debug\n');
    const c = loadConfig({ file, env: {} });
    expect(c.serialPort).toBe('COM3');
    expect(c.lan.port).toBe(9090);
    expect(c.lan.bind).toBe('0.0.0.0');
    expect(c.log.level).toBe('debug');
  });

  it('env overrides win over yaml', () => {
    const file = yamlFile('apiBaseUrl: http://x.test\ndataDir: ./a\n');
    const c = loadConfig({
      file,
      env: {
        DN_EMULATOR: '1',
        DN_MOCK_Z2M: 'true',
        DN_API_BASE_URL: 'http://127.0.0.1:4000',
        DN_CLOUD_MQTT_TLS: '0',
        DN_TOOLS_DIR: '/t',
        DN_DATA_DIR: '/d',
      },
    });
    expect(c).toMatchObject({
      emulator: true,
      mockZ2m: true,
      apiBaseUrl: 'http://127.0.0.1:4000',
      cloudMqttTls: false,
      toolsDir: '/t',
      dataDir: '/d',
    });
  });

  it('rejects invalid config with readable message', () => {
    const file = yamlFile('lan:\n  port: 99999\n');
    expect(() => loadConfig({ file, env: {} })).toThrow(/lan\.port/);
  });

  it('paths helper', () => {
    const p = resolvePaths({ dataDir: './d', toolsDir: undefined }, { cwd: resolve('/work'), repoRoot: resolve('/repo') });
    expect(p.dataDir).toBe(resolve('/work', 'd'));
    expect(p.hubKey).toBe(resolve('/work', 'd', 'hub.key'));
    expect(p.toolsDir).toBe(resolve('/repo', '.tools'));
    expect(resolvePaths({ dataDir: 'd', toolsDir: '/x' }).toolsDir).toBe(resolve('/x'));
  });
});
