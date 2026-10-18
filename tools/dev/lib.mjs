// Shared helpers for tools/dev/run.mjs and tools/smoke/local.mjs (plain Node, no deps).
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const isWin = process.platform === 'win32';

const req = (pkgDir) => createRequire(join(repoRoot, pkgDir, 'package.json'));
/** tsx CLI entry (run with `node <tsxCli> [watch] file.ts`, no shell needed) */
export const tsxCli = () => req('apps/hub-agent').resolve('tsx/cli');
export const firebaseCli = () => join(repoRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
export const viteCli = () => join(repoRoot, 'apps', 'web', 'node_modules', 'vite', 'bin', 'vite.js');
export const hasWeb = () => existsSync(join(repoRoot, 'apps', 'web', 'package.json')) && existsSync(viteCli());

export const EMU = { project: 'demo-devicenet', auth: 9099, firestore: 8085, ui: 4000 };

/**
 * Process env without corporate proxy variables: a proxy breaks gRPC/HTTP to the emulators,
 * the api, and the dev broker webhook. NO_PROXY covers anything that still reads a proxy.
 * `keepProxy`: the Firebase CLI itself may need the proxy once (Emulator UI download) — it honours NO_PROXY.
 */
export function cleanEnv(extra = {}, { keepProxy = false } = {}) {
  const env = { ...process.env };
  if (!keepProxy) for (const k of Object.keys(env)) if (/^(https?|grpc|all)_proxy$/i.test(k)) delete env[k];
  env.NO_PROXY = env.no_proxy = '127.0.0.1,localhost';
  env.NO_UPDATE_NOTIFIER = '1';
  env.FORCE_COLOR ??= '1';
  return { ...env, ...extra };
}

export function emulatorEnv() {
  return {
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${EMU.firestore}`,
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${EMU.auth}`,
    GCLOUD_PROJECT: EMU.project,
    FIREBASE_PROJECT_ID: EMU.project,
  };
}

/** true when something accepts TCP on host:port within `ms` */
export function tcpOpen(port, host = '127.0.0.1', ms = 500) {
  return new Promise((res) => {
    const s = createConnection({ port, host });
    const done = (v) => {
      s.destroy();
      res(v);
    };
    s.setTimeout(ms, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

export async function waitTcp(port, { host = '127.0.0.1', timeoutMs = 30_000, name = String(port), child } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`${name} exited (code ${child.exitCode}) before opening :${port}`);
    if (await tcpOpen(port, host)) return;
    await sleep(150);
  }
  throw new Error(`${name} did not open ${host}:${port} within ${timeoutMs} ms`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COLORS = [36, 33, 35, 32, 34, 91, 96];
let colorIdx = 0;

/**
 * Spawn a child (no shell) with line-prefixed output. Returns the ChildProcess with `.label`.
 * `onLine(line)` sees every stdout/stderr line (smoke uses it to sniff logs).
 */
export function startProc(label, command, args, { cwd = repoRoot, env, quiet = false, onLine } = {}) {
  const color = COLORS[colorIdx++ % COLORS.length];
  const tag = process.stdout.isTTY ? `\x1b[${color}m[${label}]\x1b[0m` : `[${label}]`;
  const child = spawn(command, args, { cwd, env: env ?? cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.label = label;
  const pipe = (stream, out) => {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        onLine?.(line);
        if (!quiet) out.write(`${tag} ${line}\n`);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code, sig) => {
    if (!quiet) process.stdout.write(`${tag} exited (${sig ?? code})\n`);
  });
  child.on('error', (e) => process.stderr.write(`${tag} spawn error: ${e.message}\n`));
  return child;
}

/** Kill a child and its whole tree (Windows: taskkill /T /F). Resolves when done. */
export function killTree(child) {
  return new Promise((res) => {
    if (!child || child.exitCode !== null || child.pid === undefined) return res();
    if (isWin) {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => res());
    } else {
      try {
        child.kill('SIGTERM');
      } catch {
        /* gone */
      }
      const t = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* gone */
        }
        res();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(t);
        res();
      });
    }
  });
}

/** Ask a child to stop gracefully (SIGINT where possible), then kill its tree after `graceMs`. */
export async function stopProc(child, graceMs = 3000) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  if (!isWin) {
    try {
      child.kill('SIGINT');
    } catch {
      /* gone */
    }
    await Promise.race([exited, sleep(graceMs)]);
  }
  await killTree(child);
}

export function emulatorsProc(opts = {}) {
  return startProc(
    'emu',
    process.execPath,
    [firebaseCli(), 'emulators:start', '--only', 'auth,firestore', '--project', EMU.project],
    { env: cleanEnv({ ...opts.env }, { keepProxy: true }), quiet: opts.quiet, onLine: opts.onLine },
  );
}
