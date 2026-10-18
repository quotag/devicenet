import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAcl, buildAnonAcl, buildMosquittoConf, loadOrCreateSecrets } from '../../src/supervisor/mosquitto.js';

describe('mosquitto config', () => {
  it('golden conf', () => {
    expect(
      buildMosquittoConf({ port: 1883, wsPort: 9001, passwdFile: 'C:\\d\\passwd', aclFile: 'C:\\d\\acl', anonAclFile: 'C:\\d\\acl.anon' }),
    ).toBe(`per_listener_settings true
persistence false
log_dest stdout

listener 1883 127.0.0.1
allow_anonymous false
password_file C:/d/passwd
acl_file C:/d/acl

listener 9001 0.0.0.0
protocol websockets
allow_anonymous true
acl_file C:/d/acl.anon
`);
  });
  it('acl files', () => {
    expect(buildAcl()).toBe('user hub\ntopic readwrite #\n\nuser z2m\ntopic readwrite zigbee2mqtt/#\n');
    const anon = buildAnonAcl();
    expect(anon).toContain('topic read t/#');
    expect(anon).toContain('topic write t/+/h/+/d/+/set');
    expect(anon).toContain('topic write t/+/h/+/cmd');
    expect(anon).not.toContain('zigbee2mqtt');
  });
  it('secrets are stable', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'dn-sec-')), 'secrets.json');
    const a = loadOrCreateSecrets(f);
    expect(a.hub).not.toBe(a.z2m);
    expect(loadOrCreateSecrets(f)).toEqual(a);
    expect(JSON.parse(readFileSync(f, 'utf8')).mosquitto).toEqual(a);
  });
});
