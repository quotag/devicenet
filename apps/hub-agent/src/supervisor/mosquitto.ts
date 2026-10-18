import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Logger } from 'pino';
import { ManagedChild, type ChildWarning } from './child.js';

const execFileP = promisify(execFile);
const isWin = process.platform === 'win32';

export interface MosquittoSecrets {
  hub: string;
  z2m: string;
}

/** Read/merge `secrets.json`; creates random mosquitto passwords once. Other keys are preserved. */
export function loadOrCreateSecrets(file: string): MosquittoSecrets {
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    /* new file */
  }
  const cur = (all.mosquitto ?? {}) as Partial<MosquittoSecrets>;
  const sec: MosquittoSecrets = {
    hub: cur.hub ?? randomBytes(18).toString('base64url'),
    z2m: cur.z2m ?? randomBytes(18).toString('base64url'),
  };
  if (cur.hub !== sec.hub || cur.z2m !== sec.z2m) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...all, mosquitto: sec }, null, 2), { mode: 0o600 });
  }
  return sec;
}

export interface MosquittoConfInput {
  port: number;
  wsPort: number;
  passwdFile: string;
  aclFile: string;
  anonAclFile: string;
}

const fwd = (p: string) => p.replace(/\\/g, '/');

export function buildMosquittoConf(i: MosquittoConfInput): string {
  return [
    'per_listener_settings true',
    'persistence false',
    'log_dest stdout',
    '',
    `listener ${i.port} 127.0.0.1`,
    'allow_anonymous false',
    `password_file ${fwd(i.passwdFile)}`,
    `acl_file ${fwd(i.aclFile)}`,
    '',
    `listener ${i.wsPort} 0.0.0.0`,
    'protocol websockets',
    'allow_anonymous true',
    `acl_file ${fwd(i.anonAclFile)}`,
    '',
  ].join('\n');
}

export function buildAcl(): string {
  return ['user hub', 'topic readwrite #', '', 'user z2m', 'topic readwrite zigbee2mqtt/#', ''].join('\n');
}

/** Anonymous WS listener (FR-H11): read t/#, write set/cmd only, nothing on zigbee2mqtt/#. */
export function buildAnonAcl(): string {
  return ['topic read t/#', 'topic write t/+/h/+/d/+/set', 'topic write t/+/h/+/cmd', ''].join('\n');
}

export function mosquittoBinary(toolsDir: string, name: 'mosquitto' | 'mosquitto_passwd' = 'mosquitto'): string {
  return isWin ? join(toolsDir, 'mosquitto', `${name}.exe`) : name;
}

export function mosquittoAvailable(toolsDir: string): boolean {
  return !isWin || existsSync(mosquittoBinary(toolsDir));
}

export interface MosquittoOptions {
  toolsDir: string;
  mosquittoDir: string;
  secretsFile: string;
  runDir: string;
  port: number;
  wsPort: number;
  log: Logger;
  onWarning?: (w: ChildWarning) => void;
}

/** Write conf/passwd/acl (regenerated every start). */
export async function prepareMosquitto(o: MosquittoOptions) {
  mkdirSync(o.mosquittoDir, { recursive: true });
  const secrets = loadOrCreateSecrets(o.secretsFile);
  const f = {
    conf: join(o.mosquittoDir, 'mosquitto.conf'),
    passwd: join(o.mosquittoDir, 'passwd'),
    acl: join(o.mosquittoDir, 'acl'),
    anonAcl: join(o.mosquittoDir, 'acl.anon'),
  };
  writeFileSync(f.acl, buildAcl());
  writeFileSync(f.anonAcl, buildAnonAcl());
  writeFileSync(
    f.conf,
    buildMosquittoConf({ port: o.port, wsPort: o.wsPort, passwdFile: f.passwd, aclFile: f.acl, anonAclFile: f.anonAcl }),
  );
  const passwdBin = mosquittoBinary(o.toolsDir, 'mosquitto_passwd');
  await execFileP(passwdBin, ['-b', '-c', f.passwd, 'hub', secrets.hub], { windowsHide: true });
  await execFileP(passwdBin, ['-b', f.passwd, 'z2m', secrets.z2m], { windowsHide: true });
  return { files: f, secrets };
}

export function waitForTcp(port: number, host: string, timeoutMs: number, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const s = createConnection({ port, host });
      s.once('connect', () => {
        s.destroy();
        resolve(true);
      });
      s.once('error', () => {
        s.destroy();
        if (Date.now() >= deadline) resolve(false);
        else setTimeout(attempt, intervalMs);
      });
    };
    attempt();
  });
}

export interface MosquittoHandle {
  child: ManagedChild;
  secrets: MosquittoSecrets;
  stop(): Promise<void>;
}

/** Generate config, spawn Mosquitto under the watchdog, wait for TCP readiness (15 s). */
export async function startMosquitto(o: MosquittoOptions): Promise<MosquittoHandle> {
  const { files, secrets } = await prepareMosquitto(o);
  const child = new ManagedChild({
    name: 'mosquitto',
    command: mosquittoBinary(o.toolsDir),
    args: ['-c', files.conf],
    runDir: o.runDir,
    log: o.log,
    onWarning: o.onWarning,
  });
  await child.start();
  const ready = await waitForTcp(o.port, '127.0.0.1', 15_000);
  if (!ready) {
    o.log.error({ port: o.port }, 'Mosquitto không sẵn sàng sau 15 s');
    await child.stop();
    throw new Error(`Mosquitto did not open 127.0.0.1:${o.port} within 15 s`);
  }
  return { child, secrets, stop: () => child.stop() };
}
